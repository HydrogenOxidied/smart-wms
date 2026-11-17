"""SQLAlchemy 2.0 database models for PocketWMS."""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow_naive() -> datetime:
    """Return current UTC timestamp normalized for cross-DB (SQLite/PG) compatibility."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Store(Base):
    """Tenant store / warehouse workspace."""

    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    industry_template: Mapped[str] = mapped_column(String(40), default="CAFE_BAKERY", nullable=False)
    lite_mode: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_negative_stock: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow_naive, nullable=False)

    users: Mapped[list["User"]] = relationship(back_populates="store", cascade="all, delete-orphan")
    products: Mapped[list["Product"]] = relationship(back_populates="store", cascade="all, delete-orphan")


class User(Base):
    """Store manager or warehouse staff account."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    hashed_secret: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="STAFF", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow_naive, nullable=False)

    store: Mapped["Store"] = relationship(back_populates="users")


class Product(Base):
    """Adaptive inventory product supporting standard SKU, pack-break, and loose consumables."""

    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("store_id", "sku", name="uq_products_store_sku"),
        Index("ix_products_store_barcode", "store_id", "barcode"),
        Index("ix_products_store_norm_name", "store_id", "normalized_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    barcode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(180), nullable=False)
    category: Mapped[str] = mapped_column(String(80), default="Chung", nullable=False)
    tracking_type: Mapped[str] = mapped_column(String(24), default="STANDARD", nullable=False)
    unit: Mapped[str] = mapped_column(String(32), default="Cái", nullable=False)
    pack_unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pack_conversion_rate: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    sealed_packs: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    capacity_reference: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_stock: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    min_stock_level: Mapped[float] = mapped_column(Float, default=5.0, nullable=False)
    lead_time_days: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    shelf_location: Mapped[str | None] = mapped_column(String(64), nullable=True)
    supplier_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow_naive, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False
    )

    store: Mapped["Store"] = relationship(back_populates="products")
    movements: Mapped[list["StockMovement"]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )


class StockMovement(Base):
    """Immutable append-only stock ledger entry."""

    __tablename__ = "stock_movements"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_movements_idempotency"),
        Index("ix_movements_store_product_date", "store_id", "product_id", "occurred_at"),
        Index("ix_movements_type_date", "store_id", "movement_type", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    movement_type: Mapped[str] = mapped_column(String(32), nullable=False)
    quantity_delta: Mapped[float] = mapped_column(Float, nullable=False)
    balance_after: Mapped[float] = mapped_column(Float, nullable=False)
    unit_entered: Mapped[str | None] = mapped_column(String(32), nullable=True)
    quantity_entered: Mapped[float | None] = mapped_column(Float, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    reversed_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movements.id"), nullable=True, index=True
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow_naive, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow_naive, nullable=False)

    product: Mapped["Product"] = relationship(back_populates="movements")
    user: Mapped["User"] = relationship()


class StocktakeSession(Base):
    """Blind or standard inventory cycle count session."""

    __tablename__ = "stocktake_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="OPEN", nullable=False)
    is_blind: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow_naive, nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    items: Mapped[list["StocktakeItem"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class StocktakeItem(Base):
    """Line item recorded inside a stocktake session."""

    __tablename__ = "stocktake_items"
    __table_args__ = (
        UniqueConstraint("session_id", "product_id", name="uq_stocktake_session_product"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("stocktake_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    system_qty_snapshot: Mapped[float] = mapped_column(Float, nullable=False)
    counted_qty: Mapped[float] = mapped_column(Float, nullable=False)
    gauge_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    treat_negative_variance_as_consumption: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    scanned_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    scanned_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow_naive, nullable=False)

    session: Mapped["StocktakeSession"] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship()
