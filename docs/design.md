# CivicLens — System Design & Architecture Specification

This document provides a comprehensive technical architecture and design reference for **CivicLens**, an automated municipal grievance triage and geospatial accountability platform. The contents reflect the verified implementation in the codebase.

---

## 1. Architectural Overview

CivicLens adopts a decoupled, event-driven, asynchronous architecture designed for high availability on mobile networks:

1. **Client Tier**: A cross-platform mobile client built using **React Native and Expo**, designed to capture geotagged images directly from hardware sensors.
2. **Cloud Data Tier**: **Supabase (PostgreSQL 15 with the PostGIS extension)** providing relational tables, spatial polygon geometry, binary object storage (`complaint-photos`), and Row-Level Security (RLS).
3. **Autonomous Worker Tier**: A Python backend service built with **FastAPI and Asyncio**, running an autonomous polling daemon that consumes unprocessed complaints, orchestrates **Google Gemini Multimodal Vision AI** for automated classification, and executes **PostGIS point-in-polygon spatial routing**.

---

## 2. Entity-Relationship (ER) Diagram

The following ER diagram is generated directly from [`supabase/schema.sql`](../supabase/schema.sql) and includes every table, column, data type, primary key (PK), foreign key (FK), and relational constraint.

```mermaid
erDiagram
    USERS ||--o{ COMPLAINTS : "files"
    USERS {
        uuid id PK "references auth.users"
        text phone "unique, phone+OTP login"
        text display_name
        real trust_score "default 0.5, 0.0 to 1.0"
        boolean is_suspended "default false"
        timestamptz created_at
        timestamptz updated_at
    }

    DEPARTMENTS ||--o{ OFFICIALS : "employs"
    DEPARTMENTS ||--o{ CATEGORY_ROUTING : "handles"
    DEPARTMENTS ||--o{ COMPLAINTS : "assigned_department"
    DEPARTMENTS {
        uuid id PK "default uuid_generate_v4()"
        text name "unique"
        timestamptz created_at
    }

    WARDS ||--o{ OFFICIAL_WARDS : "covered_by"
    WARDS ||--o{ CATEGORY_ROUTING : "overrides"
    WARDS ||--o{ COMPLAINTS : "located_in"
    WARDS {
        uuid id PK "default uuid_generate_v4()"
        text name "unique"
        text code "unique, e.g. W-01"
        geometry boundary "Polygon, SRID 4326 (GiST indexed)"
        timestamptz created_at
    }

    OFFICIALS ||--o{ OFFICIAL_WARDS : "assigned_wards"
    OFFICIALS ||--o{ COMPLAINTS : "assigned_official"
    OFFICIALS {
        uuid id PK "references auth.users"
        uuid department_id FK "references departments.id"
        text display_name
        text role "check (official, supervisor, admin)"
        boolean is_active "default true"
        timestamptz created_at
    }

    OFFICIAL_WARDS {
        uuid official_id PK, FK "references officials.id"
        uuid ward_id PK, FK "references wards.id"
    }

    CATEGORY_ROUTING {
        uuid id PK "default uuid_generate_v4()"
        text category "e.g. pothole, garbage, streetlight"
        uuid ward_id FK "nullable, references wards.id (NULL = city default)"
        uuid department_id FK "references departments.id"
    }

    SLA_RULES {
        uuid id PK "default uuid_generate_v4()"
        text category "unique with severity"
        text severity "check (low, medium, high)"
        int resolution_hours "check (> 0)"
    }

    COMPLAINTS ||--o{ AUDIT_LOGS : "audit_trail"
    COMPLAINTS ||--o{ COMPLAINT_DUPLICATES : "canonical"
    COMPLAINTS ||--o{ COMPLAINT_DUPLICATES : "duplicate"
    COMPLAINTS {
        uuid id PK "default uuid_generate_v4()"
        uuid user_id FK "nullable, references users.id"
        text description "optional citizen note"
        text photo_url "storage bucket public URL"
        double_precision latitude "GPS coordinate"
        double_precision longitude "GPS coordinate"
        text category "default 'pending'"
        text severity "check (low, medium, high)"
        real confidence_score "0.0 to 1.0"
        text ai_description "drafted formal engineering description"
        uuid ward_id FK "nullable, references wards.id"
        uuid department_id FK "nullable, references departments.id"
        uuid assigned_to FK "nullable, references officials.id"
        text status "check (Submitted, Processing, Low-Confidence, Assigned, In Progress, Resolved, Closed, Reopened, Escalated)"
        boolean is_verified "default false"
        timestamptz sla_deadline
        timestamptz escalated_at
        timestamptz resolved_at
        timestamptz closed_at
        text resolution_photo_url
        text resolution_notes
        text perceptual_hash "duplicate detection key"
        timestamptz exif_timestamp
        double_precision exif_latitude
        double_precision exif_longitude
        text device_fingerprint
        timestamptz created_at
        timestamptz updated_at
    }

    COMPLAINT_DUPLICATES {
        uuid id PK "default uuid_generate_v4()"
        uuid canonical_id FK "references complaints.id"
        uuid duplicate_id FK "references complaints.id"
        text match_reason "e.g. perceptual_hash + proximity"
        timestamptz created_at
    }

    AUDIT_LOGS {
        bigint id PK "generated always as identity"
        uuid complaint_id FK "references complaints.id"
        uuid actor_id FK "nullable, references auth.users"
        text actor_role "citizen, official, supervisor, system"
        text action "status_change, assignment, etc."
        text old_value
        text new_value
        text notes
        text prev_hash "cryptographic tamper-evident chain"
        text row_hash "SHA256(content + prev_hash)"
        timestamptz created_at
    }

    ABUSE_CLUSTERS {
        uuid id PK "default uuid_generate_v4()"
        text description
        uuid[] complaint_ids "array of linked complaint IDs"
        text status "check (flagged, reviewed, dismissed, actioned)"
        uuid reviewed_by FK "nullable, references auth.users"
        timestamptz created_at
        timestamptz reviewed_at
    }
```

### Database Constraints and Indexes
- **Spatial Indexing**: `idx_wards_boundary` uses a GiST index on `wards.boundary` for point-in-polygon queries. An additional GiST index on `complaints` location (`ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)`) accelerates geographic search.
- **SLA Partial Index**: `idx_complaints_sla` indexes `sla_deadline` specifically on active tickets (`Assigned`, `In Progress`) for background breach detection.
- **Security & RLS**: Row-Level Security is active across all tables. The PostgreSQL function `is_admin()` operates as a `SECURITY DEFINER` function, preventing infinite recursion during administrative permission evaluation.

---

## 3. End-to-End Complaint Pipeline Sequence

The sequence diagram below models the complete lifecycle from citizen intake through cloud ingestion, asynchronous vision AI classification with fallback, PostGIS boundary containment, SLA computation, and mobile client synchronization.

```mermaid
sequenceDiagram
    autonumber
    actor Citizen as Citizen (Mobile App)
    participant App as React Native / Expo Client
    participant Storage as Supabase Storage (complaint-photos)
    participant DB as Supabase PostgreSQL + PostGIS
    participant Worker as Backend Poller (main.py)
    participant AI as AI Vision Service (ai_service.py)
    participant Gemini as Google Gemini API
    participant Routing as Routing Service (routing_service.py)

    %% Step 1: Citizen Submission
    Citizen->>App: Captures photo via camera & captures GPS
    App->>App: Encodes photo to base64
    App->>Storage: Direct upload binary to `complaint-photos`
    Storage-->>App: Returns public photo URL

    App->>DB: INSERT into `complaints` (status='Submitted', category='pending', photo_url, lat, lng)
    DB-->>App: Returns created complaint record (id)
    App->>DB: INSERT into `audit_logs` (action='complaint_submitted', role='citizen')
    App-->>Citizen: Navigates immediately to ComplaintDetailScreen (< 1s)

    %% Step 2: Auto-Polling from Client
    loop Every 2.5s Polling (Client)
        App->>DB: SELECT * FROM complaints WHERE id = complaint_id
        DB-->>App: Returns current complaint record
    end

    %% Step 3: Autonomous Background Worker Intake
    loop Every 3.0s Polling (Backend Worker)
        Worker->>DB: SELECT unclassified WHERE status='Submitted' AND category='pending' LIMIT 5
        DB-->>Worker: Returns batch of pending complaints
    end

    Worker->>DB: UPDATE complaints SET status='Processing' WHERE id = complaint_id
    Note over Worker,DB: Optimistic lock prevents duplicate worker processing

    %% Step 4: Multimodal AI Classification
    Worker->>AI: analyze_complaint_image(photo_url, description)
    AI->>AI: Downloads image bytes via HTTPX & encodes base64
    AI->>AI: Formats prompt with strict civil engineering JSON schema

    rect rgb(240, 248, 255)
        Note over AI,Gemini: Multi-Model Fallback Chain (ai_service.py)
        AI->>Gemini: POST request to candidate 1: `gemini-3.1-flash-lite`
        alt Model returns 200 OK
            Gemini-->>AI: Returns structured JSON classification
        else Model returns 429 Rate Limit / 503 Overload
            AI->>Gemini: Fallback to candidate 2: `gemini-3.6-flash`
            alt Candidate 2 succeeds
                Gemini-->>AI: Returns structured JSON classification
            else Candidate 2 fails
                AI->>Gemini: Fallback to candidate 3: `gemini-3.5-flash`
                Gemini-->>AI: Returns structured JSON classification
            end
        end
    end

    AI-->>Worker: Returns {category, severity, confidence_score, ai_description, is_civic_issue}

    %% Step 5: Geospatial Routing & SLA Computation
    Worker->>Routing: route_and_assign_complaint(complaint_id, ai_result, lat, lng)
    
    Routing->>DB: RPC find_ward_for_point(lat, lng)
    Note over DB: PostGIS ST_Contains(boundary, point)<br/>Fallback: ST_DWithin within 500m
    DB-->>Routing: Returns ward_id

    Routing->>DB: SELECT department_id FROM category_routing WHERE category=? AND (ward_id=? OR ward_id IS NULL)
    DB-->>Routing: Returns department_id

    Routing->>DB: RPC find_official_for_complaint(ward_id, department_id)
    Note over DB: Balances load: least open complaints in ('Assigned', 'In Progress')
    DB-->>Routing: Returns assigned_to (official_id)

    Routing->>DB: RPC compute_sla_deadline(category, severity)
    Note over DB: Matches category x severity in sla_rules (default: 72h)
    DB-->>Routing: Returns computed sla_deadline timestamp

    %% Step 6: Confidence Threshold Gating & Update
    alt is_civic_issue == False OR confidence_score < 0.60
        Routing->>Routing: Set status = 'Low-Confidence' (routes to human review queue)
    else Department Mapped
        Routing->>Routing: Set status = 'Assigned'
    else
        Routing->>Routing: Set status = 'Submitted'
    end

    Routing->>DB: UPDATE complaints SET category, severity, confidence_score, ai_description, ward_id, department_id, assigned_to, sla_deadline, status
    Routing->>DB: INSERT into audit_logs (action='ai_classification_and_routing', role='system', notes)
    Routing-->>Worker: Returns routing summary

    %% Step 7: Mobile Screen Live Update
    App->>DB: Next poll cycle detects status change ('Assigned' / 'Low-Confidence')
    DB-->>App: Returns updated complaint record
    App-->>Citizen: UI dynamically transitions: shows category, SLA countdown, formal AI note, and assigned department
```

---

## 4. Backend Module Responsibilities

The backend is organized modularly under `backend/`, following single-responsibility and separation-of-concerns principles:

| Module | File Path | Core Responsibilities |
|---|---|---|
| **API Entry & Lifespan Daemon** | [`backend/main.py`](../backend/main.py) | • Initializes the FastAPI application, CORS middleware, and API router.<br>• Manages the application `lifespan` context to spawn and tear down the background polling worker `poll_unprocessed_complaints()`.<br>• Provides endpoints: `POST /api/complaints`, `GET /api/complaints`, `GET /api/complaints/{id}`, `GET /api/complaints/heatmap`, and `POST /api/complaints/{id}/classify`. |
| **Multimodal AI Service** | [`backend/ai_service.py`](../backend/ai_service.py) | • Connects to Google Gemini Multimodal Vision API.<br>• Converts incoming images to Base64 payloads and injects an engineering system prompt with JSON response schemas.<br>• Executes an automatic multi-model fallback chain (`gemini-3.1-flash-lite` $\to$ `gemini-3.6-flash` $\to$ `gemini-3.5-flash`) on HTTP 429/503 errors.<br>• Guards against corrupted image inputs (HTTP 400) and spam/non-civic uploads (`is_civic_issue`). |
| **Geospatial & SLA Routing** | [`backend/routing_service.py`](../backend/routing_service.py) | • Executes PostGIS stored procedure `find_ward_for_point` to resolve coordinates to administrative wards.<br>• Evaluates the hierarchical `category_routing` table (ward-specific overrides first, falling back to city-wide defaults).<br>• Calls `find_official_for_complaint` for load-balanced assignment.<br>• Invokes `compute_sla_deadline` based on configured resolution hour matrices.<br>• Enforces human-in-the-loop triage: routes items with confidence $< 0.60$ or non-civic flags to `Low-Confidence`.<br>• Records state transitions in `audit_logs`. |
| **Database Clients** | [`backend/database.py`](../backend/database.py) | • Instantiates `supabase_admin` with the `SUPABASE_SERVICE_ROLE_KEY` to perform administrative updates, background worker polling, and bypass RLS safely server-side.<br>• Instantiates `supabase_public` using `SUPABASE_ANON_KEY` for public-scoped queries. |
| **Configuration** | [`backend/config.py`](../backend/config.py) | • Implements a cached Pydantic `BaseSettings` object reading from `.env`.<br>• Validates required configurations: `supabase_url`, `supabase_anon_key`, `supabase_service_role_key`, `gemini_api_key`, and `ai_confidence_threshold` (default `0.6`). |
| **Data Schemas** | [`backend/schemas.py`](../backend/schemas.py) | • Defines Pydantic request and response contracts (`ComplaintSubmitResponse`, `ComplaintDetail`, `ComplaintDetailWithAudit`, `ComplaintListItem`, `HeatmapPoint`, `HealthResponse`).<br>• Defines domain enumerations: `ComplaintStatus` and `Severity`. |
