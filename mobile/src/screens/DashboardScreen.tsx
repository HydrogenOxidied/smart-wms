import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  ActionButton,
  ChipOption,
  SegmentedToggle,
  StatusPill,
} from '../components/CommonUI';
import { api } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { useOfflineQueueStore } from '../store/offlineQueueStore';
import { ThemePreference, useUiStore } from '../store/uiStore';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ProductForecast, TemplateKey, User } from '../types/wms';
import { formatCurrencyVnd, formatNumber, triggerSuccessHaptic } from '../utils/formatters';

const THEME_OPTIONS: ChipOption[] = [
  { key: 'system', label: 'Tự động' },
  { key: 'light', label: 'Sáng' },
  { key: 'dark', label: 'Tối' },
];

const AlertCard = React.memo(
  ({
    item,
    onPress,
  }: {
    item: ProductForecast;
    onPress: (productId: number) => void;
  }) => {
    const theme = useTheme();
    const isCritical = item.status === 'CRITICAL';
    return (
      <Pressable
        onPress={() => onPress(item.product_id)}
        accessibilityRole="button"
        accessibilityLabel={`Xem dự báo nhập hàng ${item.name}`}
        android_ripple={{ color: theme.ripple }}
        style={({ pressed }) => [
          styles.alertItem,
          {
            backgroundColor: theme.surfaceAlt,
            borderColor: isCritical ? theme.danger : theme.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <View style={styles.rowBetween}>
          <Text style={[styles.alertName, { color: theme.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <StatusPill
            text={isCritical ? 'Khẩn cấp' : 'Sắp hết'}
            tone={isCritical ? 'danger' : 'warning'}
          />
        </View>
        <Text style={[styles.alertMeta, { color: theme.textMuted }]}>
          Tồn {formatNumber(item.current_stock)} · Gợi ý nhập {formatNumber(item.recommended_order_qty)}{' '}
          {item.unit} ({formatCurrencyVnd(item.estimated_order_cost)})
        </Text>
      </Pressable>
    );
  },
);

const StaffRow = React.memo(
  ({
    member,
    currentUserId,
    onToggleActive,
  }: {
    member: User;
    currentUserId: number;
    onToggleActive: (member: User, nextActive: boolean) => void;
  }) => {
    const theme = useTheme();
    const isSelf = member.id === currentUserId;
    return (
      <View style={[styles.staffItem, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
        <View style={styles.flexOne}>
          <View style={styles.rowBetween}>
            <Text style={[styles.alertName, { color: theme.text }]} numberOfLines={1}>
              {member.full_name}
            </Text>
            <StatusPill
              text={member.role === 'MANAGER' ? 'Chủ kho' : member.is_active ? 'Hoạt động' : 'Đã khóa'}
              tone={member.role === 'MANAGER' ? 'primary' : member.is_active ? 'secondary' : 'danger'}
            />
          </View>
          <Text style={[styles.alertMeta, { color: theme.textMuted }]}>@{member.username}</Text>
        </View>
        {!isSelf ? (
          <Switch
            value={member.is_active}
            onValueChange={(v) => onToggleActive(member, v)}
            trackColor={{ false: theme.border, true: theme.primarySoft }}
            thumbColor={member.is_active ? theme.primary : theme.textMuted}
          />
        ) : null}
      </View>
    );
  },
);

export function DashboardScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { user, store, setStore, logout } = useAuthStore();
  const { pending, flushQueue, isSyncing } = useOfflineQueueStore();
  const { setActiveTab, openForecastForProduct, themePref, setThemePref } = useUiStore();
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [newStaffUser, setNewStaffUser] = useState('');
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffSecret, setNewStaffSecret] = useState('');
  const [creatingStaff, setCreatingStaff] = useState(false);

  const forecastQuery = useQuery({
    queryKey: ['forecast-overview'],
    queryFn: api.getForecastOverview,
  });

  const summaryQuery = useQuery({
    queryKey: ['movements-summary'],
    queryFn: () => api.getMovementsSummary(),
  });

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => api.listProducts(),
  });

  const staffQuery = useQuery({
    queryKey: ['store-staff'],
    queryFn: api.listStaff,
  });

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['forecast-overview'] });
    void queryClient.invalidateQueries({ queryKey: ['movements-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['store-staff'] });
  }, [queryClient]);

  const handleToggleLiteMode = useCallback(
    async (value: boolean) => {
      try {
        const updated = await api.updateStore({ lite_mode: value });
        setStore(updated);
        await triggerSuccessHaptic();
        setNotice(value ? 'Đã bật chế độ tối giản.' : 'Đã bật chế độ đầy đủ thông số.');
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Không cập nhật được chế độ.');
      }
    },
    [setStore],
  );

  const handleUploadCsv = useCallback(
    async (kind: 'products' | 'history') => {
      try {
        const res = await DocumentPicker.getDocumentAsync({
          type: ['text/csv', 'text/comma-separated-values', '*/*'],
          copyToCacheDirectory: true,
        });
        if (res.canceled || !res.assets?.length) {
          return;
        }
        setImporting(true);
        const asset = res.assets[0];
        const endpoint = kind === 'products' ? '/imports/products-csv' : '/imports/history-csv';
        const summary = await api.uploadCsv(endpoint, asset.uri, asset.name || 'import.csv');
        await triggerSuccessHaptic();
        handleRefresh();
        setNotice(
          `Import xong: +${summary.created_products} SP, ${summary.updated_products} cập nhật.`,
        );
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Lỗi import file CSV.');
      } finally {
        setImporting(false);
      }
    },
    [handleRefresh],
  );

  const handleApplyTemplate = useCallback(
    async (key: TemplateKey) => {
      setImporting(true);
      try {
        const summary = await api.applyTemplate(key);
        await triggerSuccessHaptic();
        handleRefresh();
        setNotice(`Đã nạp bộ mẫu: +${summary.created_products} mặt hàng.`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Không thể nạp bộ mẫu.');
      } finally {
        setImporting(false);
      }
    },
    [handleRefresh],
  );

  const handleCreateStaff = useCallback(async () => {
    if (!newStaffUser.trim() || !newStaffSecret.trim()) {
      setNotice('Nhập tên đăng nhập và mật khẩu cho nhân viên.');
      return;
    }
    setCreatingStaff(true);
    try {
      const created = await api.createStaff({
        username: newStaffUser.trim(),
        full_name: newStaffName.trim() || newStaffUser.trim(),
        secret: newStaffSecret,
        role: 'STAFF',
      });
      await triggerSuccessHaptic();
      setNewStaffUser('');
      setNewStaffName('');
      setNewStaffSecret('');
      setStaffModalOpen(false);
      setNotice(`Đã thêm nhân viên "@${created.username}".`);
      void queryClient.invalidateQueries({ queryKey: ['store-staff'] });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Không tạo được nhân viên.');
    } finally {
      setCreatingStaff(false);
    }
  }, [newStaffUser, newStaffName, newStaffSecret, queryClient]);

  const handleToggleStaff = useCallback(
    async (member: User, nextActive: boolean) => {
      try {
        await api.updateStaffStatus(member.id, nextActive);
        await triggerSuccessHaptic();
        setNotice(nextActive ? `Đã mở khóa @${member.username}.` : `Đã khóa @${member.username}.`);
        void queryClient.invalidateQueries({ queryKey: ['store-staff'] });
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Không cập nhật được trạng thái.');
      }
    },
    [queryClient],
  );

  const overview = forecastQuery.data;
  const urgentItems = (overview?.items || []).filter((i) => i.status !== 'HEALTHY').slice(0, 4);
  const movementEventsCount =
    (summaryQuery.data?.staff_consumed_events ?? 0) +
    (summaryQuery.data?.owner_imported_events ?? 0) +
    (summaryQuery.data?.manager_consumed_events ?? 0);
  const totalProducts = productsQuery.data?.length ?? overview?.total_skus ?? 0;
  const staffMembers = staffQuery.data || [];
  const isDemoStore = store?.code === 'MOC_BAKERY';

  const sections = ['kpis', 'alerts', 'staff', 'settings'];

  const renderStaffItem = useCallback(
    ({ item }: { item: User }) => (
      <StaffRow
        member={item}
        currentUserId={user?.id || 0}
        onToggleActive={(m, nextVal) => void handleToggleStaff(m, nextVal)}
      />
    ),
    [user?.id, handleToggleStaff],
  );

  const renderAlertItem = useCallback(
    ({ item }: { item: ProductForecast }) => (
      <AlertCard item={item} onPress={openForecastForProduct} />
    ),
    [openForecastForProduct],
  );

  const renderSection = useCallback(
    ({ item }: { item: string }) => {
      if (item === 'kpis') {
        return (
          <View style={styles.sectionBlock}>
            {pending.length > 0 ? (
              <ActionButton
                label={`Đồng bộ ${pending.length} thao tác Offline`}
                icon="cloud-upload-outline"
                variant="warning"
                loading={isSyncing}
                onPress={() => void flushQueue()}
              />
            ) : null}

            {notice ? (
              <Text style={[styles.noticeText, { color: theme.secondary }]}>{notice}</Text>
            ) : null}

            <View style={styles.kpiGrid}>
              <Pressable
                onPress={() => setActiveTab('inventory')}
                accessibilityRole="button"
                accessibilityLabel="Xem mặt hàng trong Kho hàng"
                android_ripple={{ color: theme.ripple }}
                style={({ pressed }) => [
                  styles.kpiCard,
                  { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Ionicons name="cube-outline" size={20} color={theme.primary} />
                <Text style={[styles.kpiVal, { color: theme.text }]}>{totalProducts}</Text>
                <Text style={[styles.kpiLabel, { color: theme.textMuted }]}>Mặt hàng</Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('forecast')}
                accessibilityRole="button"
                accessibilityLabel="Xem mặt hàng cần nhập sớm"
                android_ripple={{ color: theme.ripple }}
                style={({ pressed }) => [
                  styles.kpiCard,
                  { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Ionicons name="alert-circle-outline" size={20} color={theme.danger} />
                <Text style={[styles.kpiVal, { color: theme.danger }]}>
                  {(overview?.critical_count ?? 0) + (overview?.reorder_soon_count ?? 0)}
                </Text>
                <Text style={[styles.kpiLabel, { color: theme.textMuted }]}>Cần nhập</Text>
              </Pressable>

              <Pressable
                onPress={() => setActiveTab('stocktake')}
                accessibilityRole="button"
                accessibilityLabel="Mở lịch sử kiểm kê"
                android_ripple={{ color: theme.ripple }}
                style={({ pressed }) => [
                  styles.kpiCard,
                  { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Ionicons name="clipboard-outline" size={20} color={theme.warning} />
                <Text style={[styles.kpiVal, { color: theme.text }]}>{movementEventsCount}</Text>
                <Text style={[styles.kpiLabel, { color: theme.primary }]}>Sửa đổi →</Text>
              </Pressable>
            </View>
          </View>
        );
      }

      if (item === 'alerts') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Cảnh báo hết hàng</Text>
              <Pressable
                onPress={() => setActiveTab('forecast')}
                accessibilityRole="button"
                accessibilityLabel="Xem dự báo AI"
                style={({ pressed }) => [styles.linkTouch, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[styles.linkText, { color: theme.primary }]}>Dự báo →</Text>
              </Pressable>
            </View>
            {urgentItems.length === 0 ? (
              <Text style={[styles.subText, { color: theme.textMuted }]}>
                Tồn kho đang ở mức an toàn.
              </Text>
            ) : (
              <FlatList
                data={urgentItems}
                renderItem={renderAlertItem}
                keyExtractor={(u) => String(u.product_id)}
                contentContainerStyle={styles.alertList}
              />
            )}
          </View>
        );
      }

      if (item === 'staff') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                Nhân viên ({staffMembers.filter((m) => m.role === 'STAFF').length})
              </Text>
              <ActionButton
                label="+ Thêm"
                icon="person-add-outline"
                variant="secondary"
                onPress={() => setStaffModalOpen(true)}
              />
            </View>
            <FlatList
              data={staffMembers}
              renderItem={renderStaffItem}
              keyExtractor={(m) => String(m.id)}
              contentContainerStyle={styles.alertList}
            />
          </View>
        );
      }

      return (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Cài đặt & Dữ liệu</Text>

          <View style={[styles.modeSwitchRow, { backgroundColor: theme.surfaceAlt }]}>
            <Text style={[styles.modeTitle, { color: theme.text, flex: 1 }]}>
              Giao diện tối giản (Lite Mode)
            </Text>
            <Switch
              value={Boolean(store?.lite_mode)}
              onValueChange={(v) => void handleToggleLiteMode(v)}
              trackColor={{ false: theme.border, true: theme.primarySoft }}
              thumbColor={store?.lite_mode ? theme.primary : theme.textMuted}
            />
          </View>

          <SegmentedToggle
            options={THEME_OPTIONS}
            selectedKey={themePref}
            onSelect={(k) => setThemePref(k as ThemePreference)}
          />

          <View style={styles.splitRow}>
            <ActionButton
              label="Import SP CSV"
              icon="document-attach-outline"
              variant="outline"
              style={styles.flexOne}
              loading={importing}
              onPress={() => void handleUploadCsv('products')}
            />
            <ActionButton
              label="Import Lịch sử"
              icon="analytics-outline"
              variant="outline"
              style={styles.flexOne}
              loading={importing}
              onPress={() => void handleUploadCsv('history')}
            />
          </View>

          {isDemoStore ? (
            <ActionButton
              label="Nạp mẫu Shop Mắm Tép (Demo)"
              icon="cube-outline"
              variant="secondary"
              loading={importing}
              onPress={() => void handleApplyTemplate('MAM_TEP')}
            />
          ) : null}

          <ActionButton
            label={isDemoStore ? 'Thoát Demo' : 'Đăng xuất'}
            icon="log-out-outline"
            variant="danger"
            onPress={() => void logout()}
          />
        </View>
      );
    },
    [
      theme,
      store,
      isDemoStore,
      pending.length,
      isSyncing,
      flushQueue,
      notice,
      totalProducts,
      overview,
      movementEventsCount,
      urgentItems,
      renderAlertItem,
      staffMembers,
      renderStaffItem,
      importing,
      handleToggleLiteMode,
      handleUploadCsv,
      handleApplyTemplate,
      setActiveTab,
      themePref,
      setThemePref,
      logout,
    ],
  );

  return (
    <View style={styles.flexOne}>
      <FlatList
        data={sections}
        renderItem={renderSection}
        keyExtractor={(s) => s}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={forecastQuery.isRefetching}
            onRefresh={handleRefresh}
            tintColor={theme.primary}
          />
        }
      />

      <Modal
        visible={staffModalOpen}
        animationType="slide"
        onRequestClose={() => setStaffModalOpen(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: theme.bg }]}>
          <View
            style={[
              styles.modalHeaderWrap,
              { backgroundColor: theme.surface, borderBottomColor: theme.border },
            ]}
          >
            <View style={styles.modalHeaderInner}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Thêm tài khoản Nhân viên</Text>
              <Pressable
                onPress={() => setStaffModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Đóng biểu mẫu thêm nhân viên"
                android_ripple={{ color: theme.ripple }}
                style={({ pressed }) => [
                  styles.closeBtn,
                  { backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Ionicons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>
          </View>

          <View style={styles.modalBody}>
            <Text style={[styles.subText, { color: theme.textMuted }]}>Tên đăng nhập *</Text>
            <TextInput
              value={newStaffUser}
              onChangeText={setNewStaffUser}
              autoCapitalize="none"
              placeholder="Ví dụ: nv_casang"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />
            <Text style={[styles.subText, { color: theme.textMuted }]}>Họ tên</Text>
            <TextInput
              value={newStaffName}
              onChangeText={setNewStaffName}
              placeholder="Ví dụ: Nguyễn Minh Tâm"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />
            <Text style={[styles.subText, { color: theme.textMuted }]}>Mật khẩu *</Text>
            <TextInput
              value={newStaffSecret}
              onChangeText={setNewStaffSecret}
              secureTextEntry
              placeholder="Tối thiểu 4 ký tự"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />
            <ActionButton
              label="Tạo tài khoản"
              icon="checkmark-circle-outline"
              loading={creatingStaff}
              onPress={() => void handleCreateStaff()}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  sectionBlock: { gap: SPACING.sm },
  flexOne: { flex: 1 },
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  subText: {
    fontSize: 13,
  },
  modeSwitchRow: {
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  modeTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  noticeText: {
    fontSize: 13,
    fontWeight: '500',
  },
  kpiGrid: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  kpiCard: {
    flex: 1,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  kpiVal: {
    fontSize: 22,
    fontWeight: '700',
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  linkTouch: {
    minHeight: TOUCH_MIN,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xs,
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  alertList: {
    gap: SPACING.sm,
  },
  alertItem: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  alertName: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  alertMeta: {
    fontSize: 12,
  },
  splitRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  staffItem: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  modalContainer: { flex: 1 },
  modalHeaderWrap: { borderBottomWidth: 1 },
  modalHeaderInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  closeBtn: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBody: {
    padding: SPACING.lg,
    gap: SPACING.md,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  input: {
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 15,
  },
});
