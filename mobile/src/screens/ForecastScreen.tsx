import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { ActionButton, GaugeBar, StatusPill } from '../components/CommonUI';
import { api } from '../services/apiClient';
import { useUiStore } from '../store/uiStore';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ProductForecast } from '../types/wms';
import { formatCurrencyVnd, formatNumber, triggerSuccessHaptic } from '../utils/formatters';

interface TrendRow {
  key: string;
  date: string;
  qty: number;
  kind: 'HISTORY' | 'FORECAST';
}

function getTierLabel(tier: ProductForecast['algorithm_tier']): string {
  switch (tier) {
    case 'HOLT_WINTERS':
      return 'Theo mùa';
    case 'EWMA_WEEKLY':
      return 'Xu hướng tuần';
    default:
      return 'Mới tạo';
  }
}

const ForecastCard = React.memo(
  ({
    item,
    onSelect,
  }: {
    item: ProductForecast;
    onSelect: (f: ProductForecast) => void;
  }) => {
    const theme = useTheme();
    const statusTone =
      item.status === 'CRITICAL'
        ? 'danger'
        : item.status === 'REORDER_SOON'
          ? 'warning'
          : 'primary';
    const statusText =
      item.status === 'CRITICAL'
        ? 'Khẩn cấp'
        : item.status === 'REORDER_SOON'
          ? 'Sắp chạm ROP'
          : 'An toàn';

    const ropRatio = item.reorder_point > 0 ? Math.min(1, item.current_stock / item.reorder_point) : 1;

    return (
      <Pressable
        onPress={() => onSelect(item)}
        accessibilityRole="button"
        accessibilityLabel={`Xem chi tiết dự báo ${item.name}`}
        android_ripple={{ color: theme.ripple }}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: theme.surface,
            borderColor: item.status === 'CRITICAL' ? theme.danger : theme.border,
            opacity: pressed ? 0.88 : 1,
          },
        ]}
      >
        <View style={styles.rowBetween}>
          <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={2}>
            {item.name}
          </Text>
          <StatusPill text={statusText} tone={statusTone} />
        </View>

        <View style={styles.badgeLine}>
          <StatusPill text={getTierLabel(item.algorithm_tier)} tone="secondary" />
          <Text style={[styles.subText, { color: theme.textMuted }]}>
            TB {item.avg_daily_demand} {item.unit}/ngày
          </Text>
        </View>

        <GaugeBar
          ratio={ropRatio}
          tone={item.status === 'CRITICAL' ? 'danger' : item.status === 'REORDER_SOON' ? 'warning' : 'primary'}
        />

        <View style={styles.rowBetween}>
          <Text style={[styles.subText, { color: theme.textMuted }]}>
            Tồn: {formatNumber(item.current_stock)} / ROP: {formatNumber(item.reorder_point)} {item.unit}
          </Text>
          <Text style={[styles.subText, { color: theme.text }]}>
            Còn:{' '}
            {item.days_until_stockout !== null ? `${item.days_until_stockout} ngày` : 'Chưa ước tính'}
          </Text>
        </View>

        {item.recommended_order_qty > 0 ? (
          <Text style={[styles.suggestText, { color: theme.primary }]}>
            Gợi ý nhập: {formatNumber(item.recommended_order_qty)} {item.unit} (
            {formatCurrencyVnd(item.estimated_order_cost)})
          </Text>
        ) : null}
      </Pressable>
    );
  },
);

const TrendPointRow = React.memo(
  ({
    row,
    maxQty,
    unit,
  }: {
    row: TrendRow;
    maxQty: number;
    unit: string;
  }) => {
    const theme = useTheme();
    const ratio = maxQty > 0 ? row.qty / maxQty : 0;
    return (
      <View style={styles.trendRow}>
        <Text style={[styles.trendDate, { color: theme.textMuted }]}>{row.date.slice(5)}</Text>
        <View style={styles.flexOne}>
          <GaugeBar
            ratio={ratio}
            tone={row.kind === 'FORECAST' ? 'primary' : 'secondary'}
          />
        </View>
        <Text style={[styles.trendVal, { color: theme.text }]}>
          {row.qty.toFixed(1)} {unit}
        </Text>
      </View>
    );
  },
);

export function ForecastScreen() {
  const theme = useTheme();
  const focusedId = useUiStore((s) => s.focusedForecastProductId);
  const openForecastForProduct = useUiStore((s) => s.openForecastForProduct);
  const [selectedForecast, setSelectedForecast] = useState<ProductForecast | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const overviewQuery = useQuery({
    queryKey: ['forecast-overview'],
    queryFn: api.getForecastOverview,
  });

  useEffect(() => {
    if (!focusedId || !overviewQuery.data) return;
    const match = overviewQuery.data.items.find((i) => i.product_id === focusedId);
    if (match) {
      setSelectedForecast(match);
    }
  }, [focusedId, overviewQuery.data]);

  const handleCloseDetail = useCallback(() => {
    setSelectedForecast(null);
    if (focusedId) {
      openForecastForProduct(0);
    }
  }, [focusedId, openForecastForProduct]);

  const handleExportPo = useCallback(async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const csvText = await api.exportDraftPoCsvText();
      if (Platform.OS === 'web') {
        const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'draft-purchase-order.csv';
        anchor.click();
        URL.revokeObjectURL(url);
        setExportMsg('Đã tải xuống file draft-purchase-order.csv.');
      } else {
        const target = new File(Paths.cache, 'draft-purchase-order.csv');
        target.create({ overwrite: true });
        target.write(csvText);
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(target.uri, {
            mimeType: 'text/csv',
            dialogTitle: 'Chia sẻ Phiếu đề xuất nhập hàng (Draft PO)',
          });
        } else {
          await Share.share({ title: 'Draft PO CSV', message: csvText });
        }
        setExportMsg('Đã xuất và chia sẻ Phiếu đề xuất nhập hàng.');
      }
      await triggerSuccessHaptic();
    } catch (err) {
      setExportMsg(err instanceof Error ? err.message : 'Không thể xuất file Draft PO.');
    } finally {
      setExporting(false);
    }
  }, []);

  const trendRows = useMemo<TrendRow[]>(() => {
    if (!selectedForecast) return [];
    const recentHist = selectedForecast.history_series.slice(-7).map((p) => ({
      key: `h-${p.date}`,
      date: p.date,
      qty: p.qty,
      kind: 'HISTORY' as const,
    }));
    const future = selectedForecast.forecast_series.slice(0, 10).map((p) => ({
      key: `f-${p.date}`,
      date: p.date,
      qty: p.qty,
      kind: 'FORECAST' as const,
    }));
    return [...recentHist, ...future];
  }, [selectedForecast]);

  const maxTrendQty = useMemo(
    () => Math.max(1, ...trendRows.map((r) => r.qty)),
    [trendRows],
  );

  const renderForecastItem = useCallback(
    ({ item }: { item: ProductForecast }) => (
      <ForecastCard item={item} onSelect={setSelectedForecast} />
    ),
    [],
  );

  const renderTrendRow = useCallback(
    ({ item }: { item: TrendRow }) => (
      <TrendPointRow row={item} maxQty={maxTrendQty} unit={selectedForecast?.unit || ''} />
    ),
    [maxTrendQty, selectedForecast?.unit],
  );

  const overview = overviewQuery.data;

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <FlatList
        data={overview?.items || []}
        renderItem={renderForecastItem}
        keyExtractor={(item) => String(item.product_id)}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={overviewQuery.isRefetching}
            onRefresh={() => void overviewQuery.refetch()}
            tintColor={theme.primary}
          />
        }
        ListHeaderComponent={
          <View style={[styles.card, styles.headerGap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>
              Dự báo nhu cầu & Đặt hàng
            </Text>
            <View style={styles.summaryRow}>
              <StatusPill text={`Khẩn cấp: ${overview?.critical_count ?? 0}`} tone="danger" />
              <StatusPill text={`Sắp đặt: ${overview?.reorder_soon_count ?? 0}`} tone="warning" />
              <StatusPill text={`An toàn: ${overview?.healthy_count ?? 0}`} tone="primary" />
            </View>
            <Text style={[styles.poCost, { color: theme.text }]}>
              Dự toán nhập: {formatCurrencyVnd(overview?.total_suggested_po_cost ?? 0)}
            </Text>
            {exportMsg ? (
              <Text style={[styles.subText, { color: theme.secondary }]}>{exportMsg}</Text>
            ) : null}
            <ActionButton
              label="Xuất phiếu đề xuất (CSV)"
              icon="download-outline"
              loading={exporting}
              disabled={!overview || overview.items.length === 0}
              onPress={() => void handleExportPo()}
            />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={[styles.subText, { color: theme.textMuted }]}>
              Chưa có dữ liệu mặt hàng để dự báo.
            </Text>
          </View>
        }
      />

      <Modal
        visible={Boolean(selectedForecast)}
        animationType="slide"
        onRequestClose={handleCloseDetail}
      >
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
          <View style={[styles.modalHeaderWrap, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
            <View style={styles.modalHeaderInner}>
              <View style={styles.flexOne}>
                <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
                  {selectedForecast?.name}
                </Text>
                <Text style={[styles.subText, { color: theme.textMuted }]}>
                  {selectedForecast ? getTierLabel(selectedForecast.algorithm_tier) : ''} ·{' '}
                  {selectedForecast?.history_days} ngày dữ liệu
                </Text>
              </View>
              <Pressable
                onPress={handleCloseDetail}
                accessibilityRole="button"
                accessibilityLabel="Đóng chi tiết dự báo"
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

          {selectedForecast ? (
            <FlatList
              data={trendRows}
              renderItem={renderTrendRow}
              keyExtractor={(r) => r.key}
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={
                <View style={[styles.card, styles.headerGap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Text style={[styles.itemName, { color: theme.text }]}>
                    Thông số Tính toán Tồn kho An toàn & ROP (Mức phục vụ 95%)
                  </Text>
                  <Text style={[styles.subText, { color: theme.textMuted }]}>
                    Nhu cầu TB/ngày: {selectedForecast.avg_daily_demand} {selectedForecast.unit} · Độ lệch chuẩn: {selectedForecast.demand_std}
                  </Text>
                  <Text style={[styles.subText, { color: theme.textMuted }]}>
                    Safety Stock: {selectedForecast.safety_stock} {selectedForecast.unit} · Điểm đặt hàng (ROP): {selectedForecast.reorder_point} {selectedForecast.unit}
                  </Text>
                  <Text style={[styles.subText, { color: theme.textMuted }]}>
                    Lead Time NCC: {selectedForecast.lead_time_days} ngày · Sai số Backtest: MAE{' '}
                    {selectedForecast.mae ?? 'N/A'} | MAPE{' '}
                    {selectedForecast.mape !== null ? `${selectedForecast.mape}%` : 'N/A'}
                  </Text>
                  <Text style={[styles.suggestText, { color: theme.primary }]}>
                    Đề xuất nhập: {formatNumber(selectedForecast.recommended_order_qty)} {selectedForecast.unit} (
                    {formatCurrencyVnd(selectedForecast.estimated_order_cost)})
                  </Text>
                  <View style={styles.summaryRow}>
                    <StatusPill text="Xanh dương: Lịch sử 7 ngày" tone="secondary" />
                    <StatusPill text="Xanh ngọc: Dự báo 10 ngày" tone="primary" />
                  </View>
                </View>
              }
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flexOne: { flex: 1 },
  listContent: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  headerGap: {
    marginBottom: SPACING.xs,
  },
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  badgeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  itemName: { fontSize: 15, fontWeight: '600', flex: 1 },
  subText: { fontSize: 13, lineHeight: 19 },
  poCost: { fontSize: 15, fontWeight: '600' },
  suggestText: { fontSize: 14, fontWeight: '600' },
  modalHeaderWrap: {
    borderBottomWidth: 1,
  },
  modalHeaderInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    gap: SPACING.md,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  emptyBox: {
    padding: SPACING.xl,
    alignItems: 'center',
  },
  closeBtn: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  trendDate: {
    fontSize: 12,
    minWidth: 46,
  },
  trendVal: {
    fontSize: 12,
    fontWeight: '600',
    minWidth: 68,
    textAlign: 'right',
  },
});
