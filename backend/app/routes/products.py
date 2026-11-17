"""Product catalog, barcode lookup, fuzzy duplicate check, and pack-break endpoints."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_manager
from app.models.entities import Product, User
from app.schemas.api import (
    DuplicateWarningItem,
    PackBreakRequest,
    ProductCreate,
    ProductOut,
    ProductUpdate,
    StockMovementOut,
)
from app.services.ledger import break_pack, serialize_movement
from app.services.products import (
    create_product,
    delete_product,
    find_similar_products,
    normalize_vi_text,
    update_product,
)

router = APIRouter(prefix="/products", tags=["Products"])


@router.get("", response_model=list[ProductOut])
def list_products(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    search: str | None = Query(default=None),
    category: str | None = Query(default=None),
    tracking_type: str | None = Query(default=None),
    low_stock_only: bool = Query(default=False),
) -> list[ProductOut]:
    """List store products with Vietnamese accent-insensitive search and filters."""
    query = select(Product).where(
        Product.store_id == current_user.store_id,
        Product.is_active.is_(True),
    )
    if category and category != "Tất cả":
        query = query.where(Product.category == category)
    if tracking_type:
        query = query.where(Product.tracking_type == tracking_type)

    rows = db.scalars(query.order_by(Product.is_pinned.desc(), Product.updated_at.desc())).all()

    if search and search.strip():
        needle = normalize_vi_text(search)
        raw_upper = search.strip().upper()
        rows = [
            r
            for r in rows
            if needle in r.normalized_name
            or raw_upper in r.sku.upper()
            or (r.barcode and search.strip() in r.barcode)
        ]

    if low_stock_only:
        rows = [r for r in rows if r.current_stock <= r.min_stock_level]

    return [ProductOut.model_validate(r) for r in rows]


@router.get("/check-duplicates", response_model=list[DuplicateWarningItem])
def check_duplicates(
    name: str = Query(min_length=1),
    current_user: Annotated[User, Depends(get_current_user)] = ...,  # type: ignore[assignment]
    db: Annotated[Session, Depends(get_db)] = ...,  # type: ignore[assignment]
) -> list[DuplicateWarningItem]:
    """Detect similar existing products to keep Quick-Add data clean for AI forecasting."""
    return find_similar_products(db, current_user.store_id, name)


@router.get("/by-barcode/{code}", response_model=ProductOut)
def get_by_barcode(
    code: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ProductOut:
    """Resolve a scanned barcode or SKU string to an active product."""
    clean = code.strip()
    product = db.scalar(
        select(Product).where(
            Product.store_id == current_user.store_id,
            Product.is_active.is_(True),
            (Product.barcode == clean) | (Product.sku == clean.upper()),
        )
    )
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy sản phẩm có mã '{clean}'.",
        )
    return ProductOut.model_validate(product)


@router.get("/{product_id}", response_model=ProductOut)
def get_product(
    product_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ProductOut:
    """Get a single product by ID."""
    product = db.scalar(
        select(Product).where(
            Product.id == product_id,
            Product.store_id == current_user.store_id,
            Product.is_active.is_(True),
        )
    )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sản phẩm.")
    return ProductOut.model_validate(product)


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_new_product(
    payload: ProductCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ProductOut:
    """Create a product (supports 3-field Lite Quick-Add or full Warehouse Pro configuration)."""
    product = create_product(db, current_user, payload)
    return ProductOut.model_validate(product)


@router.patch("/{product_id}", response_model=ProductOut)
def patch_product(
    product_id: int,
    payload: ProductUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ProductOut:
    """Update product metadata, min stock, lead time, or barcode."""
    product = update_product(db, current_user, product_id, payload)
    return ProductOut.model_validate(product)


@router.post("/{product_id}/break-pack", response_model=StockMovementOut)
def break_product_pack(
    product_id: int,
    payload: PackBreakRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> StockMovementOut:
    """Open sealed packs into loose units and record audit entry."""
    mv = break_pack(db, current_user, product_id, payload)
    return serialize_movement(db, mv)


@router.delete("/{product_id}", status_code=status.HTTP_200_OK)
def remove_product(
    product_id: int,
    manager: Annotated[User, Depends(require_manager)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, int | str]:
    """Manager removes a discontinued product from active catalog while preserving ledger history."""
    delete_product(db, manager, product_id)
    return {"status": "deleted", "id": product_id}
