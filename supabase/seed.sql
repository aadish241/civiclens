-- =============================================================================
-- CivicLens: Seed Data (Pilot City — Patiala, Punjab)
-- =============================================================================
-- Sample wards, departments, officials, and routing rules for development.
-- Run this AFTER schema.sql in the Supabase SQL Editor.
--
-- Ward polygons are approximate bounding boxes for testing purposes.
-- Thapar University (~30.3560°N, 76.3570°E) falls in Ward W-01.
-- Replace with real PMC (Patiala Municipal Corporation) GeoJSON for production.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
insert into departments (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Roads & Infrastructure'),
  ('00000000-0000-0000-0000-000000000002', 'Sanitation & Waste'),
  ('00000000-0000-0000-0000-000000000003', 'Electrical & Streetlights'),
  ('00000000-0000-0000-0000-000000000004', 'Water Supply & Drainage'),
  ('00000000-0000-0000-0000-000000000005', 'General Maintenance')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Wards (approximate polygons — Patiala, Punjab)
-- ---------------------------------------------------------------------------
-- Patiala center: ~30.34°N, 76.37°E
--
-- W-01 Thapar / Bhadson Road  — covers Thapar University campus & surroundings
--      (30.340–30.370°N, 76.340–76.370°E)
-- W-02 Urban Estate / Sector 7 — new development sectors
--      (30.320–30.350°N, 76.360–76.395°E)
-- W-03 Old City / Purani Mandi  — historic city core, dense residential
--      (30.320–30.340°N, 76.380–76.415°E)
-- W-04 Model Town / Lajpat Nagar — mid-city residential
--      (30.345–30.375°N, 76.375–76.410°E)
-- W-05 Rajpura Road / Bahadurgarh — southern outskirts
--      (30.295–30.325°N, 76.380–76.415°E)

insert into wards (id, name, code, boundary) values
  (
    '10000000-0000-0000-0000-000000000001',
    'Thapar / Bhadson Road',
    'W-01',
    ST_GeomFromText(
      'POLYGON((76.340 30.340, 76.370 30.340, 76.370 30.370, 76.340 30.370, 76.340 30.340))',
      4326
    )
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'Urban Estate / Sector 7',
    'W-02',
    ST_GeomFromText(
      'POLYGON((76.360 30.320, 76.395 30.320, 76.395 30.350, 76.360 30.350, 76.360 30.320))',
      4326
    )
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    'Old City / Purani Mandi',
    'W-03',
    ST_GeomFromText(
      'POLYGON((76.380 30.320, 76.415 30.320, 76.415 30.340, 76.380 30.340, 76.380 30.320))',
      4326
    )
  ),
  (
    '10000000-0000-0000-0000-000000000004',
    'Model Town / Lajpat Nagar',
    'W-04',
    ST_GeomFromText(
      'POLYGON((76.375 30.345, 76.410 30.345, 76.410 30.375, 76.375 30.375, 76.375 30.345))',
      4326
    )
  ),
  (
    '10000000-0000-0000-0000-000000000005',
    'Rajpura Road / Bahadurgarh',
    'W-05',
    ST_GeomFromText(
      'POLYGON((76.380 30.295, 76.415 30.295, 76.415 30.325, 76.380 30.325, 76.380 30.295))',
      4326
    )
  )
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Category → Department Routing (city-wide defaults)
-- ---------------------------------------------------------------------------
-- ward_id = NULL means this is the default routing for all wards.
-- Ward-specific overrides can be added with a non-NULL ward_id.

insert into category_routing (category, ward_id, department_id) values
  ('pothole',      null, '00000000-0000-0000-0000-000000000001'),
  ('garbage',      null, '00000000-0000-0000-0000-000000000002'),
  ('streetlight',  null, '00000000-0000-0000-0000-000000000003'),
  ('water_leak',   null, '00000000-0000-0000-0000-000000000004'),
  ('other',        null, '00000000-0000-0000-0000-000000000005')
on conflict (category, ward_id) do nothing;

-- ---------------------------------------------------------------------------
-- Verify seed data
-- ---------------------------------------------------------------------------
-- Run these queries to confirm everything loaded:
--
--   select name, code, ST_AsText(boundary) from wards;
--
--   -- Quick sanity check: does Thapar University fall in W-01?
--   select w.name from wards w
--   where ST_Contains(w.boundary, ST_SetSRID(ST_MakePoint(76.3570, 30.3560), 4326));
--   -- Expected result: 'Thapar / Bhadson Road'
--
--   select d.name as department, cr.category
--   from category_routing cr
--   join departments d on d.id = cr.department_id;
--
--   select category, severity, resolution_hours
--   from sla_rules order by category, severity;
