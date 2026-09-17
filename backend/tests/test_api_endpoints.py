"""
CivicLens Backend — Automated API Tests (Pytest)
Tests core FastAPI endpoints using TestClient.
"""

import pytest
from fastapi.testclient import TestClient
import sys
import os

# Add backend root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app

client = TestClient(app)


def test_health_probe():
    """Verify GET /health returns 200 OK and correct service metadata."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert data["service"] == "civiclens-backend"


def test_list_complaints_endpoint():
    """Verify GET /api/complaints returns paginated list."""
    response = client.get("/api/complaints?limit=5&offset=0")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    if len(data) > 0:
        first = data[0]
        assert "id" in first
        assert "status" in first
        assert "created_at" in first


def test_public_heatmap_endpoint():
    """Verify GET /api/complaints/heatmap returns anonymized coordinate points without PII."""
    response = client.get("/api/complaints/heatmap?limit=10")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    for pt in data:
        assert "latitude" in pt
        assert "longitude" in pt
        assert "status" in pt
        # Verify strict DPDP compliance: no user PII, descriptions, or photo URLs
        assert "user_id" not in pt
        assert "description" not in pt
        assert "photo_url" not in pt


def test_get_nonexistent_complaint():
    """Verify GET /api/complaints/{id} returns 404 for invalid ID."""
    response = client.get("/api/complaints/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    data = response.json()
    assert data["detail"] == "Complaint not found"
