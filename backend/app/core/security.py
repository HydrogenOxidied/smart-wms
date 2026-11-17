"""Authentication, password hashing with bcrypt, and RBAC dependencies."""
from datetime import datetime, timedelta, timezone
from typing import Annotated

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.entities import User

bearer_scheme = HTTPBearer(auto_error=False)


def hash_secret(raw_secret: str) -> str:
    """Hash a plain secret string using bcrypt."""
    salt = bcrypt.gensalt(rounds=10)
    return bcrypt.hashpw(raw_secret.encode("utf-8"), salt).decode("utf-8")


def verify_secret(raw_secret: str, hashed_secret: str) -> bool:
    """Verify a plain secret against its stored bcrypt hash."""
    return bcrypt.checkpw(raw_secret.encode("utf-8"), hashed_secret.encode("utf-8"))


def create_access_token(user: User) -> str:
    """Issue a signed HS256 JWT access token for a user."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "store_id": user.store_id,
        "role": user.role,
        "username": user.username,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_expire_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(raw_token: str) -> dict:
    """Decode and validate a JWT access token."""
    settings = get_settings()
    try:
        return jwt.decode(raw_token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên đăng nhập không hợp lệ hoặc đã hết hạn.",
        ) from exc


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """Resolve the currently authenticated active user from Bearer JWT."""
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Thiếu token xác thực.",
        )
    payload = decode_access_token(credentials.credentials)
    user_id = int(payload.get("sub", 0))
    user = db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tài khoản không tồn tại hoặc đã bị vô hiệu hóa.",
        )
    return user


def require_manager(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """Restrict access to store MANAGER role."""
    if current_user.role != "MANAGER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chức năng này chỉ dành cho Quản lý / Chủ kho.",
        )
    return current_user
