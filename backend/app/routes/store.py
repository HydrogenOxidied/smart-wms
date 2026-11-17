"""Store configuration, Lite/Pro mode toggle, and starter templates."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_manager
from app.models.entities import Store, User
from app.schemas.api import ImportSummaryOut, StoreOut, StoreSettingsUpdate, TemplateKey
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
    """Add starter industry items into the current store."""
    return apply_starter_template(db, manager, payload.template_key)
