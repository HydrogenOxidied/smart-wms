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
import { ChipOption, ChipRow, StatusPill } from '../components/CommonUI';
import { api } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ProductAuditSummary, StockMovement } from '../types/wms';
import {
  formatNumber,
  formatShortDate,
  triggerLightHaptic,
  triggerSuccessHaptic,
} from '../utils/formatters';

type AuditViewMode = 'log' | 'by_product';
type TimeframeKey = 'ALL' | '1' | '7' | '30';
type ActionFilterKey = 'ALL' | 'STAFF_OUT' | 'OWNER_IN' | 'ALL_OUT' | 'OTHER';

const VIEW_MODE_OPTIONS: ChipOption[] = [
  { key: 'log', label: 'Nhật ký chi tiết' },
  { key: 'by_product', label: 'Tổng hợp từng mặt hàng' },
];

const TIMEFRAME_OPTIONS: ChipOption[] = [
  { key: 'ALL', label: 'Toàn bộ' },
  { key: '1', label: 'Hôm nay' },
  { key: '7', label: '7 ngày' },
  { key: '30', label: '30 ngày' },
];

const ACTION_FILTER_OPTIONS: ChipOption[] = [
  { key: 'ALL', label: 'Tất cả sửa đổi' },
  { key: 'STAFF_OUT', label: 'Nhân viên tiêu hao (-)' },
  { key: 'OWNER_IN', label: 'Chủ đã nhập (+)' },
  { key: 'ALL_OUT', label: 'Tất cả xuất/hỏng (-)' },
  { key: 'OTHER', label: 'Hoàn tác / Khác' },
];

function getAuditBadge(item: StockMovement): {
  label: string;
  tone: 'primary' | 'secondary' | 'warning' | 'danger';
} {
  switch (item.movement_type) {
    case 'IN_PURCHASE':
      return { label: 'Chủ nhập thêm (+)', tone: 'primary' };
    case 'OUT_CONSUMPTION':
      return {
        label: item.user_role === 'STAFF' ? 'Nhân viên tiêu hao (-)' : 'Chủ xuất tiêu hao (-)',
        tone: 'secondary',
      };
    case 'OUT_DAMAGE_EXPIRED':
      return { label: 'Báo hỏng / Hủy (-)', tone: 'danger' };
    case 'REVERSAL':
      return { label: 'Hoàn tác đính chính', tone: 'warning' };
    case 'PACK_BREAK':
      return { label: 'Khui thùng / Xé lẻ', tone: 'secondary' };
    case 'ADJUST_STOCKTAKE':
      return { label: 'Cân bằng kiểm kê', tone: 'secondary' };
    default:
      return { label: item.movement_type, tone: 'secondary' };
  }
}

function getActorRoleLabel(role?: string | null): string {
  if (role === 'MANAGER') return 'Chủ kho';
  if (role === 'STAFF') return 'Nhân viên';
  return 'Hệ thống';
}

function isWithinReversalWindow(createdAt: string): boolean {
  const normalized = createdAt.endsWith('Z') ? createdAt : `${createdAt}Z`;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return true;
  const elapsedMinutes = (Date.now() - parsed) / 60000;
  return elapsedMinutes <= 16;
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
          <View style={styles.flexOne}>
            <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={[styles.metaText, { color: theme.textMuted }]}>SKU: {item.sku}</Text>
          </View>
          <StatusPill text={`Tồn: ${formatNumber(item.current_stock)} ${item.unit}`} tone="secondary" />
        </View>

        <View style={styles.splitRow}>
          <View style={[styles.auditStatBox, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
            <Text style={[styles.auditStatLabel, { color: theme.textMuted }]}>Nhân viên tiêu hao</Text>
            <Text style={[styles.auditStatValue, { color: theme.danger }]}>
              -{formatNumber(item.staff_consumed_qty)} {item.unit}
            </Text>
            <Text style={[styles.metaText, { color: theme.textMuted }]}>
              {item.staff_consumed_count} lần xuất
              {item.manager_consumed_qty > 0
                ? ` · Chủ xuất: -${formatNumber(item.manager_consumed_qty)} ${item.unit}`
                : ''}
            </Text>
          </View>

          <View style={[styles.auditStatBox, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}>
            <Text style={[styles.auditStatLabel, { color: theme.textMuted }]}>Chủ đã nhập thêm</Text>
            <Text style={[styles.auditStatValue, { color: theme.primary }]}>
              +{formatNumber(item.owner_imported_qty)} {item.unit}
            </Text>
            <Text style={[styles.metaText, { color: theme.textMuted }]}>
              {item.owner_imported_count} lần nhập
            </Text>
          </View>
        </View>

        <Text style={[styles.linkHint, { color: theme.primary }]}>
          {item.last_modified_at
            ? `Sửa gần nhất: ${formatShortDate(item.last_modified_at)} · Chạm để xem lịch sử →`
            : 'Chạm để lọc nhật ký của mặt hàng này →'}
        </Text>
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
    const badge = getAuditBadge(item);
    const isReversibleType =
      item.movement_type === 'OUT_CONSUMPTION' ||
      item.movement_type === 'OUT_DAMAGE_EXPIRED' ||
      item.movement_type === 'IN_PURCHASE';
    const canReverse =
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
      ? `+${formatNumber(item.quantity_delta)}`
      : formatNumber(item.quantity_delta);

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
            {item.product_name || `Sản phẩm #${item.product_id}`}
          </Text>
          <StatusPill text={badge.label} tone={badge.tone} />
        </View>

        <View style={[styles.mathBox, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
          <Text style={[styles.mathLine, { color: theme.text }]}>
            Trước: {formatNumber(beforeQty)} {unit}{'  →  '}
            <Text style={{ color: isPositive ? theme.primary : theme.danger }}>
              {deltaLabel} {unit}
            </Text>
            {'  →  '}Còn: {formatNumber(item.balance_after)} {unit}
          </Text>
          {item.unit_entered && item.unit_entered !== unit && item.quantity_entered ? (
            <Text style={[styles.metaText, { color: theme.textMuted }]}>
              (Đơn vị thao tác: {formatNumber(item.quantity_entered)} {item.unit_entered})
            </Text>
          ) : null}
        </View>

        <View style={styles.actorRow}>
          <Ionicons
            name={item.user_role === 'MANAGER' ? 'shield-checkmark-outline' : 'person-outline'}
            size={16}
            color={item.user_role === 'MANAGER' ? theme.primary : theme.secondary}
          />
          <Text style={[styles.subText, { color: theme.textMuted, flex: 1 }]}>
            {getActorRoleLabel(item.user_role)}: {item.user_name || 'Hệ thống'}
            {item.user_username ? ` (@${item.user_username})` : ''} · {formatShortDate(item.occurred_at)}
          </Text>
        </View>

        {item.note ? (
          <Text style={[styles.noteText, { color: theme.textMuted }]}>Ghi chú: {item.note}</Text>
        ) : null}

        {item.is_reversed ? (
          <Text style={[styles.reversedLabel, { color: theme.warning }]}>
            Đã hoàn tác đính chính (Không tính vào tổng tiêu hao / nhập hàng)
          </Text>
        ) : canReverse ? (
          <Pressable
            onPress={() => onReverse(item)}
            accessibilityRole="button"
            accessibilityLabel={`Đính chính hoàn tác giao dịch ${item.id}`}
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => [
              styles.reverseBtn,
              { backgroundColor: theme.warningSoft, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Ionicons name="arrow-undo-outline" size={18} color={theme.warning} />
            <Text style={[styles.reverseBtnText, { color: theme.text }]}>
              {isManager ? 'Đính chính / Hoàn tác' : 'Đính chính (Hoàn tác 15p)'}
            </Text>
          </Pressable>
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
      { key: 'ALL', label: 'Tất cả mặt hàng' },
      ...products.map((p) => ({ key: String(p.id), label: p.name })),
    ],
    [products],
  );

  const filteredMovements = useMemo(() => {
    const raw = movementsQuery.data || [];
    if (actionFilter === 'STAFF_OUT' || actionFilter === 'ALL_OUT') {
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
          setNotice(
            `Đã hoàn tác giao dịch #${mv.id} (${mv.product_name || 'SP'}) bằng bút toán REVERSAL.`,
          );
          refreshAll();
        } catch (err) {
          setNotice(err instanceof Error ? err.message : 'Không thể hoàn tác giao dịch này.');
        }
      };

      if (Platform.OS === 'web') {
        void runReverse();
        return;
      }

      Alert.alert(
        'Xác nhận hoàn tác / đính chính',
        `Tạo bút toán bù trừ hoàn lại ${formatNumber(Math.abs(mv.quantity_delta))} ${mv.product_unit || ''}?`,
        [
          { text: 'Hủy', style: 'cancel' },
          { text: 'Đính chính ngay', onPress: () => void runReverse() },
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
            <Text style={[styles.kpiTitle, { color: theme.textMuted }]}>Nhân viên đã tiêu hao</Text>
            <Text style={[styles.kpiVal, { color: theme.danger }]}>
              -{formatNumber(summary?.staff_consumed_total ?? 0)}
            </Text>
            <Text style={[styles.metaText, { color: theme.textMuted }]}>
              {summary?.staff_consumed_events ?? 0} lượt xuất bởi Nhân viên
              {(summary?.manager_consumed_total ?? 0) > 0
                ? ` · Chủ xuất: -${formatNumber(summary?.manager_consumed_total ?? 0)}`
                : ''}
            </Text>
          </View>

          <View style={[styles.kpiCard, { backgroundColor: theme.surface, borderColor: theme.primary }]}>
            <Text style={[styles.kpiTitle, { color: theme.textMuted }]}>Chủ shop đã nhập</Text>
            <Text style={[styles.kpiVal, { color: theme.primary }]}>
              +{formatNumber(summary?.owner_imported_total ?? 0)}
            </Text>
            <Text style={[styles.metaText, { color: theme.textMuted }]}>
              {summary?.owner_imported_events ?? 0} lượt nhập kho
            </Text>
          </View>
        </View>

        {viewMode === 'log' ? (
          <View style={styles.filterBlock}>
            <Text style={[styles.filterHeading, { color: theme.textMuted }]}>
              Lọc theo loại biến động:
            </Text>
            <ChipRow
              options={ACTION_FILTER_OPTIONS}
              selectedKey={actionFilter}
              onSelect={(k) => setActionFilter(k as ActionFilterKey)}
            />

            <Text style={[styles.filterHeading, { color: theme.textMuted }]}>
              Lọc theo mặt hàng:
            </Text>
            <ChipRow
              options={productFilterChips}
              selectedKey={selectedProductFilter}
              onSelect={setSelectedProductFilter}
            />

            {selectedProductSummary ? (
              <View
                style={[
                  styles.selectedProductCard,
                  { backgroundColor: theme.primarySoft, borderColor: theme.primary },
                ]}
              >
                <Text style={[styles.itemName, { color: theme.text }]}>
                  Đối soát: {selectedProductSummary.name}
                </Text>
                <Text style={[styles.subText, { color: theme.text }]}>
                  Chủ đã nhập: +{formatNumber(selectedProductSummary.owner_imported_qty)}{' '}
                  {selectedProductSummary.unit} · Nhân viên tiêu hao: -
                  {formatNumber(selectedProductSummary.staff_consumed_qty)} {selectedProductSummary.unit}{' '}
                  · Tồn hiện tại: {formatNumber(selectedProductSummary.current_stock)}{' '}
                  {selectedProductSummary.unit}
                </Text>
              </View>
            ) : null}

            <Text style={[styles.sectionSub, { color: theme.textMuted }]}>
              Nhật ký sửa đổi ({filteredMovements.length} bản ghi):
            </Text>
          </View>
        ) : (
          <Text style={[styles.sectionSub, { color: theme.textMuted }]}>
            Tổng hợp theo từng mặt hàng ({summary?.products.length ?? 0} SP):
          </Text>
        )}
      </View>
    ),
    [
      theme,
      summary,
      viewMode,
      actionFilter,
      productFilterChips,
      selectedProductFilter,
      selectedProductSummary,
      filteredMovements.length,
    ],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.topPanel, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          Kiểm kê & Lịch sử sửa đổi kho
        </Text>
        <ChipRow
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
                Chưa có lịch sử sửa đổi khớp bộ lọc.
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
  flexOne: { flex: 1 },
  topPanel: {
    padding: SPACING.md,
    borderBottomWidth: 1,
    gap: SPACING.sm,
  },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  noticeText: { fontSize: 13, fontWeight: '500' },
  listContent: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  headerSections: {
    gap: SPACING.md,
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
    gap: SPACING.xs,
  },
  kpiTitle: { fontSize: 12, fontWeight: '600' },
  kpiVal: { fontSize: 22, fontWeight: '700' },
  filterBlock: { gap: SPACING.xs },
  filterHeading: { fontSize: 12, fontWeight: '600', marginTop: SPACING.xs },
  selectedProductCard: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  sectionSub: { fontSize: 13, fontWeight: '600', marginTop: SPACING.xs },
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
  subText: { fontSize: 13, lineHeight: 19 },
  metaText: { fontSize: 12, lineHeight: 17 },
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
  auditStatValue: { fontSize: 16, fontWeight: '700' },
  linkHint: { fontSize: 12, fontWeight: '600' },
  mathBox: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: 2,
  },
  mathLine: { fontSize: 14, fontWeight: '600' },
  actorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  noteText: { fontSize: 12, fontStyle: 'italic' },
  reversedLabel: { fontSize: 12, fontWeight: '600' },
  reverseBtn: {
    minHeight: TOUCH_MIN,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    alignSelf: 'flex-start',
  },
  reverseBtnText: { fontSize: 13, fontWeight: '600' },
  emptyBox: { padding: SPACING.xl, alignItems: 'center' },
});
