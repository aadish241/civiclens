"""
CivicLens Backend — Pydantic Schemas
Request/response models for the API endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ComplaintStatus(str, Enum):
    submitted = "Submitted"
    processing = "Processing"
    low_confidence = "Low-Confidence"
    assigned = "Assigned"
    in_progress = "In Progress"
    resolved = "Resolved"
    closed = "Closed"
    reopened = "Reopened"
    escalated = "Escalated"


class Severity(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------

class ComplaintSubmitResponse(BaseModel):
    """Returned immediately after POST /api/complaints (NFR-1: < 500ms)."""
    id: str
    status: str = "Submitted"
    message: str = "Complaint submitted successfully. AI classification in progress."


class ComplaintDetail(BaseModel):
    """Full complaint detail for GET /api/complaints/{id}."""
    id: str
    description: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    status: str
    confidence_score: Optional[float] = None
    ai_description: Optional[str] = None
    photo_url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    ward_id: Optional[str] = None
    department_id: Optional[str] = None
    assigned_to: Optional[str] = None
    sla_deadline: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None

    # Joined data (populated when available)
    ward_name: Optional[str] = None
    department_name: Optional[str] = None
    official_name: Optional[str] = None


class ComplaintListItem(BaseModel):
    """Summary item for GET /api/complaints list."""
    id: str
    description: Optional[str] = None
    category: Optional[str] = None
    status: str
    photo_url: Optional[str] = None
    created_at: str


class AuditLogEntry(BaseModel):
    """Single audit log entry for complaint history."""
    id: int
    action: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    actor_id: Optional[str] = None
    actor_role: Optional[str] = None
    notes: Optional[str] = None
    created_at: str


class ComplaintDetailWithAudit(ComplaintDetail):
    """Complaint detail enriched with audit trail."""
    audit_trail: list[AuditLogEntry] = []


class HeatmapPoint(BaseModel):
    """Single point for the public heatmap (FR-C8)."""
    latitude: float
    longitude: float
    category: Optional[str] = None
    severity: Optional[str] = None
    status: str


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
    service: str = "civiclens-backend"
