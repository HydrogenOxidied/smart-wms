"""Blind stocktake cycle count & manager variance approval routes (Flow 3)."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_manager
from app.models.entities import StocktakeSession, User
from app.schemas.api import (
    StocktakeApproveRequest,
    StocktakeCreateRequest,
    StocktakeScanRequest,
    StocktakeSessionOut,
)
from app.services.stocktake import (
    approve_session,
    create_session,
    record_scan,
    serialize_session,
    submit_session,
)

router = APIRouter(prefix="/stocktakes", tags=["Stocktakes"])


@router.get("", response_model=list[StocktakeSessionOut])
def list_sessions(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[StocktakeSessionOut]:
    """List stocktake sessions ordered newest first."""
    sessions = db.scalars(
        select(StocktakeSession)
        .where(StocktakeSession.store_id == current_user.store_id)
        .order_by(StocktakeSession.created_at.desc(), StocktakeSession.id.desc())
    ).all()
    return [serialize_session(s, current_user) for s in sessions]


@router.post("", response_model=StocktakeSessionOut, status_code=status.HTTP_201_CREATED)
def create_new_session(
    payload: StocktakeCreateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> StocktakeSessionOut:
    """Start a new blind or open cycle count session."""
    session = create_session(db, current_user, payload)
    return serialize_session(session, current_user)


@router.get("/{session_id}", response_model=StocktakeSessionOut)
def get_session(
    session_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> StocktakeSessionOut:
    """Get a single stocktake session with role-appropriate blind masking."""
    session = db.scalar(
        select(StocktakeSession).where(
            StocktakeSession.id == session_id, StocktakeSession.store_id == current_user.store_id
        )
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiên kiểm kê.")
    return serialize_session(session, current_user)


@router.post("/{session_id}/scan", response_model=StocktakeSessionOut)
def scan_item(
    session_id: int,
    payload: StocktakeScanRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> StocktakeSessionOut:
    """Record counted quantity or consumable gauge percentage for an item."""
    session = record_scan(db, current_user, session_id, payload)
    return serialize_session(session, current_user)


@router.post("/{session_id}/submit", response_model=StocktakeSessionOut)
def submit_stocktake(
    session_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> StocktakeSessionOut:
    """Submit stocktake counts for manager review."""
    session = submit_session(db, current_user, session_id)
    return serialize_session(session, current_user)


@router.post("/{session_id}/approve", response_model=StocktakeSessionOut)
def approve_stocktake(
    session_id: int,
    payload: StocktakeApproveRequest,
    manager: Annotated[User, Depends(require_manager)],
    db: Annotated[Session, Depends(get_db)],
) -> StocktakeSessionOut:
    """Manager approves variances and posts ADJUST_STOCKTAKE / Implied OUT_CONSUMPTION."""
    session = approve_session(db, manager, session_id, payload)
    return serialize_session(session, manager)
