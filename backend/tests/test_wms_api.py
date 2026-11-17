"""Comprehensive unit and integration tests for PocketWMS Backend & Forecasting."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import uuid

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import sessionmaker

from app.core.database import Base, build_engine, get_db
from app.main import create_app
from app.models.entities import StockMovement
from app.seed import seed_demo_data_if_empty


@pytest.fixture()
def client_and_db(tmp_path: Path):
    """Create isolated SQLite DB per test with seeded demo store."""
    db_file = tmp_path / "test_wms.db"
    engine = build_engine(f"sqlite:///{db_file.as_posix()}")
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as db:
        seed_demo_data_if_empty(db)

    app = create_app()
    # Disable lifespan seeding against default global DB during tests
    app.router.lifespan_context = lambda _app: _noop_lifespan()

    def _override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as client:
        yield client, TestingSessionLocal


class _noop_lifespan:
    async def __aenter__(self):
        return None

    async def __aexit__(self, *args):
        return False


def _auth_headers(client: TestClient, role: str) -> dict[str, str]:
    res = client.post("/api/v1/auth/demo-login", json={"role": role})
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_rbac_and_store_registration(client_and_db):
    client, _ = client_and_db
    staff_headers = _auth_headers(client, "STAFF")
    mgr_headers = _auth_headers(client, "MANAGER")

    # STAFF cannot modify store settings or apply templates
    res_forbidden = client.post(
        "/api/v1/store/apply-template",
        json={"template_key": "MINI_MART"},
        headers=staff_headers,
    )
    assert res_forbidden.status_code == 403

    # MANAGER can toggle Lite Mode <-> Warehouse Pro Mode
    res_toggle = client.patch("/api/v1/store", json={"lite_mode": False}, headers=mgr_headers)
    assert res_toggle.status_code == 200
    assert res_toggle.json()["lite_mode"] is False

    # Register brand new micro-store with template
    reg = client.post(
        "/api/v1/auth/register-store",
        json={
            "store_name": "Tạp hóa Cô Ba",
            "manager_username": "coba_mgr",
            "manager_full_name": "Cô Ba",
            "manager_secret": "SAMPLE_Store99!",
            "staff_username": "coba_staff",
            "staff_secret": "SAMPLE_Staff99!",
            "industry_template": "MINI_MART",
            "lite_mode": True,
        },
    )
    assert reg.status_code == 201, reg.text
    new_headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    prods = client.get("/api/v1/products", headers=new_headers).json()
    assert len(prods) == 3


def test_quick_add_fuzzy_duplicate_and_pack_break(client_and_db):
    client, _ = client_and_db
    staff_headers = _auth_headers(client, "STAFF")

    # 3-field Lite Quick-Add (no SKU, no barcode provided)
    created = client.post(
        "/api/v1/products",
        json={
            "name": "Túi giấy đựng bánh mì nhỏ",
            "unit": "Cái",
            "current_stock": 200,
            "tracking_type": "PACK_BREAK",
            "pack_unit": "Bịch",
            "pack_conversion_rate": 50,
        },
        headers=staff_headers,
    )
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["sku"]
    assert item["barcode"].startswith("200")
    assert item["sealed_packs"] == 4

    # Fuzzy duplicate warning ignores Vietnamese accents
    dups = client.get(
        "/api/v1/products/check-duplicates",
        params={"name": "tui giay dung banh mi"},
        headers=staff_headers,
    )
    assert dups.status_code == 200
    assert any(d["id"] == item["id"] for d in dups.json())

    # Break 1 pack -> sealed_packs drops from 4 to 3 while total current_stock stays 200
    brk = client.post(
        f"/api/v1/products/{item['id']}/break-pack",
        json={"packs_to_break": 1, "idempotency_key": str(uuid.uuid4())},
        headers=staff_headers,
    )
    assert brk.status_code == 200, brk.text
    refreshed = client.get(f"/api/v1/products/{item['id']}", headers=staff_headers).json()
    assert refreshed["sealed_packs"] == 3
    assert refreshed["current_stock"] == 200.0


def test_flow1_consumption_idempotency_anomaly_and_reversal(client_and_db):
    client, SessionLocal = client_and_db
    staff_headers = _auth_headers(client, "STAFF")
    mgr_headers = _auth_headers(client, "MANAGER")

    milk = client.get("/api/v1/products/by-barcode/8934588013010", headers=staff_headers).json()
    start_stock = milk["current_stock"]

    # Flow 1: Idempotent deduction
    idem = f"test-idem-{uuid.uuid4()}"
    mv1 = client.post(
        "/api/v1/movements",
        json={
            "product_id": milk["id"],
            "movement_type": "OUT_CONSUMPTION",
            "quantity": 3,
            "unit_mode": "BASE",
            "note": "Pha chế ca sáng",
            "idempotency_key": idem,
        },
        headers=staff_headers,
    )
    assert mv1.status_code == 201, mv1.text
    mv1_dup = client.post(
        "/api/v1/movements",
        json={
            "product_id": milk["id"],
            "movement_type": "OUT_CONSUMPTION",
            "quantity": 3,
            "unit_mode": "BASE",
            "idempotency_key": idem,
        },
        headers=staff_headers,
    )
    assert mv1_dup.status_code == 201
    assert mv1_dup.json()["id"] == mv1.json()["id"]

    after_deduct = client.get(f"/api/v1/products/{milk['id']}", headers=staff_headers).json()
    assert after_deduct["current_stock"] == pytest.approx(start_stock - 3.0)

    # Anomaly guard: first stock-in plenty of stock, then try huge spike >10x daily avg
    client.post(
        "/api/v1/movements",
        json={
            "product_id": milk["id"],
            "movement_type": "IN_PURCHASE",
            "quantity": 200,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=mgr_headers,
    )
    spike = client.post(
        "/api/v1/movements",
        json={
            "product_id": milk["id"],
            "movement_type": "OUT_CONSUMPTION",
            "quantity": 180,
            "idempotency_key": str(uuid.uuid4()),
            "confirm_anomaly": False,
        },
        headers=staff_headers,
    )
    assert spike.status_code == 409
    assert spike.json()["detail"]["code"] == "ANOMALY_CONFIRMATION_REQUIRED"

    # Reversal within 15m by STAFF restores stock cleanly
    rev = client.post(
        f"/api/v1/movements/{mv1.json()['id']}/reverse",
        json={"reason": "Bấm nhầm số lượng"},
        headers=staff_headers,
    )
    assert rev.status_code == 201, rev.text
    assert rev.json()["movement_type"] == "REVERSAL"
    assert rev.json()["quantity_delta"] == 3.0

    # Double reversal blocked
    rev_again = client.post(
        f"/api/v1/movements/{mv1.json()['id']}/reverse",
        json={"reason": "Thử lại"},
        headers=staff_headers,
    )
    assert rev_again.status_code == 409

    # Enforce 15-minute window for STAFF on older rows
    with SessionLocal() as db:
        old_mv = db.get(StockMovement, mv1.json()["id"])
        assert old_mv is not None
        # Add another fresh movement, backdate created_at by 20 mins, test STAFF blocked
    fresh = client.post(
        "/api/v1/movements",
        json={
            "product_id": milk["id"],
            "movement_type": "OUT_CONSUMPTION",
            "quantity": 2,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=staff_headers,
    )
    assert fresh.status_code == 201
    with SessionLocal() as db:
        row = db.get(StockMovement, fresh.json()["id"])
        assert row is not None
        row.created_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=20)
        db.commit()

    staff_expired = client.post(
        f"/api/v1/movements/{fresh.json()['id']}/reverse",
        json={"reason": "Quá hạn 15 phút"},
        headers=staff_headers,
    )
    assert staff_expired.status_code == 403


def test_flow2_batch_and_flow3_blind_stocktake(client_and_db):
    client, _ = client_and_db
    staff_headers = _auth_headers(client, "STAFF")
    mgr_headers = _auth_headers(client, "MANAGER")

    products = client.get("/api/v1/products", headers=staff_headers).json()
    bean = next(p for p in products if p["sku"] == "CF-BEAN-01")
    straw = next(p for p in products if p["sku"] == "CF-STRAW-01")

    # Flow 2: End-of-Shift Batch Consumption
    batch_res = client.post(
        "/api/v1/movements/batch",
        json={
            "items": [
                {
                    "product_id": bean["id"],
                    "movement_type": "OUT_CONSUMPTION",
                    "quantity": 2,
                    "note": "Chốt ca tối",
                    "idempotency_key": str(uuid.uuid4()),
                },
                {
                    "product_id": straw["id"],
                    "movement_type": "OUT_CONSUMPTION",
                    "quantity": 20,
                    "note": "Chốt ca tối",
                    "idempotency_key": str(uuid.uuid4()),
                },
            ]
        },
        headers=staff_headers,
    )
    assert batch_res.status_code == 201
    assert batch_res.json()["processed_count"] == 2

    # Flow 3: Blind Stocktake masks snapshot for STAFF while OPEN
    sessions = client.get("/api/v1/stocktakes", headers=staff_headers).json()
    open_session = next(s for s in sessions if s["status"] == "OPEN")
    assert all(i["system_qty_snapshot"] is None for i in open_session["items"])
    assert all(i["variance_qty"] is None for i in open_session["items"])

    # STAFF scans bean with counted_qty and straw with 20% gauge
    client.post(
        f"/api/v1/stocktakes/{open_session['id']}/scan",
        json={"barcode": bean["barcode"], "counted_qty": bean["current_stock"] - 3.0},
        headers=staff_headers,
    )
    scan_straw = client.post(
        f"/api/v1/stocktakes/{open_session['id']}/scan",
        json={"product_id": straw["id"], "gauge_percent": 20.0},
        headers=staff_headers,
    )
    assert scan_straw.status_code == 200
    assert all(i["system_qty_snapshot"] is None for i in scan_straw.json()["items"])

    # Submit and Manager reviews variances
    sub = client.post(f"/api/v1/stocktakes/{open_session['id']}/submit", headers=staff_headers)
    assert sub.status_code == 200
    assert sub.json()["status"] == "SUBMITTED"

    mgr_view = client.get(f"/api/v1/stocktakes/{open_session['id']}", headers=mgr_headers).json()
    assert all(i["system_qty_snapshot"] is not None for i in mgr_view["items"])

    # Approve session: straw (CONSUMABLE) posts implied OUT_CONSUMPTION, bean posts ADJUST_STOCKTAKE
    app_res = client.post(
        f"/api/v1/stocktakes/{open_session['id']}/approve",
        json={"item_options": []},
        headers=mgr_headers,
    )
    assert app_res.status_code == 200
    assert app_res.json()["status"] == "APPROVED"

    straw_updated = client.get(f"/api/v1/products/{straw['id']}", headers=mgr_headers).json()
    assert straw_updated["current_stock"] == pytest.approx(200.0)


def test_forecasting_tiers_damage_exclusion_and_csv_import(client_and_db):
    client, _ = client_and_db
    mgr_headers = _auth_headers(client, "MANAGER")

    overview = client.get("/api/v1/forecasts/overview", headers=mgr_headers).json()
    assert overview["total_skus"] >= 10

    milk_fc = next(i for i in overview["items"] if i["sku"] == "CF-MILK-01")
    assert milk_fc["algorithm_tier"] == "HOLT_WINTERS"
    assert milk_fc["history_days"] >= 60
    assert milk_fc["safety_stock"] > 0
    assert milk_fc["reorder_point"] > 0
    assert milk_fc["mae"] is not None and milk_fc["mape"] is not None
    assert len(milk_fc["forecast_series"]) == 14

    matcha_fc = next(i for i in overview["items"] if i["sku"] == "CF-MATCHA-01")
    assert matcha_fc["algorithm_tier"] == "COLD_START"

    # Verify OUT_DAMAGE_EXPIRED does NOT inflate forecast demand
    bean_before = next(i for i in overview["items"] if i["sku"] == "CF-BEAN-01")
    client.post(
        "/api/v1/movements",
        json={
            "product_id": bean_before["product_id"],
            "movement_type": "OUT_DAMAGE_EXPIRED",
            "quantity": 10,
            "note": "Bị ẩm mốc, tiêu hủy",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=mgr_headers,
    )
    bean_after = client.get(
        f"/api/v1/forecasts/products/{bean_before['product_id']}", headers=mgr_headers
    ).json()
    assert bean_after["avg_daily_demand"] == pytest.approx(bean_before["avg_daily_demand"])

    # CSV import products + consumption history + PO export
    prod_csv = (
        "name,unit,current_stock,min_stock_level,lead_time_days,category,tracking_type\n"
        "Cốc nhựa PET 500ml,Cái,300,100,2,Bao bì & Ly,STANDARD\n"
    ).encode("utf-8")
    imp_p = client.post(
        "/api/v1/imports/products-csv",
        files={"file": ("products.csv", prod_csv, "text/csv")},
        headers=mgr_headers,
    )
    assert imp_p.status_code == 200
    assert imp_p.json()["created_products"] == 1

    today_str = datetime.now(timezone.utc).date().isoformat()
    hist_csv = (
        "sku_or_name,date,quantity_consumed\n"
        f"Cốc nhựa PET 500ml,{today_str},25\n"
    ).encode("utf-8")
    imp_h = client.post(
        "/api/v1/imports/history-csv",
        files={"file": ("history.csv", hist_csv, "text/csv")},
        headers=mgr_headers,
    )
    assert imp_h.status_code == 200
    assert imp_h.json()["imported_movements"] == 1

    po = client.get("/api/v1/forecasts/export-po", headers=mgr_headers)
    assert po.status_code == 200
    assert "SoLuongDeXuatNhap" in po.text
