"""Quick smoke test for the CivicLens API endpoints."""
import httpx
import io
import json
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE = "http://localhost:8000"

def test_health():
    r = httpx.get(f"{BASE}/health")
    assert r.status_code == 200
    print(f"[PASS] /health -> {r.json()}")

def test_submit():
    # Create a tiny fake JPEG (just the magic bytes)
    fake_jpg = b'\xff\xd8\xff\xe0' + b'\x00' * 100
    files = {"photo": ("test.jpg", io.BytesIO(fake_jpg), "image/jpeg")}
    data = {
        "latitude": "30.3515",
        "longitude": "76.3620",
        "description": "Test pothole near Thapar Gate 1 -- submitted via API",
    }
    r = httpx.post(f"{BASE}/api/complaints", files=files, data=data)
    assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
    body = r.json()
    print(f"[PASS] POST /api/complaints -> id={body['id']}, status={body['status']}")
    return body["id"]

def test_list():
    r = httpx.get(f"{BASE}/api/complaints")
    assert r.status_code == 200
    items = r.json()
    print(f"[PASS] GET /api/complaints -> {len(items)} complaints")

def test_detail(complaint_id: str):
    r = httpx.get(f"{BASE}/api/complaints/{complaint_id}")
    assert r.status_code == 200
    body = r.json()
    print(f"[PASS] GET /api/complaints/{complaint_id}")
    print(f"   status={body['status']}, category={body['category']}")
    print(f"   lat={body['latitude']}, lng={body['longitude']}")
    print(f"   audit_trail entries: {len(body['audit_trail'])}")
    if body["audit_trail"]:
        log = body["audit_trail"][0]
        print(f"   first audit: action={log['action']}, new_value={log['new_value']}")

def test_heatmap():
    r = httpx.get(f"{BASE}/api/complaints/heatmap")
    assert r.status_code == 200
    points = r.json()
    print(f"[PASS] GET /api/complaints/heatmap -> {len(points)} points")

def test_404():
    r = httpx.get(f"{BASE}/api/complaints/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404
    print(f"[PASS] GET /api/complaints/nonexistent -> 404")

if __name__ == "__main__":
    print("=" * 50)
    print("CivicLens API Smoke Tests")
    print("=" * 50)
    try:
        test_health()
        cid = test_submit()
        test_list()
        test_detail(cid)
        test_heatmap()
        test_404()
        print("\nAll tests passed successfully!")
    except Exception as e:
        print(f"\nTest failed: {e}")
        sys.exit(1)
