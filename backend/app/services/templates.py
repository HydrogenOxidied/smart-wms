"""1-Minute Starter Industry Templates for Micro-Store & Warehouse Onboarding."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Product, User
from app.schemas.api import ImportSummaryOut, ProductCreate, TemplateKey
from app.services.products import create_product

STARTER_TEMPLATES: dict[str, list[dict]] = {
    "CAFE_BAKERY": [
        {
            "sku": "CF-MILK-01",
            "barcode": "8934588013010",
            "name": "Sữa tươi thanh trùng DalatMilk 1L",
            "category": "Nguyên liệu Pha chế",
            "tracking_type": "STANDARD",
            "unit": "Hộp",
            "current_stock": 24,
            "min_stock_level": 12,
            "lead_time_days": 2,
            "unit_cost": 36000,
            "shelf_location": "Tủ mát A1",
            "supplier_name": "NPP DalatMilk HCM",
            "is_pinned": True,
        },
        {
            "sku": "CF-BEAN-01",
            "barcode": "8935024180025",
            "name": "Hạt Cà phê Arabica Cầu Đất 1Kg",
            "category": "Nguyên liệu Pha chế",
            "tracking_type": "STANDARD",
            "unit": "Túi",
            "current_stock": 14,
            "min_stock_level": 6,
            "lead_time_days": 3,
            "unit_cost": 240000,
            "shelf_location": "Kệ B2",
            "supplier_name": "Xưởng rang Mộc",
            "is_pinned": True,
        },
        {
            "sku": "CF-CUP-01",
            "barcode": "8936112090112",
            "name": "Ly giấy nóng 12oz (Bịch 50 cái)",
            "category": "Bao bì & Ly",
            "tracking_type": "PACK_BREAK",
            "unit": "Cái",
            "pack_unit": "Bịch",
            "pack_conversion_rate": 50,
            "current_stock": 250,
            "min_stock_level": 150,
            "lead_time_days": 3,
            "unit_cost": 950,
            "shelf_location": "Kệ C1",
            "supplier_name": "Bao bì An Tâm",
            "is_pinned": True,
        },
        {
            "sku": "CF-STRAW-01",
            "barcode": None,
            "name": "Ống hút giấy kraft bọc màng",
            "category": "Vật tư nhỏ lẻ",
            "tracking_type": "CONSUMABLE",
            "unit": "Cái",
            "capacity_reference": 1000,
            "current_stock": 420,
            "min_stock_level": 200,
            "lead_time_days": 2,
            "unit_cost": 180,
            "shelf_location": "Ngăn quầy bar",
            "supplier_name": "Bao bì An Tâm",
            "is_pinned": False,
        },
        {
            "sku": "BK-FLOUR-01",
            "barcode": "8934563138165",
            "name": "Bột mì làm bánh số 8 (Bao 1Kg)",
            "category": "Nguyên liệu Bánh",
            "tracking_type": "STANDARD",
            "unit": "Kg",
            "current_stock": 18,
            "min_stock_level": 10,
            "lead_time_days": 2,
            "unit_cost": 28000,
            "shelf_location": "Kệ D1",
            "supplier_name": "Đại lý Bột Baker",
            "is_pinned": True,
        },
    ],
    "MINI_MART": [
        {
            "sku": "MM-WATER-01",
            "barcode": "8934588012020",
            "name": "Nước suối Aquafina 500ml (Thùng 24 chai)",
            "category": "Đồ uống",
            "tracking_type": "PACK_BREAK",
            "unit": "Chai",
            "pack_unit": "Thùng",
            "pack_conversion_rate": 24,
            "current_stock": 96,
            "min_stock_level": 48,
            "lead_time_days": 2,
            "unit_cost": 4200,
            "shelf_location": "Kệ 1A",
            "supplier_name": "NPP Suntory",
            "is_pinned": True,
        },
        {
            "sku": "MM-NOODLE-01",
            "barcode": "8934563101114",
            "name": "Mì Hảo Hảo Tôm Chua Cay (Thùng 30 gói)",
            "category": "Thực phẩm khô",
            "tracking_type": "PACK_BREAK",
            "unit": "Gói",
            "pack_unit": "Thùng",
            "pack_conversion_rate": 30,
            "current_stock": 120,
            "min_stock_level": 60,
            "lead_time_days": 3,
            "unit_cost": 3800,
            "shelf_location": "Kệ 2B",
            "supplier_name": "NPP Acecook",
            "is_pinned": True,
        },
        {
            "sku": "MM-BAG-01",
            "barcode": None,
            "name": "Túi xốp 2 quai sinh học cỡ trung",
            "category": "Vật tư nhỏ lẻ",
            "tracking_type": "CONSUMABLE",
            "unit": "Chiếc",
            "capacity_reference": 500,
            "current_stock": 300,
            "min_stock_level": 100,
            "lead_time_days": 2,
            "unit_cost": 150,
            "shelf_location": "Quầy thu ngân",
            "supplier_name": "Bao bì An Tâm",
            "is_pinned": False,
        },
    ],
    "HARDWARE": [
        {
            "sku": "HW-SCREW-01",
            "barcode": None,
            "name": "Vít bắn tôn đầu lục giác (Hộp 200 con)",
            "category": "Kim khí nhỏ lẻ",
            "tracking_type": "PACK_BREAK",
            "unit": "Con",
            "pack_unit": "Hộp",
            "pack_conversion_rate": 200,
            "current_stock": 800,
            "min_stock_level": 400,
            "lead_time_days": 3,
            "unit_cost": 450,
            "shelf_location": "Khay A4",
            "supplier_name": "Kim khí Tân Phát",
            "is_pinned": True,
        },
        {
            "sku": "HW-TAPE-01",
            "barcode": "8936009980015",
            "name": "Băng keo điện Nano đen",
            "category": "Vật tư điện",
            "tracking_type": "STANDARD",
            "unit": "Cuộn",
            "current_stock": 35,
            "min_stock_level": 15,
            "lead_time_days": 2,
            "unit_cost": 8000,
            "shelf_location": "Kệ B1",
            "supplier_name": "Kim khí Tân Phát",
            "is_pinned": True,
        },
        {
            "sku": "HW-ZIPTIE-01",
            "barcode": None,
            "name": "Dây rút nhựa trắng 20cm",
            "category": "Vật tư nhỏ lẻ",
            "tracking_type": "CONSUMABLE",
            "unit": "Sợi",
            "capacity_reference": 1000,
            "current_stock": 650,
            "min_stock_level": 200,
            "lead_time_days": 2,
            "unit_cost": 120,
            "shelf_location": "Khay B3",
            "supplier_name": "Kim khí Tân Phát",
            "is_pinned": False,
        },
    ],
    "EMPTY": [],
}


def apply_starter_template(db: Session, user: User, template_key: TemplateKey) -> ImportSummaryOut:
    """Populate a store with starter items from the chosen industry template without duplicating SKUs."""
    rows = STARTER_TEMPLATES.get(template_key, [])
    existing_skus = set(
        db.scalars(select(Product.sku).where(Product.store_id == user.store_id)).all()
    )
    created = 0
    warnings: list[str] = []

    for row in rows:
        if row["sku"] in existing_skus:
            warnings.append(f"Bỏ qua SKU đã có: {row['sku']}")
            continue
        payload = ProductCreate(**row)
        create_product(db, user, payload)
        existing_skus.add(row["sku"])
        created += 1

    return ImportSummaryOut(
        created_products=created,
        updated_products=0,
        imported_movements=0,
        warnings=warnings,
    )
