import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote


def _enc(s: str) -> str:
    return quote(s, safe="")

from app.schemas.sync import SyncPushRequest
from app.services.sync_service import push, pull


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cust_payload() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": f"Sync Mills {uuid.uuid4().hex[:6]}",
        "gstin": f"24AB{uuid.uuid4().hex[:6].upper()}Z1M",
        "address": "42 Sync Road, Surat",
        "state": "Gujarat",
        "state_code": "24",
        "updated_at": _now(),
    }


def _colour_payload() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": f"Sync Violet {uuid.uuid4().hex[:6]}",
        "hex": "#8A2BE2",
        "updated_at": _now(),
    }


def _doc_payload(customer_id: str, challan_no: str | None = None) -> tuple[dict, str]:
    doc_id = str(uuid.uuid4())
    doc = {
        "id": doc_id,
        "updated_at": _now(),
        "document_type": "RECEIPT",
        "challan_no": challan_no or f"SC-{uuid.uuid4().hex[:6].upper()}",
        "challan_date": "2026-09-23",
        "status": "saved",
        "customer_id": customer_id,
        "vehicle_no": "PB11SYNC1",
        "items": [
            {"line_no": 1, "lot_no": "SL-001", "rolls": 12, "quantity": "480.5", "rate": "46"},
        ],
        "raw_json": '{"header": {"challanNo": "X", "challanDate": "2026-09-23"}, "lineItems": []}',
    }
    return doc, doc_id


async def test_sync_health_public(client, auth_headers):
    resp = await client.get("/sync/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_sync_requires_auth(client):
    resp = await client.get("/sync/pull")
    assert resp.status_code == 401


async def test_push_masters_and_document_then_pull(client, auth_headers):
    cust = _cust_payload()
    colour = _colour_payload()
    doc, doc_id = _doc_payload(cust["id"])

    push_body = {
        "device_id": "test-device-1",
        "masters": {"customers": [cust], "colours": [colour]},
        "documents": [doc],
        "tombstones": [],
    }
    resp = await client.post("/sync/push", json=push_body, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["errors"] == []
    assert body["masters"] == {}
    assert body["documents"] == []

    # Pull everything since epoch.
    since = datetime(1970, 1, 1, tzinfo=timezone.utc).isoformat()
    pull = await client.get(f"/sync/pull?since={_enc(since)}", headers=auth_headers)
    assert pull.status_code == 200, pull.text
    data = pull.json()
    assert {"customers", "colours"}.issubset(set(data["masters"].keys()))
    assert any(m["id"] == cust["id"] for m in data["masters"]["customers"])
    assert any(m["hex"] == "#8A2BE2" for m in data["masters"]["colours"])
    assert len(data["documents"]) == 1
    pulled = data["documents"][0]
    assert pulled["id"] == doc_id
    assert pulled["document_type"] == "RECEIPT"
    assert pulled["challan_date"] == "2026-09-23"
    assert pulled["raw_json"] is not None
    assert str(pulled["items"][0]["rolls"]) == "12.000"
    assert str(pulled["items"][0]["quantity"]) == "480.500"
    assert str(pulled["items"][0]["amount"]) == "22103.00"


async def test_push_pulls_since_watermark(client, auth_headers):
    cust = _cust_payload()
    doc, _ = _doc_payload(cust["id"])
    push_body = {"masters": {"customers": [cust]}, "documents": [doc]}
    resp = await client.post("/sync/push", json=push_body, headers=auth_headers)
    assert resp.status_code == 200, resp.text

    then = datetime.now(timezone.utc).isoformat()
    pull = await client.get(f"/sync/pull?since={_enc(then)}", headers=auth_headers)
    data = pull.json()
    assert data["masters"]["customers"] == []
    assert data["documents"] == []


async def test_push_upsert_twice_no_duplicate(client, auth_headers):
    cust = _cust_payload()
    b1 = await client.post("/sync/push", json={"masters": {"customers": [cust]}}, headers=auth_headers)
    assert b1.status_code == 200, b1.text
    b2 = await client.post("/sync/push", json={"masters": {"customers": [cust]}}, headers=auth_headers)
    assert b2.status_code == 200, b2.text
    assert b2.json()["errors"] == []

    since = datetime(1970, 1, 1, tzinfo=timezone.utc).isoformat()
    pull = await client.get(f"/sync/pull?since={_enc(since)}", headers=auth_headers)
    custs = pull.json()["masters"]["customers"]
    assert len(custs) == 1


async def test_lww_server_wins(client, auth_headers):
    cust = _cust_payload()
    doc, doc_id = _doc_payload(cust["id"], challan_no="SC-LWW")

    r1 = await client.post("/sync/push", json={"masters": {"customers": [cust]}, "documents": [doc]}, headers=auth_headers)
    assert r1.status_code == 200, r1.text

    # Client pushes an OLDER version (older updated_at) of the same document.
    stale = dict(doc)
    stale["updated_at"] = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    stale["challan_no"] = "SC-LWW-STALE"
    r2 = await client.post("/sync/push", json={"documents": [stale]}, headers=auth_headers)
    assert r2.status_code == 200, r2.text
    reply = r2.json()
    assert len(reply["documents"]) == 1
    assert reply["documents"][0]["id"] == doc_id
    assert reply["documents"][0]["challan_no"] == "SC-LWW"

    # Server row is untouched.
    got = await client.get(f"/documents/{doc_id}", headers=auth_headers)
    assert got.status_code == 200
    assert got.json()["challan_no"] == "SC-LWW"


async def test_push_tombstone_deletes_document(client, auth_headers):
    cust = _cust_payload()
    doc, doc_id = _doc_payload(cust["id"])
    r = await client.post("/sync/push", json={"documents": [doc]}, headers=auth_headers)
    assert r.status_code == 200, r.text

    got = await client.get(f"/documents/{doc_id}", headers=auth_headers)
    assert got.status_code == 200

    tomb = {"tombstones": [{"table": "challans", "row_id": doc_id}]}
    r = await client.post("/sync/push", json=tomb, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["errors"] == []

    got = await client.get(f"/documents/{doc_id}", headers=auth_headers)
    assert got.status_code == 404

    since = datetime(1970, 1, 1, tzinfo=timezone.utc).isoformat()
    pull = await client.get(f"/sync/pull?since={_enc(since)}", headers=auth_headers)
    assert any(
        t["table"] == "challans" and t["row_id"] == doc_id for t in pull.json()["tombstones"]
    )


async def test_push_invalid_master_kind_rejected(client, auth_headers):
    r = await client.post(
        "/sync/push",
        json={"masters": {"widgets": [{"id": str(uuid.uuid4()), "name": "x", "updated_at": _now()}]}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    errors = r.json()["errors"]
    assert errors and "Unsupported master kind" in errors[0]["message"]


async def test_push_duplicate_challan_returns_error(client, auth_headers):
    cust = _cust_payload()
    doc_a, _ = _doc_payload(cust["id"], challan_no="SC-DUP")
    doc_b, _ = _doc_payload(cust["id"], challan_no="SC-DUP")

    r1 = await client.post("/sync/push", json={"documents": [doc_a]}, headers=auth_headers)
    assert r1.status_code == 200, r1.text
    assert r1.json()["errors"] == []

    r2 = await client.post("/sync/push", json={"documents": [doc_b]}, headers=auth_headers)
    assert r2.status_code == 200, r2.text
    errors = r2.json()["errors"]
    assert errors and "conflicts" in errors[0]["message"]


async def test_service_push_pull_roundtrip(engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.models import DyeingDocument

    maker = async_sessionmaker(engine, expire_on_commit=False)
    cust = _cust_payload()
    colour = _colour_payload()
    doc, _ = _doc_payload(cust["id"])

    async with maker() as session:
        req = SyncPushRequest(masters={"customers": [cust], "colours": [colour]}, documents=[doc])
        out = await push(session, req)
        assert out["errors"] == []
    async with maker() as session:
        pulled = await pull(session, None)
        assert len(pulled["documents"]) == 1
        assert any(str(c["id"]) == cust["id"] for c in pulled["masters"]["customers"])
        stored = await session.get(DyeingDocument, doc["id"])
        assert stored is not None and stored.net_amount == stored.gross_amount
        # Service-level LWW: an older client copy loses and the server row comes back as the winner.
        old = dict(cust)
        old["updated_at"] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        out2 = await push(session, SyncPushRequest(masters={"customers": [old]}))
        assert out2["errors"] == []
        assert out2["masters"]["customers"][0]["name"] == cust["name"]