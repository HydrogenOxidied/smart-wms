import { Platform } from 'react-native';
import {
  AuthResponse,
  DuplicateWarningItem,
  ForecastOverview,
  ImportSummary,
  LedgerAuditSummary,
  MovementCreateInput,
  Product,
  ProductCreateInput,
  ProductForecast,
  RoleType,
  StockMovement,
  StocktakeSession,
  Store,
  TemplateKey,
  User,
} from '../types/wms';
import {
  filterCachedMovements,
  filterCachedProducts,
  loadCachedProfile,
  loadPendingMovements,
  loadStoreSnapshot,
  overlayPendingOnProducts,
  reportNetworkStatus,
  saveCachedProfile,
  saveForecastCache,
  saveMovementsCache,
  saveProductsCache,
  saveSummaryCache,
} from './offlineStorage';
import {
  loadSecureToken,
  loadServerUrl,
  saveServerUrl,
} from './secureTokenStorage';

function resolveDefaultBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.replace(/\/+$/, '');
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const { protocol, hostname, port, origin } = window.location;
    if (port === '8081' || port === '19006') {
      return `${protocol}//${hostname || '127.0.0.1'}:8000/api/v1`;
    }
    return `${origin}/api/v1`;
  }
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000/api/v1';
  }
  return 'http://127.0.0.1:8000/api/v1';
}

let activeBaseUrl = resolveDefaultBaseUrl();

export function getActiveBaseUrl(): string {
  return activeBaseUrl;
}

export async function initApiBaseUrl(): Promise<string> {
  const saved = await loadServerUrl();
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const { port, origin, protocol } = window.location;
    if (port !== '8081' && port !== '19006') {
      const sameOriginApi = `${origin}/api/v1`;
      if (!saved || (protocol === 'https:' && saved.trim().startsWith('http://'))) {
        activeBaseUrl = sameOriginApi;
        return activeBaseUrl;
      }
    }
  }
  if (saved && saved.trim().length > 0) {
    activeBaseUrl = saved.trim().replace(/\/+$/, '');
  }
  return activeBaseUrl;
}

export async function updateApiBaseUrl(nextUrl: string): Promise<string> {
  const normalized = nextUrl.trim().replace(/\/+$/, '');
  activeBaseUrl = normalized;
  await saveServerUrl(normalized);
  return activeBaseUrl;
}

export class ApiHttpError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export class NetworkOfflineError extends Error {
  readonly isOffline = true;

  constructor(message = 'Không kết nối được máy chủ. Đã chuyển sang dữ liệu Offline trên máy.') {
    super(message);
    this.name = 'NetworkOfflineError';
  }
}

export function isOfflineNetworkError(err: unknown): err is NetworkOfflineError {
  return (
    err instanceof NetworkOfflineError ||
    (typeof err === 'object' && err !== null && 'isOffline' in err && (err as { isOffline: boolean }).isOffline === true)
  );
}

async function getActiveStoreId(): Promise<number | null> {
  const cached = await loadCachedProfile();
  return cached?.store?.id ?? null;
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  requireAuth = true,
): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    reportNetworkStatus(true);
    throw new NetworkOfflineError();
  }

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (requireAuth) {
    const jwt = await loadSecureToken();
    if (jwt) {
      headers.Authorization = `Bearer ${jwt}`;
    }
  }

  let response: Response;
  try {
    response = await fetch(`${activeBaseUrl}${path}`, {
      ...options,
      headers,
    });
  } catch {
    reportNetworkStatus(true);
    throw new NetworkOfflineError();
  }

  reportNetworkStatus(false);

  if (!response.ok) {
    let payload: unknown = null;
    let message = `Lỗi kết nối máy chủ (${response.status})`;
    try {
      payload = await response.json();
      if (payload && typeof payload === 'object' && 'detail' in payload) {
        const detailObj = (payload as { detail: unknown }).detail;
        if (typeof detailObj === 'string') {
          message = detailObj;
        } else if (detailObj && typeof detailObj === 'object' && 'message' in detailObj) {
          message = String((detailObj as { message: unknown }).message);
        }
      }
    } catch {
      // Keep default HTTP message
    }
    throw new ApiHttpError(response.status, message, payload);
  }

  return (await response.json()) as T;
}

export const api = {
  health: () => requestJson<{ status: string }>('/health', {}, false),

  login: (username: string, secret: string) =>
    requestJson<AuthResponse>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ username, secret }) },
      false,
    ),

  demoLogin: (role: RoleType) =>
    requestJson<AuthResponse>(
      '/auth/demo-login',
      { method: 'POST', body: JSON.stringify({ role }) },
      false,
    ),

  registerStore: (payload: {
    store_name: string;
    manager_username: string;
    manager_full_name: string;
    manager_secret: string;
    staff_username?: string;
    staff_secret?: string;
    industry_template: TemplateKey;
    lite_mode: boolean;
  }) =>
    requestJson<AuthResponse>(
      '/auth/register-store',
      { method: 'POST', body: JSON.stringify(payload) },
      false,
    ),

  getMe: () => requestJson<AuthResponse>('/auth/me'),

  getStore: async (): Promise<Store> => {
    try {
      const data = await requestJson<Store>('/store');
      const cached = await loadCachedProfile();
      if (cached) {
        await saveCachedProfile({ user: cached.user, store: data });
      }
      return data;
    } catch (err) {
      if (isOfflineNetworkError(err)) {
        const cached = await loadCachedProfile();
        if (cached?.store) {
          return cached.store;
        }
      }
      throw err;
    }
  },

  updateStore: (payload: { lite_mode?: boolean; allow_negative_stock?: boolean; name?: string }) =>
    requestJson<Store>('/store', { method: 'PATCH', body: JSON.stringify(payload) }),

  applyTemplate: (template_key: TemplateKey) =>
    requestJson<ImportSummary>('/store/apply-template', {
      method: 'POST',
      body: JSON.stringify({ template_key }),
    }),

  listStaff: () => requestJson<User[]>('/store/staff'),

  createStaff: (payload: {
    username: string;
    full_name: string;
    secret?: string;
    role?: RoleType;
  }) =>
    requestJson<User>('/store/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateStaffStatus: (userId: number, is_active: boolean) =>
    requestJson<User>(`/store/staff/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active }),
    }),

  resetStaffSecret: (userId: number, new_secret = '1234') =>
    requestJson<User>(`/store/staff/${userId}/secret`, {
      method: 'PATCH',
      body: JSON.stringify({ new_secret }),
    }),

  deleteStaff: (userId: number) =>
    requestJson<{ status: string; id: number }>(`/store/staff/${userId}`, {
      method: 'DELETE',
    }),

  changeSecret: (current_secret: string, new_secret: string) =>
    requestJson<{ status: string; message: string }>('/auth/change-secret', {
      method: 'POST',
      body: JSON.stringify({ current_secret, new_secret }),
    }),

  listProducts: async (params?: {
    search?: string;
    category?: string;
    low_stock_only?: boolean;
  }): Promise<Product[]> => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.category && params.category !== 'Tất cả') q.set('category', params.category);
    if (params?.low_stock_only) q.set('low_stock_only', 'true');
    const qs = q.toString() ? `?${q.toString()}` : '';
    const storeId = await getActiveStoreId();

    try {
      const data = await requestJson<Product[]>(`/products${qs}`);
      if (storeId) {
        const pendingAll = await loadPendingMovements();
        const pendingStore = pendingAll.filter((p) => p.store_id === storeId);
        if (pendingStore.length === 0) {
          if (!params?.search && (!params?.category || params.category === 'Tất cả') && !params?.low_stock_only) {
            await saveProductsCache(storeId, data);
          }
          return data;
        }
        return overlayPendingOnProducts(data, pendingStore);
      }
      return data;
    } catch (err) {
      if (isOfflineNetworkError(err) && storeId) {
        const snap = await loadStoreSnapshot(storeId);
        if (snap.products) {
          return filterCachedProducts(snap.products, params);
        }
      }
      throw err;
    }
  },

  findByBarcode: async (code: string): Promise<Product> => {
    const storeId = await getActiveStoreId();
    try {
      return await requestJson<Product>(`/products/by-barcode/${encodeURIComponent(code)}`);
    } catch (err) {
      if (isOfflineNetworkError(err) && storeId) {
        const snap = await loadStoreSnapshot(storeId);
        if (snap.products) {
          const found = snap.products.find(
            (p) => p.barcode === code || p.sku.toUpperCase() === code.toUpperCase(),
          );
          if (found) return found;
          throw new ApiHttpError(404, `Không tìm thấy sản phẩm mã "${code}" trong bộ nhớ tạm.`);
        }
      }
      throw err;
    }
  },

  checkDuplicates: (name: string) =>
    requestJson<DuplicateWarningItem[]>(
      `/products/check-duplicates?name=${encodeURIComponent(name)}`,
    ),

  createProduct: (payload: ProductCreateInput) =>
    requestJson<Product>('/products', { method: 'POST', body: JSON.stringify(payload) }),

  deleteProduct: (productId: number) =>
    requestJson<{ status: string; id: number }>(`/products/${productId}`, { method: 'DELETE' }),

  breakPack: (productId: number, packs_to_break: number, idempotency_key: string) =>
    requestJson<StockMovement>(`/products/${productId}/break-pack`, {
      method: 'POST',
      body: JSON.stringify({ packs_to_break, idempotency_key }),
    }),

  listMovements: async (params?: {
    product_id?: number;
    movement_type?: string;
    actor_role?: string;
    days?: number;
    limit?: number;
  }): Promise<StockMovement[]> => {
    const q = new URLSearchParams();
    if (params?.product_id) q.set('product_id', String(params.product_id));
    if (params?.movement_type) q.set('movement_type', params.movement_type);
    if (params?.actor_role) q.set('actor_role', params.actor_role);
    if (params?.days) q.set('days', String(params.days));
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString() ? `?${q.toString()}` : '';
    const storeId = await getActiveStoreId();

    try {
      const data = await requestJson<StockMovement[]>(`/movements${qs}`);
      if (storeId) {
        const pendingAll = await loadPendingMovements();
        const pendingStore = pendingAll.filter((p) => p.store_id === storeId);
        if (pendingStore.length === 0) {
          if (!params?.product_id && !params?.movement_type && !params?.actor_role && !params?.days) {
            await saveMovementsCache(storeId, data);
          }
          return data;
        }
        const snap = await loadStoreSnapshot(storeId);
        const serverKeys = new Set(data.map((m) => m.idempotency_key));
        const extraPending = (snap.movements || []).filter(
          (m) => m.id < 0 && !serverKeys.has(m.idempotency_key),
        );
        return filterCachedMovements([...extraPending, ...data], params);
      }
      return data;
    } catch (err) {
      if (isOfflineNetworkError(err) && storeId) {
        const snap = await loadStoreSnapshot(storeId);
        if (snap.movements) {
          return filterCachedMovements(snap.movements, params);
        }
      }
      throw err;
    }
  },

  getMovementsSummary: async (days?: number): Promise<LedgerAuditSummary> => {
    const storeId = await getActiveStoreId();
    try {
      const data = await requestJson<LedgerAuditSummary>(
        days ? `/movements/summary?days=${days}` : '/movements/summary',
      );
      if (storeId && !days) {
        const pendingAll = await loadPendingMovements();
        const pendingStore = pendingAll.filter((p) => p.store_id === storeId);
        if (pendingStore.length === 0) {
          await saveSummaryCache(storeId, data);
        }
      }
      return data;
    } catch (err) {
      if (isOfflineNetworkError(err) && storeId) {
        const snap = await loadStoreSnapshot(storeId);
        if (snap.summary) {
          return snap.summary;
        }
        if (snap.products) {
          return {
            store_id: storeId,
            period_days: days ?? null,
            owner_imported_total: 0,
            owner_imported_events: 0,
            staff_consumed_total: 0,
            staff_consumed_events: 0,
            manager_consumed_total: 0,
            manager_consumed_events: 0,
            products: [],
          };
        }
      }
      throw err;
    }
  },

  createMovement: (payload: MovementCreateInput) =>
    requestJson<StockMovement>('/movements', { method: 'POST', body: JSON.stringify(payload) }),

  createBatchMovements: (items: MovementCreateInput[]) =>
    requestJson<{ processed_count: number; movements: StockMovement[] }>('/movements/batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  reverseMovement: (movementId: number, reason: string) =>
    requestJson<StockMovement>(`/movements/${movementId}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  listStocktakes: () => requestJson<StocktakeSession[]>('/stocktakes'),

  createStocktake: (title: string, is_blind = true) =>
    requestJson<StocktakeSession>('/stocktakes', {
      method: 'POST',
      body: JSON.stringify({ title, is_blind }),
    }),

  scanStocktakeItem: (
    sessionId: number,
    payload: {
      product_id?: number;
      barcode?: string;
      counted_qty?: number;
      gauge_percent?: number;
      treat_negative_variance_as_consumption?: boolean;
      note?: string;
    },
  ) =>
    requestJson<StocktakeSession>(`/stocktakes/${sessionId}/scan`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitStocktake: (sessionId: number) =>
    requestJson<StocktakeSession>(`/stocktakes/${sessionId}/submit`, { method: 'POST' }),

  approveStocktake: (
    sessionId: number,
    item_options: Array<{ product_id: number; treat_negative_variance_as_consumption: boolean }>,
  ) =>
    requestJson<StocktakeSession>(`/stocktakes/${sessionId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ item_options }),
    }),

  getForecastOverview: async (): Promise<ForecastOverview> => {
    const storeId = await getActiveStoreId();
    try {
      const data = await requestJson<ForecastOverview>('/forecasts/overview');
      if (storeId) {
        await saveForecastCache(storeId, data);
      }
      return data;
    } catch (err) {
      if (isOfflineNetworkError(err) && storeId) {
        const snap = await loadStoreSnapshot(storeId);
        if (snap.forecastOverview) {
          return snap.forecastOverview;
        }
      }
      throw err;
    }
  },

  getProductForecast: async (productId: number): Promise<ProductForecast> => {
    const storeId = await getActiveStoreId();
    try {
      return await requestJson<ProductForecast>(`/forecasts/products/${productId}`);
    } catch (err) {
      if (isOfflineNetworkError(err) && storeId) {
        const snap = await loadStoreSnapshot(storeId);
        const cachedItem = snap.forecastOverview?.items.find((i) => i.product_id === productId);
        if (cachedItem) {
          return cachedItem;
        }
      }
      throw err;
    }
  },

  exportDraftPoCsvText: async (): Promise<string> => {
    const jwt = await loadSecureToken();
    const res = await fetch(`${activeBaseUrl}/forecasts/export-po`, {
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
    });
    if (!res.ok) {
      throw new ApiHttpError(res.status, 'Không thể xuất file Draft PO.');
    }
    return res.text();
  },

  uploadCsv: async (endpoint: '/imports/products-csv' | '/imports/history-csv', uri: string, name: string) => {
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await fetch(uri).then((r) => r.blob());
      form.append('file', blob, name);
    } else {
      form.append('file', { uri, name, type: 'text/csv' } as unknown as Blob);
    }
    return requestJson<ImportSummary>(
      endpoint,
      { method: 'POST', body: form },
      true,
    );
  },
};
