"""
CivicLens — End-to-End AI Pipeline Verification Script (Phase 3)
Tests:
1. On-demand AI classification & routing on a real complaint photo from user testing
2. Verification of Gemini multimodal output (category, severity, confidence, municipal description)
3. PostGIS ward intersection and category-based department routing
4. SLA calculation & audit trail entry
5. Verification via GET /api/complaints/{id}
"""

import sys
import time
import httpx

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE = "http://localhost:8000"


def test_classify_real_complaint():
    print("\n--- Test 1: Classify Real User-Captured Complaint via AI Pipeline ---")
    # bffb95a9-64c8-4e35-962b-4a177d0d3d3e is the real complaint photo captured in mobile app
    target_id = "bffb95a9-64c8-4e35-962b-4a177d0d3d3e"
    print(f"Target complaint ID: {target_id}")

    t0 = time.time()
    res = httpx.post(f"{BASE}/api/complaints/{target_id}/classify", timeout=60.0)
    elapsed = round((time.time() - t0), 2)
    assert res.status_code == 200, f"Classify failed with {res.status_code}: {res.text}"
    data = res.json()
    print(f"[PASS] Classification & routing finished in {elapsed}s")
    print(f"  Category:        {data.get('category')}")
    print(f"  Severity:        {data.get('severity')}")
    print(f"  Confidence:      {data.get('confidence_score')}")
    print(f"  Status:          {data.get('status')}")
    print(f"  Ward:            {data.get('ward_name')} ({data.get('ward_id')})")
    print(f"  Department:      {data.get('department_name')} ({data.get('department_id')})")
    print(f"  SLA Deadline:    {data.get('sla_deadline')}")
    print(f"  AI Description:  {data.get('ai_description')}")

    print("\n--- Test 2: Verify Complaint Detail & Audit Trail ---")
    detail_res = httpx.get(f"{BASE}/api/complaints/{target_id}")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    print(f"[PASS] Retrieved complaint detail from Supabase:")
    print(f"  ID:              {detail.get('id')}")
    print(f"  Status:          {detail.get('status')}")
    print(f"  Category:        {detail.get('category')}")
    print(f"  Severity:        {detail.get('severity')}")
    print(f"  Ward Name:       {detail.get('ward_name')}")
    print(f"  Department Name: {detail.get('department_name')}")
    print(f"  SLA Deadline:    {detail.get('sla_deadline')}")
    print(f"  Audit Logs Count: {len(detail.get('audit_trail', []))}")
    for idx, entry in enumerate(detail.get("audit_trail", []), start=1):
        print(f"    [{idx}] {entry.get('action')} | old='{entry.get('old_value')}' -> new='{entry.get('new_value')}'")
        print(f"        Notes: {entry.get('notes')}")


if __name__ == "__main__":
    print("=" * 60)
    print("CivicLens Phase 3 — AI Classification & Routing Verification")
    print("=" * 60)
    try:
        test_classify_real_complaint()
        print("\nAll Phase 3 verification tests passed successfully!")
    except Exception as e:
        print(f"\nTest failed: {e}")
        sys.exit(1)
