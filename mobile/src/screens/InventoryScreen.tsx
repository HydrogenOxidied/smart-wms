import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import {
  ActionButton,
  ChipOption,
  ChipRow,
  GaugeBar,
  StatusPill,
} from '../components/CommonUI';
import { QuickAddProductModal } from '../components/QuickAddProductModal';
import { api } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Product, StockMovement } from '../types/wms';
import { formatNumber, formatShortDate, triggerSuccessHaptic } from '../utils/formatters';

function getMovementLabel(item: StockMovement): string {
  switch (item.movement_type) {
    case 'IN_PURCHASE':
      return 'Chủ nhập kho (+)';
    case 'OUT_CONSUMPTION':
      return item.user_role === 'STAFF' ? 'NV tiêu hao (-)' : 'Tiêu hao (-)';
    case 'OUT_DAMAGE_EXPIRED':
      return 'Hỏng / Hủy (-)';
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

const ProductCard = React.memo(
  ({
    item,
    liteMode,
    onSelect,
    onBreakPack,
  }: {
    item: Product;
    liteMode: boolean;
    onSelect: (p: Product) => void;
    onBreakPack: (p: Product) => void;
  }) => {
    const theme = useTheme();
    const isLow = item.current_stock <= item.min_stock_level;
    const capRef = item.capacity_reference || Math.max(item.current_stock, 100);
    const gaugeRatio = item.tracking_type === 'CONSUMABLE' ? Math.min(1, item.current_stock / capRef) : 0;
    const looseQty =
      item.tracking_type === 'PACK_BREAK' && item.pack_conversion_rate > 1
        ? Math.max(0, item.current_stock - item.sealed_packs * item.pack_conversion_rate)
        : 0;

    return (
      <Pressable
        onPress={() => onSelect(item)}
        accessibilityRole="button"
        accessibilityLabel={`Xem chi tiết ${item.name}`}
        android_ripple={{ color: theme.ripple }}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: theme.surface,
            borderColor: isLow ? theme.danger : theme.border,
            opacity: pressed ? 0.9 : 1,
          },
        ]}
      >
        <View style={styles.rowBetween}>
          <View style={styles.flexOne}>
            <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={2}>
              {item.name}
            </Text>
            <Text style={[styles.itemMeta, { color: theme.textMuted }]}>
              {item.sku} · Tối thiểu: {formatNumber(item.min_stock_level)} {item.unit}
              {!liteMode && item.shelf_location ? ` · Kệ ${item.shelf_location}` : ''}
            </Text>
          </View>
          <StatusPill
            text={`${formatNumber(item.current_stock)} ${item.unit}`}
            tone={isLow ? 'danger' : 'primary'}
          />
        </View>

        {item.tracking_type === 'CONSUMABLE' ? (
          <View style={styles.gaugeSection}>
            <GaugeBar
              ratio={gaugeRatio}
              tone={isLow ? 'danger' : gaugeRatio < 0.35 ? 'warning' : 'primary'}
            />
            <Text style={[styles.subInfo, { color: theme.textMuted }]}>
              Ước lượng: ~{Math.round(gaugeRatio * 100)}% ({formatNumber(capRef)} {item.unit})
            </Text>
          </View>
        ) : null}

        {item.tracking_type === 'PACK_BREAK' && item.pack_unit ? (
          <View style={styles.packFooter}>
            <Text style={[styles.subInfo, { color: theme.secondary, flex: 1 }]}>
              {item.sealed_packs} {item.pack_unit} nguyên + {formatNumber(looseQty)} {item.unit} lẻ
            </Text>
            {item.sealed_packs > 0 ? (
              <Pressable
                onPress={() => onBreakPack(item)}
                accessibilityRole="button"
                accessibilityLabel={`Khui 1 ${item.pack_unit} ${item.name}`}
                android_ripple={{ color: theme.ripple }}
                style={({ pressed }) => [
                  styles.smallActionBtn,
                  { backgroundColor: theme.secondarySoft, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Text style={[styles.smallActionText, { color: theme.secondary }]}>
                  Khui 1 {item.pack_unit}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    );
  },
);

const LedgerRow = React.memo(({ item }: { item: StockMovement }) => {
  const theme = useTheme();
  const isPositive = item.quantity_delta > 0;
  const beforeQty =
    typeof item.balance_before === 'number'
      ? item.balance_before
      : Number((item.balance_after - item.quantity_delta).toFixed(3));
  return (
    <View style={[styles.ledgerRow, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
      <View style={styles.rowBetween}>
        <Text style={[styles.ledgerType, { color: theme.text }]}>{getMovementLabel(item)}</Text>
        <Text style={[styles.ledgerDelta, { color: isPositive ? theme.primary : theme.danger }]}>
          {isPositive ? `+${formatNumber(item.quantity_delta)}` : formatNumber(item.quantity_delta)}{' '}
          {item.product_unit || ''}
        </Text>
      </View>
      <Text style={[styles.subInfo, { color: theme.textMuted }]}>
        Trước: {formatNumber(beforeQty)} → Còn: {formatNumber(item.balance_after)} ·{' '}
        {formatShortDate(item.occurred_at)} · {item.user_name || 'Hệ thống'}
      </Text>
      {item.note ? (
        <Text style={[styles.subInfo, { color: theme.textMuted }]}>{item.note}</Text>
      ) : null}
    </View>
  );
});

export function InventoryScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const store = useAuthStore((s) => s.store);
  const openMovementForProduct = useUiStore((s) => s.openMovementForProduct);
  const isManager = user?.role === 'MANAGER';

  const [searchText, setSearchText] = useState('');
  const [filterKey, setFilterKey] = useState('ALL');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => api.listProducts(),
  });

  const detailLedgerQuery = useQuery({
    queryKey: ['product-ledger', selectedProduct?.id],
    queryFn: () => api.listMovements({ product_id: selectedProduct!.id, limit: 25 }),
    enabled: Boolean(selectedProduct),
  });

  const products = productsQuery.data || [];

  const filterOptions = useMemo<ChipOption[]>(() => {
    const lowCount = products.filter((p) => p.current_stock <= p.min_stock_level).length;
    const packCount = products.filter((p) => p.tracking_type === 'PACK_BREAK').length;
    const base: ChipOption[] = [
      { key: 'ALL', label: `Tất cả (${products.length})` },
      { key: 'LOW', label: `Sắp hết (${lowCount})` },
    ];
    if (packCount > 0) {
      base.push({ key: 'PACK_BREAK', label: `Thùng / Bịch (${packCount})` });
    }
    return base;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return products.filter((item) => {
      if (filterKey === 'LOW' && item.current_stock > item.min_stock_level) return false;
      if (filterKey === 'PACK_BREAK' && item.tracking_type !== 'PACK_BREAK') return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.barcode && item.barcode.includes(q))
      );
    });
  }, [products, searchText, filterKey]);

  const handleBreakPack = useCallback(
    async (prod: Product) => {
      try {
        await api.breakPack(prod.id, 1, `break-${Date.now()}-${prod.id}`);
        await triggerSuccessHaptic();
        setBannerMsg(
          `Đã khui 1 ${prod.pack_unit} "${prod.name}" (+${prod.pack_conversion_rate} ${prod.unit} lẻ).`,
        );
        void queryClient.invalidateQueries({ queryKey: ['products'] });
        void queryClient.invalidateQueries({ queryKey: ['movements'] });
        void queryClient.invalidateQueries({ queryKey: ['movements-summary'] });
      } catch (err) {
        setBannerMsg(err instanceof Error ? err.message : 'Không thể khui bao bì.');
      }
    },
    [queryClient],
  );

  const handleScanLookup = useCallback(
    (code: string) => {
      setScannerOpen(false);
      setSearchText(code);
      const found = products.find(
        (p) => p.barcode === code || p.sku.toUpperCase() === code.toUpperCase(),
      );
      if (found) {
        setConfirmDelete(false);
        setSelectedProduct(found);
      } else {
        setBannerMsg(`Không tìm thấy mã "${code}". Bấm "+ Thêm mặt hàng" để tạo mới.`);
      }
    },
    [products],
  );

  const handleDeleteProduct = useCallback(async () => {
    if (!selectedProduct) return;
    setDeleting(true);
    try {
      await api.deleteProduct(selectedProduct.id);
      await triggerSuccessHaptic();
      const deletedName = selectedProduct.name;
      setConfirmDelete(false);
      setSelectedProduct(null);
      setBannerMsg(`Đã xóa "${deletedName}" khỏi kho.`);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['forecast-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['movements'] });
      void queryClient.invalidateQueries({ queryKey: ['movements-summary'] });
    } catch (err) {
      setBannerMsg(err instanceof Error ? err.message : 'Không thể xóa mặt hàng.');
    } finally {
      setDeleting(false);
    }
  }, [selectedProduct, queryClient]);

  const renderProduct = useCallback(
    ({ item }: { item: Product }) => (
      <ProductCard
        item={item}
        liteMode={Boolean(store?.lite_mode)}
        onSelect={(p) => {
          setConfirmDelete(false);
          setSelectedProduct(p);
        }}
        onBreakPack={(p) => void handleBreakPack(p)}
      />
    ),
    [store?.lite_mode, handleBreakPack],
  );

  const productKey = useCallback((item: Product) => String(item.id), []);
  const renderLedger = useCallback(
    ({ item }: { item: StockMovement }) => <LedgerRow item={item} />,
    [],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.searchBarWrap, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <View style={styles.searchRow}>
          <View
            style={[
              styles.searchBox,
              { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
            ]}
          >
            <Ionicons name="search-outline" size={18} color={theme.textMuted} />
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Tìm tên, SKU hoặc mã vạch..."
              placeholderTextColor={theme.textMuted}
              style={[styles.searchInput, { color: theme.text }]}
            />
          </View>
          <Pressable
            onPress={() => setScannerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Quét mã vạch tìm sản phẩm"
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => [
              styles.scanIconBtn,
              { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="barcode-outline" size={22} color={theme.primaryTextOn} />
          </Pressable>
        </View>
        <ChipRow options={filterOptions} selectedKey={filterKey} onSelect={setFilterKey} />
        {bannerMsg ? (
          <Text style={[styles.bannerText, { color: theme.secondary }]}>{bannerMsg}</Text>
        ) : null}
      </View>

      <FlatList
        data={filteredProducts}
        renderItem={renderProduct}
        keyExtractor={productKey}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={productsQuery.isRefetching}
            onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['products'] })}
            tintColor={theme.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Ionicons name="cube-outline" size={32} color={theme.textMuted} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {products.length === 0 ? 'Kho chưa có mặt hàng nào' : 'Không tìm thấy mặt hàng'}
            </Text>
            <Text style={[styles.subInfo, { color: theme.textMuted }]}>
              {products.length === 0
                ? 'Nhấn nút "+ Thêm mặt hàng" bên dưới để bắt đầu.'
                : 'Thử từ khóa khác hoặc chọn bộ lọc Tất cả.'}
            </Text>
          </View>
        }
      />

      <Pressable
        onPress={() => setQuickAddOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Thêm mặt hàng mới"
        android_ripple={{ color: theme.ripple }}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: theme.primary, opacity: pressed ? 0.88 : 1 },
        ]}
      >
        <Ionicons name="add" size={22} color={theme.primaryTextOn} />
        <Text style={[styles.fabText, { color: theme.primaryTextOn }]}>Thêm mặt hàng</Text>
      </Pressable>

      <BarcodeScannerModal
        visible={scannerOpen}
        title="Quét mã tìm sản phẩm"
        onScan={handleScanLookup}
        onClose={() => setScannerOpen(false)}
      />

      <QuickAddProductModal
        visible={quickAddOpen}
        liteMode={Boolean(store?.lite_mode)}
        onClose={() => setQuickAddOpen(false)}
        onCreated={(prod) => {
          setQuickAddOpen(false);
          setBannerMsg(`Đã thêm "${prod.name}" (${prod.sku}).`);
          void queryClient.invalidateQueries({ queryKey: ['products'] });
          void queryClient.invalidateQueries({ queryKey: ['forecast-overview'] });
          void queryClient.invalidateQueries({ queryKey: ['movements'] });
          void queryClient.invalidateQueries({ queryKey: ['movements-summary'] });
        }}
      />

      <Modal
        visible={Boolean(selectedProduct)}
        animationType="slide"
        onRequestClose={() => {
          setConfirmDelete(false);
          setSelectedProduct(null);
        }}
      >
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
          <View style={[styles.modalHeaderWrap, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
            <View style={styles.modalHeaderInner}>
              <View style={styles.flexOne}>
                <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
                  {selectedProduct?.name}
                </Text>
                <Text style={[styles.itemMeta, { color: theme.textMuted }]}>
                  {selectedProduct?.sku} · Barcode: {selectedProduct?.barcode}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setConfirmDelete(false);
                  setSelectedProduct(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Đóng chi tiết sản phẩm"
                android_ripple={{ color: theme.ripple }}
                style={({ pressed }) => [
                  styles.scanIconBtn,
                  { backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Ionicons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>
          </View>

          {selectedProduct ? (
            <View style={styles.detailWrap}>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.subInfo, { color: theme.textMuted }]}>Tồn hiện tại</Text>
                  <Text style={[styles.bigStock, { color: theme.primary }]}>
                    {formatNumber(selectedProduct.current_stock)} {selectedProduct.unit}
                  </Text>
                </View>
                <Text style={[styles.subInfo, { color: theme.textMuted }]}>
                  Tối thiểu: {formatNumber(selectedProduct.min_stock_level)} {selectedProduct.unit} · Kệ:{' '}
                  {selectedProduct.shelf_location || '—'} · NCC: {selectedProduct.supplier_name || '—'}
                </Text>
                <ActionButton
                  label="Xuất / Nhập mặt hàng này →"
                  icon="swap-vertical-outline"
                  onPress={() => {
                    const pid = selectedProduct.id;
                    setConfirmDelete(false);
                    setSelectedProduct(null);
                    openMovementForProduct(pid);
                  }}
                />
                {isManager ? (
                  confirmDelete ? (
                    <View
                      style={[
                        styles.confirmBox,
                        { backgroundColor: theme.dangerSoft, borderColor: theme.danger },
                      ]}
                    >
                      <Text style={[styles.subInfo, { color: theme.text }]}>
                        Xóa "{selectedProduct.name}" khỏi danh sách kho?
                      </Text>
                      <View style={styles.confirmRow}>
                        <ActionButton
                          label="Hủy"
                          variant="outline"
                          style={styles.flexOne}
                          onPress={() => setConfirmDelete(false)}
                        />
                        <ActionButton
                          label="Xác nhận xóa"
                          icon="trash-outline"
                          variant="danger"
                          style={styles.flexOne}
                          loading={deleting}
                          onPress={() => void handleDeleteProduct()}
                        />
                      </View>
                    </View>
                  ) : (
                    <ActionButton
                      label="Xóa mặt hàng"
                      icon="trash-outline"
                      variant="danger"
                      onPress={() => setConfirmDelete(true)}
                    />
                  )
                ) : null}
              </View>

              <Text style={[styles.ledgerHeader, { color: theme.text }]}>Lịch sử gần nhất</Text>
              <FlatList
                data={detailLedgerQuery.data || []}
                renderItem={renderLedger}
                keyExtractor={(m) => String(m.id)}
                contentContainerStyle={styles.ledgerList}
                ListEmptyComponent={
                  <Text style={[styles.subInfo, { color: theme.textMuted }]}>
                    Chưa có giao dịch nào.
                  </Text>
                }
              />
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flexOne: { flex: 1 },
  searchBarWrap: {
    padding: SPACING.md,
    borderBottomWidth: 1,
    gap: SPACING.sm,
  },
  searchRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
  },
  searchBox: {
    flex: 1,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: TOUCH_MIN,
    fontSize: 15,
  },
  scanIconBtn: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerText: { fontSize: 13, fontWeight: '500' },
  listContent: {
    padding: SPACING.lg,
    gap: SPACING.md,
    paddingBottom: 96,
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
  itemName: { fontSize: 15, fontWeight: '600' },
  itemMeta: { fontSize: 12, marginTop: 2 },
  gaugeSection: { gap: SPACING.xs, marginTop: SPACING.xs },
  packFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  smallActionBtn: {
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallActionText: { fontSize: 13, fontWeight: '600' },
  subInfo: { fontSize: 13 },
  emptyBox: {
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    gap: SPACING.xs,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginTop: SPACING.xs },
  fab: {
    position: 'absolute',
    right: SPACING.lg,
    bottom: SPACING.lg,
    minHeight: 52,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    elevation: 4,
  },
  fabText: { fontSize: 14, fontWeight: '700' },
  modalHeaderWrap: {
    borderBottomWidth: 1,
  },
  modalHeaderInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
    gap: SPACING.md,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  detailWrap: {
    flex: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  bigStock: { fontSize: 22, fontWeight: '700' },
  ledgerHeader: { fontSize: 14, fontWeight: '600' },
  ledgerList: { gap: SPACING.sm },
  ledgerRow: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  ledgerType: { fontSize: 13, fontWeight: '600' },
  ledgerDelta: { fontSize: 15, fontWeight: '700' },
  confirmBox: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
});
