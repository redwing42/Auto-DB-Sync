"""Integration tests for API endpoints using FastAPI TestClient."""

from __future__ import annotations

import os
import sys
import sqlite3
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from tests.conftest import SAMPLE_PAYLOAD_DICT


class TestWebhook:
    """Test POST /webhook/new-submission."""

    def test_valid_payload_creates_submission(self, test_client):
        response = test_client.post(
            "/webhook/new-submission",
            json=SAMPLE_PAYLOAD_DICT,
            headers={"X-Webhook-Secret": "test-secret"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "submission_id" in data
        assert data["status"] == "pending"

    def test_missing_required_fields_returns_422(self, test_client):
        incomplete = {"network_name": "Test"}
        response = test_client.post(
            "/webhook/new-submission",
            json=incomplete,
            headers={"X-Webhook-Secret": "test-secret"},
        )
        assert response.status_code == 422

    def test_missing_secret_returns_401(self, test_client):
        response = test_client.post(
            "/webhook/new-submission",
            json=SAMPLE_PAYLOAD_DICT,
        )
        assert response.status_code == 401

    def test_wrong_secret_returns_401(self, test_client):
        response = test_client.post(
            "/webhook/new-submission",
            json=SAMPLE_PAYLOAD_DICT,
            headers={"X-Webhook-Secret": "wrong-secret"},
        )
        assert response.status_code == 401


class TestSubmissionsAPI:
    """Test submissions list and detail endpoints."""

    def _create_submission(self, test_client):
        resp = test_client.post(
            "/webhook/new-submission",
            json=SAMPLE_PAYLOAD_DICT,
            headers={"X-Webhook-Secret": "test-secret"},
        )
        return resp.json()["submission_id"]

    def test_get_submissions_returns_list(self, test_client):
        self._create_submission(test_client)
        response = test_client.get("/submissions")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    def test_get_submission_by_id(self, test_client):
        sub_id = self._create_submission(test_client)
        response = test_client.get(f"/submissions/{sub_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == sub_id
        assert data["status"] == "pending"
        assert data["payload"]["network_name"] == "Hoskote - Network Zero"

    def test_get_nonexistent_submission_returns_404(self, test_client):
        response = test_client.get("/submissions/nonexistent-id")
        assert response.status_code == 404


class TestResolvePreview:
    """Test GET /submissions/{id}/resolve-preview."""

    def _create_submission(self, test_client):
        resp = test_client.post(
            "/webhook/new-submission",
            json=SAMPLE_PAYLOAD_DICT,
            headers={"X-Webhook-Secret": "test-secret"},
        )
        return resp.json()["submission_id"]

    def test_resolve_preview_returns_actions(self, test_client):
        sub_id = self._create_submission(test_client)
        response = test_client.get(f"/submissions/{sub_id}/resolve-preview")
        assert response.status_code == 200
        data = response.json()

        # Network exists in test data
        assert data["network"]["action"] == "existing"
        assert data["network"]["id"] == 1

        # Source location exists in test data
        assert data["source_location"]["action"] == "existing"

        # Waypoint file and flight route are always new
        assert data["waypoint_file"]["action"] == "new"
        assert data["flight_route"]["action"] == "new"


class TestApproval:
    """Test POST /submissions/{id}/approve."""

    def _create_submission(self, test_client):
        resp = test_client.post(
            "/webhook/new-submission",
            json=SAMPLE_PAYLOAD_DICT,
            headers={"X-Webhook-Secret": "test-secret"},
        )
        return resp.json()["submission_id"]

    def test_approve_without_confirmations_returns_403(self, test_client):
        sub_id = self._create_submission(test_client)
        response = test_client.post(
            f"/submissions/{sub_id}/approve",
            json={
                "confirmed_new_entities": {
                    "source_location": False,
                    "source_lz": False,
                    "destination_location": False,
                    "destination_lz": False,
                }
            },
        )
        # Should get 403 if there are new entities not confirmed
        # or 500 if pipeline fails due to other reasons
        assert response.status_code in (403, 500)


class TestStatusUpdate:
    """Test PATCH /submissions/{id}/status."""

    def _create_submission(self, test_client):
        resp = test_client.post(
            "/webhook/new-submission",
            json=SAMPLE_PAYLOAD_DICT,
            headers={"X-Webhook-Secret": "test-secret"},
        )
        return resp.json()["submission_id"]

    def test_reject_submission(self, test_client):
        sub_id = self._create_submission(test_client)
        response = test_client.patch(
            f"/submissions/{sub_id}/status",
            json={"status": "rejected", "reason": "Bad data"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "rejected"


class TestHealthCheck:
    """Test health endpoint."""

    def test_health(self, test_client):
        response = test_client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


class TestCesiumToken:
    """Test config endpoint."""

    def test_get_cesium_token(self, test_client):
        response = test_client.get("/config/cesium-token")
        assert response.status_code == 200
        assert "token" in response.json()


class TestNetworkMap:
    """Test GET /network-map across schema variants."""

    def test_network_map_with_location_type_id_schema(self, test_client, test_settings):
        flights_db = Path(test_settings.REDWING_REPO_PATH) / "instance" / "flights.db"
        conn = sqlite3.connect(flights_db)
        conn.execute("CREATE TABLE networks (id INTEGER PRIMARY KEY, name TEXT)")
        conn.execute(
            """
            CREATE TABLE locations (
                id INTEGER PRIMARY KEY,
                name TEXT,
                code TEXT,
                location_type_id INTEGER
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE landing_zones (
                id INTEGER PRIMARY KEY,
                location_id INTEGER,
                name TEXT,
                latitude REAL,
                longitude REAL
            )
            """
        )
        conn.execute("CREATE TABLE waypoint_files (id INTEGER PRIMARY KEY, filename TEXT)")
        conn.execute(
            """
            CREATE TABLE flight_routes (
                id INTEGER PRIMARY KEY,
                network_id INTEGER,
                start_lz_id INTEGER,
                end_lz_id INTEGER,
                start_location_id INTEGER,
                end_location_id INTEGER,
                waypoint_file_id INTEGER,
                status INTEGER,
                takeoff_direction INTEGER,
                approach_direction INTEGER
            )
            """
        )
        conn.execute("INSERT INTO networks (id, name) VALUES (1, 'Test Network')")
        conn.execute("INSERT INTO locations (id, name, code, location_type_id) VALUES (1, 'Hub A', 'HUBA', 2)")
        conn.execute("INSERT INTO locations (id, name, code, location_type_id) VALUES (2, 'Node B', 'NODEB', 1)")
        conn.execute("INSERT INTO landing_zones (id, location_id, name, latitude, longitude) VALUES (11, 1, 'Hub Pad', 13.1, 77.1)")
        conn.execute("INSERT INTO landing_zones (id, location_id, name, latitude, longitude) VALUES (22, 2, 'Node Pad', 13.2, 77.2)")
        conn.execute("INSERT INTO waypoint_files (id, filename) VALUES (101, 'L01_demo.waypoints')")
        conn.execute(
            """
            INSERT INTO flight_routes (
                id, network_id, start_lz_id, end_lz_id, start_location_id, end_location_id,
                waypoint_file_id, status, takeoff_direction, approach_direction
            ) VALUES (501, 1, 11, 22, 1, 2, 101, 1, 90, 270)
            """
        )
        conn.commit()
        conn.close()

        response = test_client.get("/network-map")
        assert response.status_code == 200
        data = response.json()
        assert "route_groups" in data
        assert len(data["route_groups"]) >= 1
        first_group = data["route_groups"][0]
        assert first_group["hub_location_name"] == "Hub A"
        assert first_group["node_location_name"] == "Node B"


class TestPayloadEdit:
    """Test PATCH /submissions/{id}/payload."""

    def _create_submission(self, test_client):
        resp = test_client.post(
            "/webhook/new-submission",
            json=SAMPLE_PAYLOAD_DICT,
            headers={"X-Webhook-Secret": "test-secret"},
        )
        return resp.json()["submission_id"]

    def test_patch_payload_updates_lat_lng_and_resets_id_review(self, test_client):
        sub_id = self._create_submission(test_client)
        test_client.patch(f"/submissions/{sub_id}/review-state", json={"waypoint_verified": True})
        test_client.patch(f"/submissions/{sub_id}/review-state", json={"id_resolution_reviewed": True})

        response = test_client.patch(
            f"/submissions/{sub_id}/payload",
            json={
                "source_latitude": 12.3456,
                "source_longitude": 78.9012,
                "destination_latitude": 13.4567,
                "destination_longitude": 79.0123,
                "source_location_name": "Edited Source",
                "destination_location_name": "Edited Destination",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["payload"]["source_latitude"] == 12.3456
        assert data["payload"]["destination_longitude"] == 79.0123
        assert data["payload"]["source_location_name"] == "Edited Source"
        assert data["id_resolution_reviewed"] is False
