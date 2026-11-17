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
import { api, isOfflineNetworkError } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { useOfflineQueueStore } from '../store/offlineQueueStore';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Product, StockMovement } from '../types/wms';
import {
  createIdempotencyKey,
  formatNumber,
  formatShortDate,
  triggerLightHaptic,
  triggerSuccessHaptic,
} from '../utils/formatters';

const FILTER_OPTIONS: ChipOption[] = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'LOW', label: 'Sắp hết' },
  { key: 'PACK_BREAK', label: 'Xé lẻ Thùng/Bịch' },
  { key: 'CONSUMABLE', label: 'Vật tư nhỏ lẻ' },
];

const ProductCard = React.memo(
  ({
    item,
    liteMode,
    onSelect,
    onQuickDeduct,
    onBreakPack,
  }: {
    item: Product;
    liteMode: boolean;
    onSelect: (p: Product) => void;
    onQuickDeduct: (p: Product) => void;
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
              {liteMode
                ? `${item.category}`
                : `${item.sku} · ${item.shelf_location || 'Chưa gán kệ'} · ${item.barcode || 'Nội bộ'}`}
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
              Vật tư ước lượng: ~{Math.round(gaugeRatio * 100)}% (Đầy: {formatNumber(capRef)} {item.unit})
            </Text>
          </View>
        ) : null}

        {item.tracking_type === 'PACK_BREAK' && item.pack_unit ? (
          <View style={styles.packRow}>
            <Text style={[styles.subInfo, { color: theme.secondary }]}>
              {item.sealed_packs} {item.pack_unit} nguyên + {formatNumber(looseQty)} {item.unit} lẻ (1{' '}
              {item.pack_unit} = {item.pack_conversion_rate} {item.unit})
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

        <View style={styles.cardFooter}>
          <Text style={[styles.subInfo, { color: theme.textMuted }]}>
            Tối thiểu: {formatNumber(item.min_stock_level)} {item.unit}
          </Text>
          <Pressable
            onPress={() => onQuickDeduct(item)}
            accessibilityRole="button"
            accessibilityLabel={`Xuất nhanh 1 ${item.unit} ${item.name}`}
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => [
              styles.quickMinusBtn,
              {
                backgroundColor: theme.surfaceAlt,
                borderColor: theme.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons name="remove-circle-outline" size={18} color={theme.danger} />
            <Text style={[styles.quickMinusText, { color: theme.text }]}>-1 {item.unit}</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  },
);

const LedgerRow = React.memo(({ item }: { item: StockMovement }) => {
  const theme = useTheme();
  const isPositive = item.quantity_delta > 0;
  return (
    <View style={[styles.ledgerRow, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
      <View style={styles.rowBetween}>
        <Text style={[styles.ledgerType, { color: theme.text }]}>{item.movement_type}</Text>
        <Text style={[styles.ledgerDelta, { color: isPositive ? theme.primary : theme.danger }]}>
          {isPositive ? `+${formatNumber(item.quantity_delta)}` : formatNumber(item.quantity_delta)}
        </Text>
      </View>
      <Text style={[styles.subInfo, { color: theme.textMuted }]}>
        Tồn sau: {formatNumber(item.balance_after)} · {formatShortDate(item.occurred_at)} ·{' '}
        {item.user_name || 'Hệ thống'}
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
  const isManager = user?.role === 'MANAGER';
  const enqueueMovement = useOfflineQueueStore((s) => s.enqueueMovement);

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

  const filteredProducts = useMemo(() => {
    const raw = productsQuery.data || [];
    const q = searchText.trim().toLowerCase();
    return raw.filter((item) => {
      if (filterKey === 'LOW' && item.current_stock > item.min_stock_level) return false;
      if (filterKey === 'PACK_BREAK' && item.tracking_type !== 'PACK_BREAK') return false;
      if (filterKey === 'CONSUMABLE' && item.tracking_type !== 'CONSUMABLE') return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.barcode && item.barcode.includes(q))
      );
    });
  }, [productsQuery.data, searchText, filterKey]);

  const handleQuickDeduct = useCallback(
    async (prod: Product) => {
      await triggerLightHaptic();
      const payload = {
        product_id: prod.id,
        movement_type: 'OUT_CONSUMPTION' as const,
        quantity: 1,
        unit_mode: 'BASE' as const,
        note: 'Trừ nhanh từ danh sách kho',
        idempotency_key: createIdempotencyKey('inv-quick'),
      };
      try {
        await api.createMovement(payload);
        await triggerSuccessHaptic();
        setBannerMsg(`Đã trừ 1 ${prod.unit} "${prod.name}".`);
        void queryClient.invalidateQueries({ queryKey: ['products'] });
        void queryClient.invalidateQueries({ queryKey: ['forecast-overview'] });
        void queryClient.invalidateQueries({ queryKey: ['movements'] });
      } catch (err) {
        if (isOfflineNetworkError(err)) {
          await enqueueMovement(prod.name, prod.unit, payload);
          setBannerMsg(`Mất mạng: Đã lưu trừ 1 ${prod.unit} "${prod.name}" vào hàng đợi Offline.`);
        } else {
          setBannerMsg(err instanceof Error ? err.message : 'Không thể trừ kho.');
        }
      }
    },
    [enqueueMovement, queryClient],
  );

  const handleBreakPack = useCallback(
    async (prod: Product) => {
      try {
        await api.breakPack(prod.id, 1, createIdempotencyKey('break'));
        await triggerSuccessHaptic();
        setBannerMsg(
          `Đã khui 1 ${prod.pack_unit} "${prod.name}" thành ${prod.pack_conversion_rate} ${prod.unit} lẻ.`,
        );
        void queryClient.invalidateQueries({ queryKey: ['products'] });
      } catch (err) {
        setBannerMsg(err instanceof Error ? err.message : 'Không thể khui bịch.');
      }
    },
    [queryClient],
  );

  const handleScanLookup = useCallback(
    (code: string) => {
      setScannerOpen(false);
      setSearchText(code);
      const found = (productsQuery.data || []).find(
        (p) => p.barcode === code || p.sku.toUpperCase() === code.toUpperCase(),
      );
      if (found) {
        setConfirmDelete(false);
        setSelectedProduct(found);
      } else {
        setBannerMsg(`Không tìm thấy mã "${code}". Bấm "+ Thêm nhanh" để tạo mới.`);
      }
    },
    [productsQuery.data],
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
      setBannerMsg(`Đã xóa mặt hàng "${deletedName}" khỏi danh sách quản lý kho.`);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['forecast-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['stocktakes'] });
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
        onQuickDeduct={(p) => void handleQuickDeduct(p)}
        onBreakPack={(p) => void handleBreakPack(p)}
      />
    ),
    [store?.lite_mode, handleQuickDeduct, handleBreakPack],
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
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Tìm tên, SKU hoặc mã vạch..."
            placeholderTextColor={theme.textMuted}
            style={[
              styles.searchInput,
              { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
            ]}
          />
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
            <Ionicons name="barcode-outline" size={24} color={theme.primaryTextOn} />
          </Pressable>
        </View>
        <ChipRow options={FILTER_OPTIONS} selectedKey={filterKey} onSelect={setFilterKey} />
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
            <Text style={[styles.subInfo, { color: theme.textMuted }]}>
              Chưa có mặt hàng khớp bộ lọc.
            </Text>
          </View>
        }
      />

      <Pressable
        onPress={() => setQuickAddOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Thêm nhanh mặt hàng mới"
        android_ripple={{ color: theme.ripple }}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: theme.primary, opacity: pressed ? 0.88 : 1 },
        ]}
      >
        <Ionicons name="add" size={24} color={theme.primaryTextOn} />
        <Text style={[styles.fabText, { color: theme.primaryTextOn }]}>Thêm nhanh (5s)</Text>
      </Pressable>

      <BarcodeScannerModal
        visible={scannerOpen}
        title="Quét mã tìm nhanh trong kho"
        onScan={handleScanLookup}
        onClose={() => setScannerOpen(false)}
      />

      <QuickAddProductModal
        visible={quickAddOpen}
        liteMode={Boolean(store?.lite_mode)}
        onClose={() => setQuickAddOpen(false)}
        onCreated={(prod) => {
          setQuickAddOpen(false);
          setBannerMsg(`Đã thêm "${prod.name}" (SKU: ${prod.sku}).`);
          void queryClient.invalidateQueries({ queryKey: ['products'] });
          void queryClient.invalidateQueries({ queryKey: ['forecast-overview'] });
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
          <View style={[styles.modalHeader, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
            <View style={styles.flexOne}>
              <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
                {selectedProduct?.name}
              </Text>
              <Text style={[styles.itemMeta, { color: theme.textMuted }]}>
                SKU: {selectedProduct?.sku} · Barcode: {selectedProduct?.barcode}
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
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
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
                  Kệ: {selectedProduct.shelf_location || 'Chưa gán'} · NCC:{' '}
                  {selectedProduct.supplier_name || 'Chưa gán'}
                </Text>
                <ActionButton
                  label={`Trừ nhanh 1 ${selectedProduct.unit} tiêu thụ`}
                  icon="remove-circle-outline"
                  onPress={() => {
                    void handleQuickDeduct(selectedProduct);
                    setConfirmDelete(false);
                    setSelectedProduct(null);
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
                        Xóa "{selectedProduct.name}" khỏi danh sách kho & dự báo? (Lịch sử sổ cái cũ vẫn được giữ để đối soát).
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
                      label="Xóa mặt hàng khỏi kho"
                      icon="trash-outline"
                      variant="danger"
                      onPress={() => setConfirmDelete(true)}
                    />
                  )
                ) : null}
              </View>

              <Text style={[styles.ledgerHeader, { color: theme.text }]}>
                Sổ cái biến động kho gần nhất (Bất biến)
              </Text>
              <FlatList
                data={detailLedgerQuery.data || []}
                renderItem={renderLedger}
                keyExtractor={(m) => String(m.id)}
                contentContainerStyle={styles.ledgerList}
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
  searchInput: {
    flex: 1,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
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
  itemName: { fontSize: 16, fontWeight: '600' },
  itemMeta: { fontSize: 12, marginTop: 2 },
  gaugeSection: { gap: SPACING.xs, marginTop: SPACING.xs },
  packRow: { gap: SPACING.xs, marginTop: SPACING.xs },
  smallActionBtn: {
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  smallActionText: { fontSize: 13, fontWeight: '600' },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  subInfo: { fontSize: 13 },
  quickMinusBtn: {
    minHeight: TOUCH_MIN,
    minWidth: TOUCH_MIN,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  quickMinusText: { fontSize: 13, fontWeight: '600' },
  emptyBox: { padding: SPACING.xl, alignItems: 'center' },
  fab: {
    position: 'absolute',
    right: SPACING.lg,
    bottom: SPACING.lg,
    minHeight: 54,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    elevation: 4,
  },
  fabText: { fontSize: 15, fontWeight: '600' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    gap: SPACING.md,
  },
  detailWrap: {
    flex: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  bigStock: { fontSize: 22, fontWeight: '700' },
  ledgerHeader: { fontSize: 15, fontWeight: '600' },
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
