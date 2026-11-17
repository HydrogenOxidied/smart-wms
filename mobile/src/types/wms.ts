export type RoleType = 'MANAGER' | 'STAFF';
export type TrackingType = 'STANDARD' | 'PACK_BREAK' | 'CONSUMABLE';
export type MovementType =
  | 'IN_PURCHASE'
  | 'OUT_CONSUMPTION'
  | 'OUT_DAMAGE_EXPIRED'
  | 'ADJUST_STOCKTAKE'
  | 'REVERSAL'
  | 'PACK_BREAK';

export type UnitMode = 'BASE' | 'PACK';
export type TemplateKey = 'MAM_TEP' | 'CAFE_BAKERY' | 'MINI_MART' | 'HARDWARE' | 'EMPTY';

export interface Store {
  id: number;
  name: string;
  code: string;
  industry_template: string;
  lite_mode: boolean;
  allow_negative_stock: boolean;
  created_at: string;
}

export interface User {
  id: number;
  store_id: number;
  username: string;
  full_name: string;
  role: RoleType;
  is_active: boolean;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
  store: Store;
}

export interface Product {
  id: number;
  store_id: number;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  tracking_type: TrackingType;
  unit: string;
  pack_unit: string | null;
  pack_conversion_rate: number;
  sealed_packs: number;
  capacity_reference: number | null;
  current_stock: number;
  min_stock_level: number;
  lead_time_days: number;
  unit_cost: number;
  shelf_location: string | null;
  supplier_name: string | null;
  is_pinned: boolean;
  is_active: boolean;
  updated_at: string;
}

export interface ProductCreateInput {
  name: string;
  unit: string;
  current_stock: number;
  sku?: string;
  barcode?: string;
  category?: string;
  tracking_type?: TrackingType;
  pack_unit?: string;
  pack_conversion_rate?: number;
  capacity_reference?: number;
  min_stock_level?: number;
  lead_time_days?: number;
  unit_cost?: number;
  shelf_location?: string;
  supplier_name?: string;
  is_pinned?: boolean;
}

export interface DuplicateWarningItem {
  id: number;
  sku: string;
  name: string;
  unit: string;
  current_stock: number;
  similarity: number;
}

export interface MovementCreateInput {
  product_id: number;
  movement_type: 'IN_PURCHASE' | 'OUT_CONSUMPTION' | 'OUT_DAMAGE_EXPIRED';
  quantity: number;
  unit_mode: UnitMode;
  note?: string;
  idempotency_key: string;
  confirm_anomaly?: boolean;
  occurred_at?: string;
}

export interface StockMovement {
  id: number;
  store_id: number;
  product_id: number;
  product_name: string | null;
  product_unit: string | null;
  user_id: number;
  user_name: string | null;
  movement_type: MovementType;
  quantity_delta: number;
  balance_after: number;
  unit_entered: string | null;
  quantity_entered: number | null;
  note: string | null;
  idempotency_key: string;
  reversed_movement_id: number | null;
  is_reversed: boolean;
  occurred_at: string;
  created_at: string;
}

export interface StocktakeItem {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  tracking_type: TrackingType;
  barcode: string | null;
  shelf_location: string | null;
  system_qty_snapshot: number | null;
  counted_qty: number;
  variance_qty: number | null;
  gauge_percent: number | null;
  treat_negative_variance_as_consumption: boolean;
  note: string | null;
  scanned_at: string;
}

export interface StocktakeSession {
  id: number;
  store_id: number;
  title: string;
  status: 'OPEN' | 'SUBMITTED' | 'APPROVED' | 'CANCELLED';
  is_blind: boolean;
  created_by_id: number;
  approved_by_id: number | null;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  items: StocktakeItem[];
}

export interface DailyPoint {
  date: string;
  qty: number;
  lower?: number | null;
  upper?: number | null;
}

export interface ProductForecast {
  product_id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  tracking_type: TrackingType;
  supplier_name: string | null;
  current_stock: number;
  min_stock_level: number;
  lead_time_days: number;
  unit_cost: number;
  history_days: number;
  algorithm_tier: 'COLD_START' | 'EWMA_WEEKLY' | 'HOLT_WINTERS';
  avg_daily_demand: number;
  demand_std: number;
  safety_stock: number;
  reorder_point: number;
  days_until_stockout: number | null;
  status: 'CRITICAL' | 'REORDER_SOON' | 'HEALTHY';
  recommended_order_qty: number;
  estimated_order_cost: number;
  mae: number | null;
  mape: number | null;
  history_series: DailyPoint[];
  forecast_series: DailyPoint[];
}

export interface ForecastOverview {
  store_id: number;
  total_skus: number;
  critical_count: number;
  reorder_soon_count: number;
  healthy_count: number;
  total_suggested_po_cost: number;
  items: ProductForecast[];
}

export interface ImportSummary {
  created_products: number;
  updated_products: number;
  imported_movements: number;
  warnings: string[];
}
