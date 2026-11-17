"""Immutable stock ledger endpoints: Flow 1 single movement, Flow 2 batch, audit summary, and 15m reversal."""
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.entities import Product, StockMovement, User, utcnow_naive
from app.schemas.api import (
    BatchMovementRequest,
    BatchMovementResponse,
    LedgerAuditSummaryOut,
    MovementCreate,
    ReversalRequest,
    StockMovementOut,
)
from app.services.ledger import (
    get_ledger_audit_summary,
    record_batch_movements,
    record_movement,
    reverse_movement,
    serialize_movement,
)

router = APIRouter(prefix="/movements", tags=["Stock Ledger"])


@router.get("/summary", response_model=LedgerAuditSummaryOut)
def get_movements_summary(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    days: int | None = Query(default=None, ge=1, le=3650),
) -> LedgerAuditSummaryOut:
    """Summarize owner restocks and staff consumptions per store and per product."""
    return get_ledger_audit_summary(db, current_user.store_id, days)


@router.get("", response_model=list[StockMovementOut])
def list_movements(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    product_id: int | None = Query(default=None),
    movement_type: str | None = Query(default=None),
    actor_role: str | None = Query(default=None),
    days: int | None = Query(default=None, ge=1, le=3650),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[StockMovementOut]:
    """List recent immutable stock movements for active products in the current store."""
    query = (
        select(StockMovement)
        .join(Product, StockMovement.product_id == Product.id)
        .where(
            StockMovement.store_id == current_user.store_id,
            Product.is_active.is_(True),
        )
    )
    if product_id is not None:
        query = query.where(StockMovement.product_id == product_id)
    if movement_type:
        query = query.where(StockMovement.movement_type == movement_type)
    if actor_role:
        query = query.join(User, StockMovement.user_id == User.id).where(
            User.role == actor_role.upper()
        )
    if days is not None:
        since = utcnow_naive() - timedelta(days=days)
        query = query.where(StockMovement.occurred_at >= since)
    rows = db.scalars(
        query.order_by(StockMovement.occurred_at.desc(), StockMovement.id.desc()).limit(limit)
    ).all()
    return [serialize_movement(db, row) for row in rows]


@router.post("", response_model=StockMovementOut, status_code=status.HTTP_201_CREATED)
def create_movement(
    payload: MovementCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> StockMovementOut:
    """Flow 1: Record single stock-in, consumption, or damage movement with idempotency."""
    mv = record_movement(db, current_user, payload, commit=True)
    return serialize_movement(db, mv)


@router.post("/batch", response_model=BatchMovementResponse, status_code=status.HTTP_201_CREATED)
def create_batch_movements(
    payload: BatchMovementRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> BatchMovementResponse:
    """Flow 2: End-of-shift batch consumption or offline queue synchronization."""
    movements = record_batch_movements(db, current_user, payload.items)
    return BatchMovementResponse(
        processed_count=len(movements),
        movements=[serialize_movement(db, mv) for mv in movements],
    )


@router.post("/{movement_id}/reverse", response_model=StockMovementOut, status_code=status.HTTP_201_CREATED)
def reverse_ledger_movement(
    movement_id: int,
    payload: ReversalRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> StockMovementOut:
    """Compensate an incorrect movement via REVERSAL without deleting ledger history."""
    mv = reverse_movement(db, current_user, movement_id, payload.reason)
    return serialize_movement(db, mv)
