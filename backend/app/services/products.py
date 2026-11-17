"""Product catalog helpers, auto-SKU/barcode generation, and Vietnamese fuzzy search."""
from difflib import SequenceMatcher
import random
import re
import unicodedata

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Product, StockMovement, User
from app.schemas.api import DuplicateWarningItem, ProductCreate, ProductUpdate


def normalize_vi_text(text: str) -> str:
    """Normalize Vietnamese text by stripping diacritics and punctuation."""
    replaced = text.replace("đ", "d").replace("Đ", "D")
    nfd = unicodedata.normalize("NFD", replaced)
    stripped = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    cleaned = re.sub(r"[^a-z0-9\s]", " ", stripped.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def generate_auto_sku(db: Session, store_id: int, name: str) -> str:
    """Generate a deterministic short SKU prefix based on product name."""
    tokens = [t for t in normalize_vi_text(name).split(" ") if t]
    prefix = "".join(t[:2].upper() for t in tokens[:3]) or "ITEM"
    prefix = prefix[:6]
    existing_skus = set(
        db.scalars(select(Product.sku).where(Product.store_id == store_id)).all()
    )
    for idx in range(1, 9999):
        candidate = f"{prefix}-{idx:03d}"
        if candidate not in existing_skus:
            return candidate
    return f"SKU-{random.randint(10000, 99999)}"


def generate_internal_barcode(db: Session, store_id: int) -> str:
    """Generate an internal 13-digit barcode starting with '200' for loose items."""
    existing = set(
        b for b in db.scalars(select(Product.barcode).where(Product.store_id == store_id)).all() if b
    )
    while True:
        body = f"200{store_id:03d}{random.randint(100000, 999999)}"
        digits = [int(d) for d in body]
        checksum = (10 - (sum(digits[0::2]) + 3 * sum(digits[1::2])) % 10) % 10
        code = f"{body}{checksum}"
        if code not in existing:
            return code


def find_similar_products(
    db: Session, store_id: int, query_name: str, threshold: float = 0.62
) -> list[DuplicateWarningItem]:
    """Return potential duplicate products matching normalized name."""
    norm_query = normalize_vi_text(query_name)
    if not norm_query:
        return []
    products = db.scalars(
        select(Product).where(Product.store_id == store_id, Product.is_active.is_(True))
    ).all()
    matches: list[DuplicateWarningItem] = []
    for prod in products:
        ratio = SequenceMatcher(None, norm_query, prod.normalized_name).ratio()
        if norm_query in prod.normalized_name or prod.normalized_name in norm_query:
            ratio = max(ratio, 0.85)
        if ratio >= threshold:
            matches.append(
                DuplicateWarningItem(
                    id=prod.id,
                    sku=prod.sku,
                    name=prod.name,
                    unit=prod.unit,
                    current_stock=prod.current_stock,
                    similarity=round(ratio, 2),
                )
            )
    matches.sort(key=lambda m: m.similarity, reverse=True)
    return matches[:5]


def create_product(db: Session, user: User, payload: ProductCreate) -> Product:
    """Create a product with auto SKU/barcode fallback and opening ledger entry."""
    sku = (payload.sku or "").strip().upper() or generate_auto_sku(db, user.store_id, payload.name)
    existing_sku = db.scalar(
        select(Product).where(Product.store_id == user.store_id, Product.sku == sku)
    )
    if existing_sku:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Mã SKU '{sku}' đã tồn tại trong kho.",
        )

    barcode = (payload.barcode or "").strip() or None
    if barcode:
        dup_barcode = db.scalar(
            select(Product).where(
                Product.store_id == user.store_id,
                Product.barcode == barcode,
                Product.is_active.is_(True),
            )
        )
        if dup_barcode:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Mã vạch '{barcode}' đã được gán cho sản phẩm '{dup_barcode.name}'.",
            )
    else:
        barcode = generate_internal_barcode(db, user.store_id)

    capacity_ref = payload.capacity_reference
    if payload.tracking_type == "CONSUMABLE" and not capacity_ref:
        capacity_ref = max(payload.current_stock, payload.min_stock_level * 4.0, 100.0)

    sealed_packs = payload.sealed_packs
    if payload.tracking_type == "PACK_BREAK" and payload.pack_conversion_rate > 1 and sealed_packs == 0:
        sealed_packs = int(payload.current_stock // payload.pack_conversion_rate)

    product = Product(
        store_id=user.store_id,
        sku=sku,
        barcode=barcode,
        name=payload.name.strip(),
        normalized_name=normalize_vi_text(payload.name),
        category=payload.category.strip() or "Chung",
        tracking_type=payload.tracking_type,
        unit=payload.unit.strip(),
        pack_unit=payload.pack_unit.strip() if payload.pack_unit else None,
        pack_conversion_rate=payload.pack_conversion_rate,
        sealed_packs=sealed_packs,
        capacity_reference=capacity_ref,
        current_stock=round(payload.current_stock, 3),
        min_stock_level=round(payload.min_stock_level, 3),
        lead_time_days=payload.lead_time_days,
        unit_cost=payload.unit_cost,
        shelf_location=payload.shelf_location.strip() if payload.shelf_location else None,
        supplier_name=payload.supplier_name.strip() if payload.supplier_name else None,
        is_pinned=payload.is_pinned,
    )
    db.add(product)
    db.flush()

    if product.current_stock > 0:
        opening_movement = StockMovement(
            store_id=user.store_id,
            product_id=product.id,
            user_id=user.id,
            movement_type="IN_PURCHASE",
            quantity_delta=product.current_stock,
            balance_after=product.current_stock,
            unit_entered=product.unit,
            quantity_entered=product.current_stock,
            note="Tồn kho khởi tạo khi thêm mặt hàng",
            idempotency_key=f"init-product-{user.store_id}-{product.id}",
        )
        db.add(opening_movement)

    db.commit()
    db.refresh(product)
    return product


def update_product(db: Session, user: User, product_id: int, payload: ProductUpdate) -> Product:
    """Update product fields while enforcing barcode uniqueness."""
    product = db.scalar(
        select(Product).where(
            Product.id == product_id,
            Product.store_id == user.store_id,
            Product.is_active.is_(True),
        )
    )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sản phẩm.")

    data = payload.model_dump(exclude_unset=True)
    if "barcode" in data and data["barcode"]:
        barcode_clean = data["barcode"].strip()
        dup = db.scalar(
            select(Product).where(
                Product.store_id == user.store_id,
                Product.barcode == barcode_clean,
                Product.id != product.id,
                Product.is_active.is_(True),
            )
        )
        if dup:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Mã vạch '{barcode_clean}' đã gán cho '{dup.name}'.",
            )
        data["barcode"] = barcode_clean

    if "name" in data and data["name"]:
        data["name"] = data["name"].strip()
        data["normalized_name"] = normalize_vi_text(data["name"])

    for key, val in data.items():
        setattr(product, key, val)

    db.commit()
    db.refresh(product)
    return product
