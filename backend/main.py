"""
CivicLens Backend — FastAPI Application
========================================
Phase 2: Core API endpoints for complaint management.

Endpoints:
  POST /api/complaints          → Submit a new complaint (photo + GPS + note)
  GET  /api/complaints          → List all complaints (paginated)
  GET  /api/complaints/{id}     → Get complaint detail with audit trail
  GET  /api/complaints/heatmap  → GeoJSON-like data for public heatmap
  GET  /health                  → Health check
"""

import uuid
import time
import logging
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from database import supabase_admin
from ai_service import analyze_complaint_image
from routing_service import route_and_assign_complaint
from schemas import (
    ComplaintSubmitResponse,
    ComplaintDetail,
    ComplaintDetailWithAudit,
    ComplaintListItem,
    AuditLogEntry,
    HeatmapPoint,
    HealthResponse,
)

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("civiclens")

settings = get_settings()


async def run_complaint_pipeline(
    complaint_id: str,
    photo_url: str,
    user_description: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
) -> dict:
    """
    Background worker task:
    1. Calls Gemini 3.6 Flash to classify photo and assess severity.
    2. Runs PostGIS boundary and SLA routing logic.
    3. Updates the complaint record and audit trail.
    """
    logger.info(f"Triggering AI classification pipeline for complaint {complaint_id}...")
    try:
        # 1. Multimodal AI Analysis
        ai_result = await analyze_complaint_image(photo_url, user_description)
        logger.info(
            f"AI classification complete for {complaint_id}: "
            f"category={ai_result['category']}, severity={ai_result['severity']}, "
            f"confidence={ai_result['confidence_score']:.2f}"
        )

        # 2. Geospatial Ward, Dept, Official & SLA routing
        routing_result = await route_and_assign_complaint(
            complaint_id=complaint_id,
            ai_result=ai_result,
            latitude=latitude,
            longitude=longitude,
        )
        return routing_result

    except Exception as e:
        logger.error(f"Complaint pipeline execution failed for {complaint_id}: {e}", exc_info=True)
        try:
            supabase_admin.table("complaints").update({
                "status": "Low-Confidence",
                "category": "other",
                "severity": "low",
                "ai_description": f"Analysis encountered error: {str(e)[:150]}. Sent for human review.",
            }).eq("id", complaint_id).execute()

            supabase_admin.table("audit_logs").insert({
                "complaint_id": complaint_id,
                "actor_role": "system",
                "action": "ai_pipeline_failed",
                "notes": f"AI pipeline error: {str(e)[:200]}"
            }).execute()
        except Exception:
            pass
        return {"error": str(e), "complaint_id": complaint_id}


async def poll_unprocessed_complaints():
    """
    Autonomous background poller: watches Supabase for complaints in 'Submitted' status
    with 'pending' category. This immediately catches complaints submitted directly from
    mobile devices via Supabase cloud storage/database, classifying them in 2-4 seconds.
    """
    logger.info("Autonomous AI complaint worker started — watching Supabase for pending submissions...")
    while True:
        try:
            res = (
                supabase_admin.table("complaints")
                .select("id, photo_url, description, latitude, longitude")
                .eq("status", "Submitted")
                .eq("category", "pending")
                .order("created_at", desc=False)
                .limit(5)
                .execute()
            )
            items = res.data or []
            for item in items:
                cid = item["id"]
                purl = item.get("photo_url")
                if not purl:
                    continue
                logger.info(f"[Auto-Worker] Picked up unclassified complaint {cid}. Marking Processing...")
                # Immediately mark as Processing so it is not re-queried on next tick
                supabase_admin.table("complaints").update({"status": "Processing"}).eq("id", cid).execute()

                # Process asynchronously in background
                asyncio.create_task(
                    run_complaint_pipeline(
                        complaint_id=cid,
                        photo_url=purl,
                        user_description=item.get("description"),
                        latitude=item.get("latitude"),
                        longitude=item.get("longitude"),
                    )
                )
        except Exception as err:
            logger.error(f"[Auto-Worker] Polling error: {err}")

        await asyncio.sleep(3)


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker_task = asyncio.create_task(poll_unprocessed_complaints())
    try:
        yield
    finally:
        worker_task.cancel()
        try:
            await worker_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="CivicLens API",
    description="Civic Complaint Routing & Accountability Platform",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow the mobile app and future web dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """Basic health probe."""
    return HealthResponse()


# ---------------------------------------------------------------------------
# POST /api/complaints — Submit a new complaint
# ---------------------------------------------------------------------------

@app.post(
    "/api/complaints",
    response_model=ComplaintSubmitResponse,
    status_code=201,
    tags=["Complaints"],
    summary="Submit a new civic complaint",
)
async def submit_complaint(
    background_tasks: BackgroundTasks,
    photo: UploadFile = File(..., description="Live-captured photo of the issue"),
    latitude: float = Form(..., description="GPS latitude"),
    longitude: float = Form(..., description="GPS longitude"),
    description: Optional[str] = Form(None, description="Optional citizen note"),
):
    """
    Accepts a photo + GPS coordinates + optional description.
    Uploads the photo to Supabase Storage, creates the complaint record,
    and returns the complaint ID immediately (NFR-1: < 500ms target).

    The AI classification worker (Phase 3) will pick this up asynchronously.
    """
    start = time.time()

    try:
        # 1. Read photo bytes
        photo_bytes = await photo.read()
        file_ext = photo.filename.split(".")[-1] if photo.filename else "jpg"
        file_name = f"complaint-{uuid.uuid4().hex}.{file_ext}"

        # 2. Upload to Supabase Storage
        upload_result = supabase_admin.storage.from_("complaint-photos").upload(
            path=file_name,
            file=photo_bytes,
            file_options={"content-type": photo.content_type or "image/jpeg"},
        )

        # 3. Get public URL
        public_url_data = supabase_admin.storage.from_("complaint-photos").get_public_url(file_name)

        # 4. Insert complaint record
        complaint_data = {
            "description": description,
            "category": "pending",  # AI worker classifies this later
            "status": "Submitted",
            "photo_url": public_url_data,
            "latitude": latitude,
            "longitude": longitude,
        }

        result = (
            supabase_admin.table("complaints")
            .insert(complaint_data)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create complaint record")

        complaint_id = result.data[0]["id"]

        # 5. Create initial audit log entry
        audit_entry = {
            "complaint_id": complaint_id,
            "action": "complaint_submitted",
            "new_value": "Submitted",
            "actor_role": "citizen",
            "notes": "Complaint submitted by citizen via mobile app.",
        }
        supabase_admin.table("audit_logs").insert(audit_entry).execute()

        elapsed = round((time.time() - start) * 1000)
        logger.info(f"Complaint {complaint_id} created in {elapsed}ms")

        # 6. Enqueue AI classification & geospatial routing as background task (Phase 3)
        background_tasks.add_task(
            run_complaint_pipeline,
            complaint_id=complaint_id,
            photo_url=public_url_data,
            user_description=description,
            latitude=latitude,
            longitude=longitude,
        )

        return ComplaintSubmitResponse(id=complaint_id)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Complaint submission failed: {e}")
        raise HTTPException(status_code=500, detail=f"Submission failed: {str(e)}")


# ---------------------------------------------------------------------------
# GET /api/complaints — List complaints
# ---------------------------------------------------------------------------

@app.get(
    "/api/complaints",
    response_model=list[ComplaintListItem],
    tags=["Complaints"],
    summary="List all complaints (paginated)",
)
async def list_complaints(
    limit: int = Query(50, ge=1, le=100, description="Max results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    status: Optional[str] = Query(None, description="Filter by status"),
):
    """
    Returns a paginated list of complaints, newest first.
    In Phase 4 (auth), this will be scoped to the authenticated user.
    """
    query = (
        supabase_admin.table("complaints")
        .select("id, description, category, status, photo_url, created_at")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )

    if status:
        query = query.eq("status", status)

    result = query.execute()

    return [
        ComplaintListItem(
            id=row["id"],
            description=row.get("description"),
            category=row.get("category"),
            status=row["status"],
            photo_url=row.get("photo_url"),
            created_at=row["created_at"],
        )
        for row in (result.data or [])
    ]


# ---------------------------------------------------------------------------
# GET /api/complaints/heatmap — Public heatmap data (FR-C8)
# ---------------------------------------------------------------------------

@app.get(
    "/api/complaints/heatmap",
    response_model=list[HeatmapPoint],
    tags=["Public"],
    summary="Anonymized complaint locations for public heatmap",
)
async def get_heatmap_data(
    limit: int = Query(500, ge=1, le=2000, description="Max points"),
):
    """
    Returns anonymized complaint locations for the public heatmap.
    Only includes complaints that have GPS coordinates.
    No PII is exposed (NFR-9: DPDP compliance).
    """
    result = (
        supabase_admin.table("complaints")
        .select("latitude, longitude, category, severity, status")
        .not_.is_("latitude", "null")
        .not_.is_("longitude", "null")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    return [
        HeatmapPoint(
            latitude=row["latitude"],
            longitude=row["longitude"],
            category=row.get("category"),
            severity=row.get("severity"),
            status=row["status"],
        )
        for row in (result.data or [])
    ]


# ---------------------------------------------------------------------------
# GET /api/complaints/{id} — Complaint detail with audit trail
# ---------------------------------------------------------------------------

@app.get(
    "/api/complaints/{complaint_id}",
    response_model=ComplaintDetailWithAudit,
    tags=["Complaints"],
    summary="Get full complaint details with audit trail",
)
async def get_complaint_detail(complaint_id: str):
    """
    Returns complete complaint data including AI classification results,
    assigned department/official info, SLA deadline, and the full audit trail.
    """
    # Fetch complaint
    result = (
        supabase_admin.table("complaints")
        .select("*")
        .eq("id", complaint_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Complaint not found")

    complaint = result.data[0]

    # Fetch joined names (ward, department, official) if IDs exist
    ward_name = None
    department_name = None
    official_name = None

    if complaint.get("ward_id"):
        ward_result = (
            supabase_admin.table("wards")
            .select("name")
            .eq("id", complaint["ward_id"])
            .execute()
        )
        if ward_result.data:
            ward_name = ward_result.data[0]["name"]

    if complaint.get("department_id"):
        dept_result = (
            supabase_admin.table("departments")
            .select("name")
            .eq("id", complaint["department_id"])
            .execute()
        )
        if dept_result.data:
            department_name = dept_result.data[0]["name"]

    if complaint.get("assigned_to"):
        official_result = (
            supabase_admin.table("officials")
            .select("name")
            .eq("id", complaint["assigned_to"])
            .execute()
        )
        if official_result.data:
            official_name = official_result.data[0]["name"]

    # Fetch audit trail
    audit_result = (
        supabase_admin.table("audit_logs")
        .select("id, action, old_value, new_value, actor_id, actor_role, notes, created_at")
        .eq("complaint_id", complaint_id)
        .order("created_at", desc=False)
        .execute()
    )

    audit_trail = [
        AuditLogEntry(
            id=log["id"],
            action=log["action"],
            old_value=log.get("old_value"),
            new_value=log.get("new_value"),
            actor_id=str(log["actor_id"]) if log.get("actor_id") else None,
            actor_role=log.get("actor_role"),
            notes=log.get("notes"),
            created_at=log["created_at"],
        )
        for log in (audit_result.data or [])
    ]

    return ComplaintDetailWithAudit(
        id=complaint["id"],
        description=complaint.get("description"),
        category=complaint.get("category"),
        severity=complaint.get("severity"),
        status=complaint["status"],
        confidence_score=complaint.get("confidence_score"),
        ai_description=complaint.get("ai_description"),
        photo_url=complaint.get("photo_url"),
        latitude=complaint.get("latitude"),
        longitude=complaint.get("longitude"),
        ward_id=complaint.get("ward_id"),
        department_id=complaint.get("department_id"),
        assigned_to=complaint.get("assigned_to"),
        sla_deadline=str(complaint["sla_deadline"]) if complaint.get("sla_deadline") else None,
        created_at=complaint["created_at"],
        updated_at=complaint.get("updated_at"),
        ward_name=ward_name,
        department_name=department_name,
        official_name=official_name,
        audit_trail=audit_trail,
    )


# ---------------------------------------------------------------------------
# POST /api/complaints/{id}/classify — Trigger or re-run AI pipeline
# ---------------------------------------------------------------------------

@app.post(
    "/api/complaints/{complaint_id}/classify",
    tags=["Complaints"],
    summary="Trigger or re-run AI classification and routing on an existing complaint",
)
async def classify_complaint_endpoint(complaint_id: str):
    """
    On-demand trigger to classify an existing complaint with Gemini and route it.
    Useful for testing, backfilling, or admin re-evaluation.
    """
    res = (
        supabase_admin.table("complaints")
        .select("id, photo_url, description, latitude, longitude")
        .eq("id", complaint_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Complaint not found")

    c = res.data[0]
    photo_url = c.get("photo_url")
    if not photo_url:
        raise HTTPException(status_code=400, detail="Complaint has no photo_url to classify")

    result = await run_complaint_pipeline(
        complaint_id=complaint_id,
        photo_url=photo_url,
        user_description=c.get("description"),
        latitude=c.get("latitude"),
        longitude=c.get("longitude"),
    )
    return result


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )
