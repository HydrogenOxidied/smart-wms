"""Blind stocktake, consumable gauge counting, and manager variance reconciliation."""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    Product,
    StockMovement,
    StocktakeItem,
    StocktakeSession,
    User,
    utcnow_naive,
)
from app.schemas.api import (
    StocktakeApproveRequest,
    StocktakeCreateRequest,
    StocktakeItemOut,
    StocktakeScanRequest,
    StocktakeSessionOut,
)


def serialize_session(session: StocktakeSession, user: User) -> StocktakeSessionOut:
    """Serialize stocktake session; hide system snapshot during OPEN blind count for STAFF."""
    hide_snapshot = session.is_blind and session.status == "OPEN" and user.role != "MANAGER"
    items_out: list[StocktakeItemOut] = []
    for item in session.items:
        prod = item.product
        variance = round(item.counted_qty - item.system_qty_snapshot, 3)
        items_out.append(
            StocktakeItemOut(
                id=item.id,
                product_id=item.product_id,
                sku=prod.sku if prod else "",
                name=prod.name if prod else "",
                unit=prod.unit if prod else "",
                tracking_type=prod.tracking_type if prod else "STANDARD",
                barcode=prod.barcode if prod else None,
                shelf_location=prod.shelf_location if prod else None,
                system_qty_snapshot=None if hide_snapshot else item.system_qty_snapshot,
                counted_qty=item.counted_qty,
                variance_qty=None if hide_snapshot else variance,
                gauge_percent=item.gauge_percent,
                treat_negative_variance_as_consumption=item.treat_negative_variance_as_consumption,
                note=item.note,
                scanned_at=item.scanned_at,
            )
        )
    items_out.sort(key=lambda x: x.scanned_at, reverse=True)
    return StocktakeSessionOut(
        id=session.id,
        store_id=session.store_id,
        title=session.title,
        status=session.status,
        is_blind=session.is_blind,
        created_by_id=session.created_by_id,
        approved_by_id=session.approved_by_id,
        created_at=session.created_at,
        submitted_at=session.submitted_at,
        approved_at=session.approved_at,
        items=items_out,
    )


def create_session(db: Session, user: User, payload: StocktakeCreateRequest) -> StocktakeSession:
    """Create a new stocktake cycle count session."""
    session = StocktakeSession(
        store_id=user.store_id,
        title=payload.title.strip(),
        status="OPEN",
        is_blind=payload.is_blind,
        created_by_id=user.id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def record_scan(
    db: Session, user: User, session_id: int, payload: StocktakeScanRequest
) -> StocktakeSession:
    """Record or update counted quantity (or gauge percentage for consumables) in an OPEN session."""
    session = db.scalar(
        select(StocktakeSession).where(
            StocktakeSession.id == session_id, StocktakeSession.store_id == user.store_id
        )
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiên kiểm kê.")
    if session.status != "OPEN":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phiên kiểm kê không còn ở trạng thái đang kiểm.",
        )

    product: Product | None = None
    if payload.product_id:
        product = db.scalar(
            select(Product).where(
                Product.id == payload.product_id,
                Product.store_id == user.store_id,
                Product.is_active.is_(True),
            )
        )
    elif payload.barcode:
        clean_code = payload.barcode.strip()
        product = db.scalar(
            select(Product).where(
                Product.store_id == user.store_id,
                Product.is_active.is_(True),
                (Product.barcode == clean_code) | (Product.sku == clean_code.upper()),
            )
        )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy mặt hàng khớp mã.")

    if payload.gauge_percent is not None:
        ref = product.capacity_reference or max(product.current_stock, product.min_stock_level * 4.0, 100.0)
        counted = round((payload.gauge_percent / 100.0) * ref, 3)
    elif payload.counted_qty is not None:
        counted = round(payload.counted_qty, 3)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cần cung cấp số lượng thực đếm hoặc tỷ lệ % ước lượng.",
        )

    existing_item = db.scalar(
        select(StocktakeItem).where(
            StocktakeItem.session_id == session.id, StocktakeItem.product_id == product.id
        )
    )
    default_implied = (
        payload.treat_negative_variance_as_consumption
        if payload.treat_negative_variance_as_consumption is not None
        else (product.tracking_type == "CONSUMABLE")
    )

    if existing_item:
        existing_item.counted_qty = counted
        existing_item.gauge_percent = payload.gauge_percent
        existing_item.treat_negative_variance_as_consumption = default_implied
        existing_item.note = payload.note
        existing_item.scanned_by_id = user.id
        existing_item.scanned_at = utcnow_naive()
    else:
        db.add(
            StocktakeItem(
                session_id=session.id,
                product_id=product.id,
                system_qty_snapshot=product.current_stock,
                counted_qty=counted,
                gauge_percent=payload.gauge_percent,
                treat_negative_variance_as_consumption=default_implied,
                note=payload.note,
                scanned_by_id=user.id,
            )
        )

    db.commit()
    db.refresh(session)
    return session


def submit_session(db: Session, user: User, session_id: int) -> StocktakeSession:
    """Lock an OPEN stocktake session for manager review."""
    session = db.scalar(
        select(StocktakeSession).where(
            StocktakeSession.id == session_id, StocktakeSession.store_id == user.store_id
        )
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiên kiểm kê.")
    if session.status != "OPEN":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Phiên đã được gửi trước đó.")
    if not session.items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cần kiểm kê ít nhất 1 mặt hàng trước khi gửi duyệt.",
        )
    session.status = "SUBMITTED"
    session.submitted_at = utcnow_naive()
    db.commit()
    db.refresh(session)
    return session


def approve_session(
    db: Session, manager: User, session_id: int, payload: StocktakeApproveRequest
) -> StocktakeSession:
    """Reconcile counted quantities into immutable ledger entries (implied consumption or adjust)."""
    session = db.scalar(
        select(StocktakeSession).where(
            StocktakeSession.id == session_id, StocktakeSession.store_id == manager.store_id
        )
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiên kiểm kê.")
    if session.status == "APPROVED":
        return session
    if session.status == "CANCELLED":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Phiên đã bị hủy.")

    overrides = {opt.product_id: opt.treat_negative_variance_as_consumption for opt in payload.item_options}

    for item in session.items:
        product = db.get(Product, item.product_id)
        if not product:
            continue
        if item.product_id in overrides:
            item.treat_negative_variance_as_consumption = overrides[item.product_id]

        delta = round(item.counted_qty - product.current_stock, 3)
        if abs(delta) < 1e-6:
            continue

        if delta < 0 and item.treat_negative_variance_as_consumption:
            mv_type = "OUT_CONSUMPTION"
            note = f"Suy ngược tiêu thụ từ kiểm kê #{session.id} ({session.title})"
        else:
            mv_type = "ADJUST_STOCKTAKE"
            note = f"Cân bằng chênh lệch kiểm kê #{session.id} ({session.title})"

        product.current_stock = round(item.counted_qty, 3)
        if product.tracking_type == "PACK_BREAK" and product.pack_conversion_rate > 1:
            max_packs = int(product.current_stock // product.pack_conversion_rate)
            if product.sealed_packs > max_packs:
                product.sealed_packs = max_packs

        db.add(
            StockMovement(
                store_id=manager.store_id,
                product_id=product.id,
                user_id=manager.id,
                movement_type=mv_type,
                quantity_delta=delta,
                balance_after=product.current_stock,
                unit_entered=product.unit,
                quantity_entered=abs(delta),
                note=note,
                idempotency_key=f"stocktake-approve-{session.id}-{product.id}",
            )
        )

    session.status = "APPROVED"
    session.approved_by_id = manager.id
    session.approved_at = utcnow_naive()
    if not session.submitted_at:
        session.submitted_at = session.approved_at
    db.commit()
    db.refresh(session)
    return session
