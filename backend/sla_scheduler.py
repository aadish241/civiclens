"""
CivicLens Backend — SLA Escalation Scheduler (FR-S)
====================================================
Background worker that periodically scans for complaints whose SLA deadline
has passed and auto-escalates them:

  1. Finds complaints in 'Assigned' or 'In Progress' status where
     sla_deadline < NOW().
  2. Updates their status to 'Escalated'.
  3. Records an immutable audit log entry for each escalation.

This runs as an asyncio task inside the FastAPI lifespan — no external
scheduler (Celery, cron) required.
"""

import logging
from datetime import datetime, timezone, timedelta
from database import supabase_admin

logger = logging.getLogger("civiclens.sla")

# Statuses eligible for SLA escalation
ESCALATABLE_STATUSES = ["Assigned", "In Progress"]


async def check_and_escalate_sla_breaches() -> int:
    """
    Scans for complaints that have breached their SLA deadline and
    escalates them. Returns the number of escalated complaints.
    """
    escalated_count = 0

    try:
        # Find complaints with a passed SLA deadline that haven't been
        # escalated, resolved, or closed yet.
        now_iso = datetime.now(timezone.utc).isoformat()

        res = (
            supabase_admin.table("complaints")
            .select("id, status, category, severity, ward_id, department_id, assigned_to, sla_deadline")
            .in_("status", ESCALATABLE_STATUSES)
            .not_.is_("sla_deadline", "null")
            .lt("sla_deadline", now_iso)
            .order("sla_deadline", desc=False)
            .limit(20)  # Process in batches to avoid long-running transactions
            .execute()
        )

        breached = res.data or []

        if not breached:
            return 0

        logger.info(f"[SLA Scheduler] Found {len(breached)} SLA-breached complaint(s). Escalating...")

        for complaint in breached:
            cid = complaint["id"]
            old_status = complaint["status"]

            try:
                # 1. Update complaint status to Escalated
                supabase_admin.table("complaints").update({
                    "status": "Escalated",
                }).eq("id", cid).execute()

                # 2. Compute how late the complaint is
                deadline = datetime.fromisoformat(complaint["sla_deadline"].replace("Z", "+00:00"))
                now = datetime.now(timezone.utc)
                overdue_hours = round((now - deadline).total_seconds() / 3600, 1)

                # 3. Record immutable audit log entry (FR-O5)
                audit_entry = {
                    "complaint_id": cid,
                    "actor_role": "system",
                    "action": "sla_escalation",
                    "old_value": old_status,
                    "new_value": "Escalated",
                    "notes": (
                        f"SLA deadline breached — overdue by {overdue_hours}h. "
                        f"Auto-escalated to supervisor. "
                        f"Category: {complaint.get('category', 'unknown')}, "
                        f"Severity: {complaint.get('severity', 'unknown')}."
                    ),
                }
                supabase_admin.table("audit_logs").insert(audit_entry).execute()

                escalated_count += 1
                logger.info(
                    f"[SLA Scheduler] Escalated complaint {cid} "
                    f"(was '{old_status}', overdue by {overdue_hours}h)"
                )

            except Exception as e:
                logger.error(f"[SLA Scheduler] Failed to escalate complaint {cid}: {e}")

    except Exception as e:
        logger.error(f"[SLA Scheduler] Scan failed: {e}")

    return escalated_count


async def check_and_autoclose_resolved_complaints(days_threshold: int = 7) -> int:
    """
    FR-C7: Automatically closes complaints that have been in 'Resolved' status
    for more than `days_threshold` days (default: 7) without citizen confirmation
    or dispute.
    """
    closed_count = 0

    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days_threshold)
        cutoff_iso = cutoff.isoformat()

        # Check complaints marked Resolved where resolved_at < cutoff
        res = (
            supabase_admin.table("complaints")
            .select("id, status, resolved_at, updated_at")
            .eq("status", "Resolved")
            .limit(20)
            .execute()
        )

        candidates = res.data or []
        for complaint in candidates:
            cid = complaint["id"]
            # Check resolved_at or fallback to updated_at
            ts_str = complaint.get("resolved_at") or complaint.get("updated_at")
            if not ts_str:
                continue

            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            if ts <= cutoff:
                try:
                    now_iso = datetime.now(timezone.utc).isoformat()
                    # 1. Update status to Closed
                    supabase_admin.table("complaints").update({
                        "status": "Closed",
                        "closed_at": now_iso,
                    }).eq("id", cid).execute()

                    # 2. Add audit log
                    audit_entry = {
                        "complaint_id": cid,
                        "actor_role": "system",
                        "action": "auto_closed",
                        "old_value": "Resolved",
                        "new_value": "Closed",
                        "notes": f"Auto-closed by system after {days_threshold} days of inactivity without citizen dispute (FR-C7).",
                    }
                    supabase_admin.table("audit_logs").insert(audit_entry).execute()
                    closed_count += 1
                    logger.info(f"[Auto-Close] Complaint {cid} auto-closed after {days_threshold} days in Resolved.")
                except Exception as e:
                    logger.error(f"[Auto-Close] Failed to auto-close complaint {cid}: {e}")

    except Exception as e:
        logger.error(f"[Auto-Close] Scan failed: {e}")

    return closed_count
