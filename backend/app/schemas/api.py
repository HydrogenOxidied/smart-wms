"""Pydantic v2 request and response schemas for PocketWMS."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RoleType = Literal["MANAGER", "STAFF"]
TrackingType = Literal["STANDARD", "PACK_BREAK", "CONSUMABLE"]
DEFAULT_ACCOUNT_SECRET = "1234"
MovementType = Literal[
    "IN_PURCHASE",
    "OUT_CONSUMPTION",
    "OUT_DAMAGE_EXPIRED",
    "ADJUST_STOCKTAKE",
    "REVERSAL",
    "PACK_BREAK",
]
UnitMode = Literal["BASE", "PACK"]
TemplateKey = Literal["MAM_TEP", "CAFE_BAKERY", "MINI_MART", "HARDWARE", "EMPTY"]


class StaffCreateRequest(BaseModel):
    """Manager creates an additional staff or co-manager account for the store."""

    username: str = Field(min_length=3, max_length=64)
    full_name: str = Field(min_length=2, max_length=120)
    secret: str = Field(default=DEFAULT_ACCOUNT_SECRET, min_length=4, max_length=128)
    role: RoleType = "STAFF"


class StaffStatusUpdate(BaseModel):
    """Activate or lock a store staff account."""

    is_active: bool


class ChangeSecretRequest(BaseModel):
    """Authenticated user changes their own account secret."""

    current_secret: str = Field(min_length=3, max_length=128)
    new_secret: str = Field(min_length=4, max_length=128)


class StaffSecretResetRequest(BaseModel):
    """Manager resets a staff member's secret (defaults to 1234)."""

    new_secret: str = Field(default=DEFAULT_ACCOUNT_SECRET, min_length=4, max_length=128)


class StoreOut(BaseModel):
    """Store workspace summary."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str
    industry_template: str
    lite_mode: bool
    allow_negative_stock: bool
    created_at: datetime


class StoreSettingsUpdate(BaseModel):
    """Update store operational preferences."""

    name: str | None = Field(default=None, min_length=2, max_length=120)
    lite_mode: bool | None = None
    allow_negative_stock: bool | None = None


class UserOut(BaseModel):
    """Authenticated user profile."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int
    username: str
    full_name: str
    role: str
    is_active: bool


class LoginRequest(BaseModel):
    """Username and secret login request."""

    username: str = Field(min_length=2, max_length=64)
    secret: str = Field(min_length=3, max_length=128)


class RegisterStoreRequest(BaseModel):
    """Create a fresh store with manager + starter template."""

    store_name: str = Field(min_length=2, max_length=120)
    manager_username: str = Field(min_length=3, max_length=64)
    manager_full_name: str = Field(min_length=2, max_length=120)
    manager_secret: str = Field(default=DEFAULT_ACCOUNT_SECRET, min_length=4, max_length=128)
    staff_username: str | None = Field(default=None, min_length=3, max_length=64)
    staff_secret: str | None = Field(default=DEFAULT_ACCOUNT_SECRET, min_length=4, max_length=128)
    industry_template: TemplateKey = "CAFE_BAKERY"
    lite_mode: bool = True


class AuthResponse(BaseModel):
    """JWT access token paired with user and store context."""

    access_token: str
    token_type: str = "bearer"
    user: UserOut
    store: StoreOut


class ProductCreate(BaseModel):
    """Create a product using either 3-field Lite Mode or full Warehouse Pro fields."""

    name: str = Field(min_length=1, max_length=180)
    unit: str = Field(default="Cái", min_length=1, max_length=32)
    current_stock: float = Field(default=0.0, ge=0.0)
    sku: str | None = Field(default=None, max_length=64)
    barcode: str | None = Field(default=None, max_length=64)
    category: str = Field(default="Chung", max_length=80)
    tracking_type: TrackingType = "STANDARD"
    pack_unit: str | None = Field(default=None, max_length=32)
    pack_conversion_rate: float = Field(default=1.0, ge=1.0)
    sealed_packs: int = Field(default=0, ge=0)
    capacity_reference: float | None = Field(default=None, gt=0.0)
    min_stock_level: float = Field(default=5.0, ge=0.0)
    lead_time_days: int = Field(default=3, ge=1, le=90)
    unit_cost: float = Field(default=0.0, ge=0.0)
    shelf_location: str | None = Field(default=None, max_length=64)
    supplier_name: str | None = Field(default=None, max_length=120)
    is_pinned: bool = False


class ProductUpdate(BaseModel):
    """Partial update for product settings."""

    name: str | None = Field(default=None, min_length=1, max_length=180)
    barcode: str | None = Field(default=None, max_length=64)
    category: str | None = Field(default=None, max_length=80)
    tracking_type: TrackingType | None = None
    unit: str | None = Field(default=None, min_length=1, max_length=32)
    pack_unit: str | None = Field(default=None, max_length=32)
    pack_conversion_rate: float | None = Field(default=None, ge=1.0)
    capacity_reference: float | None = Field(default=None, gt=0.0)
    min_stock_level: float | None = Field(default=None, ge=0.0)
    lead_time_days: int | None = Field(default=None, ge=1, le=90)
    unit_cost: float | None = Field(default=None, ge=0.0)
    shelf_location: str | None = Field(default=None, max_length=64)
    supplier_name: str | None = Field(default=None, max_length=120)
    is_pinned: bool | None = None


class ProductOut(BaseModel):
    """Product representation returned to mobile client."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int
    sku: str
    barcode: str | None
    name: str
    category: str
    tracking_type: str
    unit: str
    pack_unit: str | None
    pack_conversion_rate: float
    sealed_packs: int
    capacity_reference: float | None
    current_stock: float
    min_stock_level: float
    lead_time_days: int
    unit_cost: float
    shelf_location: str | None
    supplier_name: str | None
    is_pinned: bool
    is_active: bool
    updated_at: datetime


class DuplicateWarningItem(BaseModel):
    """Potential fuzzy-duplicate product match."""

    id: int
    sku: str
    name: str
    unit: str
    current_stock: float
    similarity: float


class MovementCreate(BaseModel):
    """Single stock movement submission (Flow 1 / Stock-In / Damage)."""

    product_id: int
    movement_type: Literal["IN_PURCHASE", "OUT_CONSUMPTION", "OUT_DAMAGE_EXPIRED"]
    quantity: float = Field(gt=0.0)
    unit_mode: UnitMode = "BASE"
    note: str | None = Field(default=None, max_length=400)
    idempotency_key: str = Field(min_length=4, max_length=128)
    confirm_anomaly: bool = False
    occurred_at: datetime | None = None


class BatchMovementRequest(BaseModel):
    """End-of-shift or offline sync batch submission (Flow 2)."""

    items: list[MovementCreate] = Field(min_length=1, max_length=200)


class PackBreakRequest(BaseModel):
    """Convert sealed packs into loose open stock."""

    packs_to_break: int = Field(default=1, ge=1, le=500)
    idempotency_key: str = Field(min_length=4, max_length=128)
    note: str | None = Field(default=None, max_length=300)


class ReversalRequest(BaseModel):
    """Reverse an erroneous movement via compensating ledger entry."""

    reason: str = Field(default="Nhập nhầm số lượng", min_length=2, max_length=300)


class StockMovementOut(BaseModel):
    """Immutable stock movement response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int
    product_id: int
    product_name: str | None = None
    product_unit: str | None = None
    user_id: int
    user_name: str | None = None
    user_username: str | None = None
    user_role: str | None = None
    movement_type: str
    quantity_delta: float
    balance_before: float = 0.0
    balance_after: float
    unit_entered: str | None
    quantity_entered: float | None
    note: str | None
    idempotency_key: str
    reversed_movement_id: int | None
    is_reversed: bool = False
    occurred_at: datetime
    created_at: datetime


class BatchMovementResponse(BaseModel):
    """Result summary for batch consumption / offline sync."""

    processed_count: int
    movements: list[StockMovementOut]


class ProductAuditSummaryOut(BaseModel):
    """Per-product aggregated stock-in and staff/manager consumption audit."""

    product_id: int
    sku: str
    name: str
    unit: str
    current_stock: float
    owner_imported_qty: float
    owner_imported_count: int
    staff_consumed_qty: float
    staff_consumed_count: int
    manager_consumed_qty: float
    total_consumed_qty: float
    last_modified_at: datetime | None = None


class LedgerAuditSummaryOut(BaseModel):
    """Store-wide modification summary separating staff consumption from owner stock-in."""

    store_id: int
    period_days: int | None = None
    owner_imported_total: float
    owner_imported_events: int
    staff_consumed_total: float
    staff_consumed_events: int
    manager_consumed_total: float
    manager_consumed_events: int
    products: list[ProductAuditSummaryOut]


class StocktakeCreateRequest(BaseModel):
    """Start a new blind or open stocktake session."""

    title: str = Field(min_length=2, max_length=160)
    is_blind: bool = True


class StocktakeScanRequest(BaseModel):
    """Record or update a scanned/counted product inside a stocktake session."""

    product_id: int | None = None
    barcode: str | None = None
    counted_qty: float | None = Field(default=None, ge=0.0)
    gauge_percent: float | None = Field(default=None, ge=0.0, le=100.0)
    treat_negative_variance_as_consumption: bool | None = None
    note: str | None = Field(default=None, max_length=300)


class StocktakeApproveItemOption(BaseModel):
    """Manager override per item during stocktake approval."""

    product_id: int
    treat_negative_variance_as_consumption: bool


class StocktakeApproveRequest(BaseModel):
    """Manager variance approval payload."""

    item_options: list[StocktakeApproveItemOption] = Field(default_factory=list)


class StocktakeItemOut(BaseModel):
    """Stocktake line item with blind-mode masking for STAFF."""

    id: int
    product_id: int
    sku: str
    name: str
    unit: str
    tracking_type: str
    barcode: str | None
    shelf_location: str | None
    system_qty_snapshot: float | None
    counted_qty: float
    variance_qty: float | None
    gauge_percent: float | None
    treat_negative_variance_as_consumption: bool
    note: str | None
    scanned_at: datetime


class StocktakeSessionOut(BaseModel):
    """Stocktake session details with items."""

    id: int
    store_id: int
    title: str
    status: str
    is_blind: bool
    created_by_id: int
    approved_by_id: int | None
    created_at: datetime
    submitted_at: datetime | None
    approved_at: datetime | None
    items: list[StocktakeItemOut]


class DailyPoint(BaseModel):
    """Single day observation or forecast point."""

    date: str
    qty: float
    lower: float | None = None
    upper: float | None = None


class ProductForecastOut(BaseModel):
    """Comprehensive demand forecast and replenishment recommendation."""

    product_id: int
    sku: str
    name: str
    category: str
    unit: str
    tracking_type: str
    supplier_name: str | None
    current_stock: float
    min_stock_level: float
    lead_time_days: int
    unit_cost: float
    history_days: int
    algorithm_tier: Literal["COLD_START", "EWMA_WEEKLY", "HOLT_WINTERS"]
    avg_daily_demand: float
    demand_std: float
    safety_stock: float
    reorder_point: float
    days_until_stockout: float | None
    status: Literal["CRITICAL", "REORDER_SOON", "HEALTHY"]
    recommended_order_qty: float
    estimated_order_cost: float
    mae: float | None
    mape: float | None
    history_series: list[DailyPoint]
    forecast_series: list[DailyPoint]


class ForecastOverviewOut(BaseModel):
    """Store-wide replenishment alerts and ranked forecasts."""

    store_id: int
    total_skus: int
    critical_count: int
    reorder_soon_count: int
    healthy_count: int
    total_suggested_po_cost: float
    items: list[ProductForecastOut]


class ImportSummaryOut(BaseModel):
    """Result returned by CSV or template imports."""

    created_products: int
    updated_products: int
    imported_movements: int
    warnings: list[str] = Field(default_factory=list)
