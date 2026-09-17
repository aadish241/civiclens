"""
CivicLens Backend — Geospatial Routing & SLA Service (Phase 3)
Connects AI classification outputs with PostGIS ward boundaries,
department lookup rules, and dynamic SLA computation.
"""

import logging
from typing import Any, Dict, Optional
from database import supabase_admin
from config import get_settings

logger = logging.getLogger("civiclens.routing")


async def route_and_assign_complaint(
    complaint_id: str,
    ai_result: Dict[str, Any],
    latitude: Optional[float] = None,
    longitude: Optional[float] = None
) -> Dict[str, Any]:
    """
    Executes PostGIS ward determination, department lookup, SLA calculation,
    and updates the complaint record + audit log in Supabase.
    """
    settings = get_settings()

    ward_id: Optional[str] = None
    ward_name: Optional[str] = None
    department_id: Optional[str] = None
    department_name: Optional[str] = None
    assigned_to: Optional[str] = None
    sla_deadline: Optional[str] = None

    category = ai_result["category"]
    severity = ai_result["severity"]
    confidence = ai_result["confidence_score"]
    is_civic = ai_result["is_civic_issue"]

    # 1. PostGIS Ward Lookup
    if latitude is not None and longitude is not None:
        try:
            ward_rpc = supabase_admin.rpc(
                "find_ward_for_point",
                {"lat": latitude, "lng": longitude}
            ).execute()
            ward_id = ward_rpc.data
            if ward_id:
                w_row = supabase_admin.table("wards").select("name").eq("id", ward_id).single().execute()
                if w_row.data:
                    ward_name = w_row.data.get("name")
        except Exception as e:
            logger.warning(f"Ward lookup failed for ({latitude}, {longitude}): {e}")

    # 2. Category -> Department Routing Lookup
    try:
        # First check for ward-specific routing override
        if ward_id:
            dept_res = (
                supabase_admin.table("category_routing")
                .select("department_id, departments(name)")
                .eq("category", category)
                .eq("ward_id", ward_id)
                .execute()
            )
            if dept_res.data:
                department_id = dept_res.data[0].get("department_id")
                dept_obj = dept_res.data[0].get("departments")
                if dept_obj:
                    department_name = dept_obj.get("name")

        # Fallback to city-wide default routing (ward_id IS NULL)
        if not department_id:
            dept_res = (
                supabase_admin.table("category_routing")
                .select("department_id, departments(name)")
                .eq("category", category)
                .is_("ward_id", "null")
                .execute()
            )
            if dept_res.data:
                department_id = dept_res.data[0].get("department_id")
                dept_obj = dept_res.data[0].get("departments")
                if dept_obj:
                    department_name = dept_obj.get("name")
    except Exception as e:
        logger.error(f"Department routing lookup failed: {e}")

    # 3. Official Assignment (if officials are configured)
    if ward_id and department_id:
        try:
            off_rpc = supabase_admin.rpc(
                "find_official_for_complaint",
                {"p_ward_id": ward_id, "p_department_id": department_id}
            ).execute()
            assigned_to = off_rpc.data
        except Exception as e:
            logger.warning(f"Official assignment RPC error: {e}")

    # 4. SLA Deadline Computation
    try:
        sla_rpc = supabase_admin.rpc(
            "compute_sla_deadline",
            {"p_category": category, "p_severity": severity}
        ).execute()
        sla_deadline = sla_rpc.data
    except Exception as e:
        logger.error(f"SLA calculation failed: {e}")

    # 5. Determine New Status
    # FR-AI2: Confidence < threshold or non-civic photo triggers Low-Confidence review
    if (not is_civic) or (confidence < settings.ai_confidence_threshold):
        new_status = "Low-Confidence"
    elif department_id is not None:
        new_status = "Assigned"
    else:
        new_status = "Submitted"

    # 6. Update Complaint Record in Supabase
    update_payload = {
        "category": category,
        "severity": severity,
        "confidence_score": confidence,
        "ai_description": ai_result.get("ai_description"),
        "ward_id": ward_id,
        "department_id": department_id,
        "assigned_to": assigned_to,
        "sla_deadline": sla_deadline,
        "status": new_status,
    }

    supabase_admin.table("complaints").update(update_payload).eq("id", complaint_id).execute()

    # 7. Record Immutable Audit Log Entry
    notes_parts = [
        f"AI categorized as '{category}'",
        f"severity '{severity}'",
        f"confidence {confidence:.2f}"
    ]
    if ward_name:
        notes_parts.append(f"Ward: {ward_name}")
    if department_name:
        notes_parts.append(f"Dept: {department_name}")
    if not is_civic:
        notes_parts.append("[Flagged as Non-Civic Object/Spam]")

    audit_entry = {
        "complaint_id": complaint_id,
        "actor_role": "system",
        "action": "ai_classification_and_routing",
        "old_value": "Submitted",
        "new_value": new_status,
        "notes": ", ".join(notes_parts)
    }
    try:
        supabase_admin.table("audit_logs").insert(audit_entry).execute()
    except Exception as e:
        logger.warning(f"Failed to record audit log for {complaint_id}: {e}")

    logger.info(
        f"Complaint {complaint_id} processed: category={category}, severity={severity}, "
        f"status={new_status}, ward={ward_name}, dept={department_name}"
    )

    return {
        "complaint_id": complaint_id,
        "status": new_status,
        "category": category,
        "severity": severity,
        "confidence_score": confidence,
        "ward_id": ward_id,
        "ward_name": ward_name,
        "department_id": department_id,
        "department_name": department_name,
        "assigned_to": assigned_to,
        "sla_deadline": sla_deadline,
        "ai_description": ai_result.get("ai_description"),
    }
