import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  ForecastOverview,
  LedgerAuditSummary,
  MovementCreateInput,
  Product,
  RoleType,
  StockMovement,
  Store,
  User,
} from '../types/wms';

const PROFILE_STORAGE_KEY = 'pocketwms_workspace_v2';
const OFFLINE_QUEUE_KEY = 'pocketwms_offline_queue_v2';
const SNAPSHOT_KEY_PREFIX = 'pocketwms_snapshot_v2_';

export interface CachedWorkspace {
  user: User;
  store: Store;
}

export interface PendingOfflineMovement {
  id: string;
  store_id: number;
  user_id: number;
  user_name: string;
  user_username: string;
  user_role: RoleType;
  payload: MovementCreateInput;
  queued_at: string;
}

export interface StoreOfflineSnapshot {
  products: Product[] | null;
  movements: StockMovement[] | null;
  summary: LedgerAuditSummary | null;
  forecastOverview: ForecastOverview | null;
  updatedAt: string;
}

type NetworkListener = (offline: boolean) => void;
const networkListeners = new Set<NetworkListener>();
let lastKnownOffline = false;

export function reportNetworkStatus(offline: boolean): void {
  if (lastKnownOffline === offline) {
    return;
  }
  lastKnownOffline = offline;
  networkListeners.forEach((listener) => {
    try {
      listener(offline);
    } catch {
      // Ignore listener failures
    }
  });
}

export function onNetworkStatusChange(listener: NetworkListener): () => void {
  networkListeners.add(listener);
  return () => {
    networkListeners.delete(listener);
  };
}

async function readStorageValue(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function writeStorageValue(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, value);
      }
    } catch {
      // Ignore quota errors in restricted web contexts
    }
    return;
  }
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Ignore native storage write errors
  }
}

async function removeStorageValue(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore
    }
    return;
  }
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await readStorageValue(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, data: unknown): Promise<void> {
  await writeStorageValue(key, JSON.stringify(data));
}

export async function saveCachedProfile(profile: CachedWorkspace): Promise<void> {
  await writeJson(PROFILE_STORAGE_KEY, profile);
}

export async function loadCachedProfile(): Promise<CachedWorkspace | null> {
  return readJson<CachedWorkspace>(PROFILE_STORAGE_KEY);
}

export async function clearCachedProfile(): Promise<void> {
  await removeStorageValue(PROFILE_STORAGE_KEY);
}

function emptySnapshot(): StoreOfflineSnapshot {
  return {
    products: null,
    movements: null,
    summary: null,
    forecastOverview: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadStoreSnapshot(storeId: number): Promise<StoreOfflineSnapshot> {
  const existing = await readJson<StoreOfflineSnapshot>(`${SNAPSHOT_KEY_PREFIX}${storeId}`);
  return existing || emptySnapshot();
}

async function saveStoreSnapshot(
  storeId: number,
  updater: (prev: StoreOfflineSnapshot) => StoreOfflineSnapshot,
): Promise<StoreOfflineSnapshot> {
  const prev = await loadStoreSnapshot(storeId);
  const next = updater(prev);
  next.updatedAt = new Date().toISOString();
  await writeJson(`${SNAPSHOT_KEY_PREFIX}${storeId}`, next);
  return next;
}

export async function saveProductsCache(storeId: number, products: Product[]): Promise<void> {
  await saveStoreSnapshot(storeId, (prev) => ({ ...prev, products }));
}

export async function saveMovementsCache(storeId: number, movements: StockMovement[]): Promise<void> {
  await saveStoreSnapshot(storeId, (prev) => ({ ...prev, movements: movements.slice(0, 250) }));
}

export async function saveSummaryCache(
  storeId: number,
  summary: LedgerAuditSummary,
): Promise<void> {
  await saveStoreSnapshot(storeId, (prev) => ({ ...prev, summary }));
}

export async function saveForecastCache(
  storeId: number,
  forecastOverview: ForecastOverview,
): Promise<void> {
  await saveStoreSnapshot(storeId, (prev) => ({ ...prev, forecastOverview }));
}

export async function loadPendingMovements(): Promise<PendingOfflineMovement[]> {
  const list = await readJson<PendingOfflineMovement[]>(OFFLINE_QUEUE_KEY);
  return Array.isArray(list) ? list : [];
}

export async function savePendingMovements(items: PendingOfflineMovement[]): Promise<void> {
  await writeJson(OFFLINE_QUEUE_KEY, items);
}

export function computeMovementDelta(
  product: Product | undefined,
  item: MovementCreateInput,
): number {
  const rate =
    item.unit_mode === 'PACK' && product && product.pack_conversion_rate > 1
      ? product.pack_conversion_rate
      : 1;
  const baseQty = Number((item.quantity * rate).toFixed(3));
  return item.movement_type === 'IN_PURCHASE' ? baseQty : -baseQty;
}

export function applyOptimisticProductDelta(
  product: Product,
  item: MovementCreateInput,
  nowIso: string,
): { updated: Product; before: number; after: number; delta: number } {
  const delta = computeMovementDelta(product, item);
  const before = product.current_stock;
  const after = Number((before + delta).toFixed(3));
  let sealedPacks = product.sealed_packs;
  if (product.tracking_type === 'PACK_BREAK' && item.unit_mode === 'PACK') {
    const packChange = delta > 0 ? item.quantity : -item.quantity;
    sealedPacks = Math.max(0, Math.round(sealedPacks + packChange));
  }
  return {
    updated: {
      ...product,
      current_stock: after,
      sealed_packs: sealedPacks,
      updated_at: nowIso,
    },
    before,
    after,
    delta,
  };
}

export function overlayPendingOnProducts(
  products: Product[],
  pendingItems: PendingOfflineMovement[],
): Product[] {
  if (pendingItems.length === 0) return products;
  const map = new Map<number, Product>();
  for (const p of products) {
    map.set(p.id, { ...p });
  }
  for (const item of pendingItems) {
    const target = map.get(item.payload.product_id);
    if (!target) continue;
    const applied = applyOptimisticProductDelta(target, item.payload, item.queued_at);
    map.set(target.id, applied.updated);
  }
  return products.map((p) => map.get(p.id) || p);
}

export async function applyOptimisticMovementsToCache(params: {
  storeId: number;
  user: User;
  items: MovementCreateInput[];
}): Promise<{ updatedProducts: Product[]; createdMovements: StockMovement[] }> {
  const { storeId, user, items } = params;
  const now = new Date();
  const baseMs = now.getTime();
  const snapshot = await loadStoreSnapshot(storeId);
  const nextProducts = [...(snapshot.products || [])];
  const nextMovements = [...(snapshot.movements || [])];
  const nextSummary: LedgerAuditSummary | null = snapshot.summary
    ? {
        ...snapshot.summary,
        products: snapshot.summary.products.map((p) => ({ ...p })),
      }
    : null;

  const createdMovements: StockMovement[] = [];

  items.forEach((payload, index) => {
    const nowIso = new Date(baseMs + index).toISOString();
    const prodIdx = nextProducts.findIndex((p) => p.id === payload.product_id);
    const prod = prodIdx >= 0 ? nextProducts[prodIdx] : undefined;

    let before = prod ? prod.current_stock : 0;
    let delta = computeMovementDelta(prod, payload);
    let after = Number((before + delta).toFixed(3));

    if (prod && prodIdx >= 0) {
      const applied = applyOptimisticProductDelta(prod, payload, nowIso);
      nextProducts[prodIdx] = applied.updated;
      before = applied.before;
      delta = applied.delta;
      after = applied.after;
    }

    const syntheticMovement: StockMovement = {
      id: -(baseMs + index),
      store_id: storeId,
      product_id: payload.product_id,
      product_name: prod?.name || `SP #${payload.product_id}`,
      product_unit: prod?.unit || null,
      user_id: user.id,
      user_name: user.full_name,
      user_username: user.username,
      user_role: user.role,
      movement_type: payload.movement_type,
      quantity_delta: delta,
      balance_before: before,
      balance_after: after,
      unit_entered:
        payload.unit_mode === 'PACK' ? prod?.pack_unit || prod?.unit || null : prod?.unit || null,
      quantity_entered: payload.quantity,
      note: payload.note || 'Lưu Offline trên máy',
      idempotency_key: payload.idempotency_key,
      reversed_movement_id: null,
      is_reversed: false,
      occurred_at: payload.occurred_at || nowIso,
      created_at: nowIso,
    };

    createdMovements.push(syntheticMovement);
    nextMovements.unshift(syntheticMovement);

    if (nextSummary) {
      const absDelta = Math.abs(delta);
      const summaryRow = nextSummary.products.find((p) => p.product_id === payload.product_id);
      if (payload.movement_type === 'IN_PURCHASE') {
        nextSummary.owner_imported_total = Number(
          (nextSummary.owner_imported_total + absDelta).toFixed(3),
        );
        nextSummary.owner_imported_events += 1;
        if (summaryRow) {
          summaryRow.current_stock = after;
          summaryRow.owner_imported_qty = Number(
            (summaryRow.owner_imported_qty + absDelta).toFixed(3),
          );
          summaryRow.owner_imported_count += 1;
          summaryRow.last_modified_at = nowIso;
        }
      } else {
        if (user.role === 'STAFF') {
          nextSummary.staff_consumed_total = Number(
            (nextSummary.staff_consumed_total + absDelta).toFixed(3),
          );
          nextSummary.staff_consumed_events += 1;
          if (summaryRow) {
            summaryRow.staff_consumed_qty = Number(
              (summaryRow.staff_consumed_qty + absDelta).toFixed(3),
            );
            summaryRow.staff_consumed_count += 1;
          }
        } else {
          nextSummary.manager_consumed_total = Number(
            (nextSummary.manager_consumed_total + absDelta).toFixed(3),
          );
          nextSummary.manager_consumed_events += 1;
          if (summaryRow) {
            summaryRow.manager_consumed_qty = Number(
              (summaryRow.manager_consumed_qty + absDelta).toFixed(3),
            );
          }
        }
        if (summaryRow) {
          summaryRow.current_stock = after;
          summaryRow.total_consumed_qty = Number(
            (summaryRow.total_consumed_qty + absDelta).toFixed(3),
          );
          summaryRow.last_modified_at = nowIso;
        }
      }
    }
  });

  await saveStoreSnapshot(storeId, (prev) => ({
    ...prev,
    products: nextProducts,
    movements: nextMovements.slice(0, 250),
    summary: nextSummary,
  }));

  return { updatedProducts: nextProducts, createdMovements };
}

export function filterCachedProducts(
  products: Product[],
  params?: { search?: string; category?: string; low_stock_only?: boolean },
): Product[] {
  let out = products;
  if (params?.search) {
    const q = params.search.trim().toLowerCase();
    out = out.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)),
    );
  }
  if (params?.category && params.category !== 'Tất cả') {
    out = out.filter((p) => p.category === params.category);
  }
  if (params?.low_stock_only) {
    out = out.filter((p) => p.current_stock <= p.min_stock_level);
  }
  return out;
}

export function filterCachedMovements(
  movements: StockMovement[],
  params?: {
    product_id?: number;
    movement_type?: string;
    actor_role?: string;
    days?: number;
    limit?: number;
  },
): StockMovement[] {
  let out = movements;
  if (params?.product_id) {
    out = out.filter((m) => m.product_id === params.product_id);
  }
  if (params?.movement_type) {
    out = out.filter((m) => m.movement_type === params.movement_type);
  }
  if (params?.actor_role) {
    out = out.filter((m) => m.user_role === params.actor_role);
  }
  if (params?.days) {
    const cutoff = Date.now() - params.days * 86400 * 1000;
    out = out.filter((m) => {
      const raw = m.created_at || m.occurred_at;
      const norm = /[zZ]$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`;
      const ms = new Date(norm).getTime();
      return Number.isNaN(ms) || ms >= cutoff;
    });
  }
  if (params?.limit && params.limit > 0) {
    out = out.slice(0, params.limit);
  }
  return out;
}
