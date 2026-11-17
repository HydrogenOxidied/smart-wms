"""CSV import endpoints for bulk products and historical consumption."""
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_manager
from app.models.entities import User
from app.schemas.api import ImportSummaryOut
from app.services.csv_import import import_consumption_history_csv, import_products_csv

router = APIRouter(prefix="/imports", tags=["CSV Import"])


@router.post("/products-csv", response_model=ImportSummaryOut)
async def upload_products_csv(
    file: Annotated[UploadFile, File(...)],
    manager: Annotated[User, Depends(require_manager)],
    db: Annotated[Session, Depends(get_db)],
) -> ImportSummaryOut:
    """Bulk import or update product catalog from CSV."""
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Thiếu file CSV.")
    content = await file.read()
    return import_products_csv(db, manager, content)


@router.post("/history-csv", response_model=ImportSummaryOut)
async def upload_history_csv(
    file: Annotated[UploadFile, File(...)],
    manager: Annotated[User, Depends(require_manager)],
    db: Annotated[Session, Depends(get_db)],
) -> ImportSummaryOut:
    """Import historical daily OUT_CONSUMPTION rows to accelerate AI forecasting."""
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Thiếu file CSV.")
    content = await file.read()
    return import_consumption_history_csv(db, manager, content)
