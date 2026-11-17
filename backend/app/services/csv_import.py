"""CSV bulk product/history import and Draft Purchase Order export."""
import csv
from datetime import datetime
import io

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Product, StockMovement, User
from app.schemas.api import ImportSummaryOut, MovementCreate, ProductCreate
from app.services.forecasting import get_store_forecast_overview
from app.services.ledger import record_movement
from app.services.products import create_product, normalize_vi_text


def import_products_csv(db: Session, user: User, raw_bytes: bytes) -> ImportSummaryOut:
    """Import or update products from a UTF-8 CSV file."""
    text = raw_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    created = 0
    updated = 0
    warnings: list[str] = []

    for idx, row in enumerate(reader, start=2):
        name = (row.get("name") or "").strip()
        if not name:
            warnings.append(f"Dòng {idx}: Thiếu cột 'name', đã bỏ qua.")
            continue

        sku = (row.get("sku") or "").strip().upper() or None
        existing = None
        if sku:
            existing = db.scalar(
                select(Product).where(Product.store_id == user.store_id, Product.sku == sku)
            )
        if not existing:
            norm = normalize_vi_text(name)
            existing = db.scalar(
                select(Product).where(Product.store_id == user.store_id, Product.normalized_name == norm)
            )

        try:
            current_stock = float(row.get("current_stock") or 0)
            min_stock = float(row.get("min_stock_level") or 5)
            lead_time = int(float(row.get("lead_time_days") or 3))
            unit_cost = float(row.get("unit_cost") or 0)
            pack_rate = float(row.get("pack_conversion_rate") or 1)
        except ValueError:
            warnings.append(f"Dòng {idx} ({name}): Giá trị số không hợp lệ, đã bỏ qua.")
            continue

        tracking = (row.get("tracking_type") or "STANDARD").strip().upper()
        if tracking not in {"STANDARD", "PACK_BREAK", "CONSUMABLE"}:
            tracking = "STANDARD"

        if existing:
            existing.unit = (row.get("unit") or existing.unit).strip()
            existing.category = (row.get("category") or existing.category).strip()
            existing.min_stock_level = min_stock
            existing.lead_time_days = max(1, lead_time)
            existing.unit_cost = max(0.0, unit_cost)
            if row.get("barcode"):
                existing.barcode = row["barcode"].strip()
            if row.get("supplier_name"):
                existing.supplier_name = row["supplier_name"].strip()
            updated += 1
        else:
            payload = ProductCreate(
                name=name,
                sku=sku,
                barcode=(row.get("barcode") or "").strip() or None,
                category=(row.get("category") or "Chung").strip(),
                tracking_type=tracking,  # type: ignore[arg-type]
                unit=(row.get("unit") or "Cái").strip(),
                pack_unit=(row.get("pack_unit") or "").strip() or None,
                pack_conversion_rate=max(1.0, pack_rate),
                current_stock=max(0.0, current_stock),
                min_stock_level=max(0.0, min_stock),
                lead_time_days=max(1, lead_time),
                unit_cost=max(0.0, unit_cost),
                shelf_location=(row.get("shelf_location") or "").strip() or None,
                supplier_name=(row.get("supplier_name") or "").strip() or None,
            )
            create_product(db, user, payload)
            created += 1

    db.commit()
    return ImportSummaryOut(
        created_products=created,
        updated_products=updated,
        imported_movements=0,
        warnings=warnings[:20],
    )


def import_consumption_history_csv(db: Session, user: User, raw_bytes: bytes) -> ImportSummaryOut:
    """Import historical daily consumption CSV (sku_or_name,date,quantity_consumed) for forecasting."""
    text = raw_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    products = db.scalars(
        select(Product).where(Product.store_id == user.store_id, Product.is_active.is_(True))
    ).all()
    by_sku = {p.sku.upper(): p for p in products}
    by_norm = {p.normalized_name: p for p in products}

    imported = 0
    warnings: list[str] = []

    for idx, row in enumerate(reader, start=2):
        key = (row.get("sku_or_name") or row.get("sku") or row.get("name") or "").strip()
        date_raw = (row.get("date") or "").strip()
        qty_raw = (row.get("quantity_consumed") or row.get("quantity") or "").strip()
        if not key or not date_raw or not qty_raw:
            warnings.append(f"Dòng {idx}: Thiếu sku_or_name/date/quantity_consumed.")
            continue

        product = by_sku.get(key.upper()) or by_norm.get(normalize_vi_text(key))
        if not product:
            warnings.append(f"Dòng {idx}: Không tìm thấy sản phẩm '{key}'.")
            continue

        try:
            qty = float(qty_raw)
            occurred_at = datetime.fromisoformat(date_raw)
        except ValueError:
            warnings.append(f"Dòng {idx}: Sai định dạng ngày (YYYY-MM-DD) hoặc số lượng.")
            continue

        if qty <= 0:
            continue

        idem_key = f"csv-hist-{user.store_id}-{product.id}-{occurred_at.date().isoformat()}-{idx}"
        existing = db.scalar(
            select(StockMovement).where(StockMovement.idempotency_key == idem_key)
        )
        if existing:
            continue

        # Ensure historical ledger entry doesn't drain below 0 if stock wasn't preloaded
        if product.current_stock < qty:
            product.current_stock += qty
            db.flush()

        record_movement(
            db,
            user,
            MovementCreate(
                product_id=product.id,
                movement_type="OUT_CONSUMPTION",
                quantity=qty,
                unit_mode="BASE",
                note="Import lịch sử tiêu thụ từ CSV",
                idempotency_key=idem_key,
                confirm_anomaly=True,
                occurred_at=occurred_at,
            ),
            commit=False,
        )
        imported += 1

    db.commit()
    return ImportSummaryOut(
        created_products=0,
        updated_products=0,
        imported_movements=imported,
        warnings=warnings[:20],
    )


def generate_draft_po_csv(db: Session, store_id: int) -> str:
    """Export ranked replenishment recommendations into a supplier-ready Draft PO CSV."""
    overview = get_store_forecast_overview(db, store_id)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "SKU",
            "TenMatHang",
            "NhaCungCap",
            "TrangThai",
            "TonHienTai",
            "DiemDatHangROP",
            "TonAnToan",
            "NgayConLai",
            "SoLuongDeXuatNhap",
            "DonVi",
            "DuToanChiPhiVND",
            "ThuatToanDuBao",
        ]
    )
    for item in overview.items:
        if item.recommended_order_qty <= 0:
            continue
        writer.writerow(
            [
                item.sku,
                item.name,
                item.supplier_name or "Chưa gán NCC",
                item.status,
                item.current_stock,
                item.reorder_point,
                item.safety_stock,
                item.days_until_stockout if item.days_until_stockout is not None else "N/A",
                item.recommended_order_qty,
                item.unit,
                item.estimated_order_cost,
                item.algorithm_tier,
            ]
        )
    return buf.getvalue()
