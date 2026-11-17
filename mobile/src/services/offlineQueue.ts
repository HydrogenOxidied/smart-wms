import AsyncStorage from '@react-native-async-storage/async-storage';
import { MovementCreateInput } from '../types/wms';

const QUEUE_STORAGE_KEY = 'pocketwms_pending_ledger_queue_v1';

export interface PendingLedgerRecord {
  localId: string;
  productName: string;
  productUnit: string;
  payload: MovementCreateInput;
  queuedAt: string;
}

export async function loadPendingQueue(): Promise<PendingLedgerRecord[]> {
  const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function savePendingQueue(records: PendingLedgerRecord[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(records));
}
