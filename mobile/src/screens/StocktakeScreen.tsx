import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { ChipOption, ChipRow, SegmentedToggle, StatusPill } from '../components/CommonUI';
import { api } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ProductAuditSummary, StockMovement } from '../types/wms';
import {
  formatNumber,
  formatShortDate,
  parseUtcDate,
  triggerLightHaptic,
  triggerSuccessHaptic,
} from '../utils/formatters';

type AuditViewMode = 'log' | 'by_product';
type TimeframeKey = 'ALL' | '1' | '7' | '30';
type ActionFilterKey = 'ALL' | 'STAFF_OUT' | 'OWNER_IN' | 'OTHER';

const VIEW_MODE_OPTIONS: ChipOption[] = [
  { key: 'log', label: 'Nhật ký sửa đổi' },
  { key: 'by_product', label: 'Tổng hợp theo SP' },
];

const TIMEFRAME_OPTIONS: ChipOption[] = [
  { key: 'ALL', label: 'Toàn bộ' },
  { key: '1', label: 'Hôm nay' },
  { key: '7', label: '7 ngày' },
  { key: '30', label: '30 ngày' },
];

const ACTION_FILTER_OPTIONS: ChipOption[] = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'STAFF_OUT', label: 'NV tiêu hao (-)' },
  { key: 'OWNER_IN', label: 'Chủ nhập (+)' },
  { key: 'OTHER', label: 'Hoàn tác / Khác' },
];

function getAuditLabel(item: StockMovement): string {
  switch (item.movement_type) {
    case 'IN_PURCHASE':
      return 'Chủ nhập';
    case 'OUT_CONSUMPTION':
      return item.user_role === 'STAFF' ? 'NV tiêu hao' : 'Chủ xuất';
    case 'OUT_DAMAGE_EXPIRED':
      return 'Báo hỏng';
    case 'REVERSAL':
      return 'Hoàn tác';
    case 'PACK_BREAK':
      return 'Khui thùng';
    case 'ADJUST_STOCKTAKE':
      return 'Kiểm kê';
    default:
      return item.movement_type;
  }
}

function getActorRoleLabel(role?: string | null): string {
  if (role === 'MANAGER') return 'Chủ kho';
  if (role === 'STAFF') return 'NV';
  return 'Hệ thống';
}

function isWithinReversalWindow(createdAt: string): boolean {
  const parsed = parseUtcDate(createdAt).getTime();
  if (Number.isNaN(parsed)) return true;
  return (Date.now() - parsed) / 60000 <= 16;
}

const ProductAuditCard = React.memo(
  ({
    item,
    onInspectProduct,
  }: {
    item: ProductAuditSummary;
    onInspectProduct: (productId: number) => void;
  }) => {
    const theme = useTheme();
    return (
      <Pressable
        onPress={() => {
          void triggerLightHaptic();
          onInspectProduct(item.product_id);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Xem lịch sử sửa đổi của ${item.name}`}
        android_ripple={{ color: theme.ripple }}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.88 : 1 },
        ]}
      >
        <View style={styles.rowBetween}>
          <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={2}>
            {item.name}
          </Text>
          <StatusPill text={`Tồn ${formatNumber(item.current_stock)} ${item.unit}`} tone="secondary" />
        </View>

        <View style={styles.splitRow}>
          <View style={[styles.auditStatBox, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
            <Text style={[styles.auditStatLabel, { color: theme.textMuted }]}>NV tiêu hao</Text>
            <Text style={[styles.auditStatValue, { color: theme.danger }]}>
              -{formatNumber(item.staff_consumed_qty)} {item.unit}
            </Text>
            <Text style={[styles.metaText, { color: theme.textMuted }]}>
              {item.staff_consumed_count} lượt
              {item.manager_consumed_qty > 0
                ? ` · Chủ xuất -${formatNumber(item.manager_consumed_qty)}`
                : ''}
            </Text>
          </View>

          <View style={[styles.auditStatBox, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}>
            <Text style={[styles.auditStatLabel, { color: theme.textMuted }]}>Chủ đã nhập</Text>
            <Text style={[styles.auditStatValue, { color: theme.primary }]}>
              +{formatNumber(item.owner_imported_qty)} {item.unit}
            </Text>
            <Text style={[styles.metaText, { color: theme.textMuted }]}>
              {item.owner_imported_count} lượt
            </Text>
          </View>
        </View>
      </Pressable>
    );
  },
);

const AuditMovementCard = React.memo(
  ({
    item,
    isManager,
    onReverse,
  }: {
    item: StockMovement;
    isManager: boolean;
    onReverse: (mv: StockMovement) => void;
  }) => {
    const theme = useTheme();
    const isReversibleType =
      item.movement_type === 'OUT_CONSUMPTION' ||
      item.movement_type === 'OUT_DAMAGE_EXPIRED' ||
      item.movement_type === 'IN_PURCHASE';
    const canReverse =
      item.id > 0 &&
      !item.is_reversed &&
      isReversibleType &&
      (isManager || isWithinReversalWindow(item.created_at));

    const unit = item.product_unit || 'ĐV';
    const beforeQty =
      typeof item.balance_before === 'number'
        ? item.balance_before
        : Number((item.balance_after - item.quantity_delta).toFixed(3));
    const isPositive = item.quantity_delta > 0;
    const deltaLabel = isPositive
      ? `+${formatNumber(item.quantity_delta)} ${unit}`
      : `${formatNumber(item.quantity_delta)} ${unit}`;
    const pillTone: 'primary' | 'danger' | 'warning' = item.is_reversed
      ? 'warning'
      : isPositive
        ? 'primary'
        : 'danger';

    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.surface,
            borderColor: item.is_reversed ? theme.warning : theme.border,
          },
        ]}
      >
        <View style={styles.rowBetween}>
          <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={2}>
            {item.product_name || `SP #${item.product_id}`}
          </Text>
          <StatusPill text={deltaLabel} tone={pillTone} />
        </View>

        <View style={styles.rowBetween}>
          <Text style={[styles.mathLine, { color: theme.text }]}>
            Trước {formatNumber(beforeQty)} → Còn {formatNumber(item.balance_after)} {unit}
          </Text>
          <Text style={[styles.badgeText, { color: theme.textMuted }]}>{getAuditLabel(item)}</Text>
        </View>

        <View style={styles.rowBetween}>
          <Text style={[styles.metaText, { color: theme.textMuted, flex: 1 }]}>
            {getActorRoleLabel(item.user_role)}: {item.user_name || 'Hệ thống'} ·{' '}
            {formatShortDate(item.movement_type === 'REVERSAL' ? item.created_at : item.occurred_at)}
          </Text>
          {canReverse ? (
            <Pressable
              onPress={() => onReverse(item)}
              accessibilityRole="button"
              accessibilityLabel={`Hoàn tác giao dịch ${item.id}`}
              android_ripple={{ color: theme.ripple }}
              style={({ pressed }) => [
                styles.reverseBtn,
                { backgroundColor: theme.warningSoft, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Ionicons name="arrow-undo-outline" size={16} color={theme.warning} />
              <Text style={[styles.reverseBtnText, { color: theme.text }]}>Hoàn tác</Text>
            </Pressable>
          ) : item.id < 0 ? (
            <StatusPill text="Chờ đồng bộ" tone="warning" />
          ) : null}
        </View>

        {item.is_reversed ? (
          <Text style={[styles.reversedLabel, { color: theme.warning }]}>Đã hoàn tác</Text>
        ) : item.note ? (
          <Text style={[styles.metaText, { color: theme.textMuted }]}>{item.note}</Text>
        ) : null}
      </View>
    );
  },
);

export function StocktakeScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isManager = user?.role === 'MANAGER';

  const [viewMode, setViewMode] = useState<AuditViewMode>('log');
  const [timeframe, setTimeframe] = useState<TimeframeKey>('ALL');
  const [actionFilter, setActionFilter] = useState<ActionFilterKey>('ALL');
  const [selectedProductFilter, setSelectedProductFilter] = useState<string>('ALL');
  const [notice, setNotice] = useState<string | null>(null);

  const daysParam = timeframe === 'ALL' ? undefined : Number(timeframe);
  const productIdParam =
    selectedProductFilter === 'ALL' ? undefined : Number(selectedProductFilter);

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => api.listProducts(),
  });

  const summaryQuery = useQuery({
    queryKey: ['movements-summary', timeframe],
    queryFn: () => api.getMovementsSummary(daysParam),
  });

  const movementsQuery = useQuery({
    queryKey: ['movements', 'audit', timeframe, actionFilter, selectedProductFilter],
    queryFn: () =>
      api.listMovements({
        product_id: productIdParam,
        days: daysParam,
        actor_role: actionFilter === 'STAFF_OUT' ? 'STAFF' : undefined,
        movement_type: actionFilter === 'OWNER_IN' ? 'IN_PURCHASE' : undefined,
        limit: 250,
      }),
    enabled: viewMode === 'log',
  });

  const summary = summaryQuery.data;
  const products = productsQuery.data || [];

  const productFilterChips = useMemo<ChipOption[]>(
    () => [
      { key: 'ALL', label: 'Tất cả SP' },
      ...products.map((p) => ({ key: String(p.id), label: p.name })),
    ],
    [products],
  );

  const filteredMovements = useMemo(() => {
    const raw = movementsQuery.data || [];
    if (actionFilter === 'STAFF_OUT') {
      return raw.filter(
        (m) => m.movement_type === 'OUT_CONSUMPTION' || m.movement_type === 'OUT_DAMAGE_EXPIRED',
      );
    }
    if (actionFilter === 'OTHER') {
      return raw.filter(
        (m) =>
          m.movement_type === 'REVERSAL' ||
          m.movement_type === 'PACK_BREAK' ||
          m.movement_type === 'ADJUST_STOCKTAKE',
      );
    }
    return raw;
  }, [movementsQuery.data, actionFilter]);

  const selectedProductSummary = useMemo(() => {
    if (selectedProductFilter === 'ALL' || !summary) return null;
    const pid = Number(selectedProductFilter);
    return summary.products.find((p) => p.product_id === pid) || null;
  }, [selectedProductFilter, summary]);

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['movements'] });
    void queryClient.invalidateQueries({ queryKey: ['movements-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['forecast-overview'] });
  }, [queryClient]);

  const handleReverse = useCallback(
    async (mv: StockMovement) => {
      const runReverse = async () => {
        try {
          await api.reverseMovement(mv.id, 'Đính chính thao tác nhập/xuất nhầm');
          await triggerSuccessHaptic();
          setNotice(`Đã hoàn tác giao dịch #${mv.id} (${mv.product_name || 'SP'}).`);
          refreshAll();
        } catch (err) {
          setNotice(err instanceof Error ? err.message : 'Không thể hoàn tác giao dịch.');
        }
      };

      if (Platform.OS === 'web') {
        void runReverse();
        return;
      }

      Alert.alert(
        'Xác nhận hoàn tác',
        `Hoàn lại ${formatNumber(Math.abs(mv.quantity_delta))} ${mv.product_unit || ''}?`,
        [
          { text: 'Hủy', style: 'cancel' },
          { text: 'Hoàn tác ngay', onPress: () => void runReverse() },
        ],
      );
    },
    [refreshAll],
  );

  const handleInspectProduct = useCallback((productId: number) => {
    setSelectedProductFilter(String(productId));
    setActionFilter('ALL');
    setViewMode('log');
  }, []);

  const renderMovementItem = useCallback(
    ({ item }: { item: StockMovement }) => (
      <AuditMovementCard
        item={item}
        isManager={isManager}
        onReverse={(mv) => void handleReverse(mv)}
      />
    ),
    [isManager, handleReverse],
  );

  const renderProductAuditItem = useCallback(
    ({ item }: { item: ProductAuditSummary }) => (
      <ProductAuditCard item={item} onInspectProduct={handleInspectProduct} />
    ),
    [handleInspectProduct],
  );

  const listHeader = useMemo(
    () => (
      <View style={styles.headerSections}>
        <View style={styles.kpiRow}>
          <View style={[styles.kpiCard, { backgroundColor: theme.surface, borderColor: theme.danger }]}>
            <Text style={[styles.kpiTitle, { color: theme.textMuted }]}>NV tiêu hao</Text>
            <Text style={[styles.kpiVal, { color: theme.danger }]}>
              -{formatNumber(summary?.staff_consumed_total ?? 0)}
            </Text>
            <Text style={[styles.metaText, { color: theme.textMuted }]}>
              {summary?.staff_consumed_events ?? 0} lượt
              {(summary?.manager_consumed_total ?? 0) > 0
                ? ` · Chủ xuất -${formatNumber(summary?.manager_consumed_total ?? 0)}`
                : ''}
            </Text>
          </View>

          <View style={[styles.kpiCard, { backgroundColor: theme.surface, borderColor: theme.primary }]}>
            <Text style={[styles.kpiTitle, { color: theme.textMuted }]}>Chủ đã nhập</Text>
            <Text style={[styles.kpiVal, { color: theme.primary }]}>
              +{formatNumber(summary?.owner_imported_total ?? 0)}
            </Text>
            <Text style={[styles.metaText, { color: theme.textMuted }]}>
              {summary?.owner_imported_events ?? 0} lượt
            </Text>
          </View>
        </View>

        {viewMode === 'log' ? (
          <View style={styles.filterBlock}>
            <ChipRow
              options={ACTION_FILTER_OPTIONS}
              selectedKey={actionFilter}
              onSelect={(k) => setActionFilter(k as ActionFilterKey)}
            />
            {products.length > 1 ? (
              <ChipRow
                options={productFilterChips}
                selectedKey={selectedProductFilter}
                onSelect={setSelectedProductFilter}
              />
            ) : null}

            {selectedProductSummary ? (
              <View
                style={[
                  styles.selectedProductCard,
                  { backgroundColor: theme.primarySoft, borderColor: theme.primary },
                ]}
              >
                <Text style={[styles.itemName, { color: theme.text }]}>
                  {selectedProductSummary.name}
                </Text>
                <Text style={[styles.subText, { color: theme.text }]}>
                  Nhập: +{formatNumber(selectedProductSummary.owner_imported_qty)} · NV tiêu: -
                  {formatNumber(selectedProductSummary.staff_consumed_qty)} · Còn:{' '}
                  {formatNumber(selectedProductSummary.current_stock)} {selectedProductSummary.unit}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    ),
    [
      theme,
      summary,
      viewMode,
      actionFilter,
      products.length,
      productFilterChips,
      selectedProductFilter,
      selectedProductSummary,
    ],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.topPanel, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <SegmentedToggle
          options={VIEW_MODE_OPTIONS}
          selectedKey={viewMode}
          onSelect={(k) => setViewMode(k as AuditViewMode)}
        />
        <ChipRow
          options={TIMEFRAME_OPTIONS}
          selectedKey={timeframe}
          onSelect={(k) => setTimeframe(k as TimeframeKey)}
        />
        {notice ? <Text style={[styles.noticeText, { color: theme.secondary }]}>{notice}</Text> : null}
      </View>

      {viewMode === 'log' ? (
        <FlatList
          data={filteredMovements}
          renderItem={renderMovementItem}
          keyExtractor={(item) => String(item.id)}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={movementsQuery.isRefetching || summaryQuery.isRefetching}
              onRefresh={refreshAll}
              tintColor={theme.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={[styles.subText, { color: theme.textMuted }]}>
                Chưa có lịch sử sửa đổi nào.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={summary?.products || []}
          renderItem={renderProductAuditItem}
          keyExtractor={(item) => String(item.product_id)}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={summaryQuery.isRefetching}
              onRefresh={refreshAll}
              tintColor={theme.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={[styles.subText, { color: theme.textMuted }]}>
                Kho chưa có mặt hàng nào.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topPanel: {
    padding: SPACING.md,
    borderBottomWidth: 1,
    gap: SPACING.xs,
  },
  noticeText: { fontSize: 13, fontWeight: '500' },
  listContent: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  headerSections: {
    gap: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  kpiCard: {
    flex: 1,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
    gap: 2,
  },
  kpiTitle: { fontSize: 12, fontWeight: '600' },
  kpiVal: { fontSize: 22, fontWeight: '700' },
  filterBlock: { gap: SPACING.xs },
  selectedProductCard: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: 2,
  },
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  itemName: { fontSize: 15, fontWeight: '600', flex: 1 },
  subText: { fontSize: 13 },
  metaText: { fontSize: 12 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  splitRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  auditStatBox: {
    flex: 1,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: 2,
  },
  auditStatLabel: { fontSize: 11, fontWeight: '600' },
  auditStatValue: { fontSize: 15, fontWeight: '700' },
  mathLine: { fontSize: 13, fontWeight: '600' },
  reversedLabel: { fontSize: 12, fontWeight: '600' },
  reverseBtn: {
    minHeight: TOUCH_MIN,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  reverseBtnText: { fontSize: 13, fontWeight: '600' },
  emptyBox: { padding: SPACING.xl, alignItems: 'center' },
});
