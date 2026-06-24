"""REST API integration tests using FastAPI's TestClient."""
from __future__ import annotations

from tests.conftest import build_workbook, full_row


def _group(client, name="Customer"):
    res = client.post("/api/domain-groups", json={"name": name, "description": "d", "businessOwner": "Jane"})
    assert res.status_code == 201, res.text
    return res.json()


def _domain(client, group_id, name="Loyalty"):
    res = client.post(
        "/api/domains",
        json={"name": name, "description": "d", "businessOwner": "Jane", "technicalOwner": "Raj", "domainGroupId": group_id},
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_create_and_fetch(client):
    g = _group(client)
    res = client.get(f"/api/domain-groups/{g['id']}")
    assert res.status_code == 200
    assert res.json()["name"] == "Customer"


def test_create_validation_returns_400_with_fields(client):
    res = client.post("/api/domain-groups", json={"name": "", "description": "", "businessOwner": ""})
    assert res.status_code == 400
    body = res.json()
    assert "fields" in body
    assert "name" in body["fields"]


def test_duplicate_returns_409(client):
    _group(client)
    res = client.post("/api/domain-groups", json={"name": "Customer", "description": "d", "businessOwner": "Jane"})
    assert res.status_code == 409


def test_missing_returns_404(client):
    assert client.get("/api/domain-groups/nope").status_code == 404


def test_domain_requires_technical_owner(client):
    g = _group(client)
    res = client.post("/api/domains", json={"name": "Loyalty", "description": "d", "businessOwner": "Jane", "domainGroupId": g["id"]})
    assert res.status_code == 400
    assert "technicalOwner" in res.json()["fields"]


def test_patch_updates(client):
    g = _group(client)
    res = client.patch(f"/api/domain-groups/{g['id']}", json={"description": "updated"})
    assert res.status_code == 200
    assert res.json()["description"] == "updated"


def test_rename_via_patch(client):
    g = _group(client)
    res = client.patch(f"/api/domain-groups/{g['id']}", json={"name": "Renamed"})
    assert res.json()["name"] == "Renamed"


def test_delete_returns_descendant_count(client):
    g = _group(client)
    _domain(client, g["id"])
    res = client.delete(f"/api/domain-groups/{g['id']}")
    assert res.status_code == 200
    assert res.json()["descendantsRemoved"] == 1


def test_tree_endpoint(client):
    g = _group(client)
    _domain(client, g["id"])
    tree = client.get("/api/tree").json()
    assert tree[0]["children"][0]["name"] == "Loyalty"


def test_reorder_endpoint(client):
    g = _group(client)
    d = _domain(client, g["id"])
    s1 = client.post("/api/subdomains", json={"name": "A", "description": "d", "businessOwner": "J", "technicalOwner": "R", "domainId": d["id"]}).json()
    s2 = client.post("/api/subdomains", json={"name": "B", "description": "d", "businessOwner": "J", "technicalOwner": "R", "domainId": d["id"]}).json()
    res = client.post("/api/subdomains/reorder", json={"parentId": d["id"], "orderedIds": [s2["id"], s1["id"]]})
    assert res.status_code == 200
    order = [s["name"] for s in client.get(f"/api/subdomains?parentId={d['id']}").json()]
    assert order == ["B", "A"]


def test_move_endpoint(client):
    g = _group(client)
    d1 = _domain(client, g["id"], "Loyalty")
    d2 = _domain(client, g["id"], "Pricing")
    s = client.post("/api/subdomains", json={"name": "Membership", "description": "d", "businessOwner": "J", "technicalOwner": "R", "domainId": d1["id"]}).json()
    res = client.post(f"/api/subdomains/{s['id']}/move", json={"newParentId": d2["id"], "newIndex": 0})
    assert res.status_code == 200
    assert res.json()["domainId"] == d2["id"]


def test_export_download(client):
    _group(client)
    res = client.get("/api/export")
    assert res.status_code == 200
    assert "spreadsheetml" in res.headers["content-type"]
    assert len(res.content) > 0


def test_import_upload(client):
    data = build_workbook([
        full_row(["Customer", "d", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Profile", "d", "Jane", "Raj"]),
    ])
    res = client.post("/api/import", content=data, headers={"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})
    assert res.status_code == 200
    body = res.json()
    assert body["created"] == 4
    assert body["errors"] == []


def test_import_empty_body_returns_400(client):
    res = client.post("/api/import", content=b"", headers={"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})
    assert res.status_code == 400
