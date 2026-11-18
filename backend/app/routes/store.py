"""Store configuration, Lite/Pro mode toggle, and starter templates."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, hash_secret, require_manager
from app.models.entities import StockMovement, StocktakeItem, StocktakeSession, Store, User
from app.schemas.api import (
    DEFAULT_ACCOUNT_SECRET,
    ImportSummaryOut,
    StaffCreateRequest,
    StaffSecretResetRequest,
    StaffStatusUpdate,
    StoreOut,
    StoreSettingsUpdate,
    TemplateKey,
    UserOut,
)
from app.services.templates import apply_starter_template

router = APIRouter(prefix="/store", tags=["Store"])


class ApplyTemplateRequest(BaseModel):
    """Apply an industry starter template to current store."""

    template_key: TemplateKey


@router.get("", response_model=StoreOut)
def get_store(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> StoreOut:
    """Get active store configuration."""
    store = db.get(Store, current_user.store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found.")
    return StoreOut.model_validate(store)


@router.patch("", response_model=StoreOut)
def update_store(
    payload: StoreSettingsUpdate,
    manager: Annotated[User, Depends(require_manager)],
    db: Annotated[Session, Depends(get_db)],
) -> StoreOut:
    """Toggle Lite Mode / Warehouse Pro Mode or update store preferences."""
    store = db.get(Store, manager.store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found.")
    for key, val in payload.model_dump(exclude_unset=True).items():
        setattr(store, key, val)
    db.commit()
    db.refresh(store)
    return StoreOut.model_validate(store)


@router.post("/apply-template", response_model=ImportSummaryOut)
def apply_template(
    payload: ApplyTemplateRequest,
    manager: Annotated[User, Depends(require_manager)],
    db: Annotated[Session, Depends(get_db)],
) -> ImportSummaryOut:
    """Add starter industry items exclusively inside the seeded Demo workspace."""
    store = db.get(Store, manager.store_id)
    if not store or store.code != "MOC_BAKERY":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chức năng nạp bộ mẫu thử nghiệm chỉ bật trong tài khoản Demo.",
        )
    return apply_starter_template(db, manager, payload.template_key)


@router.get("/staff", response_model=list[UserOut])
def list_store_staff(
    manager: Annotated[User, Depends(require_manager)],
    db: Annotated[Session, Depends(get_db)],
) -> list[UserOut]:
    """List all active/locked manager and staff accounts belonging to the current store."""
    users = db.scalars(
        select(User)
        .where(User.store_id == manager.store_id, ~User.username.contains("__DEL_"))
        .order_by(User.role.asc(), User.id.asc())
    ).all()
    return [UserOut.model_validate(u) for u in users]


@router.post("/staff", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_store_staff(
    payload: StaffCreateRequest,
    manager: Annotated[User, Depends(require_manager)],
    db: Annotated[Session, Depends(get_db)],
) -> UserOut:
    """Allow store manager to add unlimited staff or co-manager accounts."""
    username = payload.username.strip().lower()
    if db.scalar(select(User).where(User.username == username)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tên đăng nhập '{username}' đã tồn tại.",
        )
    raw_secret = payload.secret.strip() if payload.secret else DEFAULT_ACCOUNT_SECRET
    new_user = User(
        store_id=manager.store_id,
        username=username,
        full_name=payload.full_name.strip(),
        hashed_secret=hash_secret(raw_secret),
        role=payload.role,
        is_active=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return UserOut.model_validate(new_user)


@router.patch("/staff/{user_id}", response_model=UserOut)
def update_store_staff_status(
    user_id: int,
    payload: StaffStatusUpdate,
    manager: Annotated[User, Depends(require_manager)],
    db: Annotated[Session, Depends(get_db)],
) -> UserOut:
    """Activate or deactivate a staff account without deleting historical ledger audit."""
    if user_id == manager.id and not payload.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Không thể tự khóa tài khoản Quản lý đang đăng nhập.",
        )
    target = db.scalar(
        select(User).where(
            User.id == user_id,
            User.store_id == manager.store_id,
            ~User.username.contains("__DEL_"),
        )
    )
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy nhân viên.")
    target.is_active = payload.is_active
    db.commit()
    db.refresh(target)
    return UserOut.model_validate(target)


@router.patch("/staff/{user_id}/secret", response_model=UserOut)
def reset_store_staff_secret(
    user_id: int,
    payload: StaffSecretResetRequest,
    manager: Annotated[User, Depends(require_manager)],
    db: Annotated[Session, Depends(get_db)],
) -> UserOut:
    """Manager resets or updates a store user's password (defaults to 1234)."""
    target = db.scalar(
        select(User).where(
            User.id == user_id,
            User.store_id == manager.store_id,
            ~User.username.contains("__DEL_"),
        )
    )
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy nhân viên.")
    target.hashed_secret = hash_secret(payload.new_secret.strip() or DEFAULT_ACCOUNT_SECRET)
    db.commit()
    db.refresh(target)
    return UserOut.model_validate(target)


@router.delete("/staff/{user_id}", status_code=status.HTTP_200_OK)
def delete_store_staff(
    user_id: int,
    manager: Annotated[User, Depends(require_manager)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, int | str]:
    """Manager deletes a staff account cleanly while preserving historical ledger integrity."""
    if user_id == manager.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Không thể xóa tài khoản Chủ kho đang đăng nhập.",
        )
    target = db.scalar(
        select(User).where(
            User.id == user_id,
            User.store_id == manager.store_id,
            ~User.username.contains("__DEL_"),
        )
    )
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy nhân viên.")

    has_history = any(
        (
            db.scalar(select(StockMovement.id).where(StockMovement.user_id == target.id)) is not None,
            db.scalar(select(StocktakeSession.id).where(StocktakeSession.created_by_id == target.id)) is not None,
            db.scalar(select(StocktakeSession.id).where(StocktakeSession.approved_by_id == target.id)) is not None,
            db.scalar(select(StocktakeItem.id).where(StocktakeItem.scanned_by_id == target.id)) is not None,
        )
    )
    if has_history:
        target.is_active = False
        target.username = f"{target.username[:46]}__DEL_{target.id}"
        target.hashed_secret = hash_secret(f"REVOKED_{target.id}")
    else:
        db.delete(target)
    db.commit()
    return {"status": "deleted", "id": user_id}
