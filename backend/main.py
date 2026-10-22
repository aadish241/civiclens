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
from sla_scheduler import (
    check_and_escalate_sla_breaches,
    check_and_autoclose_resolved_complaints,
)
from schemas import (
    ComplaintSubmitResponse,
    ComplaintDetail,
    ComplaintDetailWithAudit,
    ComplaintListItem,
    AuditLogEntry,
    HeatmapPoint,
    HealthResponse,
    ConfirmResolutionRequest,
    DisputeResolutionRequest,
    OfficialResolveRequest,
    ResolutionActionResponse,
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


async def poll_sla_escalations():
    """
    Background worker that checks for SLA breaches every 60 seconds.
    Runs alongside the AI classification poller.
    """
    logger.info("SLA escalation scheduler started — checking every 60s for overdue complaints...")
    # Initial delay to let the server start up cleanly
    await asyncio.sleep(10)
    while True:
        try:
            count = await check_and_escalate_sla_breaches()
            if count > 0:
                logger.info(f"[SLA Scheduler] Escalated {count} complaint(s) this cycle.")

            closed = await check_and_autoclose_resolved_complaints(days_threshold=7)
            if closed > 0:
                logger.info(f"[Auto-Close] Auto-closed {closed} complaint(s) after 7 days in Resolved.")
        except Exception as err:
            logger.error(f"[SLA/Auto-Close Scheduler] Error: {err}")
        await asyncio.sleep(60)  # Check every 60 seconds


@asynccontextmanager
async def lifespan(app: FastAPI):
    ai_worker = asyncio.create_task(poll_unprocessed_complaints())
    sla_worker = asyncio.create_task(poll_sla_escalations())
    try:
        yield
    finally:
        ai_worker.cancel()
        sla_worker.cancel()
        try:
            await ai_worker
        except asyncio.CancelledError:
            pass
        try:
            await sla_worker
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
        resolved_at=str(complaint["resolved_at"]) if complaint.get("resolved_at") else None,
        closed_at=str(complaint["closed_at"]) if complaint.get("closed_at") else None,
        resolution_photo_url=complaint.get("resolution_photo_url"),
        resolution_notes=complaint.get("resolution_notes"),
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
# POST /api/sla/check — Manually trigger SLA escalation scan
# ---------------------------------------------------------------------------

@app.post(
    "/api/sla/check",
    tags=["System"],
    summary="Manually trigger SLA breach check and escalation",
)
async def manual_sla_check():
    """
    On-demand SLA breach scanner. Useful for testing or admin-triggered checks.
    The background worker already runs this every 60 seconds automatically.
    """
    count = await check_and_escalate_sla_breaches()
    return {
        "escalated_count": count,
        "message": f"SLA check complete. {count} complaint(s) escalated." if count else "No SLA breaches found.",
    }


# ---------------------------------------------------------------------------
# POST /api/complaints/{id}/confirm — Citizen confirms resolution (FR-C7)
# ---------------------------------------------------------------------------

@app.post(
    "/api/complaints/{complaint_id}/confirm",
    response_model=ResolutionActionResponse,
    tags=["Citizen Resolution Loop"],
    summary="Citizen confirms issue resolution (FR-C7: Resolved -> Closed)",
)
async def confirm_resolution(
    complaint_id: str,
    body: Optional[ConfirmResolutionRequest] = None,
):
    """
    FR-C7: Citizen confirms that the reported issue has been satisfactorily resolved.
    Transitions complaint status from 'Resolved' to 'Closed' and records an audit log entry.
    """
    res = (
        supabase_admin.table("complaints")
        .select("id, status")
        .eq("id", complaint_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Complaint not found")

    complaint = res.data[0]
    if complaint["status"] != "Resolved":
        raise HTTPException(
            status_code=400,
            detail=f"Only complaints in 'Resolved' status can be confirmed (current: '{complaint['status']}').",
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    supabase_admin.table("complaints").update({
        "status": "Closed",
        "closed_at": now_iso,
    }).eq("id", complaint_id).execute()

    notes = (body.notes.strip() if body and body.notes else "") or "Citizen confirmed resolution. Ticket closed."
    audit_entry = {
        "complaint_id": complaint_id,
        "actor_role": "citizen",
        "action": "citizen_confirmed",
        "old_value": "Resolved",
        "new_value": "Closed",
        "notes": notes,
    }
    supabase_admin.table("audit_logs").insert(audit_entry).execute()

    logger.info(f"Complaint {complaint_id} confirmed by citizen -> Closed")
    return ResolutionActionResponse(
        id=complaint_id,
        status="Closed",
        message="Resolution confirmed successfully. Complaint is now Closed.",
    )


# ---------------------------------------------------------------------------
# POST /api/complaints/{id}/dispute — Citizen disputes resolution (FR-C7)
# ---------------------------------------------------------------------------

@app.post(
    "/api/complaints/{complaint_id}/dispute",
    response_model=ResolutionActionResponse,
    tags=["Citizen Resolution Loop"],
    summary="Citizen disputes resolution (FR-C7: Resolved -> Reopened)",
)
async def dispute_resolution(
    complaint_id: str,
    reason: str = Form(..., description="Explanation of why the issue is still unresolved"),
    photo: Optional[UploadFile] = File(None, description="Optional photo proof of unresolved issue"),
):
    """
    FR-C7: Citizen disputes that the issue was resolved (e.g. work incomplete or sub-par).
    Transitions complaint status from 'Resolved' to 'Reopened' and logs the citizen's dispute notes and proof photo.
    """
    res = (
        supabase_admin.table("complaints")
        .select("id, status")
        .eq("id", complaint_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Complaint not found")

    complaint = res.data[0]
    if complaint["status"] != "Resolved":
        raise HTTPException(
            status_code=400,
            detail=f"Only complaints in 'Resolved' status can be disputed (current: '{complaint['status']}').",
        )

    dispute_photo_url = None
    if photo:
        try:
            photo_bytes = await photo.read()
            ext = photo.filename.split(".")[-1] if photo.filename else "jpg"
            file_name = f"dispute-{uuid.uuid4().hex}.{ext}"
            supabase_admin.storage.from_("complaint-photos").upload(
                path=file_name,
                file=photo_bytes,
                file_options={"content-type": photo.content_type or "image/jpeg"},
            )
            dispute_photo_url = supabase_admin.storage.from_("complaint-photos").get_public_url(file_name)
        except Exception as e:
            logger.warning(f"Could not upload dispute photo: {e}")

    # Reopen ticket
    supabase_admin.table("complaints").update({
        "status": "Reopened",
    }).eq("id", complaint_id).execute()

    notes_str = f"Citizen disputed resolution: {reason.strip()}"
    if dispute_photo_url:
        notes_str += f" | Proof photo: {dispute_photo_url}"

    audit_entry = {
        "complaint_id": complaint_id,
        "actor_role": "citizen",
        "action": "citizen_disputed",
        "old_value": "Resolved",
        "new_value": "Reopened",
        "notes": notes_str,
    }
    supabase_admin.table("audit_logs").insert(audit_entry).execute()

    logger.info(f"Complaint {complaint_id} disputed by citizen -> Reopened")
    return ResolutionActionResponse(
        id=complaint_id,
        status="Reopened",
        message="Resolution disputed. Complaint has been reopened and returned to the department queue.",
    )


# ---------------------------------------------------------------------------
# POST /api/complaints/{id}/resolve — Official marks complaint Resolved (FR-O4)
# ---------------------------------------------------------------------------

@app.post(
    "/api/complaints/{complaint_id}/resolve",
    response_model=ResolutionActionResponse,
    tags=["Official Actions"],
    summary="Mark complaint as Resolved (FR-O4: Official attaches proof & notes)",
)
async def resolve_complaint(
    complaint_id: str,
    resolution_notes: str = Form(..., description="Details of the repair or work performed"),
    resolution_photo: Optional[UploadFile] = File(None, description="Official proof photo of completed work"),
):
    """
    FR-O4: Official marks complaint as Resolved with mandatory notes and optional proof photo.
    This opens the 7-day citizen confirmation / dispute window (FR-C7).
    """
    res = (
        supabase_admin.table("complaints")
        .select("id, status")
        .eq("id", complaint_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Complaint not found")

    complaint = res.data[0]
    old_status = complaint["status"]

    resolution_photo_url = None
    if resolution_photo:
        try:
            photo_bytes = await resolution_photo.read()
            ext = resolution_photo.filename.split(".")[-1] if resolution_photo.filename else "jpg"
            file_name = f"resolution-{uuid.uuid4().hex}.{ext}"
            supabase_admin.storage.from_("complaint-photos").upload(
                path=file_name,
                file=photo_bytes,
                file_options={"content-type": resolution_photo.content_type or "image/jpeg"},
            )
            resolution_photo_url = supabase_admin.storage.from_("complaint-photos").get_public_url(file_name)
        except Exception as e:
            logger.warning(f"Could not upload resolution photo: {e}")

    now_iso = datetime.now(timezone.utc).isoformat()
    update_payload = {
        "status": "Resolved",
        "resolved_at": now_iso,
        "resolution_notes": resolution_notes.strip(),
    }
    if resolution_photo_url:
        update_payload["resolution_photo_url"] = resolution_photo_url

    supabase_admin.table("complaints").update(update_payload).eq("id", complaint_id).execute()

    audit_entry = {
        "complaint_id": complaint_id,
        "actor_role": "official",
        "action": "official_resolved",
        "old_value": old_status,
        "new_value": "Resolved",
        "notes": f"Work completed: {resolution_notes.strip()}" + (f" | Proof: {resolution_photo_url}" if resolution_photo_url else ""),
    }
    supabase_admin.table("audit_logs").insert(audit_entry).execute()

    logger.info(f"Complaint {complaint_id} marked Resolved by official (was '{old_status}')")
    return ResolutionActionResponse(
        id=complaint_id,
        status="Resolved",
        message="Complaint marked as Resolved. Citizen confirmation window is now active.",
    )


# ---------------------------------------------------------------------------
# POST /api/sla/auto-close — Trigger auto-close check for Resolved complaints
# ---------------------------------------------------------------------------

@app.post(
    "/api/sla/auto-close",
    tags=["System"],
    summary="Trigger auto-close check for Resolved complaints older than 7 days",
)
async def manual_auto_close_check(days: int = Query(7, ge=1, le=30)):
    count = await check_and_autoclose_resolved_complaints(days_threshold=days)
    return {
        "closed_count": count,
        "message": f"{count} complaint(s) auto-closed after {days} days in Resolved." if count else "No stale resolved complaints found.",
    }


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
