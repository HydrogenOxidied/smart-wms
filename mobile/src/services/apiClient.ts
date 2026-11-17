import { Platform } from 'react-native';
import {
  AuthResponse,
  DuplicateWarningItem,
  ForecastOverview,
  ImportSummary,
  MovementCreateInput,
  Product,
  ProductCreateInput,
  ProductForecast,
  RoleType,
  StockMovement,
  StocktakeSession,
  Store,
  TemplateKey,
} from '../types/wms';
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
    const host = window.location.hostname || '127.0.0.1';
    return `http://${host}:8000/api/v1`;
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

export function isOfflineNetworkError(err: unknown): boolean {
  if (err instanceof ApiHttpError) {
    return false;
  }
  return err instanceof TypeError || (err instanceof Error && /network|fetch|timeout|failed/i.test(err.message));
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  requireAuth = true,
): Promise<T> {
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

  const response = await fetch(`${activeBaseUrl}${path}`, {
    ...options,
    headers,
  });

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

  updateStore: (payload: { lite_mode?: boolean; allow_negative_stock?: boolean; name?: string }) =>
    requestJson<Store>('/store', { method: 'PATCH', body: JSON.stringify(payload) }),

  applyTemplate: (template_key: TemplateKey) =>
    requestJson<ImportSummary>('/store/apply-template', {
      method: 'POST',
      body: JSON.stringify({ template_key }),
    }),

  listProducts: (params?: { search?: string; category?: string; low_stock_only?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.category && params.category !== 'Tất cả') q.set('category', params.category);
    if (params?.low_stock_only) q.set('low_stock_only', 'true');
    const qs = q.toString() ? `?${q.toString()}` : '';
    return requestJson<Product[]>(`/products${qs}`);
  },

  findByBarcode: (code: string) =>
    requestJson<Product>(`/products/by-barcode/${encodeURIComponent(code)}`),

  checkDuplicates: (name: string) =>
    requestJson<DuplicateWarningItem[]>(
      `/products/check-duplicates?name=${encodeURIComponent(name)}`,
    ),

  createProduct: (payload: ProductCreateInput) =>
    requestJson<Product>('/products', { method: 'POST', body: JSON.stringify(payload) }),

  breakPack: (productId: number, packs_to_break: number, idempotency_key: string) =>
    requestJson<StockMovement>(`/products/${productId}/break-pack`, {
      method: 'POST',
      body: JSON.stringify({ packs_to_break, idempotency_key }),
    }),

  listMovements: (params?: { product_id?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.product_id) q.set('product_id', String(params.product_id));
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString() ? `?${q.toString()}` : '';
    return requestJson<StockMovement[]>(`/movements${qs}`);
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

  getForecastOverview: () => requestJson<ForecastOverview>('/forecasts/overview'),

  getProductForecast: (productId: number) =>
    requestJson<ProductForecast>(`/forecasts/products/${productId}`),

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
    const jwt = await loadSecureToken();
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
