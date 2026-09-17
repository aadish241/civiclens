-- =============================================================================
-- CivicLens: Full Production Schema
-- =============================================================================
-- Evolves the week-1 skeleton into the complete schema described in
-- requirements.md. Run this in the Supabase SQL Editor.
--
-- Prerequisites:
--   • PostGIS extension available (Supabase enables this on request or
--     via Dashboard > Database > Extensions > postgis > Enable)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "postgis";       -- FR-L1: spatial queries

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
-- Using CHECK constraints instead of enums for easier extensibility via admin
-- (adding a new category doesn't require an ALTER TYPE).

-- ---------------------------------------------------------------------------
-- 2. Users / Citizen Profiles
-- ---------------------------------------------------------------------------
-- Linked to Supabase Auth (auth.users). Stores citizen-specific profile data
-- and the anti-abuse trust score (FR-T2).
create table if not exists users (
  id            uuid primary key references auth.users(id) on delete cascade,
  phone         text unique,               -- FR-C1: phone+OTP login
  display_name  text,
  trust_score   real not null default 0.5   -- FR-T2: 0.0 (untrusted) – 1.0 (fully trusted)
    check (trust_score >= 0.0 and trust_score <= 1.0),
  is_suspended  boolean not null default false,  -- FR-A4: admin can suspend
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Wards (PostGIS)
-- ---------------------------------------------------------------------------
-- FR-L1: Each ward is a polygon. GPS points are resolved to wards via
-- ST_Contains / ST_DWithin queries.
create table if not exists wards (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null unique,
  code        text unique,                   -- e.g. "W-01", for display
  boundary    geometry(Polygon, 4326) not null, -- SRID 4326 = WGS 84 (GPS)
  created_at  timestamptz not null default now()
);

-- Spatial index for fast point-in-polygon lookups (FR-L1)
create index if not exists idx_wards_boundary on wards using gist (boundary);

-- ---------------------------------------------------------------------------
-- 4. Departments
-- ---------------------------------------------------------------------------
create table if not exists departments (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null unique,        -- e.g. "Roads & Potholes", "Sanitation"
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Officials
-- ---------------------------------------------------------------------------
-- An official belongs to a department and is assigned to one or more wards.
-- FR-O1: officials see complaints filtered to their ward + department.
-- FR-L4: load-balanced assignment uses current open-complaint count.
create table if not exists officials (
  id              uuid primary key references auth.users(id) on delete cascade,
  department_id   uuid not null references departments(id) on delete restrict,
  display_name    text not null,
  role            text not null default 'official'
    check (role in ('official', 'supervisor', 'admin')),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Junction table: official ↔ ward (many-to-many)
create table if not exists official_wards (
  official_id  uuid not null references officials(id) on delete cascade,
  ward_id      uuid not null references wards(id) on delete cascade,
  primary key (official_id, ward_id)
);

-- ---------------------------------------------------------------------------
-- 6. Category → Department Routing
-- ---------------------------------------------------------------------------
-- FR-L3: Configurable lookup (category × ward → department).
-- FR-A1 / NFR-12: Admin can edit without code deploy.
create table if not exists category_routing (
  id              uuid primary key default uuid_generate_v4(),
  category        text not null,
  ward_id         uuid references wards(id) on delete cascade,  -- NULL = city-wide default
  department_id   uuid not null references departments(id) on delete restrict,
  unique (category, ward_id)
);

-- ---------------------------------------------------------------------------
-- 7. SLA Rules
-- ---------------------------------------------------------------------------
-- FR-S1 / FR-A2: Resolution hours per category × severity.
-- NFR-12: Configurable by admin without a code deploy.
create table if not exists sla_rules (
  id                uuid primary key default uuid_generate_v4(),
  category          text not null,
  severity          text not null check (severity in ('low', 'medium', 'high')),
  resolution_hours  int not null check (resolution_hours > 0),
  unique (category, severity)
);

-- Seed sensible defaults
insert into sla_rules (category, severity, resolution_hours) values
  ('pothole',       'low',    168),   -- 7 days
  ('pothole',       'medium',  72),   -- 3 days
  ('pothole',       'high',    24),   -- 1 day
  ('garbage',       'low',    120),   -- 5 days
  ('garbage',       'medium',  48),
  ('garbage',       'high',    24),
  ('streetlight',   'low',    168),
  ('streetlight',   'medium',  72),
  ('streetlight',   'high',    24),
  ('water_leak',    'low',     72),
  ('water_leak',    'medium',  24),
  ('water_leak',    'high',    12),
  ('other',         'low',    168),
  ('other',         'medium',  72),
  ('other',         'high',    48)
on conflict (category, severity) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Complaints (expanded)
-- ---------------------------------------------------------------------------
-- Drop the old minimal table and recreate with all required columns.
-- If you have existing data you want to keep, use ALTER TABLE ADD COLUMN
-- instead — but for a fresh deploy this is cleaner.
drop table if exists complaints cascade;

create table complaints (
  id                uuid primary key default uuid_generate_v4(),

  -- Citizen-provided data
  user_id           uuid references users(id) on delete set null,   -- NULL for legacy/anon submissions
  description       text,                    -- FR-C3: optional free-text note
  photo_url         text,                    -- URL in Supabase Storage
  latitude          double precision,        -- FR-C2: GPS from device
  longitude         double precision,        -- FR-C2: GPS from device

  -- AI-produced data (filled async by worker — FR-AI)
  category          text not null default 'pending',
  severity          text check (severity in ('low', 'medium', 'high')),
  confidence_score  real check (confidence_score >= 0.0 and confidence_score <= 1.0),
  ai_description    text,                    -- FR-AI3: drafted formal complaint

  -- Routing data (filled by worker after AI + geofence — FR-L)
  ward_id           uuid references wards(id) on delete set null,
  department_id     uuid references departments(id) on delete set null,
  assigned_to       uuid references officials(id) on delete set null,

  -- Lifecycle
  status            text not null default 'Submitted'
    check (status in (
      'Submitted',       -- citizen just filed
      'Processing',      -- AI worker picked it up
      'Low-Confidence',  -- AI confidence < threshold, needs human review (FR-AI2)
      'Assigned',        -- routed to official
      'In Progress',     -- official acknowledged
      'Resolved',        -- official submitted proof
      'Closed',          -- citizen confirmed (FR-C7)
      'Reopened',        -- citizen disputed (FR-C7)
      'Escalated'        -- SLA breached (FR-S2)
    )),
  is_verified       boolean not null default false,  -- FR-T1: only verified complaints start SLA
  sla_deadline      timestamptz,                     -- FR-S1: computed on verification
  escalated_at      timestamptz,
  resolved_at       timestamptz,
  closed_at         timestamptz,

  -- Resolution proof (FR-O4)
  resolution_photo_url  text,
  resolution_notes      text,

  -- Anti-abuse metadata (FR-T)
  perceptual_hash   text,                    -- FR-T4: for duplicate detection
  exif_timestamp    timestamptz,             -- FR-T6: cross-check against submission time
  exif_latitude     double precision,        -- FR-T6: cross-check against GPS
  exif_longitude    double precision,
  device_fingerprint text,                   -- FR-T3: rate-limit key

  -- Timestamps
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Indexes for common query patterns
create index if not exists idx_complaints_user       on complaints (user_id);
create index if not exists idx_complaints_status     on complaints (status);
create index if not exists idx_complaints_ward       on complaints (ward_id);
create index if not exists idx_complaints_assigned   on complaints (assigned_to);
create index if not exists idx_complaints_sla        on complaints (sla_deadline)
  where status in ('Assigned', 'In Progress');  -- partial index for SLA scanner
create index if not exists idx_complaints_phash      on complaints (perceptual_hash)
  where perceptual_hash is not null;            -- for duplicate detection
create index if not exists idx_complaints_location   on complaints using gist (
  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
) where latitude is not null and longitude is not null;

-- updated_at trigger (carried over from week-1)
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_complaints_updated_at on complaints;
create trigger trg_complaints_updated_at
before update on complaints
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 9. Complaint Duplicates
-- ---------------------------------------------------------------------------
-- FR-T4: Links duplicate reports to a single canonical complaint.
create table if not exists complaint_duplicates (
  id                uuid primary key default uuid_generate_v4(),
  canonical_id      uuid not null references complaints(id) on delete cascade,
  duplicate_id      uuid not null references complaints(id) on delete cascade,
  match_reason      text,   -- e.g. 'perceptual_hash + proximity'
  created_at        timestamptz not null default now(),
  unique (canonical_id, duplicate_id)
);

-- ---------------------------------------------------------------------------
-- 10. Audit Log (immutable, hash-chained)
-- ---------------------------------------------------------------------------
-- NFR-4: Status updates + audit writes in the same transaction.
-- NFR-8: Tamper-evident via hash chaining.
-- FR-O5: Every status change logged with official ID, timestamp, notes.
create table if not exists audit_logs (
  id              bigint generated always as identity primary key,
  complaint_id    uuid not null references complaints(id) on delete cascade,
  actor_id        uuid references auth.users(id) on delete set null,  -- who made the change
  actor_role      text,                      -- 'citizen', 'official', 'supervisor', 'system'
  action          text not null,             -- e.g. 'status_change', 'assignment', 'escalation'
  old_value       text,                      -- previous status / value
  new_value       text,                      -- new status / value
  notes           text,
  -- NFR-8: hash chain for tamper evidence
  prev_hash       text,                      -- hash of the previous audit_log row for this complaint
  row_hash        text,                      -- hash of this row's content + prev_hash
  created_at      timestamptz not null default now()
);

create index if not exists idx_audit_logs_complaint on audit_logs (complaint_id, id);

-- ---------------------------------------------------------------------------
-- 11. Abuse Clusters (FR-T5)
-- ---------------------------------------------------------------------------
-- Flagged clusters of suspicious activity for admin review.
create table if not exists abuse_clusters (
  id              uuid primary key default uuid_generate_v4(),
  description     text,
  complaint_ids   uuid[] not null default '{}',   -- array of linked complaint IDs
  status          text not null default 'flagged'
    check (status in ('flagged', 'reviewed', 'dismissed', 'actioned')),
  reviewed_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz
);

-- ---------------------------------------------------------------------------
-- 12. Row-Level Security Policies
-- ---------------------------------------------------------------------------
-- NFR-5: Role-based access control.

alter table users enable row level security;
alter table complaints enable row level security;
alter table audit_logs enable row level security;
alter table wards enable row level security;
alter table departments enable row level security;
alter table officials enable row level security;
alter table official_wards enable row level security;
alter table category_routing enable row level security;
alter table sla_rules enable row level security;
alter table complaint_duplicates enable row level security;
alter table abuse_clusters enable row level security;

-- --- Users ---
-- Citizens can read/update only their own profile
create policy "Users can view own profile"
  on users for select using (auth.uid() = id);
create policy "Users can update own profile"
  on users for update using (auth.uid() = id);

-- --- Complaints ---
-- In development / testing (or anonymous reporting), allow users to view complaints
drop policy if exists "Citizens can view own complaints" on complaints;
drop policy if exists "Citizens can view complaints" on complaints;
create policy "Citizens can view complaints"
  on complaints for select
  to anon, authenticated
  using (true);

-- Citizens can insert complaints (authenticated or anonymous)
drop policy if exists "Citizens can submit complaints" on complaints;
create policy "Citizens can submit complaints"
  on complaints for insert
  to anon, authenticated
  with check (
    auth.uid() is null
    or auth.uid() = user_id
  );

-- Officials can update complaints assigned to their ward/department
create policy "Officials can update assigned complaints"
  on complaints for update using (
    exists (
      select 1 from officials o
      join official_wards ow on ow.official_id = o.id
      where o.id = auth.uid()
        and ow.ward_id = complaints.ward_id
        and o.department_id = complaints.department_id
    )
    or exists (
      select 1 from officials where id = auth.uid() and role = 'admin'
    )
  );

-- --- Audit Logs ---
-- Anyone authenticated can read audit logs for their visible complaints
create policy "Authenticated users can view audit logs"
  on audit_logs for select using (
    exists (
      select 1 from complaints c
      where c.id = audit_logs.complaint_id
        and (
          c.user_id = auth.uid()
          or exists (select 1 from officials where id = auth.uid())
        )
    )
  );
-- Only the system/backend inserts audit logs (via service_role key)
-- No insert policy for anon/authenticated — inserts go through the API.

-- --- Reference tables: readable by all authenticated users ---
-- Security definer helper to check if a user is an admin without triggering recursive RLS
create or replace function is_admin(user_id uuid default auth.uid())
returns boolean as $$
  select exists (
    select 1 from officials
    where id = user_id and role = 'admin'
  );
$$ language sql security definer;

-- Reference tables: readable by all users (anon + authenticated)
create policy "Anyone can view wards"
  on wards for select using (true);
create policy "Anyone can view departments"
  on departments for select using (true);
create policy "Anyone can view sla_rules"
  on sla_rules for select using (true);
create policy "Anyone can view category_routing"
  on category_routing for select using (true);

-- Admin-only write policies for reference tables
create policy "Admins can manage wards"
  on wards for all using (is_admin());
create policy "Admins can manage departments"
  on departments for all using (is_admin());
create policy "Admins can manage sla_rules"
  on sla_rules for all using (is_admin());
create policy "Admins can manage category_routing"
  on category_routing for all using (is_admin());
create policy "Admins can manage abuse_clusters"
  on abuse_clusters for all using (is_admin());

-- Officials table: officials can see their own record, admins can manage all
create policy "Officials can view own record"
  on officials for select using (auth.uid() = id);
create policy "Admins can manage officials"
  on officials for all using (is_admin());

-- Official wards: same as officials
create policy "View own ward assignments"
  on official_wards for select using (auth.uid() = official_id);
create policy "Admins can manage official_wards"
  on official_wards for all using (is_admin());

-- Complaint duplicates: readable by officials
create policy "Officials can view duplicates"
  on complaint_duplicates for select using (
    exists (select 1 from officials where id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 13. Storage Bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('complaint-photos', 'complaint-photos', true)
on conflict (id) do update set public = true;

-- Upload: allow anon and authenticated users
drop policy if exists "Authenticated users can upload complaint photos" on storage.objects;
drop policy if exists "Anyone can upload complaint photos" on storage.objects;
create policy "Anyone can upload complaint photos"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'complaint-photos');

-- Read: allow anon and authenticated users
drop policy if exists "Authenticated users can view complaint photos" on storage.objects;
drop policy if exists "Anyone can view complaint photos" on storage.objects;
create policy "Anyone can view complaint photos"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'complaint-photos');

-- ---------------------------------------------------------------------------
-- 14. Helper Functions
-- ---------------------------------------------------------------------------

-- Find the ward containing a GPS point (FR-L1), with fallback (FR-L2)
create or replace function find_ward_for_point(
  lat double precision,
  lng double precision,
  fallback_distance_meters double precision default 500.0
)
returns uuid as $$
declare
  point geometry;
  ward_id uuid;
begin
  point := ST_SetSRID(ST_MakePoint(lng, lat), 4326);

  -- Try exact containment first
  select w.id into ward_id
  from wards w
  where ST_Contains(w.boundary, point)
  limit 1;

  -- Fallback: nearest ward within threshold (FR-L2)
  if ward_id is null then
    select w.id into ward_id
    from wards w
    where ST_DWithin(w.boundary::geography, point::geography, fallback_distance_meters)
    order by ST_Distance(w.boundary::geography, point::geography)
    limit 1;
  end if;

  return ward_id;
end;
$$ language plpgsql stable;

-- Find the best official for a complaint based on load balancing (FR-L4)
create or replace function find_official_for_complaint(
  p_ward_id uuid,
  p_department_id uuid
)
returns uuid as $$
declare
  official_id uuid;
begin
  select o.id into official_id
  from officials o
  join official_wards ow on ow.official_id = o.id
  where ow.ward_id = p_ward_id
    and o.department_id = p_department_id
    and o.is_active = true
    and o.role = 'official'
  order by (
    select count(*) from complaints c
    where c.assigned_to = o.id
      and c.status in ('Assigned', 'In Progress')
  ) asc
  limit 1;

  return official_id;
end;
$$ language plpgsql stable;

-- Compute SLA deadline for a complaint (FR-S1)
create or replace function compute_sla_deadline(
  p_category text,
  p_severity text
)
returns timestamptz as $$
declare
  hours int;
begin
  select sr.resolution_hours into hours
  from sla_rules sr
  where sr.category = p_category
    and sr.severity = p_severity;

  if hours is null then
    -- Fallback: 72 hours if no matching rule
    hours := 72;
  end if;

  return now() + (hours || ' hours')::interval;
end;
$$ language plpgsql stable;