"""Authorization (RBAC) tests driven through the API with auth enabled."""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture
def auth_client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/authz.db")
    monkeypatch.setenv("SEED_ON_STARTUP", "false")
    monkeypatch.setenv("RUN_MIGRATIONS", "false")
    monkeypatch.setenv("AUTH_DISABLED", "false")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@aa.com")
    monkeypatch.delenv("DEFAULT_ROLE", raising=False)
    import app as app_module

    importlib.reload(app_module)
    from fastapi.testclient import TestClient

    return TestClient(app_module.app)


def H(email: str) -> dict:
    return {"X-Forwarded-Email": email}


ADMIN = H("admin@aa.com")


def _group(client, headers, name="Customer"):
    return client.post(
        "/api/domain-groups",
        json={"name": name, "description": "d", "businessOwner": "Jane"},
        headers=headers,
    )


def test_unauthenticated_request_is_rejected(auth_client):
    assert auth_client.get("/api/tree").status_code == 401


def test_admin_from_env_can_write(auth_client):
    assert _group(auth_client, ADMIN).status_code == 201


def test_new_user_defaults_to_viewer(auth_client):
    viewer = H("viewer@aa.com")
    # Reads allowed.
    assert auth_client.get("/api/tree", headers=viewer).status_code == 200
    # Writes forbidden.
    assert _group(auth_client, viewer).status_code == 403


def test_me_reports_role(auth_client):
    body = auth_client.get("/api/me", headers=ADMIN).json()
    assert body["role"] == "admin"
    assert body["isAdmin"] is True


def test_admin_can_promote_user_to_editor(auth_client):
    user = H("eng@aa.com")
    assert _group(auth_client, user).status_code == 403
    res = auth_client.put("/api/admin/roles", json={"email": "eng@aa.com", "role": "editor"}, headers=ADMIN)
    assert res.status_code == 200
    assert _group(auth_client, user).status_code == 201


def test_role_management_requires_admin(auth_client):
    editor = H("eng@aa.com")
    auth_client.put("/api/admin/roles", json={"email": "eng@aa.com", "role": "editor"}, headers=ADMIN)
    # An editor cannot manage roles.
    res = auth_client.put("/api/admin/roles", json={"email": "x@aa.com", "role": "admin"}, headers=editor)
    assert res.status_code == 403


def test_per_domain_grant_scopes_write_access(auth_client):
    # Admin creates two groups.
    g1 = _group(auth_client, ADMIN, "Customer").json()
    g2 = _group(auth_client, ADMIN, "Commercial").json()

    steward = H("steward@aa.com")
    # Grant steward editor rights on g1 only.
    res = auth_client.put(
        "/api/admin/grants", json={"email": "steward@aa.com", "domainGroupId": g1["id"]}, headers=ADMIN
    )
    assert res.status_code == 200

    def make_domain(group_id):
        return auth_client.post(
            "/api/domains",
            json={"name": "Loyalty", "description": "d", "businessOwner": "J", "technicalOwner": "R", "domainGroupId": group_id},
            headers=steward,
        )

    # Allowed within the granted group...
    assert make_domain(g1["id"]).status_code == 201
    # ...forbidden in a different group.
    assert make_domain(g2["id"]).status_code == 403
    # ...and still cannot create a brand-new top-level group (needs global editor).
    assert _group(auth_client, steward, "Finance").status_code == 403


def test_grant_holder_cannot_import(auth_client):
    g1 = _group(auth_client, ADMIN, "Customer").json()
    steward = H("steward@aa.com")
    auth_client.put("/api/admin/grants", json={"email": "steward@aa.com", "domainGroupId": g1["id"]}, headers=ADMIN)
    res = auth_client.post(
        "/api/import", content=b"not-a-real-file", headers={**steward, "Content-Type": "application/octet-stream"}
    )
    assert res.status_code == 403


def test_audit_endpoint_is_admin_only(auth_client):
    _group(auth_client, ADMIN)
    assert auth_client.get("/api/audit", headers=ADMIN).status_code == 200
    assert auth_client.get("/api/audit", headers=H("viewer@aa.com")).status_code == 403
