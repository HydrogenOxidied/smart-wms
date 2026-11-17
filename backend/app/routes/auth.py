"""Authentication, store registration, and demo-role quick login routes."""
import random
import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import create_access_token, get_current_user, hash_secret, verify_secret
from app.models.entities import Store, User
from app.schemas.api import (
    DEFAULT_ACCOUNT_SECRET,
    AuthResponse,
    ChangeSecretRequest,
    LoginRequest,
    RegisterStoreRequest,
    StoreOut,
    UserOut,
)
from app.seed import ensure_demo_store_seeded
from app.services.templates import apply_starter_template

router = APIRouter(prefix="/auth", tags=["Auth"])


class DemoLoginRequest(BaseModel):
    """Role selection for seeded graduation-thesis demo workspace."""

    role: Literal["MANAGER", "STAFF"]


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Annotated[Session, Depends(get_db)]) -> AuthResponse:
    """Authenticate an existing manager or staff user."""
    user = db.scalar(
        select(User).where(User.username == payload.username.strip().lower(), User.is_active.is_(True))
    )
    if not user or not verify_secret(payload.secret, user.hashed_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sai tên đăng nhập hoặc mật khẩu.",
        )
    store = db.get(Store, user.store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy cửa hàng.")
    return AuthResponse(
        access_token=create_access_token(user),
        user=UserOut.model_validate(user),
        store=StoreOut.model_validate(store),
    )


@router.post("/demo-login", response_model=AuthResponse)
def demo_login(payload: DemoLoginRequest, db: Annotated[Session, Depends(get_db)]) -> AuthResponse:
    """Issue token for the demo store, lazily seeding it only when Demo is requested."""
    store = ensure_demo_store_seeded(db)
    user = db.scalar(
        select(User)
        .where(User.store_id == store.id, User.role == payload.role, User.is_active.is_(True))
        .order_by(User.id.asc())
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy tài khoản demo.")
    return AuthResponse(
        access_token=create_access_token(user),
        user=UserOut.model_validate(user),
        store=StoreOut.model_validate(store),
    )


@router.post("/register-store", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register_store(
    payload: RegisterStoreRequest, db: Annotated[Session, Depends(get_db)]
) -> AuthResponse:
    """Create a brand new store workspace with starter template and optional staff account."""
    mgr_username = payload.manager_username.strip().lower()
    if db.scalar(select(User).where(User.username == mgr_username)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tên đăng nhập '{mgr_username}' đã tồn tại.",
        )

    staff_username = payload.staff_username.strip().lower() if payload.staff_username else None
    if staff_username and (
        staff_username == mgr_username or db.scalar(select(User).where(User.username == staff_username))
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tên đăng nhập nhân viên '{staff_username}' không khả dụng.",
        )

    base_code = re.sub(r"[^A-Z0-9]", "", payload.store_name.upper())[:8] or "STORE"
    code = f"{base_code}_{random.randint(100, 999)}"
    while db.scalar(select(Store).where(Store.code == code)):
        code = f"{base_code}_{random.randint(100, 999)}"

    store = Store(
        name=payload.store_name.strip(),
        code=code,
        industry_template=payload.industry_template,
        lite_mode=payload.lite_mode,
    )
    db.add(store)
    db.flush()

    mgr_raw_secret = payload.manager_secret or DEFAULT_ACCOUNT_SECRET
    manager = User(
        store_id=store.id,
        username=mgr_username,
        full_name=payload.manager_full_name.strip(),
        hashed_secret=hash_secret(mgr_raw_secret),
        role="MANAGER",
    )
    db.add(manager)
    db.flush()

    if staff_username:
        staff_raw_secret = payload.staff_secret or DEFAULT_ACCOUNT_SECRET
        db.add(
            User(
                store_id=store.id,
                username=staff_username,
                full_name=f"Nhân viên ({staff_username})",
                hashed_secret=hash_secret(staff_raw_secret),
                role="STAFF",
            )
        )

    db.commit()
    db.refresh(store)
    db.refresh(manager)

    if payload.industry_template != "EMPTY":
        apply_starter_template(db, manager, payload.industry_template)

    return AuthResponse(
        access_token=create_access_token(manager),
        user=UserOut.model_validate(manager),
        store=StoreOut.model_validate(store),
    )


@router.get("/me", response_model=AuthResponse)
def get_me(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AuthResponse:
    """Return active user profile and store configuration."""
    store = db.get(Store, current_user.store_id)
    if not store:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Store not found.")
    return AuthResponse(
        access_token=create_access_token(current_user),
        user=UserOut.model_validate(current_user),
        store=StoreOut.model_validate(store),
    )


@router.post("/change-secret", status_code=status.HTTP_200_OK)
def change_my_secret(
    payload: ChangeSecretRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, str]:
    """Allow any authenticated manager or staff user to change their own password."""
    if not verify_secret(payload.current_secret, current_user.hashed_secret):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mật khẩu hiện tại không chính xác.",
        )
    current_user.hashed_secret = hash_secret(payload.new_secret)
    db.commit()
    return {"status": "updated", "message": "Đã đổi mật khẩu thành công."}
