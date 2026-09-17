# Requirements Document

## Project: CivicLens — Civic Complaint Routing & Accountability Platform

---

## 1. Overview

### 1.1 Problem Statement
Citizens have no low-friction way to report civic issues (potholes, garbage, broken streetlights, water leaks) that guarantees the report reaches the *correct* department, is tracked transparently, and holds the responsible authority accountable to a deadline. Existing government portals are slow, poorly routed, and offer no real accountability trail.

### 1.2 Solution Summary
A citizen photographs an issue. An AI pipeline classifies the issue and drafts a formal complaint. The system geofences the location to the correct ward and routes it to the correct department automatically. An SLA clock starts immediately, escalates automatically on breach, and every status change is logged in an auditable trail — visible to the citizen and, in aggregate, to the public.

### 1.3 Goals
- G1: Reduce the time and effort required for a citizen to file a correctly-categorized, correctly-routed complaint to under 60 seconds.
- G2: Make department accountability structural (enforced by the system) rather than discretionary.
- G3: Resist gaming/abuse (spam, coordinated flooding) without requiring manual moderation to scale.
- G4: Demonstrate a genuinely production-shaped architecture (async processing, geospatial indexing, horizontal scalability) rather than a classroom CRUD app.

### 1.4 Out of Scope (v1)
- Payment processing / fines
- Multi-city deployment (single pilot city/ward-set for the course project)
- Native mobile apps (a responsive PWA is sufficient)
- Automated field-worker dispatch/routing (human officials assign manually)

---

## 2. Stakeholders / User Roles

| Role | Description |
|---|---|
| **Citizen** | Reports issues, tracks status, confirms/disputes resolution |
| **Department Official** | Reviews assigned complaints, updates status, submits resolution proof |
| **Supervisor** | Receives escalated (SLA-breached) complaints |
| **City Admin** | Views aggregate dashboards, manages wards/departments/SLA rules |
| **Public / Auditor** | Views anonymized, aggregate accountability dashboard (read-only, no login required) |

---

## 3. Functional Requirements

### 3.1 Citizen-Facing (FR-C)
- **FR-C1**: User can register/log in via phone number + OTP.
- **FR-C2**: User can submit a complaint via **live camera capture only** (no gallery upload) plus auto-captured GPS location.
- **FR-C3**: User can optionally attach a free-text note to the complaint.
- **FR-C4**: System returns a complaint ID and estimated SLA deadline immediately upon submission (before AI processing completes).
- **FR-C5**: User can view live status of their complaint (Submitted → Assigned → In Progress → Resolved → Closed), including who last updated it and when.
- **FR-C6**: User receives SMS/email notification on every status change.
- **FR-C7**: User can confirm a resolution as satisfactory (→ Closed) or dispute it (→ Reopened).
- **FR-C8**: User can view a public heatmap of reported issues in their area.

### 3.2 Official-Facing (FR-O)
- **FR-O1**: Official sees an incoming queue of complaints filtered to their ward + department, sorted by SLA urgency.
- **FR-O2**: Official sees a separate **low-confidence review queue** for complaints the AI classifier could not confidently categorize, and must manually confirm/correct the category.
- **FR-O3**: Official can assign a complaint to a field worker and update its status.
- **FR-O4**: Official must attach a photo + notes as proof when marking a complaint Resolved.
- **FR-O5**: Every status change made by an official is logged with official ID, timestamp, and notes (immutable).

### 3.3 Admin-Facing (FR-A)
- **FR-A1**: Admin can configure wards, departments, and category→department mappings.
- **FR-A2**: Admin can configure SLA rules (resolution hours per category × severity).
- **FR-A3**: Admin can view department-level performance: SLA compliance %, average resolution time, complaint volume, trend over time.
- **FR-A4**: Admin can review flagged clusters (suspected coordinated/spam activity) and take action (suspend accounts, merge duplicates).

### 3.4 AI / LLM Requirements (FR-AI)
- **FR-AI1**: System classifies each submitted photo into a category (pothole, garbage, streetlight, water_leak, other), severity (low/medium/high), and a confidence score.
- **FR-AI2**: If confidence is below a configurable threshold (default 0.6), the complaint routes to the official's low-confidence review queue instead of auto-processing.
- **FR-AI3**: System drafts a formatted complaint description grounded strictly in the structured classification output and the citizen's note — no invented facts.
- **FR-AI4**: The vision model is explicitly instructed to treat any text/signage visible in a photo as descriptive content only, never as instructions (prompt-injection guardrail).

### 3.5 Location & Routing (FR-L)
- **FR-L1**: System resolves a GPS point to a ward polygon using PostGIS spatial queries.
- **FR-L2**: If a point falls outside all ward polygons (GPS noise), system falls back to the nearest ward within a configurable distance threshold.
- **FR-L3**: Ward → department routing uses a configurable lookup table (category × ward → department/official).
- **FR-L4**: If a department has multiple officials in a ward, assignment balances by current open-complaint load.

### 3.6 Anti-Abuse & Trust (FR-T)
- **FR-T1**: A submission starts as a **report** (low trust) and only becomes a **verified complaint** (starts SLA clock, counts toward public accountability metrics) after independent confirmation or official field verification.
- **FR-T2**: Each account has a trust score, weighted by history of verified-vs-rejected past reports.
- **FR-T3**: Rate limiting applied per account, per device fingerprint, and per phone number.
- **FR-T4**: System detects duplicate reports via perceptual image hashing + location proximity, and links duplicates to a single canonical complaint rather than creating separate SLA clocks.
- **FR-T5**: System detects abnormal temporal/spatial clustering (many reports, same small area, short time window, low-trust accounts) and flags the cluster for admin review rather than auto-processing.
- **FR-T6**: EXIF capture-timestamp and (where available) EXIF geotag are cross-checked against submission metadata; mismatches are flagged.

### 3.7 SLA & Escalation (FR-S)
- **FR-S1**: Every verified complaint has an SLA deadline computed from `sla_rules` (category × severity).
- **FR-S2**: A scheduled process checks for SLA breaches and automatically escalates overdue complaints to a supervisor — no manual trigger required.
- **FR-S3**: Escalation is visible to the citizen and counted against the department's public compliance metric.

---

## 4. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | API response for complaint submission (excluding async AI processing) < 500ms |
| NFR-2 | Scalability | AI/CV processing workers must be horizontally scalable (stateless, queue-consumer pattern) |
| NFR-3 | Reliability | Failed AI processing jobs retry with exponential backoff; after N failures, route to human review instead of silent failure |
| NFR-4 | Reliability | Status updates and audit-log writes occur in the same DB transaction (no partial state) |
| NFR-5 | Security | Role-based access control — citizens see only their own complaints; officials see only their ward/department queue |
| NFR-6 | Security | Photo access via signed, time-limited URLs — storage bucket never publicly exposed |
| NFR-7 | Security | Submission endpoint rate-limited to control abuse and LLM API cost |
| NFR-8 | Integrity | Status history is tamper-evident (hash-chained records) |
| NFR-9 | Privacy | Complaint data handling aligned with India's Digital Personal Data Protection Act (DPDP), 2023 — citizen PII never exposed on the public accountability dashboard |
| NFR-10 | Availability | Core submission flow must degrade gracefully if the LLM API is unavailable (queue holds jobs, retries once service resumes, rather than rejecting submissions) |
| NFR-11 | Usability | Citizen flow (capture → submit → confirmation) completable in under 60 seconds on a low-end Android device |
| NFR-12 | Maintainability | Category→department mappings and SLA rules configurable by admin without a code deploy |

---

## 5. System Architecture (Summary)

```
Client apps (Citizen PWA + Admin dashboard)
        │
        ▼
   API server (FastAPI) ── validates, stores photo, creates DB row, enqueues job, returns immediately
        │
        ▼
   Queue (Redis + Celery)
        │
        ▼
   CV + LLM worker(s) ── classify → confidence check → draft complaint → geofence lookup → routing
        │
        ▼
   PostgreSQL + PostGIS ── complaints, wards, users, officials, SLA rules, audit log
        │
   SLA scheduler (Celery beat / cron) ── scans for breaches, auto-escalates
        │
   Third-party services ── Vision/LLM API, SMS/email gateway
```

Full component and DB schema detail: see architecture diagrams and schema tables discussed in project notes.

---

## 6. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React + Tailwind |
| Maps | Leaflet + OpenStreetMap |
| Backend/API | Python + FastAPI |
| Queue | Redis + Celery |
| Database | PostgreSQL + PostGIS |
| Cache | Redis |
| Object storage | S3-compatible / MinIO (dev) |
| LLM/Vision | Claude or GPT-4 vision-capable API |
| Notifications | Twilio (SMS), SendGrid (email) |
| Auth | JWT (OAuth2 password flow via FastAPI) |
| Deployment | Docker Compose (local) → Render/Railway (demo) |
| CI/CD | GitHub Actions |

---

## 7. Complaint Lifecycle (State Machine)

```
Submitted → Assigned → In Progress → Resolved → Closed
                  │                      │
                  ▼ (SLA breach)         ▼ (citizen disputes)
              Escalated              Reopened
           (reassigned upward)    (back to Assigned)
```

---

## 8. Team Roles (3-person team)

| Person | Responsibility |
|---|---|
| A | Backend API, PostGIS schema, ward/department routing, SLA scheduler |
| B | Frontend — citizen upload flow, admin dashboard, map views |
| C | CV/LLM worker pipeline, prompt design, guardrails, queue integration, deployment |

---

## 9. Assumptions & Constraints
- Pilot scope limited to one city (or a representative subset of wards) with available/approximated boundary data.
- LLM API usage is rate-limited/budgeted; system must degrade gracefully (queue + retry) rather than fail hard under quota limits.
- Officials are provisioned by admin (no public self-registration for the official role).
- Course-project timeline (~12–14 weeks) constrains scope to a single pilot city and core feature set above; multi-city/multi-language support noted as future work.

---

## 10. Future Enhancements (Not in v1)
- Regional-language complaint drafting and citizen-facing translation
- Native mobile apps with offline-first sync
- Field-worker dispatch optimization
- Public API for journalists/RTI use of aggregate accountability data
- Hash-chain migration to a verifiable, exportable audit format

---

## Change Log
| Date | Change | Author |
|---|---|---|
| — | Initial draft generated from project discussion | — |
| — | Project name finalized as CivicLens | — |
