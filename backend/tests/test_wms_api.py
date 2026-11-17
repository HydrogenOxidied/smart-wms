"""Comprehensive unit and integration tests for PocketWMS Backend & Forecasting."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import uuid

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.core.database import Base, build_engine, get_db
from app.main import create_app
from app.models.entities import StockMovement, Store
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


def test_mam_tep_template_and_unlimited_staff_management(client_and_db):
    client, _ = client_and_db

    # Create fresh Shop Mam Tep store using MAM_TEP template
    reg = client.post(
        "/api/v1/auth/register-store",
        json={
            "store_name": "Shop Mắm Tép Ba Làng",
            "manager_username": "chu_mamtep",
            "manager_full_name": "Chị Lan Mắm Tép",
            "manager_secret": "SAMPLE_MamTep99!",
            "industry_template": "MAM_TEP",
            "lite_mode": True,
        },
    )
    assert reg.status_code == 201, reg.text
    mgr_headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    products = client.get("/api/v1/products", headers=mgr_headers).json()
    assert len(products) == 7
    thung_500 = next(p for p in products if p["sku"] == "MT-THUNG-500")
    assert thung_500["unit"] == "Thùng"
    assert thung_500["current_stock"] == 15.0

    # Deduct 2 Thung Mam Tep
    out_res = client.post(
        "/api/v1/movements",
        json={
            "product_id": thung_500["id"],
            "movement_type": "OUT_CONSUMPTION",
            "quantity": 2,
            "unit_mode": "BASE",
            "note": "Xuất sỉ 2 thùng mắm tép",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=mgr_headers,
    )
    assert out_res.status_code == 201
    assert out_res.json()["balance_after"] == 13.0

    # Owner creates multiple staff accounts without artificial limit
    for uname, fname in [
        ("nv_sang", "Nhân viên Ca Sáng"),
        ("nv_chieu", "Nhân viên Ca Chiều"),
        ("nv_donggoi", "Nhân viên Đóng gói"),
    ]:
        created = client.post(
            "/api/v1/store/staff",
            json={
                "username": uname,
                "full_name": fname,
                "secret": "SAMPLE_Staff123!",
                "role": "STAFF",
            },
            headers=mgr_headers,
        )
        assert created.status_code == 201, created.text

    staff_list = client.get("/api/v1/store/staff", headers=mgr_headers).json()
    assert len(staff_list) == 4  # 1 manager + 3 staff

    # Staff logs in cleanly
    login_ok = client.post(
        "/api/v1/auth/login",
        json={"username": "nv_sang", "secret": "SAMPLE_Staff123!"},
    )
    assert login_ok.status_code == 200

    # Owner deactivates nv_sang -> login immediately rejected
    nv_sang_obj = next(u for u in staff_list if u["username"] == "nv_sang")
    lock_res = client.patch(
        f"/api/v1/store/staff/{nv_sang_obj['id']}",
        json={"is_active": False},
        headers=mgr_headers,
    )
    assert lock_res.status_code == 200
    assert lock_res.json()["is_active"] is False

    login_locked = client.post(
        "/api/v1/auth/login",
        json={"username": "nv_sang", "secret": "SAMPLE_Staff123!"},
    )
    assert login_locked.status_code == 401

    # Non-demo real store cannot call /store/apply-template (Demo-only)
    tpl_forbidden = client.post(
        "/api/v1/store/apply-template",
        json={"template_key": "CAFE_BAKERY"},
        headers=mgr_headers,
    )
    assert tpl_forbidden.status_code == 403

    # Demo store MANAGER CAN apply template
    demo_mgr_headers = _auth_headers(client, "MANAGER")
    tpl_demo = client.post(
        "/api/v1/store/apply-template",
        json={"template_key": "MAM_TEP"},
        headers=demo_mgr_headers,
    )
    assert tpl_demo.status_code == 200
    assert tpl_demo.json()["created_products"] == 7

    # STAFF cannot delete products (403); MANAGER deletes product and can reuse SKU/barcode
    nv_chieu_login = client.post(
        "/api/v1/auth/login",
        json={"username": "nv_chieu", "secret": "SAMPLE_Staff123!"},
    )
    assert nv_chieu_login.status_code == 200
    staff_headers = {"Authorization": f"Bearer {nv_chieu_login.json()['access_token']}"}

    del_staff = client.delete(f"/api/v1/products/{thung_500['id']}", headers=staff_headers)
    assert del_staff.status_code == 403

    del_mgr = client.delete(f"/api/v1/products/{thung_500['id']}", headers=mgr_headers)
    assert del_mgr.status_code == 200

    remaining = client.get("/api/v1/products", headers=mgr_headers).json()
    assert all(p["id"] != thung_500["id"] for p in remaining)

    recreated = client.post(
        "/api/v1/products",
        json={
            "name": "Thùng Mắm tép chưng thịt lô mới 500g",
            "sku": thung_500["sku"],
            "barcode": thung_500["barcode"],
            "unit": "Thùng",
            "current_stock": 8,
        },
        headers=mgr_headers,
    )
    assert recreated.status_code == 201


def test_audit_summary_and_manager_only_stockin(client_and_db):
    client, _ = client_and_db

    reg = client.post(
        "/api/v1/auth/register-store",
        json={
            "store_name": "Shop Mắm Tép Audit",
            "manager_username": "chu_audit",
            "manager_full_name": "Chủ Shop Audit",
            "manager_secret": "SAMPLE_Audit99!",
            "staff_username": "nv_audit",
            "staff_secret": "SAMPLE_StaffAudit99!",
            "industry_template": "MAM_TEP",
            "lite_mode": True,
        },
    )
    assert reg.status_code == 201, reg.text
    mgr_headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    staff_login = client.post(
        "/api/v1/auth/login",
        json={"username": "nv_audit", "secret": "SAMPLE_StaffAudit99!"},
    )
    assert staff_login.status_code == 200
    staff_headers = {"Authorization": f"Bearer {staff_login.json()['access_token']}"}

    products = client.get("/api/v1/products", headers=mgr_headers).json()
    thung_500 = next(p for p in products if p["sku"] == "MT-THUNG-500")

    before_summary = client.get("/api/v1/movements/summary", headers=mgr_headers).json()
    before_prod = next(p for p in before_summary["products"] if p["product_id"] == thung_500["id"])

    # STAFF cannot post IN_PURCHASE (only MANAGER can restock)
    staff_in = client.post(
        "/api/v1/movements",
        json={
            "product_id": thung_500["id"],
            "movement_type": "IN_PURCHASE",
            "quantity": 5,
            "unit_mode": "BASE",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=staff_headers,
    )
    assert staff_in.status_code == 403

    # MANAGER posts IN_PURCHASE (+5 Thùng)
    mgr_in = client.post(
        "/api/v1/movements",
        json={
            "product_id": thung_500["id"],
            "movement_type": "IN_PURCHASE",
            "quantity": 5,
            "unit_mode": "BASE",
            "note": "Chủ shop nhập thêm 5 thùng",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=mgr_headers,
    )
    assert mgr_in.status_code == 201, mgr_in.text
    mgr_mv = mgr_in.json()
    assert mgr_mv["user_role"] == "MANAGER"
    assert mgr_mv["user_username"] == "chu_audit"
    assert mgr_mv["balance_before"] == pytest.approx(15.0)
    assert mgr_mv["balance_after"] == pytest.approx(20.0)

    # STAFF consumes 3 Thùng, plus 2 Thùng mistaken and immediately reversed
    staff_out = client.post(
        "/api/v1/movements",
        json={
            "product_id": thung_500["id"],
            "movement_type": "OUT_CONSUMPTION",
            "quantity": 3,
            "unit_mode": "BASE",
            "note": "Xuất sỉ khách đặt",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=staff_headers,
    )
    assert staff_out.status_code == 201
    assert staff_out.json()["user_role"] == "STAFF"
    assert staff_out.json()["balance_before"] == pytest.approx(20.0)
    assert staff_out.json()["balance_after"] == pytest.approx(17.0)

    mistake = client.post(
        "/api/v1/movements",
        json={
            "product_id": thung_500["id"],
            "movement_type": "OUT_CONSUMPTION",
            "quantity": 2,
            "unit_mode": "BASE",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=staff_headers,
    )
    assert mistake.status_code == 201
    rev = client.post(
        f"/api/v1/movements/{mistake.json()['id']}/reverse",
        json={"reason": "Nhập nhầm ca"},
        headers=staff_headers,
    )
    assert rev.status_code == 201

    after_summary = client.get("/api/v1/movements/summary", headers=mgr_headers).json()
    after_prod = next(p for p in after_summary["products"] if p["product_id"] == thung_500["id"])
    assert after_prod["owner_imported_qty"] - before_prod["owner_imported_qty"] == pytest.approx(5.0)
    assert after_prod["staff_consumed_qty"] - before_prod["staff_consumed_qty"] == pytest.approx(3.0)
    assert after_prod["current_stock"] == pytest.approx(17.0)

    staff_only_logs = client.get(
        "/api/v1/movements", params={"actor_role": "STAFF"}, headers=mgr_headers
    ).json()
    assert len(staff_only_logs) >= 2
    assert all(m["user_role"] == "STAFF" for m in staff_only_logs)


def test_lazy_demo_seed_on_empty_db_and_deleted_product_excluded_from_audit(tmp_path: Path):
    db_file = tmp_path / "empty_wms.db"
    engine = build_engine(f"sqlite:///{db_file.as_posix()}")
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    app = create_app()
    app.router.lifespan_context = lambda _app: _noop_lifespan()

    def _override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db

    with TestingSessionLocal() as db:
        assert db.scalars(select(Store)).all() == []

    with TestClient(app) as client:
        # Register a real empty store; demo store is NOT auto-seeded
        reg = client.post(
            "/api/v1/auth/register-store",
            json={
                "store_name": "Kho Sạch",
                "manager_username": "manager",
                "manager_full_name": "Chủ Kho Thật",
                "manager_secret": "SAMPLE_CleanDb99!",
                "industry_template": "EMPTY",
                "lite_mode": True,
            },
        )
        assert reg.status_code == 201, reg.text
        mgr_headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
        assert client.get("/api/v1/products", headers=mgr_headers).json() == []
        assert client.get("/api/v1/movements", headers=mgr_headers).json() == []

        with TestingSessionLocal() as db:
            assert db.scalar(select(Store).where(Store.code == "MOC_BAKERY")) is None

        # Create product -> movement -> soft-delete product -> excluded from audit & movements
        created = client.post(
            "/api/v1/products",
            json={"name": "Mắm tép thử nghiệm", "unit": "Hũ", "current_stock": 12},
            headers=mgr_headers,
        )
        assert created.status_code == 201
        prod_id = created.json()["id"]
        assert len(client.get("/api/v1/movements", headers=mgr_headers).json()) == 1

        del_res = client.delete(f"/api/v1/products/{prod_id}", headers=mgr_headers)
        assert del_res.status_code == 200
        assert client.get("/api/v1/movements", headers=mgr_headers).json() == []

        summary_after_del = client.get("/api/v1/movements/summary", headers=mgr_headers).json()
        assert summary_after_del["owner_imported_total"] == pytest.approx(0.0)
        assert summary_after_del["products"] == []

        # Clicking Demo lazily creates MOC_BAKERY even when real user took username "manager"
        demo_res = client.post("/api/v1/auth/demo-login", json={"role": "MANAGER"})
        assert demo_res.status_code == 200, demo_res.text
        assert demo_res.json()["store"]["code"] == "MOC_BAKERY"
        assert demo_res.json()["user"]["username"] != "manager"


def test_default_secret_1234_change_secret_and_delete_staff(client_and_db):
    client, _ = client_and_db

    # 1. Register store omitting manager_secret & staff_secret -> defaults to "1234"
    reg = client.post(
        "/api/v1/auth/register-store",
        json={
            "store_name": "Shop Mặc Định 1234",
            "manager_username": "chu_1234",
            "manager_full_name": "Chủ 1234",
            "staff_username": "nv_1234",
            "industry_template": "EMPTY",
            "lite_mode": True,
        },
    )
    assert reg.status_code == 201, reg.text
    mgr_id = reg.json()["user"]["id"]
    mgr_headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    mgr_login = client.post("/api/v1/auth/login", json={"username": "chu_1234", "secret": "1234"})
    assert mgr_login.status_code == 200

    nv_login = client.post("/api/v1/auth/login", json={"username": "nv_1234", "secret": "1234"})
    assert nv_login.status_code == 200
    nv_id = nv_login.json()["user"]["id"]
    nv_headers = {"Authorization": f"Bearer {nv_login.json()['access_token']}"}

    # 2. Manager creates another staff omitting secret -> defaults to "1234"
    nv_phu = client.post(
        "/api/v1/store/staff",
        json={"username": "nv_phu", "full_name": "Nhân viên Phụ", "role": "STAFF"},
        headers=mgr_headers,
    )
    assert nv_phu.status_code == 201, nv_phu.text
    nv_phu_id = nv_phu.json()["id"]
    assert client.post("/api/v1/auth/login", json={"username": "nv_phu", "secret": "1234"}).status_code == 200

    # 3. Staff changes own secret (wrong current fails 400, valid succeeds 200)
    wrong_chg = client.post(
        "/api/v1/auth/change-secret",
        json={"current_secret": "9999", "new_secret": "SAMPLE_NewPass88!"},
        headers=nv_headers,
    )
    assert wrong_chg.status_code == 400

    ok_chg = client.post(
        "/api/v1/auth/change-secret",
        json={"current_secret": "1234", "new_secret": "SAMPLE_NewPass88!"},
        headers=nv_headers,
    )
    assert ok_chg.status_code == 200
    assert client.post("/api/v1/auth/login", json={"username": "nv_1234", "secret": "1234"}).status_code == 401
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"username": "nv_1234", "secret": "SAMPLE_NewPass88!"},
        ).status_code
        == 200
    )

    # 4. Manager resets nv_1234 back to 1234
    reset_res = client.patch(
        f"/api/v1/store/staff/{nv_id}/secret",
        json={"new_secret": "1234"},
        headers=mgr_headers,
    )
    assert reset_res.status_code == 200
    assert client.post("/api/v1/auth/login", json={"username": "nv_1234", "secret": "1234"}).status_code == 200

    # 5. Record movement as nv_1234, then delete nv_1234 (with history) & nv_phu (without history)
    prod = client.post(
        "/api/v1/products",
        json={"name": "Mắm tép hộp 500g", "unit": "Hộp", "current_stock": 20},
        headers=mgr_headers,
    ).json()
    mv = client.post(
        "/api/v1/movements",
        json={
            "product_id": prod["id"],
            "movement_type": "OUT_CONSUMPTION",
            "quantity": 3,
            "unit_mode": "BASE",
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=nv_headers,
    )
    assert mv.status_code == 201

    assert client.delete(f"/api/v1/store/staff/{mgr_id}", headers=mgr_headers).status_code == 400
    assert client.delete(f"/api/v1/store/staff/{nv_id}", headers=mgr_headers).status_code == 200
    assert client.delete(f"/api/v1/store/staff/{nv_phu_id}", headers=mgr_headers).status_code == 200

    # 6. Deleted staff hidden, old token/login rejected, username freed, audit history preserved
    remaining_staff = client.get("/api/v1/store/staff", headers=mgr_headers).json()
    assert [u["username"] for u in remaining_staff] == ["chu_1234"]
    assert client.get("/api/v1/auth/me", headers=nv_headers).status_code == 401
    assert client.post("/api/v1/auth/login", json={"username": "nv_1234", "secret": "1234"}).status_code == 401

    recreated = client.post(
        "/api/v1/store/staff",
        json={"username": "nv_1234", "full_name": "NV Mới Cùng Tên"},
        headers=mgr_headers,
    )
    assert recreated.status_code == 201

    summary = client.get("/api/v1/movements/summary", headers=mgr_headers).json()
    assert summary["staff_consumed_total"] == pytest.approx(3.0)
    mvs = client.get("/api/v1/movements", headers=mgr_headers).json()
    staff_mv = next(m for m in mvs if m["id"] == mv.json()["id"])
    assert staff_mv["user_username"] == "nv_1234"
