import { create } from 'zustand';
import { api, initApiBaseUrl, isOfflineNetworkError } from '../services/apiClient';
import {
  clearCachedProfile,
  loadCachedProfile,
  reportNetworkStatus,
  saveCachedProfile,
} from '../services/offlineStorage';
import {
  clearSecureToken,
  loadSecureToken,
  saveSecureToken,
} from '../services/secureTokenStorage';
import { AuthResponse, RoleType, Store, TemplateKey, User } from '../types/wms';

interface AuthState {
  isHydrated: boolean;
  isLoading: boolean;
  user: User | null;
  store: Store | null;
  hydrate: () => Promise<void>;
  login: (username: string, secret: string) => Promise<void>;
  demoLogin: (role: RoleType) => Promise<void>;
  registerStore: (payload: {
    store_name: string;
    manager_username: string;
    manager_full_name: string;
    manager_secret: string;
    staff_username?: string;
    staff_secret?: string;
    industry_template: TemplateKey;
    lite_mode: boolean;
  }) => Promise<void>;
  setStore: (store: Store) => void;
  logout: () => Promise<void>;
}

async function applySession(
  set: (partial: Partial<AuthState>) => void,
  auth: AuthResponse,
): Promise<void> {
  await saveSecureToken(auth.access_token);
  await saveCachedProfile({ user: auth.user, store: auth.store });
  set({ user: auth.user, store: auth.store, isLoading: false });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isHydrated: false,
  isLoading: false,
  user: null,
  store: null,

  hydrate: async () => {
    await initApiBaseUrl();
    const stored = await loadSecureToken();
    if (!stored) {
      set({ isHydrated: true, user: null, store: null });
      return;
    }
    try {
      const me = await api.getMe();
      await saveSecureToken(me.access_token);
      await saveCachedProfile({ user: me.user, store: me.store });
      set({ isHydrated: true, user: me.user, store: me.store });
    } catch (err) {
      if (isOfflineNetworkError(err)) {
        const cached = await loadCachedProfile();
        if (cached?.user && cached?.store) {
          reportNetworkStatus(true);
          set({ isHydrated: true, user: cached.user, store: cached.store });
          return;
        }
      }
      await clearSecureToken();
      await clearCachedProfile();
      set({ isHydrated: true, user: null, store: null });
    }
  },

  login: async (username, secret) => {
    set({ isLoading: true });
    try {
      const res = await api.login(username, secret);
      await applySession(set, res);
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  demoLogin: async (role) => {
    set({ isLoading: true });
    try {
      const res = await api.demoLogin(role);
      await applySession(set, res);
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  registerStore: async (payload) => {
    set({ isLoading: true });
    try {
      const res = await api.registerStore(payload);
      await applySession(set, res);
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  setStore: (store) => {
    const currentUser = get().user;
    if (currentUser) {
      void saveCachedProfile({ user: currentUser, store });
    }
    set({ store });
  },

  logout: async () => {
    await clearSecureToken();
    await clearCachedProfile();
    set({ user: null, store: null });
  },
}));
