import { create } from 'zustand';
import { api } from '../services/apiClient';
import {
  loadPendingQueue,
  PendingLedgerRecord,
  savePendingQueue,
} from '../services/offlineQueue';
import { MovementCreateInput } from '../types/wms';

interface OfflineQueueState {
  pending: PendingLedgerRecord[];
  isSyncing: boolean;
  lastSyncMessage: string | null;
  hydrateQueue: () => Promise<void>;
  enqueueMovement: (productName: string, productUnit: string, payload: MovementCreateInput) => Promise<void>;
  flushQueue: () => Promise<number>;
  clearLastMessage: () => void;
}

export const useOfflineQueueStore = create<OfflineQueueState>((set, get) => ({
  pending: [],
  isSyncing: false,
  lastSyncMessage: null,

  hydrateQueue: async () => {
    const items = await loadPendingQueue();
    set({ pending: items });
  },

  enqueueMovement: async (productName, productUnit, payload) => {
    const current = get().pending;
    if (current.some((item) => item.payload.idempotency_key === payload.idempotency_key)) {
      return;
    }
    const record: PendingLedgerRecord = {
      localId: payload.idempotency_key,
      productName,
      productUnit,
      payload,
      queuedAt: new Date().toISOString(),
    };
    const next = [...current, record];
    await savePendingQueue(next);
    set({
      pending: next,
      lastSyncMessage: `Đã lưu Offline (${next.length} thao tác chờ đồng bộ)`,
    });
  },

  flushQueue: async () => {
    const current = get().pending;
    if (current.length === 0 || get().isSyncing) {
      return 0;
    }
    set({ isSyncing: true });
    try {
      const payloads = current.map((item) => item.payload);
      const res = await api.createBatchMovements(payloads);
      await savePendingQueue([]);
      set({
        pending: [],
        isSyncing: false,
        lastSyncMessage: `Đã đồng bộ thành công ${res.processed_count} thao tác lên máy chủ.`,
      });
      return res.processed_count;
    } catch {
      set({
        isSyncing: false,
        lastSyncMessage: 'Chưa có kết nối máy chủ — giữ hàng đợi an toàn để đồng bộ sau.',
      });
      return 0;
    }
  },

  clearLastMessage: () => set({ lastSyncMessage: null }),
}));
