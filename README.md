# 🏛️ CivicLens
> **Smart Citizen Issue Reporting & Municipal Triage System**  
> AI-powered multimodal defect inspection, PostGIS geospatial ward routing, and dynamic SLA governance.

---

## 📌 Overview
CivicLens is an automated municipal complaint triage and civic governance platform. It bridges the gap between citizens reporting civic infrastructure defects (potholes, garbage overflows, non-functioning streetlights, water leaks) and municipal administration dispatch.

By leveraging **Multimodal Vision AI (Google Gemini)** and **PostgreSQL PostGIS spatial geometry**, CivicLens categorizes complaints, evaluates severity, drafts formal engineering notes, filters out spam/non-civic photos, and routes tickets to the exact municipal ward and department in real time.

---

## 🚀 Key Features

- **📸 Instant Citizen Reporting & Authentication**:
  - React Native / Expo cross-platform mobile client (iOS & Android) with Instagram-style 5-tab interface.
  - 8-digit email-based OTP passwordless authentication flow with anti-race state machine.
  - High-speed live hardware camera capture and hardware GPS coordinate extraction (gallery uploads blocked).
  - Direct-to-cloud upload to Supabase Cloud Storage (`< 1s` submission time).
  - Dynamic Home Screen with personalized greetings and live municipal status metrics.

- **🧠 Multimodal AI Vision Engine**:
  - Powered by Google Gemini Vision (`gemini-3.1-flash-lite`, `gemini-3.6-flash`, `gemini-3.5-flash`).
  - Automatic categorization: `pothole`, `garbage`, `streetlight`, `water_leak`, `other`.
  - Severity assessment: `low`, `medium`, `high`.
  - Generates formal municipal engineering notes and public hazard assessments.
  - Automatic non-civic/spam filtering (`is_civic_issue: false`).
  - Prompt-injection guardrail explicitly ignoring text/signage in defect imagery.
  - Multi-model fallback chain for 99.9% uptime against rate limits and 503 spikes.

- **🗺️ PostGIS Geospatial Ward Routing**:
  - Administrative boundary resolution using PostGIS polygon containment (`ST_Contains`).
  - Boundary buffer fallback (`ST_DWithin` with 500m radius) for borderline GPS points.
  - Category $\to$ Department lookup matrix with ward-specific routing overrides.

- **⏱️ Step 1: SLA Escalation Engine (Autonomous Scheduler)**:
  - Dynamic SLA deadlines computed per category and severity.
  - Background daemon scanning every 60s for expired SLAs.
  - Overdue tickets auto-escalate to `🚨 SLA Escalated`, alerting department supervisors.
  - Immutable audit trail (`audit_logs`) tracking exact overdue hours and system actions.

- **⚖️ Step 2: Citizen Confirmation & Dispute Loop (FR-C7 / FR-O4)**:
  - Official resolution proof card displaying official proof photo, remarks, and completion timestamp.
  - Citizen **Confirm Resolution ✅** action: verifies repair and transitions ticket to `Closed & Confirmed`.
  - Citizen **Dispute Work ❌** action: modal with mandatory explanation and optional camera proof photo transitions ticket back to `Reopened`.
  - **7-Day Auto-Closure Engine**: Automatically closes tickets left in `Resolved` for 7 days without citizen action.

- **📍 Hyperlocal 5km Geofenced Feed & Upvoting**:
  - Neighbourhood tab filtering tickets within 5.0 km using the Haversine formula.
  - Distance badges (`0.8 km away`) showing defect proximity.
  - Anonymous public cards (DPDP Act privacy compliant: no user names, emails, or phone numbers).
  - Atomic upvoting with database trigger synchronization preventing race conditions.

---

> 📖 **Evaluation & Viva Defense Guide**: For detailed system walkthroughs, viva questions, and architectural explanations, see [**Documentation/evaluation-defense-guide.md**](Documentation/evaluation-defense-guide.md).

---

## 🏗️ System Architecture

```
┌─────────────────────────────────┐
│       Citizen Mobile App        │
│   (React Native / Expo Client)  │
└────────────────┬────────────────┘
                 │ 1. Direct photo upload & DB record (<1s)
                 ▼
┌─────────────────────────────────┐
│     Cloud Storage & Database    │
│  (Supabase / Postgres + PostGIS)│
└────────────────┬────────────────┘
                 ▲ 2. Background polling (every 3s)
                 │ 4. Update status, dept, ward, SLA & audit logs
                 ▼
┌─────────────────────────────────┐
│    Autonomous Backend Daemon    │
│   (FastAPI / Python Asyncio)    │
│   ├── Google Gemini Vision AI   │
│   └── PostGIS Spatial Routing   │
└─────────────────────────────────┘
```

---

## 💻 Tech Stack

- **Mobile Client**: React Native, Expo SDK, React Navigation, Expo-Image-Picker, Expo-Location
- **Backend API & Daemon**: Python 3.11, FastAPI, Uvicorn, Asyncio, HTTPX
- **Database & GIS**: PostgreSQL 15, PostGIS extension, Supabase Auth & Storage
- **AI & Vision**: Google Gemini 3 Flash multimodal vision models
- **Security**: PostgreSQL Row-Level Security (RLS) with `SECURITY DEFINER` helper functions

---

## 📂 Project Structure

```text
civiclens/
├── civiclens-app/          # React Native / Expo Mobile Application
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── constants/      # Design tokens (Colors, Typography, Spacing)
│   │   ├── lib/            # Supabase client configuration
│   │   └── screens/        # Home, Submit, Detail, MyComplaints, Status
│   ├── App.js              # Navigation & app entry
│   └── .env.example        # Environment variable template for mobile
│
├── backend/                # FastAPI Backend & Background Poller
│   ├── main.py             # API server & autonomous complaint poller
│   ├── ai_service.py       # Gemini multimodal vision analysis & fallback
│   ├── routing_service.py  # PostGIS ward lookup & SLA calculation
│   ├── database.py         # Supabase admin client
│   ├── config.py           # Configuration & settings management
│   ├── schemas.py          # Pydantic schemas
│   ├── requirements.txt    # Python dependencies
│   └── .env.example        # Environment variable template for backend
│
├── supabase/               # Database DDL & Seed Data
│   ├── schema.sql          # Full production schema, PostGIS tables & RPCs
│   └── seed.sql            # Sample wards, departments, and routing rules
│
└── requirements.md         # Comprehensive specifications & requirements
```

---

## ⚙️ Getting Started

### 1. Database Setup (Supabase)
1. Create a project on [Supabase](https://supabase.com).
2. In your Supabase Dashboard, navigate to **Database > Extensions** and enable `postgis` and `uuid-ossp`.
3. Open the **SQL Editor** and run `supabase/schema.sql`, followed by `supabase/seed.sql`.
4. Ensure the `complaint-photos` storage bucket is created and set to public.

### 2. Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Fill in your `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `GEMINI_API_KEY`.
5. Run the server:
   ```bash
   python main.py
   ```

### 3. Mobile App Setup
1. Navigate to the mobile app directory:
   ```bash
   cd civiclens-app
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Fill in your `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
4. Start the Expo development server:
   ```bash
   npx expo start -c
   ```
5. Scan the QR code with **Expo Go** (Android / iOS).

---

## 🔒 Security & Privacy

- **Zero Secret Commits**: All sensitive keys (`SERVICE_ROLE_KEY`, `GEMINI_API_KEY`) are kept strictly inside untracked `.env` files.
- **Row-Level Security (RLS)**: Enforced across PostgreSQL tables.
- **Recursion-Free Admin Checks**: Uses a `SECURITY DEFINER` function `is_admin()` to avoid RLS circular evaluation.
- **Immutable Audit Trail**: Append-only log for every state transition and system action.

---

## 🗺️ Project Development Roadmap

| Phase | Milestone / Feature | Status |
|---|---|:---:|
| **Step 1** | **SLA Escalation Engine** (Autonomous 60s Background Poller, Auto-Escalation, Audit Trail) | ✅ Completed |
| **Step 2** | **Citizen Confirmation & Dispute Loop** (FR-C7 / FR-O4, Proof Photo, 7-Day Auto-Close) | ✅ Completed |
| **Neighbourhood** | **5km Geofenced Feed & Atomic Upvotes** (Haversine Filter, Anonymous Cards, Trigger Sync) | ✅ Completed |
| **Step 3** | **Municipal Officer Web Portal** (React Dashboard for Triage, Field Assignment, and Resolution) | ⏳ In Progress |
| **Step 4** | **Push Notifications** (Real-time updates on ticket assignment, escalation, and resolution) | 📋 Planned |
| **Step 5** | **Admin Analytics & Spatial Heatmaps** (Department SLA Compliance, Ward Ranking, Public Map) | 📋 Planned |
| **Step 6** | **AI Duplicate Detection Engine** (Perceptual Image Hashing `pHash` + Proximity Clustering) | 📋 Planned |

---

## 📜 License
This project is developed for civic governance research and academic evaluation.
