import uuid

from sqlalchemy import func, select

from app.models import DyeingDocumentItem

ADMIN_PASSWORD = "Password123!"


def _receipt_payload(masters: dict[str, str], challan_no: str = "RC-100") -> dict:
    return {
        "document_type": "RECEIPT",
        "challan_no": challan_no,
        "document_date": "2026-09-23",
        "customer_id": masters["customers"],
        "vehicle_no": "PB11AB1234",
        "items": [
            {
                "line_no": 1,
                "lot_no": "LOT-1",
                "item_id": masters["items"],
                "dyeing_type_id": masters["dyeing-types"],
                "colour_id": masters["colours"],
                "rolls": 25,
                "quantity": "1200.5",
                "rate": "18.75",
            },
            {
                "line_no": 2,
                "lot_no": "LOT-2",
                "item_id": masters["items"],
                "dyeing_type_id": masters["dyeing-types"],
                "rolls": 10,
                "quantity": "500",
                "rate": "15",
            },
        ],
    }


async def test_create_receipt_records_recalc_totals(client, auth_headers, masters):
    resp = await client.post("/documents", json=_receipt_payload(masters), headers=auth_headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["challan_no"] == "RC-100"
    assert body["document_type"] == "RECEIPT"
    assert str(body["total_rolls"]) == "35.000"
    assert str(body["total_qty"]) == "1700.500"
    assert str(body["gross_amount"]) == "30009.38"
    assert str(body["net_amount"]) == "30009.38"
    assert body["customer"]["name"].startswith("Fixture Mills")
    assert len(body["items"]) == 2
    assert str(body["items"][0]["amount"]) == "22509.38"
    assert body["items"][0]["colour"]["name"].startswith("Fixture Blue")


async def test_create_issue_with_round_off(client, auth_headers, masters):
    payload = _receipt_payload(masters, "IS-200")
    payload["document_type"] = "ISSUE"
    payload["issue_to_tubitor"] = True
    payload["round_off"] = "-0.02"
    resp = await client.post("/documents", json=payload, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert str(body["net_amount"]) == "30009.36"
    assert body["issue_to_tubitor"] is True


async def test_duplicate_challan_same_type_conflict(client, auth_headers, masters):
    r1 = await client.post("/documents", json=_receipt_payload(masters), headers=auth_headers)
    assert r1.status_code == 201, r1.text
    r2 = await client.post("/documents", json=_receipt_payload(masters), headers=auth_headers)
    assert r2.status_code == 409
    assert "already exists" in r2.json()["detail"]


async def test_same_challan_different_type_allowed(client, auth_headers, masters):
    r1 = await client.post("/documents", json=_receipt_payload(masters), headers=auth_headers)
    assert r1.status_code == 201
    payload = _receipt_payload(masters)
    payload["document_type"] = "ISSUE"
    r2 = await client.post("/documents", json=payload, headers=auth_headers)
    assert r2.status_code == 201


async def test_missing_master_rejected(client, auth_headers, masters):
    payload = _receipt_payload(masters, "RC-300")
    payload["customer_id"] = "00000000-0000-0000-0000-000000000000"
    resp = await client.post("/documents", json=payload, headers=auth_headers)
    assert resp.status_code == 400
    assert "customer" in resp.json()["detail"]


async def test_empty_items_rejected(client, auth_headers, masters):
    payload = _receipt_payload(masters, "RC-400")
    payload["items"] = []
    resp = await client.post("/documents", json=payload, headers=auth_headers)
    assert resp.status_code == 422


async def test_duplicate_line_numbers_rejected(client, auth_headers, masters):
    payload = _receipt_payload(masters, "RC-500")
    payload["items"].append(payload["items"][0])
    resp = await client.post("/documents", json=payload, headers=auth_headers)
    assert resp.status_code == 400
    assert "Duplicate line_no" in resp.json()["detail"]


async def test_update_replaces_items_and_recalcs(client, auth_headers, masters):
    created = await client.post("/documents", json=_receipt_payload(masters, "RC-600"), headers=auth_headers)
    doc_id = created.json()["id"]
    upd = await client.put(
        f"/documents/{doc_id}",
        json={
            "round_off": "0.50",
            "items": [
                {
                    "line_no": 1,
                    "lot_no": "LOT-X",
                    "item_id": masters["items"],
                    "rolls": "100",
                    "quantity": "1000",
                    "rate": "20",
                }
            ],
        },
        headers=auth_headers,
    )
    assert upd.status_code == 200, upd.text
    body = upd.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["lot_no"] == "LOT-X"
    assert str(body["total_rolls"]) == "100.000"
    assert str(body["total_qty"]) == "1000.000"
    assert str(body["gross_amount"]) == "20000.00"
    assert str(body["net_amount"]) == "20000.50"


async def test_delete_cascades_items(client, auth_headers, masters, engine):
    created = await client.post("/documents", json=_receipt_payload(masters, "RC-700"), headers=auth_headers)
    doc_id = created.json()["id"]
    deleted = await client.delete(f"/documents/{doc_id}", headers=auth_headers)
    assert deleted.status_code == 204
    missing = await client.get(f"/documents/{doc_id}", headers=auth_headers)
    assert missing.status_code == 404

    from sqlalchemy.ext.asyncio import async_sessionmaker

    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        orphan_count = (
            await session.execute(
                select(func.count(DyeingDocumentItem.id)).where(DyeingDocumentItem.dyeing_document_id == uuid.UUID(doc_id))
            )
        ).scalar_one()
    assert orphan_count == 0


async def test_list_and_filter(client, auth_headers, masters):
    await client.post("/documents", json=_receipt_payload(masters, "RC-800"), headers=auth_headers)
    issue = _receipt_payload(masters, "IS-900")
    issue["document_type"] = "ISSUE"
    await client.post("/documents", json=issue, headers=auth_headers)

    resp = await client.get("/documents?documentType=ISSUE", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["challan_no"] == "IS-900"

    lot = await client.get("/documents?documentType=RECEIPT&lot=LOT-2", headers=auth_headers)
    assert lot.json()["total"] == 1

    dash = await client.get("/documents/filter-options", headers=auth_headers)
    assert dash.status_code == 200
    assert "vehicleNos" in dash.json() and "PB11AB1234" in dash.json()["vehicleNos"]
    assert "lotNos" in dash.json() and "LOT-1" in dash.json()["lotNos"]


async def test_auth_login_rejects_bad_password(client):
    resp = await client.post(
        "/auth/login", json={"email": "admin@test.local", "password": "wrong"}
    )
    assert resp.status_code == 401

    ok = await client.post(
        "/auth/login",
        json={"email": "admin@test.local", "password": ADMIN_PASSWORD},
    )
    assert ok.status_code == 200
    assert ok.json()["user"]["role"] == "Admin"