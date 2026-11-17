"""Automatic rich demo seeder for 'Tiem Banh & Cafe Moc' with 65-day consumption history."""
from datetime import datetime, timedelta, timezone
import math
import os
import random

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_secret
from app.models.entities import (
    Product,
    StockMovement,
    StocktakeItem,
    StocktakeSession,
    Store,
    User,
)
from app.services.products import normalize_vi_text

DEMO_CREDENTIAL = os.getenv("WMS_DEMO_PASS", "SAMPLE_Demo123!")


def _pick_demo_username(db: Session, base: str) -> str:
    """Return `base` if free, otherwise a collision-free demo username."""
    if not db.scalar(select(User.id).where(User.username == base)):
        return base
    for idx in range(1, 100):
        candidate = f"demo_{base}" if idx == 1 else f"demo_{base}_{idx}"
        if not db.scalar(select(User.id).where(User.username == candidate)):
            return candidate
    return f"demo_{base}_{random.randint(1000, 9999)}"


def seed_demo_data_if_empty(db: Session) -> None:
    """Populate demo store only when the database has zero stores (used by test fixtures)."""
    existing_stores = db.scalar(select(func.count(Store.id)))
    if existing_stores and existing_stores > 0:
        return
    ensure_demo_store_seeded(db)


def ensure_demo_store_seeded(db: Session) -> Store:
    """Lazily create and return the MOC_BAKERY demo workspace on first demo login."""
    existing = db.scalar(select(Store).where(Store.code == "MOC_BAKERY"))
    if existing:
        return existing

    store = Store(
        name="Tiệm Bánh & Cafe Mộc",
        code="MOC_BAKERY",
        industry_template="CAFE_BAKERY",
        lite_mode=True,
        allow_negative_stock=False,
    )
    db.add(store)
    db.flush()

    hashed = hash_secret(DEMO_CREDENTIAL)
    manager = User(
        store_id=store.id,
        username=_pick_demo_username(db, "manager"),
        full_name="Minh Anh (Chủ kho)",
        hashed_secret=hashed,
        role="MANAGER",
    )
    staff = User(
        store_id=store.id,
        username=_pick_demo_username(db, "staff"),
        full_name="Hoàng Nam (Nhân viên kho)",
        hashed_secret=hashed,
        role="STAFF",
    )
    db.add_all([manager, staff])
    db.flush()

    catalog_specs = [
        {
            "sku": "CF-MILK-01",
            "barcode": "8934588013010",
            "name": "Sữa tươi thanh trùng DalatMilk 1L",
            "category": "Nguyên liệu Pha chế",
            "tracking_type": "STANDARD",
            "unit": "Hộp",
            "pack_unit": None,
            "pack_conversion_rate": 1.0,
            "sealed_packs": 0,
            "capacity_reference": None,
            "current_stock": 14.0,
            "min_stock_level": 12.0,
            "lead_time_days": 2,
            "unit_cost": 36000.0,
            "shelf_location": "Tủ mát A1",
            "supplier_name": "NPP DalatMilk HCM",
            "is_pinned": True,
            "days": 65,
            "base_daily": 11.0,
            "weekend_boost": 1.45,
        },
        {
            "sku": "BK-BUTTER-01",
            "barcode": "8935024189912",
            "name": "Bơ lạt Anchor New Zealand 227g",
            "category": "Nguyên liệu Bánh",
            "tracking_type": "STANDARD",
            "unit": "Khối",
            "pack_unit": None,
            "pack_conversion_rate": 1.0,
            "sealed_packs": 0,
            "capacity_reference": None,
            "current_stock": 9.0,
            "min_stock_level": 10.0,
            "lead_time_days": 3,
            "unit_cost": 68000.0,
            "shelf_location": "Tủ mát A2",
            "supplier_name": "Bakers Choice VN",
            "is_pinned": True,
            "days": 65,
            "base_daily": 6.5,
            "weekend_boost": 1.5,
        },
        {
            "sku": "CF-BEAN-01",
            "barcode": "8935024180025",
            "name": "Hạt Cà phê Arabica Cầu Đất 1Kg",
            "category": "Nguyên liệu Pha chế",
            "tracking_type": "STANDARD",
            "unit": "Túi",
            "pack_unit": None,
            "pack_conversion_rate": 1.0,
            "sealed_packs": 0,
            "capacity_reference": None,
            "current_stock": 19.0,
            "min_stock_level": 6.0,
            "lead_time_days": 3,
            "unit_cost": 240000.0,
            "shelf_location": "Kệ B2",
            "supplier_name": "Xưởng rang Mộc",
            "is_pinned": True,
            "days": 65,
            "base_daily": 2.4,
            "weekend_boost": 1.35,
        },
        {
            "sku": "CF-CUP-01",
            "barcode": "8936112090112",
            "name": "Ly giấy nóng 12oz (Bịch 50 cái)",
            "category": "Bao bì & Ly",
            "tracking_type": "PACK_BREAK",
            "unit": "Cái",
            "pack_unit": "Bịch",
            "pack_conversion_rate": 50.0,
            "sealed_packs": 3,
            "capacity_reference": None,
            "current_stock": 182.0,
            "min_stock_level": 150.0,
            "lead_time_days": 3,
            "unit_cost": 950.0,
            "shelf_location": "Kệ C1",
            "supplier_name": "Bao bì An Tâm",
            "is_pinned": True,
            "days": 65,
            "base_daily": 68.0,
            "weekend_boost": 1.4,
        },
        {
            "sku": "CF-STRAW-01",
            "barcode": "2000011002017",
            "name": "Ống hút giấy kraft bọc màng",
            "category": "Vật tư nhỏ lẻ",
            "tracking_type": "CONSUMABLE",
            "unit": "Cái",
            "pack_unit": None,
            "pack_conversion_rate": 1.0,
            "sealed_packs": 0,
            "capacity_reference": 1000.0,
            "current_stock": 380.0,
            "min_stock_level": 250.0,
            "lead_time_days": 2,
            "unit_cost": 180.0,
            "shelf_location": "Ngăn quầy bar",
            "supplier_name": "Bao bì An Tâm",
            "is_pinned": False,
            "days": 45,
            "base_daily": 75.0,
            "weekend_boost": 1.35,
        },
        {
            "sku": "BK-CREAM-01",
            "barcode": "8934563880019",
            "name": "Whipping Cream Elle & Vire 1L",
            "category": "Nguyên liệu Bánh",
            "tracking_type": "STANDARD",
            "unit": "Hộp",
            "pack_unit": None,
            "pack_conversion_rate": 1.0,
            "sealed_packs": 0,
            "capacity_reference": None,
            "current_stock": 6.0,
            "min_stock_level": 8.0,
            "lead_time_days": 2,
            "unit_cost": 115000.0,
            "shelf_location": "Tủ mát A1",
            "supplier_name": "Bakers Choice VN",
            "is_pinned": True,
            "days": 65,
            "base_daily": 4.2,
            "weekend_boost": 1.55,
        },
        {
            "sku": "CF-SYRUP-01",
            "barcode": "8936019001118",
            "name": "Syrup Đào Monin 700ml",
            "category": "Nguyên liệu Pha chế",
            "tracking_type": "STANDARD",
            "unit": "Chai",
            "pack_unit": None,
            "pack_conversion_rate": 1.0,
            "sealed_packs": 0,
            "capacity_reference": None,
            "current_stock": 11.0,
            "min_stock_level": 4.0,
            "lead_time_days": 3,
            "unit_cost": 195000.0,
            "shelf_location": "Kệ B1",
            "supplier_name": "Nguyên liệu Pha chế Q3",
            "is_pinned": False,
            "days": 20,
            "base_daily": 1.4,
            "weekend_boost": 1.4,
        },
        {
            "sku": "BK-BOX-01",
            "barcode": "2000011002024",
            "name": "Hộp bánh sinh nhật size 20cm (Lốc 25 hộp)",
            "category": "Bao bì & Ly",
            "tracking_type": "PACK_BREAK",
            "unit": "Hộp",
            "pack_unit": "Lốc",
            "pack_conversion_rate": 25.0,
            "sealed_packs": 2,
            "capacity_reference": None,
            "current_stock": 68.0,
            "min_stock_level": 30.0,
            "lead_time_days": 3,
            "unit_cost": 8500.0,
            "shelf_location": "Kệ C3",
            "supplier_name": "Bao bì An Tâm",
            "is_pinned": False,
            "days": 22,
            "base_daily": 8.0,
            "weekend_boost": 1.7,
        },
        {
            "sku": "BK-RIBBON-01",
            "barcode": "2000011002031",
            "name": "Ruy-băng gói hộp bánh & Nến sinh nhật",
            "category": "Vật tư nhỏ lẻ",
            "tracking_type": "CONSUMABLE",
            "unit": "Bộ",
            "pack_unit": None,
            "pack_conversion_rate": 1.0,
            "sealed_packs": 0,
            "capacity_reference": 200.0,
            "current_stock": 140.0,
            "min_stock_level": 40.0,
            "lead_time_days": 2,
            "unit_cost": 1500.0,
            "shelf_location": "Ngăn đóng gói",
            "supplier_name": "Phụ kiện Bánh Sài Gòn",
            "is_pinned": False,
            "days": 14,
            "base_daily": 10.0,
            "weekend_boost": 1.5,
        },
        {
            "sku": "CF-MATCHA-01",
            "barcode": "4901321005514",
            "name": "Bột Matcha Uji Nhật Bản 500g",
            "category": "Nguyên liệu Pha chế",
            "tracking_type": "STANDARD",
            "unit": "Gói",
            "pack_unit": None,
            "pack_conversion_rate": 1.0,
            "sealed_packs": 0,
            "capacity_reference": None,
            "current_stock": 5.0,
            "min_stock_level": 3.0,
            "lead_time_days": 5,
            "unit_cost": 320000.0,
            "shelf_location": "Kệ B3",
            "supplier_name": "Nguyên liệu Pha chế Q3",
            "is_pinned": False,
            "days": 4,
            "base_daily": 1.0,
            "weekend_boost": 1.2,
        },
    ]

    rng = random.Random(42)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    seeded_products: list[Product] = []

    for spec in catalog_specs:
        prod = Product(
            store_id=store.id,
            sku=spec["sku"],
            barcode=spec["barcode"],
            name=spec["name"],
            normalized_name=normalize_vi_text(spec["name"]),
            category=spec["category"],
            tracking_type=spec["tracking_type"],
            unit=spec["unit"],
            pack_unit=spec["pack_unit"],
            pack_conversion_rate=spec["pack_conversion_rate"],
            sealed_packs=spec["sealed_packs"],
            capacity_reference=spec["capacity_reference"],
            current_stock=spec["current_stock"],
            min_stock_level=spec["min_stock_level"],
            lead_time_days=spec["lead_time_days"],
            unit_cost=spec["unit_cost"],
            shelf_location=spec["shelf_location"],
            supplier_name=spec["supplier_name"],
            is_pinned=spec["is_pinned"],
        )
        db.add(prod)
        db.flush()
        seeded_products.append(prod)

        hist_days: int = spec["days"]
        base_daily: float = spec["base_daily"]
        weekend_boost: float = spec["weekend_boost"]
        daily_consumptions: list[tuple[datetime, float]] = []

        for d_ago in range(hist_days, 0, -1):
            day_dt = (now - timedelta(days=d_ago)).replace(hour=18, minute=30, second=0, microsecond=0)
            dow = day_dt.weekday()
            is_weekend = dow in (5, 6)
            trend_factor = 1.0 + 0.12 * ((hist_days - d_ago) / max(1, hist_days))
            seasonal = weekend_boost if is_weekend else (0.92 if dow in (0, 1) else 1.0)
            noise = rng.uniform(0.85, 1.15)
            wave = 1.0 + 0.06 * math.sin(d_ago / 3.5)
            qty = max(1.0, round(base_daily * trend_factor * seasonal * noise * wave))
            daily_consumptions.append((day_dt, float(qty)))

        total_consumed = sum(q for _, q in daily_consumptions)
        damage_qty = 2.0 if spec["sku"] in ("CF-MILK-01", "BK-CREAM-01") else 0.0
        opening_balance = round(spec["current_stock"] + total_consumed + damage_qty, 3)

        first_dt = (now - timedelta(days=hist_days + 1)).replace(hour=8, minute=0, second=0, microsecond=0)
        db.add(
            StockMovement(
                store_id=store.id,
                product_id=prod.id,
                user_id=manager.id,
                movement_type="IN_PURCHASE",
                quantity_delta=opening_balance,
                balance_after=opening_balance,
                unit_entered=prod.unit,
                quantity_entered=opening_balance,
                note="Nhập tồn kho đầu kỳ mẫu",
                idempotency_key=f"seed-open-{prod.sku}",
                occurred_at=first_dt,
                created_at=first_dt,
            )
        )

        running_balance = opening_balance
        for idx, (day_dt, qty) in enumerate(daily_consumptions):
            running_balance = round(running_balance - qty, 3)
            actor_id = staff.id if idx % 2 == 0 else manager.id
            db.add(
                StockMovement(
                    store_id=store.id,
                    product_id=prod.id,
                    user_id=actor_id,
                    movement_type="OUT_CONSUMPTION",
                    quantity_delta=-qty,
                    balance_after=running_balance,
                    unit_entered=prod.unit,
                    quantity_entered=qty,
                    note="Tiêu thụ trong ca",
                    idempotency_key=f"seed-cons-{prod.sku}-{idx}",
                    occurred_at=day_dt,
                    created_at=day_dt,
                )
            )

        if damage_qty > 0:
            dmg_dt = (now - timedelta(days=5)).replace(hour=21, minute=0, second=0, microsecond=0)
            running_balance = round(running_balance - damage_qty, 3)
            db.add(
                StockMovement(
                    store_id=store.id,
                    product_id=prod.id,
                    user_id=staff.id,
                    movement_type="OUT_DAMAGE_EXPIRED",
                    quantity_delta=-damage_qty,
                    balance_after=running_balance,
                    unit_entered=prod.unit,
                    quantity_entered=damage_qty,
                    note="Hàng hỏng / hết hạn cuối ngày (Loại khỏi AI Dự báo)",
                    idempotency_key=f"seed-dmg-{prod.sku}",
                    occurred_at=dmg_dt,
                    created_at=dmg_dt,
                )
            )

    # Create 1 active Blind Stocktake session ready for defense demo
    session = StocktakeSession(
        store_id=store.id,
        title="Kiểm kê mù cuối ngày - Quầy Bar & Tủ mát",
        status="OPEN",
        is_blind=True,
        created_by_id=manager.id,
    )
    db.add(session)
    db.flush()

    milk = seeded_products[0]
    straw = seeded_products[4]
    db.add_all(
        [
            StocktakeItem(
                session_id=session.id,
                product_id=milk.id,
                system_qty_snapshot=milk.current_stock,
                counted_qty=12.0,
                treat_negative_variance_as_consumption=False,
                note="Đếm thực tế tủ mát A1",
                scanned_by_id=staff.id,
            ),
            StocktakeItem(
                session_id=session.id,
                product_id=straw.id,
                system_qty_snapshot=straw.current_stock,
                counted_qty=250.0,
                gauge_percent=25.0,
                treat_negative_variance_as_consumption=True,
                note="Ước lượng còn 1/4 hộp ống hút",
                scanned_by_id=staff.id,
            ),
        ]
    )

    db.commit()
    db.refresh(store)
    return store
