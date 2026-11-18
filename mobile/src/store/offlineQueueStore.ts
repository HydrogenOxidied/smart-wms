import { create } from 'zustand';
import { ApiHttpError, api, isOfflineNetworkError } from '../services/apiClient';
import {
  applyOptimisticMovementsToCache,
  loadPendingMovements,
  onNetworkStatusChange,
  PendingOfflineMovement,
  reportNetworkStatus,
  savePendingMovements,
} from '../services/offlineStorage';
import { MovementCreateInput, Product, StockMovement, User } from '../types/wms';

interface SyncResult {
  synced: number;
  remaining: number;
}

interface OfflineQueueState {
  pending: PendingOfflineMovement[];
  isOfflineMode: boolean;
  isSyncing: boolean;
  lastSyncNotice: string | null;
  hydrateQueue: () => Promise<void>;
  enqueueMovements: (
    items: MovementCreateInput[],
    user: User,
    storeId: number,
  ) => Promise<{ updatedProducts: Product[]; createdMovements: StockMovement[] }>;
  syncPendingMovements: (activeStoreId?: number) => Promise<SyncResult>;
  clearSyncNotice: () => void;
}

let activeSyncPromise: Promise<SyncResult> | null = null;

export const useOfflineQueueStore = create<OfflineQueueState>((set, get) => {
  onNetworkStatusChange((offline) => {
    set({ isOfflineMode: offline });
  });

  return {
    pending: [],
    isOfflineMode: typeof navigator !== 'undefined' && navigator.onLine === false,
    isSyncing: false,
    lastSyncNotice: null,

    hydrateQueue: async () => {
      const items = await loadPendingMovements();
      const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      reportNetworkStatus(browserOffline);
      set({ pending: items, isOfflineMode: browserOffline });
    },

    enqueueMovements: async (items, user, storeId) => {
      const existing = get().pending;
      const existingKeys = new Set(existing.map((p) => p.payload.idempotency_key));
      const newItems = items.filter((it) => !existingKeys.has(it.idempotency_key));

      const stampedPayloads = newItems.map((it, idx) => ({
        ...it,
        occurred_at: it.occurred_at || new Date(Date.now() + idx).toISOString(),
      }));

      const { updatedProducts, createdMovements } = await applyOptimisticMovementsToCache({
        storeId,
        user,
        items: stampedPayloads,
      });

      const queuedRecords: PendingOfflineMovement[] = stampedPayloads.map((payload) => ({
        id: payload.idempotency_key,
        store_id: storeId,
        user_id: user.id,
        user_name: user.full_name,
        user_username: user.username,
        user_role: user.role,
        payload,
        queued_at: payload.occurred_at || new Date().toISOString(),
      }));

      const nextPending = [...existing, ...queuedRecords];
      await savePendingMovements(nextPending);
      reportNetworkStatus(true);
      set({ pending: nextPending, isOfflineMode: true });
      return { updatedProducts, createdMovements };
    },

    syncPendingMovements: async (activeStoreId) => {
      if (activeSyncPromise) {
        return activeSyncPromise;
      }

      const runner = async (): Promise<SyncResult> => {
        const currentPending = get().pending;
        const toSync = activeStoreId
          ? currentPending.filter((p) => p.store_id === activeStoreId)
          : currentPending;

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          reportNetworkStatus(true);
          set({ isOfflineMode: true });
          return { synced: 0, remaining: currentPending.length };
        }

        if (toSync.length === 0) {
          if (get().isOfflineMode) {
            try {
              await api.health();
              reportNetworkStatus(false);
              set({ isOfflineMode: false });
            } catch {
              // Still offline
            }
          }
          return { synced: 0, remaining: currentPending.length };
        }

        set({ isSyncing: true });
        try {
          await api.createBatchMovements(
            toSync.map((item) => ({ ...item.payload, confirm_anomaly: true })),
          );
          const syncedIds = new Set(toSync.map((item) => item.id));
          const remainingList = get().pending.filter((item) => !syncedIds.has(item.id));
          await savePendingMovements(remainingList);
          reportNetworkStatus(false);
          set({
            pending: remainingList,
            isOfflineMode: false,
            isSyncing: false,
            lastSyncNotice: `Đã đồng bộ ${toSync.length} giao dịch Offline lên máy chủ.`,
          });
          return { synced: toSync.length, remaining: remainingList.length };
        } catch (err) {
          if (err instanceof ApiHttpError) {
            // Replay item by item so one bad/stale item does not stall valid offline entries
            const resolvedIds = new Set<string>();
            let syncedCount = 0;
            let hitNetworkDrop = false;

            for (const entry of toSync) {
              try {
                await api.createMovement({ ...entry.payload, confirm_anomaly: true });
                resolvedIds.add(entry.id);
                syncedCount += 1;
              } catch (itemErr) {
                if (isOfflineNetworkError(itemErr)) {
                  hitNetworkDrop = true;
                  break;
                }
                if (itemErr instanceof ApiHttpError && itemErr.status >= 400 && itemErr.status < 500) {
                  resolvedIds.add(entry.id);
                }
              }
            }

            const remainingList = get().pending.filter((item) => !resolvedIds.has(item.id));
            await savePendingMovements(remainingList);
            if (!hitNetworkDrop) {
              reportNetworkStatus(false);
            }
            set({
              pending: remainingList,
              isOfflineMode: hitNetworkDrop,
              isSyncing: false,
              lastSyncNotice:
                syncedCount > 0
                  ? `Đã đồng bộ ${syncedCount} giao dịch Offline lên máy chủ.`
                  : get().lastSyncNotice,
            });
            return { synced: syncedCount, remaining: remainingList.length };
          }

          if (isOfflineNetworkError(err)) {
            reportNetworkStatus(true);
            set({ isOfflineMode: true, isSyncing: false });
          } else {
            set({ isSyncing: false });
          }
          return { synced: 0, remaining: get().pending.length };
        }
      };

      activeSyncPromise = runner().finally(() => {
        activeSyncPromise = null;
      });
      return activeSyncPromise;
    },

    clearSyncNotice: () => set({ lastSyncNotice: null }),
  };
});
