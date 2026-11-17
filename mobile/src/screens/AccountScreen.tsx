import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { ActionButton, ChipOption, ChipRow, StatusPill } from '../components/CommonUI';
import { getActiveBaseUrl } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { useOfflineQueueStore } from '../store/offlineQueueStore';
import { ThemePreference, useUiStore } from '../store/uiStore';
import { RADIUS, SPACING } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { triggerSuccessHaptic } from '../utils/formatters';

const THEME_OPTIONS: ChipOption[] = [
  { key: 'system', label: 'Theo hệ thống' },
  { key: 'light', label: 'Giao diện Sáng' },
  { key: 'dark', label: 'Tối (Tiết kiệm OLED)' },
];

export function AccountScreen() {
  const theme = useTheme();
  const { user, store, logout } = useAuthStore();
  const { pending, isSyncing, lastSyncMessage, flushQueue } = useOfflineQueueStore();
  const { themePref, setThemePref } = useUiStore();
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    const count = await flushQueue();
    if (count > 0) {
      await triggerSuccessHaptic();
    }
    setSyncNotice(
      count > 0
        ? `Đã đồng bộ ${count} giao dịch Offline.`
        : 'Không có giao dịch chờ hoặc chưa có mạng.',
    );
  }, [flushQueue]);

  const blocks = ['profile', 'sync', 'theme'];

  const renderBlock = useCallback(
    ({ item }: { item: string }) => {
      if (item === 'profile') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.title, { color: theme.text }]}>{user?.full_name}</Text>
              <StatusPill
                text={user?.role === 'MANAGER' ? 'Quản lý' : 'Nhân viên kho'}
                tone={user?.role === 'MANAGER' ? 'primary' : 'secondary'}
              />
            </View>
            <Text style={[styles.subText, { color: theme.textMuted }]}>
              Cửa hàng: {store?.name} ({store?.code})
            </Text>
            <Text style={[styles.subText, { color: theme.textMuted }]}>
              Chế độ giao diện: {store?.lite_mode ? 'Lite Mode (Tiệm nhỏ)' : 'Warehouse Pro Mode'}
            </Text>
            <Text style={[styles.subText, { color: theme.textMuted }]}>
              Máy chủ: {getActiveBaseUrl()}
            </Text>
            <ActionButton
              label="Đăng xuất / Đổi tài khoản"
              icon="log-out-outline"
              variant="danger"
              onPress={() => void logout()}
            />
          </View>
        );
      }

      if (item === 'sync') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.title, { color: theme.text }]}>Hàng đợi Offline</Text>
              <StatusPill
                text={pending.length > 0 ? `${pending.length} chờ gửi` : 'Đã đồng bộ'}
                tone={pending.length > 0 ? 'warning' : 'primary'}
              />
            </View>
            <Text style={[styles.subText, { color: theme.textMuted }]}>
              Mọi thao tác quét xuất/nhập khi mất sóng trong kho sẽ được lưu an toàn và đồng bộ FIFO khi có kết nối.
            </Text>
            {syncNotice || lastSyncMessage ? (
              <Text style={[styles.subText, { color: theme.secondary }]}>
                {syncNotice || lastSyncMessage}
              </Text>
            ) : null}
            <ActionButton
              label={`Đồng bộ ngay (${pending.length})`}
              icon="cloud-upload-outline"
              variant="secondary"
              disabled={pending.length === 0}
              loading={isSyncing}
              onPress={() => void handleSync()}
            />
          </View>
        );
      }

      return (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.text }]}>Giao diện Sáng / Tối</Text>
          <ChipRow
            options={THEME_OPTIONS}
            selectedKey={themePref}
            onSelect={(k) => setThemePref(k as ThemePreference)}
          />
        </View>
      );
    },
    [
      theme,
      user,
      store,
      logout,
      pending.length,
      syncNotice,
      lastSyncMessage,
      isSyncing,
      handleSync,
      themePref,
      setThemePref,
    ],
  );

  return (
    <FlatList
      data={blocks}
      renderItem={renderBlock}
      keyExtractor={(i) => i}
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  subText: {
    fontSize: 13,
    lineHeight: 19,
  },
});
