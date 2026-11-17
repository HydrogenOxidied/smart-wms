import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export function createIdempotencyKey(prefix = 'wms'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

export function formatCurrencyVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString('vi-VN')} đ`;
}

export function formatNumber(val: number): string {
  if (Number.isInteger(val)) {
    return val.toLocaleString('vi-VN');
  }
  return Number(val.toFixed(2)).toLocaleString('vi-VN');
}

export function parseUtcDate(iso: string): Date {
  const trimmed = iso.trim();
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const normalized = hasTz ? trimmed : `${trimmed.replace(' ', 'T')}Z`;
  return new Date(normalized);
}

export function formatShortDate(iso: string): string {
  if (!iso) return '';
  const d = parseUtcDate(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
}

export async function triggerLightHaptic(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Ignore on unsupported devices
  }
}

export async function triggerSuccessHaptic(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Ignore
  }
}

export async function triggerWarningHaptic(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {
    // Ignore
  }
}
