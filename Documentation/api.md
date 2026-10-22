# CivicLens — API Reference Specification

This document details all API interfaces implemented in the CivicLens platform. It enumerates every route in the **FastAPI backend** (`backend/main.py`), documents request and response schemas defined in `backend/schemas.py`, and outlines direct **Supabase Database / Storage interfaces** leveraged by the client tier.

---

## 1. FastAPI Backend API Reference

The backend runs on **FastAPI** (`http://<host>:8000`), serving RESTful endpoints for submission, listing, detail retrieval, on-demand AI classification, and public geospatial analysis.

### Summary of Endpoints

| Method | Path | Resource Group | Auth Required | Description |
|---|---|---|---|---|
| `GET` | `/health` | System | No | Health check probe and service version |
| `POST` | `/api/complaints` | Complaints | No (v1) | Submit a new complaint (photo + GPS coordinates + note) |
| `GET` | `/api/complaints` | Complaints | No (v1) | Paginated list of complaints with optional status filter |
| `GET` | `/api/complaints/{complaint_id}` | Complaints | No (v1) | Full complaint details with joined ward/dept names and audit trail |
| `POST` | `/api/complaints/{complaint_id}/classify` | Complaints | No (Admin/Dev) | Trigger on-demand AI vision classification and routing pipeline |
| `POST` | `/api/complaints/{complaint_id}/confirm` | Citizen Loop | No (v1) | Citizen confirms resolution (FR-C7: Resolved -> Closed) |
| `POST` | `/api/complaints/{complaint_id}/dispute` | Citizen Loop | No (v1) | Citizen disputes resolution with reason & photo (FR-C7: Resolved -> Reopened) |
| `POST` | `/api/complaints/{complaint_id}/resolve` | Official | No (v1) | Official resolves complaint with proof notes & photo (FR-O4) |
| `POST` | `/api/sla/check` | SLA / Automation | No (Admin/Dev) | Manually trigger SLA escalation scan for overdue complaints |
| `POST` | `/api/sla/auto-close` | SLA / Automation | No (Admin/Dev) | Manually trigger auto-close check for 7-day stale resolved tickets |
| `GET` | `/api/complaints/heatmap` | Public / Geospatial | No | Anonymized geospatial points for map rendering (DPDP compliant) |

---

### 1.1 System Endpoints

#### `GET /health`
Probes the running FastAPI application status.

- **HTTP Method**: `GET`
- **Path**: `/health`
- **Authentication**: None
- **Request Parameters**: None
- **Response Status Code**: `200 OK`
- **Response Schema (`HealthResponse`)**:
  ```json
  {
    "status": "ok",
    "version": "0.1.0",
    "service": "civiclens-backend"
  }
  ```

---

### 1.2 Complaints Resource

#### `POST /api/complaints`
Accepts a live-captured photo, GPS coordinates, and an optional citizen description. Uploads the image binary to Supabase Storage, records an initial database entry with status `Submitted`, logs the initial citizen audit entry, and spawns the AI classification pipeline asynchronously as a background task.

- **HTTP Method**: `POST`
- **Path**: `/api/complaints`
- **Authentication**: None (accepts anonymous or app-mediated reports in v1; citizen JWT tied in Phase 4)
- **Request Content-Type**: `multipart/form-data`
- **Request Form Fields**:
  | Field | Type | Required | Description |
  |---|---|---|---|
  | `photo` | `UploadFile` (binary) | **Yes** | Image file (JPEG/PNG) of the civic defect. |
  | `latitude` | `float` | **Yes** | Device GPS latitude coordinate. |
  | `longitude` | `float` | **Yes** | Device GPS longitude coordinate. |
  | `description` | `string` | No | Optional citizen description or contextual note. |

- **Response Status Code**: `201 Created`
- **Response Schema (`ComplaintSubmitResponse`)**:
  ```json
  {
    "id": "bffb95a9-64c8-4e35-962b-4a177d0d3d3e",
    "status": "Submitted",
    "message": "Complaint submitted successfully. AI classification in progress."
  }
  ```
- **Error Responses**:
  - `422 Unprocessable Entity`: Validation failure on missing photo or coordinates.
  - `500 Internal Server Error`: Storage upload or database insertion failure.

---

#### `GET /api/complaints`
Returns a paginated list of complaints ordered newest first.

- **HTTP Method**: `GET`
- **Path**: `/api/complaints`
- **Authentication**: None (public in v1; filtered to user profile in Phase 4)
- **Query Parameters**:
  | Parameter | Type | Default | Validation | Description |
  |---|---|---|---|---|
  | `limit` | `integer` | `50` | `1 <= limit <= 100` | Maximum number of records to return. |
  | `offset` | `integer` | `0` | `offset >= 0` | Pagination offset. |
  | `status` | `string` | `null` | Optional | Filter by status (e.g., `Submitted`, `Assigned`, `In Progress`, `Resolved`). |

- **Response Status Code**: `200 OK`
- **Response Schema (`list[ComplaintListItem]`)**:
  ```json
  [
    {
      "id": "bffb95a9-64c8-4e35-962b-4a177d0d3d3e",
      "description": "Deep pothole outside Thapar University gate 1",
      "category": "pothole",
      "status": "Assigned",
      "photo_url": "https://nlegghskxmlxzgywhibv.supabase.co/storage/v1/object/public/complaint-photos/complaint-1789147951972.jpg",
      "created_at": "2026-09-17T16:15:30.123456+00:00"
    }
  ]
  ```

---

#### `GET /api/complaints/{complaint_id}`
Retrieves full details for a single complaint, including multimodal AI assessment scores, spatial ward resolution, assigned department and official, SLA resolution deadline, and the complete audit trail.

- **HTTP Method**: `GET`
- **Path**: `/api/complaints/{complaint_id}`
- **Authentication**: None
- **Path Parameters**:
  | Parameter | Type | Description |
  |---|---|---|
  | `complaint_id` | `string` (UUID) | Unique identifier of the complaint. |

- **Response Status Code**: `200 OK`
- **Response Schema (`ComplaintDetailWithAudit`)**:
  ```json
  {
    "id": "bffb95a9-64c8-4e35-962b-4a177d0d3d3e",
    "description": "Deep pothole outside Thapar University gate 1",
    "category": "pothole",
    "severity": "high",
    "status": "Assigned",
    "confidence_score": 0.92,
    "ai_description": "Substantial asphalt subsidence and roadway crater visible with high risk to two-wheelers.",
    "photo_url": "https://nlegghskxmlxzgywhibv.supabase.co/storage/v1/object/public/complaint-photos/complaint-1789147951972.jpg",
    "latitude": 30.3560,
    "longitude": 76.3570,
    "ward_id": "10000000-0000-0000-0000-000000000001",
    "department_id": "00000000-0000-0000-0000-000000000001",
    "assigned_to": null,
    "sla_deadline": "2026-09-18T16:15:30.123456+00:00",
    "created_at": "2026-09-17T16:15:30.123456+00:00",
    "updated_at": "2026-09-17T16:15:34.654321+00:00",
    "ward_name": "Thapar / Bhadson Road",
    "department_name": "Roads & Infrastructure",
    "official_name": null,
    "audit_trail": [
      {
        "id": 1,
        "action": "complaint_submitted",
        "old_value": null,
        "new_value": "Submitted",
        "actor_id": null,
        "actor_role": "citizen",
        "notes": "Complaint submitted by citizen via mobile app.",
        "created_at": "2026-09-17T16:15:30.123456+00:00"
      },
      {
        "id": 2,
        "action": "ai_classification_and_routing",
        "old_value": "Submitted",
        "new_value": "Assigned",
        "actor_id": null,
        "actor_role": "system",
        "notes": "AI categorized as 'pothole', severity 'high', confidence 0.92, Ward: Thapar / Bhadson Road, Dept: Roads & Infrastructure",
        "created_at": "2026-09-17T16:15:34.654321+00:00"
      }
    ]
  }
  ```
- **Error Responses**:
  - `404 Not Found`: Complaint with the specified UUID does not exist.

---

#### `POST /api/complaints/{complaint_id}/classify`
Triggers immediate on-demand execution of the Gemini multimodal vision classification and PostGIS routing pipeline on an existing complaint record. Used for testing, admin re-evaluation, or backfilling unprocessed tickets.

- **HTTP Method**: `POST`
- **Path**: `/api/complaints/{complaint_id}/classify`
- **Authentication**: None (internal / administrative endpoint)
- **Path Parameters**:
  | Parameter | Type | Description |
  |---|---|---|
  | `complaint_id` | `string` (UUID) | Unique identifier of the complaint. |

- **Request Body**: None
- **Response Status Code**: `200 OK`
- **Response Structure**:
  ```json
  {
    "complaint_id": "bffb95a9-64c8-4e35-962b-4a177d0d3d3e",
    "status": "Assigned",
    "category": "pothole",
    "severity": "high",
    "confidence_score": 0.92,
    "ward_id": "10000000-0000-0000-0000-000000000001",
    "ward_name": "Thapar / Bhadson Road",
    "department_id": "00000000-0000-0000-0000-000000000001",
    "department_name": "Roads & Infrastructure",
    "assigned_to": null,
    "sla_deadline": "2026-09-18T16:15:30.123456+00:00",
    "ai_description": "Substantial asphalt subsidence and roadway crater visible with high risk to two-wheelers."
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Complaint does not have a valid `photo_url`.
  - `404 Not Found`: Complaint record not found.

---

### 1.3 Public / Geospatial Resource

#### `GET /api/complaints/heatmap`
Returns anonymized complaint geographic coordinates, category, severity, and status for public map visualization (FR-C8).

- **HTTP Method**: `GET`
- **Path**: `/api/complaints/heatmap`
- **Authentication**: None (Publicly accessible)
- **Privacy Compliance**: Strictly aligned with India's Digital Personal Data Protection Act (DPDP), 2023 (NFR-9). **Zero citizen PII, user IDs, notes, or photo URLs are exposed.**
- **Query Parameters**:
  | Parameter | Type | Default | Validation | Description |
  |---|---|---|---|---|
  | `limit` | `integer` | `500` | `1 <= limit <= 2000` | Maximum number of coordinate points. |

- **Response Status Code**: `200 OK`
- **Response Schema (`list[HeatmapPoint]`)**:
  ```json
  [
    {
      "latitude": 30.3560,
      "longitude": 76.3570,
      "category": "pothole",
      "severity": "high",
      "status": "Assigned"
    },
    {
      "latitude": 30.3421,
      "longitude": 76.3689,
      "category": "garbage",
      "severity": "medium",
      "status": "In Progress"
    }
  ]
  ```

---

### 1.4 Citizen Resolution Loop (FR-C7)

#### `POST /api/complaints/{complaint_id}/confirm`
Citizen confirms that the reported civic defect has been satisfactorily resolved. Transitions complaint status from `Resolved` to `Closed`, stamps `closed_at`, and records an immutable audit entry.

- **HTTP Method**: `POST`
- **Path**: `/api/complaints/{complaint_id}/confirm`
- **Authentication**: None (v1) / Citizen JWT (Phase 4)
- **Request Content-Type**: `application/json`
- **Request Body (`ConfirmResolutionRequest`)**:
  ```json
  {
    "notes": "Verified on site. Roadway is smooth and cleared."
  }
  ```
- **Response Status Code**: `200 OK`
- **Response Schema (`ResolutionActionResponse`)**:
  ```json
  {
    "id": "5effdf40-876a-489d-82d7-3cae3ae92758",
    "status": "Closed",
    "message": "Resolution confirmed successfully. Complaint is now Closed."
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Complaint is not in `Resolved` status.
  - `404 Not Found`: Complaint not found.

---

#### `POST /api/complaints/{complaint_id}/dispute`
Citizen disputes that the issue was resolved (e.g. work incomplete or defect still hazardous). Transitions status from `Resolved` to `Reopened`, optionally uploads citizen proof photo, and appends an immutable dispute audit entry.

- **HTTP Method**: `POST`
- **Path**: `/api/complaints/{complaint_id}/dispute`
- **Authentication**: None (v1) / Citizen JWT (Phase 4)
- **Request Content-Type**: `multipart/form-data`
- **Request Form Fields**:
  | Field | Type | Required | Description |
  |---|---|---|---|
  | `reason` | `string` | **Yes** | Detailed explanation of why the repair is incomplete. |
  | `photo` | `UploadFile` (binary) | No | Optional live photo proof taken by citizen showing unresolved issue. |
- **Response Status Code**: `200 OK`
- **Response Schema (`ResolutionActionResponse`)**:
  ```json
  {
    "id": "5effdf40-876a-489d-82d7-3cae3ae92758",
    "status": "Reopened",
    "message": "Resolution disputed. Complaint has been reopened and returned to the department queue."
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: Complaint is not in `Resolved` status.
  - `404 Not Found`: Complaint not found.

---

### 1.5 Official Resolution Resource (FR-O4)

#### `POST /api/complaints/{complaint_id}/resolve`
Municipal official marks an active complaint (`Assigned`, `In Progress`, `Escalated`, or `Reopened`) as `Resolved`. Attaches mandatory repair notes and optional proof photo of the completed work. Opens the 7-day citizen confirmation window.

- **HTTP Method**: `POST`
- **Path**: `/api/complaints/{complaint_id}/resolve`
- **Authentication**: None (v1) / Official JWT (Phase 4)
- **Request Content-Type**: `multipart/form-data`
- **Request Form Fields**:
  | Field | Type | Required | Description |
  |---|---|---|---|
  | `resolution_notes` | `string` | **Yes** | Engineering remarks describing the repair work completed. |
  | `resolution_photo` | `UploadFile` (binary) | No | Official proof photo of the completed site. |
- **Response Status Code**: `200 OK`
- **Response Schema (`ResolutionActionResponse`)**:
  ```json
  {
    "id": "5effdf40-876a-489d-82d7-3cae3ae92758",
    "status": "Resolved",
    "message": "Complaint marked as Resolved. Citizen confirmation window is now active."
  }
  ```

---

### 1.6 SLA Governance & Automation Endpoints

#### `POST /api/sla/check`
On-demand trigger to scan for active complaints (`Assigned`, `In Progress`) whose `sla_deadline < NOW()`. Overdue tickets are auto-escalated to `Escalated` status and audit logged. (The background worker already executes this every 60 seconds automatically).

- **HTTP Method**: `POST`
- **Path**: `/api/sla/check`
- **Authentication**: None (Admin/Dev)
- **Response Status Code**: `200 OK`
- **Response Example**:
  ```json
  {
    "escalated_count": 1,
    "message": "SLA check complete. 1 complaint(s) escalated."
  }
  ```

---

#### `POST /api/sla/auto-close`
On-demand trigger to scan for complaints that have been in `Resolved` status for $\ge$ `days` (default: 7) without citizen confirmation or dispute. Automatically transitions them to `Closed`.

- **HTTP Method**: `POST`
- **Path**: `/api/sla/auto-close`
- **Query Parameters**:
  | Parameter | Type | Default | Description |
  |---|---|---|---|
  | `days` | `integer` | `7` | Stale threshold in days (`1 <= days <= 30`). |
- **Response Status Code**: `200 OK`
- **Response Example**:
  ```json
  {
    "closed_count": 0,
    "message": "No stale resolved complaints found."
  }
  ```

---

## 2. Direct Supabase Client Resources

To eliminate cellular network bottlenecks and bypass local network firewalls, the React Native client interacts directly with Supabase cloud endpoints for low-latency CRUD operations:

### 2.1 Storage Bucket: `complaint-photos`
- **Protocol**: S3-compatible REST API / Supabase JS Storage SDK.
- **Upload Endpoint**: `POST /storage/v1/object/complaint-photos/{filename}`
- **Security Check**: Bucket policy allows `anon` and `authenticated` inserts into `complaint-photos`.
- **Public URL**: `GET /storage/v1/object/public/complaint-photos/{filename}`

### 2.2 Relational PostgREST Endpoints (Mobile Client Direct Access)
- `POST /rest/v1/complaints`: Instant insertion of complaint metadata from `SubmitComplaintScreen.js`.
- `GET /rest/v1/complaints?id=eq.{id}&select=*`: Direct polling (< 100ms) by `ComplaintDetailScreen.js` every 2.5s.
- `GET /rest/v1/complaints?select=status`: Aggregated query used by `HomeScreen.js` to compute live stats counters (*Submitted*, *In Progress*, *Resolved*).
- `GET /rest/v1/complaints?select=*&order=created_at.desc`: User ticket history used by `MyComplaintsScreen.js`.

### 2.3 Community Upvoting Interface (`complaint_upvotes`)
- **Table**: `complaint_upvotes (id, complaint_id, user_id, created_at)`
- **Composite Primary Key**: `(complaint_id, user_id)` guarantees one upvote per user per ticket.
- **Toggle Upvote**:
  - `POST /rest/v1/complaint_upvotes`: Inserts upvote record.
  - `DELETE /rest/v1/complaint_upvotes?complaint_id=eq.{cid}&user_id=eq.{uid}`: Removes upvote record.
- **Database Trigger**: `sync_complaint_upvote_count` automatically updates `complaints.upvote_count` using atomic `COUNT(*)` in PostgreSQL.
