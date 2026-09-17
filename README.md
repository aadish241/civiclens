# 🏛️ CivicLens
> **Smart Citizen Issue Reporting & Municipal Triage System**  
> AI-powered multimodal defect inspection, PostGIS geospatial ward routing, and dynamic SLA governance.

---

## 📌 Overview
CivicLens is an automated municipal complaint triage and civic governance platform. It bridges the gap between citizens reporting civic infrastructure defects (potholes, garbage overflows, non-functioning streetlights, water leaks) and municipal administration dispatch.

By leveraging **Multimodal Vision AI (Google Gemini)** and **PostgreSQL PostGIS spatial geometry**, CivicLens categorizes complaints, evaluates severity, drafts formal engineering notes, filters out spam/non-civic photos, and routes tickets to the exact municipal ward and department in real time.

---

## 🚀 Key Features

- **📸 Instant Citizen Reporting**:
  - React Native / Expo cross-platform mobile client (iOS & Android).
  - High-speed camera capture and hardware GPS coordinate extraction.
  - Direct-to-cloud upload to Supabase Cloud Storage (`< 1s` submission time).
  - Real-time Home Screen metrics tracker (*Submitted*, *In Progress*, *Resolved*).

- **🧠 Multimodal AI Vision Engine**:
  - Powered by Google Gemini Vision (`gemini-3.1-flash-lite`, `gemini-3.6-flash`, `gemini-3.5-flash`).
  - Automatic categorization: `pothole`, `garbage`, `streetlight`, `water_leak`, `other`.
  - Severity assessment: `low`, `medium`, `high`.
  - Generates formal municipal engineering notes and public hazard assessments.
  - Automatic non-civic/spam filtering (`is_civic_issue: false`).
  - Multi-model fallback chain for 99.9% uptime against rate limits and 503 spikes.

- **🗺️ PostGIS Geospatial Ward Routing**:
  - Administrative boundary resolution using PostGIS polygon containment (`ST_Contains`).
  - Boundary buffer fallback (`ST_DWithin` with 500m radius) for borderline GPS points.
  - Category $\to$ Department lookup matrix with ward-specific routing overrides.

- **⏱️ Dynamic SLA & Ticket Lifecycle**:
  - Configurable SLA deadlines per category and severity matrix.
  - **Human-in-the-Loop Triage**: Tickets with confidence score $< 0.70$ or non-civic flags are marked `Low-Confidence` for manual supervisor review.
  - Transparent status progression: `Submitted` $\to$ `Processing` $\to$ `Assigned` $\to$ `In Progress` $\to$ `Resolved`.
  - Immutable audit trail (`audit_logs`) tracking every status change, AI score, and official assignment.

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

## 📜 License
This project is developed for civic governance research and academic evaluation.
