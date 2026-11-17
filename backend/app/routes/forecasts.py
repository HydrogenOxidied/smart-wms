"""AI Demand Forecasting, Reorder Point Alerts, and Draft Purchase Order export."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.entities import Product, User
from app.schemas.api import ForecastOverviewOut, ProductForecastOut
from app.services.csv_import import generate_draft_po_csv
from app.services.forecasting import forecast_product, get_store_forecast_overview

router = APIRouter(prefix="/forecasts", tags=["AI Forecasting"])


@router.get("/overview", response_model=ForecastOverviewOut)
def forecast_overview(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ForecastOverviewOut:
    """Get store-wide ranked replenishment alerts and 14-day demand forecasts."""
    return get_store_forecast_overview(db, current_user.store_id)


@router.get("/products/{product_id}", response_model=ProductForecastOut)
def product_forecast(
    product_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ProductForecastOut:
    """Get detailed demand forecast, safety stock, ROP, and accuracy metrics for a product."""
    product = db.scalar(
        select(Product).where(
            Product.id == product_id,
            Product.store_id == current_user.store_id,
            Product.is_active.is_(True),
        )
    )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sản phẩm.")
    return forecast_product(db, product)


@router.get("/export-po")
def export_draft_po(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    """Export supplier-ready Draft Purchase Order CSV."""
    csv_text = generate_draft_po_csv(db, current_user.store_id)
    return Response(
        content="\ufeff" + csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="draft-purchase-order.csv"'},
    )
