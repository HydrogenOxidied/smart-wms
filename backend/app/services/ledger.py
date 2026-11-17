"""Immutable append-only stock ledger with idempotency, anomaly guard, and 15m reversal."""
from datetime import datetime, timedelta
import math
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import Product, StockMovement, Store, User, utcnow_naive
from app.schemas.api import (
    LedgerAuditSummaryOut,
    MovementCreate,
    PackBreakRequest,
    ProductAuditSummaryOut,
    StockMovementOut,
)

REVERSAL_WINDOW_MINUTES = 15


def serialize_movement(db: Session, movement: StockMovement) -> StockMovementOut:
    """Serialize a ledger movement enriched with product, user, and reversal status."""
    product = db.get(Product, movement.product_id)
    actor = db.get(User, movement.user_id)
    is_reversed = (
        db.scalar(
            select(StockMovement.id).where(StockMovement.reversed_movement_id == movement.id)
        )
        is not None
    )
    balance_before = round(movement.balance_after - movement.quantity_delta, 3)
    return StockMovementOut(
        id=movement.id,
        store_id=movement.store_id,
        product_id=movement.product_id,
        product_name=product.name if product else None,
        product_unit=product.unit if product else None,
        user_id=movement.user_id,
        user_name=actor.full_name if actor else None,
        user_username=actor.username if actor else None,
        user_role=actor.role if actor else None,
        movement_type=movement.movement_type,
        quantity_delta=movement.quantity_delta,
        balance_before=balance_before,
        balance_after=movement.balance_after,
        unit_entered=movement.unit_entered,
        quantity_entered=movement.quantity_entered,
        note=movement.note,
        idempotency_key=movement.idempotency_key,
        reversed_movement_id=movement.reversed_movement_id,
        is_reversed=is_reversed,
        occurred_at=movement.occurred_at,
        created_at=movement.created_at,
    )


def _compute_recent_avg_daily_consumption(db: Session, store_id: int, product_id: int) -> float:
    """Compute average daily OUT_CONSUMPTION over the last 30 days."""
    since = utcnow_naive() - timedelta(days=30)
    total_consumed = db.scalar(
        select(func.coalesce(func.sum(func.abs(StockMovement.quantity_delta)), 0.0)).where(
            StockMovement.store_id == store_id,
            StockMovement.product_id == product_id,
            StockMovement.movement_type == "OUT_CONSUMPTION",
            StockMovement.occurred_at >= since,
        )
    )
    active_days = db.scalar(
        select(func.count(func.distinct(func.date(StockMovement.occurred_at)))).where(
            StockMovement.store_id == store_id,
            StockMovement.product_id == product_id,
            StockMovement.movement_type == "OUT_CONSUMPTION",
            StockMovement.occurred_at >= since,
        )
    )
    if not active_days or active_days < 3:
        return 0.0
    return float(total_consumed or 0.0) / float(active_days)


def _sync_sealed_packs(product: Product, movement_type: str, unit_mode: str, entered_qty: float) -> None:
    """Keep unopened pack counts consistent with base-unit total stock."""
    if product.tracking_type != "PACK_BREAK" or product.pack_conversion_rate <= 1:
        return
    rate = product.pack_conversion_rate
    if movement_type == "IN_PURCHASE" and unit_mode == "PACK":
        product.sealed_packs += int(round(entered_qty))
    max_possible_packs = int(math.floor(max(0.0, product.current_stock) / rate))
    if product.sealed_packs > max_possible_packs:
        product.sealed_packs = max_possible_packs


def record_movement(
    db: Session,
    user: User,
    payload: MovementCreate,
    commit: bool = True,
) -> StockMovement:
    """Record a single stock movement atomically with idempotency and anomaly guard."""
    existing = db.scalar(
        select(StockMovement).where(StockMovement.idempotency_key == payload.idempotency_key)
    )
    if existing:
        if existing.store_id != user.store_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Idempotency key không hợp lệ.")
        return existing

    store = db.get(Store, user.store_id)
    product = db.scalar(
        select(Product).where(
            Product.id == payload.product_id,
            Product.store_id == user.store_id,
            Product.is_active.is_(True),
        )
    )
    if not product or not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy mặt hàng.")

    if payload.movement_type == "IN_PURCHASE" and user.role != "MANAGER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ Chủ kho mới có quyền nhập thêm hàng vào kho.",
        )

    multiplier = 1.0
    unit_label = product.unit
    if payload.unit_mode == "PACK":
        if not product.pack_unit or product.pack_conversion_rate <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Sản phẩm '{product.name}' chưa cấu hình đơn vị thùng/bịch quy đổi.",
            )
        multiplier = product.pack_conversion_rate
        unit_label = product.pack_unit

    base_qty = round(payload.quantity * multiplier, 3)
    if payload.movement_type == "IN_PURCHASE":
        delta = base_qty
    else:
        delta = -base_qty

    if payload.movement_type == "OUT_CONSUMPTION" and not payload.confirm_anomaly:
        avg_daily = _compute_recent_avg_daily_consumption(db, user.store_id, product.id)
        if avg_daily > 0 and base_qty > max(20.0, 10.0 * avg_daily):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "ANOMALY_CONFIRMATION_REQUIRED",
                    "message": (
                        f"Số lượng xuất ({base_qty:g} {product.unit}) cao bất thường so với mức "
                        f"trung bình {avg_daily:.1f} {product.unit}/ngày. Xác nhận nếu bạn chắc chắn."
                    ),
                    "avg_daily": round(avg_daily, 2),
                    "entered_base_qty": base_qty,
                },
            )

    new_balance = round(product.current_stock + delta, 3)
    if new_balance < 0 and not store.allow_negative_stock:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Tồn kho '{product.name}' chỉ còn {product.current_stock:g} {product.unit}, "
                f"không đủ để xuất {base_qty:g} {product.unit}."
            ),
        )

    product.current_stock = new_balance
    _sync_sealed_packs(product, payload.movement_type, payload.unit_mode, payload.quantity)

    occurred = payload.occurred_at.replace(tzinfo=None) if payload.occurred_at else utcnow_naive()
    movement = StockMovement(
        store_id=user.store_id,
        product_id=product.id,
        user_id=user.id,
        movement_type=payload.movement_type,
        quantity_delta=delta,
        balance_after=new_balance,
        unit_entered=unit_label,
        quantity_entered=payload.quantity,
        note=payload.note,
        idempotency_key=payload.idempotency_key,
        occurred_at=occurred,
    )
    db.add(movement)
    if commit:
        db.commit()
        db.refresh(movement)
    else:
        db.flush()
    return movement


def record_batch_movements(db: Session, user: User, items: list[MovementCreate]) -> list[StockMovement]:
    """Process a batch of movements (end-of-shift or offline queue sync) inside one transaction."""
    results: list[StockMovement] = []
    for item in items:
        mv = record_movement(db, user, item, commit=False)
        results.append(mv)
    db.commit()
    for mv in results:
        db.refresh(mv)
    return results


def break_pack(db: Session, user: User, product_id: int, payload: PackBreakRequest) -> StockMovement:
    """Open sealed packs into loose individual units without changing total base-unit stock."""
    existing = db.scalar(
        select(StockMovement).where(StockMovement.idempotency_key == payload.idempotency_key)
    )
    if existing:
        return existing

    product = db.scalar(
        select(Product).where(
            Product.id == product_id,
            Product.store_id == user.store_id,
            Product.is_active.is_(True),
        )
    )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy mặt hàng.")
    if product.tracking_type != "PACK_BREAK" or not product.pack_unit or product.pack_conversion_rate <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mặt hàng này không sử dụng chế độ xé lẻ bao bì.",
        )
    if product.sealed_packs < payload.packs_to_break:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Chỉ còn {product.sealed_packs} {product.pack_unit} nguyên seal để khui.",
        )

    product.sealed_packs -= payload.packs_to_break
    opened_units = round(payload.packs_to_break * product.pack_conversion_rate, 3)
    movement = StockMovement(
        store_id=user.store_id,
        product_id=product.id,
        user_id=user.id,
        movement_type="PACK_BREAK",
        quantity_delta=0.0,
        balance_after=product.current_stock,
        unit_entered=product.pack_unit,
        quantity_entered=float(payload.packs_to_break),
        note=payload.note or f"Khui {payload.packs_to_break} {product.pack_unit} thành {opened_units:g} {product.unit} lẻ",
        idempotency_key=payload.idempotency_key,
    )
    db.add(movement)
    db.commit()
    db.refresh(movement)
    return movement


def reverse_movement(db: Session, user: User, movement_id: int, reason: str) -> StockMovement:
    """Compensate an erroneous movement via an immutable REVERSAL entry (15m limit for STAFF)."""
    original = db.scalar(
        select(StockMovement).where(
            StockMovement.id == movement_id,
            StockMovement.store_id == user.store_id,
        )
    )
    if not original:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy giao dịch.")
    if original.movement_type in {"REVERSAL", "PACK_BREAK", "ADJUST_STOCKTAKE"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Không thể đính chính loại giao dịch này.",
        )

    already_reversed = db.scalar(
        select(StockMovement).where(StockMovement.reversed_movement_id == original.id)
    )
    if already_reversed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Giao dịch này đã được đính chính trước đó.",
        )

    if user.role != "MANAGER":
        elapsed = utcnow_naive() - original.created_at
        if elapsed > timedelta(minutes=REVERSAL_WINDOW_MINUTES):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Nhân viên chỉ được đính chính giao dịch trong vòng {REVERSAL_WINDOW_MINUTES} phút. Liên hệ Quản lý.",
            )

    product = db.get(Product, original.product_id)
    store = db.get(Store, user.store_id)
    if not product or not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sản phẩm không tồn tại.")

    reverse_delta = round(-original.quantity_delta, 3)
    new_balance = round(product.current_stock + reverse_delta, 3)
    if new_balance < 0 and not store.allow_negative_stock:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Không thể đính chính vì sẽ làm tồn kho âm.",
        )

    product.current_stock = new_balance
    if product.tracking_type == "PACK_BREAK" and product.pack_conversion_rate > 1:
        max_packs = int(math.floor(max(0.0, new_balance) / product.pack_conversion_rate))
        if product.sealed_packs > max_packs:
            product.sealed_packs = max_packs

    reversal = StockMovement(
        store_id=user.store_id,
        product_id=product.id,
        user_id=user.id,
        movement_type="REVERSAL",
        quantity_delta=reverse_delta,
        balance_after=new_balance,
        unit_entered=product.unit,
        quantity_entered=abs(reverse_delta),
        note=f"Đính chính giao dịch #{original.id}: {reason}",
        idempotency_key=f"reversal-{original.id}",
        reversed_movement_id=original.id,
        occurred_at=original.occurred_at,
    )
    db.add(reversal)
    db.commit()
    db.refresh(reversal)
    return reversal


def get_ledger_audit_summary(
    db: Session, store_id: int, days: int | None = None
) -> LedgerAuditSummaryOut:
    """Aggregate net owner stock-ins and staff/manager consumptions per product and store."""
    active_products = db.scalars(
        select(Product)
        .where(Product.store_id == store_id, Product.is_active.is_(True))
        .order_by(Product.is_pinned.desc(), Product.name.asc())
    ).all()

    reversed_ids = set(
        db.scalars(
            select(StockMovement.reversed_movement_id).where(
                StockMovement.store_id == store_id,
                StockMovement.reversed_movement_id.is_not(None),
            )
        ).all()
    )

    stats: dict[int, dict[str, Any]] = {
        prod.id: {
            "product": prod,
            "owner_imported_qty": 0.0,
            "owner_imported_count": 0,
            "staff_consumed_qty": 0.0,
            "staff_consumed_count": 0,
            "manager_consumed_qty": 0.0,
            "last_modified_at": None,
        }
        for prod in active_products
    }

    stmt = (
        select(StockMovement, User.role)
        .outerjoin(User, StockMovement.user_id == User.id)
        .where(StockMovement.store_id == store_id)
    )
    if days is not None:
        since = utcnow_naive() - timedelta(days=days)
        stmt = stmt.where(StockMovement.occurred_at >= since)

    rows = db.execute(
        stmt.order_by(StockMovement.occurred_at.desc(), StockMovement.id.desc())
    ).all()

    owner_imported_total = 0.0
    owner_imported_events = 0
    staff_consumed_total = 0.0
    staff_consumed_events = 0
    manager_consumed_total = 0.0
    manager_consumed_events = 0

    for mv, actor_role in rows:
        entry = stats.get(mv.product_id)
        if entry is not None:
            prev_dt: datetime | None = entry["last_modified_at"]
            if prev_dt is None or mv.occurred_at > prev_dt:
                entry["last_modified_at"] = mv.occurred_at

        if mv.id in reversed_ids or mv.movement_type == "REVERSAL":
            continue

        if mv.movement_type == "IN_PURCHASE":
            qty = abs(float(mv.quantity_delta))
            owner_imported_total += qty
            owner_imported_events += 1
            if entry is not None:
                entry["owner_imported_qty"] += qty
                entry["owner_imported_count"] += 1
        elif mv.movement_type in ("OUT_CONSUMPTION", "OUT_DAMAGE_EXPIRED"):
            qty = abs(float(mv.quantity_delta))
            if actor_role == "STAFF":
                staff_consumed_total += qty
                staff_consumed_events += 1
                if entry is not None:
                    entry["staff_consumed_qty"] += qty
                    entry["staff_consumed_count"] += 1
            else:
                manager_consumed_total += qty
                manager_consumed_events += 1
                if entry is not None:
                    entry["manager_consumed_qty"] += qty

    product_items: list[ProductAuditSummaryOut] = []
    for prod in active_products:
        entry = stats[prod.id]
        staff_qty = round(float(entry["staff_consumed_qty"]), 3)
        mgr_qty = round(float(entry["manager_consumed_qty"]), 3)
        product_items.append(
            ProductAuditSummaryOut(
                product_id=prod.id,
                sku=prod.sku,
                name=prod.name,
                unit=prod.unit,
                current_stock=round(float(prod.current_stock), 3),
                owner_imported_qty=round(float(entry["owner_imported_qty"]), 3),
                owner_imported_count=int(entry["owner_imported_count"]),
                staff_consumed_qty=staff_qty,
                staff_consumed_count=int(entry["staff_consumed_count"]),
                manager_consumed_qty=mgr_qty,
                total_consumed_qty=round(staff_qty + mgr_qty, 3),
                last_modified_at=entry["last_modified_at"],
            )
        )

    return LedgerAuditSummaryOut(
        store_id=store_id,
        period_days=days,
        owner_imported_total=round(owner_imported_total, 3),
        owner_imported_events=owner_imported_events,
        staff_consumed_total=round(staff_consumed_total, 3),
        staff_consumed_events=staff_consumed_events,
        manager_consumed_total=round(manager_consumed_total, 3),
        manager_consumed_events=manager_consumed_events,
        products=product_items,
    )
