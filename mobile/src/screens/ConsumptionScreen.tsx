import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { ActionButton, ChipOption, ChipRow, StatusPill } from '../components/CommonUI';
import { ApiHttpError, api, isOfflineNetworkError } from '../services/apiClient';
import { useOfflineQueueStore } from '../store/offlineQueueStore';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { MovementCreateInput, Product, StockMovement, UnitMode } from '../types/wms';
import {
  createIdempotencyKey,
  formatNumber,
  formatShortDate,
  triggerLightHaptic,
  triggerSuccessHaptic,
  triggerWarningHaptic,
} from '../utils/formatters';

const MODE_TABS: ChipOption[] = [
  { key: 'flow1', label: '1. Xuất tức thì' },
  { key: 'flow2', label: '2. Chốt cuối ca' },
  { key: 'stockin', label: 'Nhập hàng' },
  { key: 'history', label: 'Lịch sử & Đính chính' },
];

const OUT_REASON_OPTIONS: ChipOption[] = [
  { key: 'OUT_CONSUMPTION', label: 'Tiêu thụ thực tế (AI học)' },
  { key: 'OUT_DAMAGE_EXPIRED', label: 'Hàng hỏng / Hủy (Loại khỏi AI)' },
];

const UNIT_MODE_OPTIONS: ChipOption[] = [
  { key: 'BASE', label: 'Đơn vị lẻ' },
  { key: 'PACK', label: 'Thùng / Bịch nguyên' },
];

const ShiftItemRow = React.memo(
  ({
    product,
    qty,
    onChangeQty,
  }: {
    product: Product;
    qty: number;
    onChangeQty: (productId: number, nextQty: number) => void;
  }) => {
    const theme = useTheme();
    return (
      <View style={[styles.shiftCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.flexOne}>
          <View style={styles.rowGap}>
            {product.is_pinned ? <StatusPill text="Hay dùng" tone="primary" /> : null}
            <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
              {product.name}
            </Text>
          </View>
          <Text style={[styles.subText, { color: theme.textMuted }]}>
            Tồn: {formatNumber(product.current_stock)} {product.unit}
          </Text>
        </View>

        <View style={styles.stepperWrap}>
          <Pressable
            onPress={() => {
              void triggerLightHaptic();
              onChangeQty(product.id, Math.max(0, qty - 1));
            }}
            accessibilityRole="button"
            accessibilityLabel={`Giảm số lượng chốt ca cho ${product.name}`}
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => [
              styles.stepBtn,
              { backgroundColor: theme.surfaceAlt, borderColor: theme.border, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Ionicons name="remove" size={20} color={theme.text} />
          </Pressable>
          <Text style={[styles.stepVal, { color: qty > 0 ? theme.primary : theme.textMuted }]}>
            {qty}
          </Text>
          <Pressable
            onPress={() => {
              void triggerLightHaptic();
              onChangeQty(product.id, qty + 1);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Tăng số lượng chốt ca cho ${product.name}`}
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => [
              styles.stepBtn,
              { backgroundColor: theme.primarySoft, borderColor: theme.primary, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Ionicons name="add" size={20} color={theme.primary} />
          </Pressable>
        </View>
      </View>
    );
  },
);

const HistoryCard = React.memo(
  ({
    item,
    onReverse,
  }: {
    item: StockMovement;
    onReverse: (mv: StockMovement) => void;
  }) => {
    const theme = useTheme();
    const canReverse =
      !item.is_reversed &&
      (item.movement_type === 'OUT_CONSUMPTION' ||
        item.movement_type === 'OUT_DAMAGE_EXPIRED' ||
        item.movement_type === 'IN_PURCHASE');

    const tone =
      item.movement_type === 'IN_PURCHASE'
        ? 'primary'
        : item.movement_type === 'OUT_DAMAGE_EXPIRED'
          ? 'danger'
          : item.movement_type === 'REVERSAL'
            ? 'warning'
            : 'secondary';

    return (
      <View style={[styles.shiftCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.flexOne}>
          <View style={styles.rowBetween}>
            <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
              {item.product_name || `SP #${item.product_id}`}
            </Text>
            <StatusPill text={item.movement_type} tone={tone} />
          </View>
          <Text style={[styles.subText, { color: theme.textMuted }]}>
            Biến động:{' '}
            {item.quantity_delta > 0
              ? `+${formatNumber(item.quantity_delta)}`
              : formatNumber(item.quantity_delta)}{' '}
            {item.product_unit} · Còn: {formatNumber(item.balance_after)} ·{' '}
            {formatShortDate(item.occurred_at)}
          </Text>
          {item.note ? (
            <Text style={[styles.subText, { color: theme.textMuted }]}>{item.note}</Text>
          ) : null}
          {canReverse ? (
            <Pressable
              onPress={() => onReverse(item)}
              accessibilityRole="button"
              accessibilityLabel={`Đính chính giao dịch ${item.id}`}
              android_ripple={{ color: theme.ripple }}
              style={({ pressed }) => [
                styles.reverseBtn,
                { backgroundColor: theme.warningSoft, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Ionicons name="arrow-undo-outline" size={18} color={theme.warning} />
              <Text style={[styles.reverseBtnText, { color: theme.text }]}>
                Đính chính (Hoàn tác 15p)
              </Text>
            </Pressable>
          ) : item.is_reversed ? (
            <Text style={[styles.subText, { color: theme.warning }]}>Đã đính chính trước đó</Text>
          ) : null}
        </View>
      </View>
    );
  },
);

export function ConsumptionScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { pending, enqueueMovement, flushQueue } = useOfflineQueueStore();

  const [mode, setMode] = useState<'flow1' | 'flow2' | 'stockin' | 'history'>('flow1');
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [qtyText, setQtyText] = useState('1');
  const [reason, setReason] = useState<'OUT_CONSUMPTION' | 'OUT_DAMAGE_EXPIRED'>('OUT_CONSUMPTION');
  const [unitMode, setUnitMode] = useState<UnitMode>('BASE');
  const [note, setNote] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [anomalyPending, setAnomalyPending] = useState<{
    message: string;
    payload: MovementCreateInput;
  } | null>(null);

  const [shiftQuantities, setShiftQuantities] = useState<Record<number, number>>({});

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => api.listProducts(),
  });

  const movementsQuery = useQuery({
    queryKey: ['movements'],
    queryFn: () => api.listMovements({ limit: 40 }),
  });

  const products = productsQuery.data || [];
  const activeProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || products[0] || null,
    [products, selectedProductId],
  );

  const productChipOptions = useMemo<ChipOption[]>(
    () => products.map((p) => ({ key: String(p.id), label: `${p.name} (${formatNumber(p.current_stock)})` })),
    [products],
  );

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['movements'] });
    void queryClient.invalidateQueries({ queryKey: ['forecast-overview'] });
  }, [queryClient]);

  const submitMovementPayload = useCallback(
    async (payload: MovementCreateInput, product: Product) => {
      setSubmitting(true);
      setStatusMsg(null);
      try {
        const created = await api.createMovement(payload);
        await triggerSuccessHaptic();
        setAnomalyPending(null);
        setNote('');
        setQtyText('1');
        setStatusMsg(
          `Đã ghi nhận ${created.quantity_delta > 0 ? '+' : ''}${formatNumber(created.quantity_delta)} ${product.unit} cho "${product.name}". Tồn mới: ${formatNumber(created.balance_after)} ${product.unit}.`,
        );
        refreshAll();
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 409) {
          await triggerWarningHaptic();
          setAnomalyPending({ message: err.message, payload });
          return;
        }
        if (isOfflineNetworkError(err)) {
          await enqueueMovement(product.name, product.unit, payload);
          setStatusMsg(
            `Mất kết nối: Đã lưu giao dịch "${product.name}" vào hàng đợi Offline để đồng bộ sau.`,
          );
          return;
        }
        setStatusMsg(err instanceof Error ? err.message : 'Lỗi ghi nhận giao dịch.');
      } finally {
        setSubmitting(false);
      }
    },
    [enqueueMovement, refreshAll],
  );

  const handleSingleSubmit = useCallback(
    (movementType: 'OUT_CONSUMPTION' | 'OUT_DAMAGE_EXPIRED' | 'IN_PURCHASE') => {
      if (!activeProduct) return;
      const qtyNum = Number(qtyText.replace(',', '.'));
      if (Number.isNaN(qtyNum) || qtyNum <= 0) {
        setStatusMsg('Số lượng phải lớn hơn 0.');
        return;
      }
      const effectiveUnitMode: UnitMode =
        activeProduct.tracking_type === 'PACK_BREAK' && activeProduct.pack_unit ? unitMode : 'BASE';
      const payload: MovementCreateInput = {
        product_id: activeProduct.id,
        movement_type: movementType,
        quantity: qtyNum,
        unit_mode: effectiveUnitMode,
        note: note.trim() || undefined,
        idempotency_key: createIdempotencyKey('mv'),
        confirm_anomaly: false,
      };
      void submitMovementPayload(payload, activeProduct);
    },
    [activeProduct, qtyText, unitMode, note, submitMovementPayload],
  );

  const handleBarcodeScan = useCallback(
    (code: string) => {
      setScannerOpen(false);
      const found = products.find(
        (p) => p.barcode === code || p.sku.toUpperCase() === code.toUpperCase(),
      );
      if (!found) {
        setStatusMsg(`Không tìm thấy sản phẩm khớp mã "${code}".`);
        return;
      }
      setSelectedProductId(found.id);
      setStatusMsg(`Đã chọn "${found.name}" qua mã vạch ${code}.`);
    },
    [products],
  );

  const handleShiftChange = useCallback((productId: number, nextQty: number) => {
    setShiftQuantities((prev) => ({ ...prev, [productId]: nextQty }));
  }, []);

  const handleSubmitShiftBatch = useCallback(async () => {
    const entries = Object.entries(shiftQuantities).filter(([, qty]) => qty > 0);
    if (entries.length === 0) {
      setStatusMsg('Hãy tăng số lượng ít nhất 1 mặt hàng đã tiêu trong ca.');
      return;
    }

    const batchItems: MovementCreateInput[] = entries.map(([pidStr, qty]) => ({
      product_id: Number(pidStr),
      movement_type: 'OUT_CONSUMPTION',
      quantity: qty,
      unit_mode: 'BASE',
      note: 'Chốt tiêu thụ cuối ca',
      idempotency_key: createIdempotencyKey(`shift-${pidStr}`),
      confirm_anomaly: true,
    }));

    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await api.createBatchMovements(batchItems);
      await triggerSuccessHaptic();
      setShiftQuantities({});
      setStatusMsg(`Đã chốt ca thành công ${res.processed_count} mặt hàng vào sổ cái.`);
      refreshAll();
    } catch (err) {
      if (isOfflineNetworkError(err)) {
        for (const item of batchItems) {
          const prod = products.find((p) => p.id === item.product_id);
          await enqueueMovement(prod?.name || `SP #${item.product_id}`, prod?.unit || 'ĐV', item);
        }
        setShiftQuantities({});
        setStatusMsg(`Đang Offline: Đã đưa ${batchItems.length} dòng chốt ca vào hàng đợi đồng bộ.`);
      } else {
        setStatusMsg(err instanceof Error ? err.message : 'Lỗi chốt ca.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [shiftQuantities, products, enqueueMovement, refreshAll]);

  const handleReverse = useCallback(
    async (mv: StockMovement) => {
      const runReverse = async () => {
        try {
          await api.reverseMovement(mv.id, 'Đính chính thao tác nhập nhầm');
          await triggerSuccessHaptic();
          setStatusMsg(`Đã đính chính giao dịch #${mv.id} bằng bút toán bù trừ REVERSAL.`);
          refreshAll();
        } catch (err) {
          setStatusMsg(err instanceof Error ? err.message : 'Không thể đính chính giao dịch này.');
        }
      };

      if (Platform.OS === 'web') {
        void runReverse();
        return;
      }

      Alert.alert(
        'Xác nhận đính chính',
        `Tạo bút toán REVERSAL hoàn lại ${Math.abs(mv.quantity_delta)} ${mv.product_unit || ''}?`,
        [
          { text: 'Hủy', style: 'cancel' },
          { text: 'Đính chính ngay', onPress: () => void runReverse() },
        ],
      );
    },
    [refreshAll],
  );

  const renderShiftRow = useCallback(
    ({ item }: { item: Product }) => (
      <ShiftItemRow
        product={item}
        qty={shiftQuantities[item.id] || 0}
        onChangeQty={handleShiftChange}
      />
    ),
    [shiftQuantities, handleShiftChange],
  );

  const renderHistoryRow = useCallback(
    ({ item }: { item: StockMovement }) => (
      <HistoryCard item={item} onReverse={(mv) => void handleReverse(mv)} />
    ),
    [handleReverse],
  );

  const singleFormSections = ['pick', 'action'];

  const renderSingleForm = useCallback(
    () => (
      <View style={styles.formWrap}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.rowBetween}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Chọn mặt hàng</Text>
            <ActionButton
              label="Quét Barcode"
              icon="barcode-outline"
              variant="secondary"
              onPress={() => setScannerOpen(true)}
            />
          </View>
          <ChipRow
            options={productChipOptions}
            selectedKey={activeProduct ? String(activeProduct.id) : ''}
            onSelect={(k) => setSelectedProductId(Number(k))}
          />
          {activeProduct ? (
            <Text style={[styles.subText, { color: theme.textMuted }]}>
              Tồn hiện tại: {formatNumber(activeProduct.current_stock)} {activeProduct.unit}
              {activeProduct.pack_unit
                ? ` (1 ${activeProduct.pack_unit} = ${activeProduct.pack_conversion_rate} ${activeProduct.unit})`
                : ''}
            </Text>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {mode === 'flow1' ? (
            <View style={styles.gapSm}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Phân loại xuất kho</Text>
              <ChipRow
                options={OUT_REASON_OPTIONS}
                selectedKey={reason}
                onSelect={(k) => setReason(k as 'OUT_CONSUMPTION' | 'OUT_DAMAGE_EXPIRED')}
              />
            </View>
          ) : (
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Nhập hàng mới về kho (IN_PURCHASE)
            </Text>
          )}

          {activeProduct?.tracking_type === 'PACK_BREAK' && activeProduct.pack_unit ? (
            <View style={styles.gapSm}>
              <Text style={[styles.subText, { color: theme.textMuted }]}>Đơn vị nhập liệu:</Text>
              <ChipRow
                options={UNIT_MODE_OPTIONS}
                selectedKey={unitMode}
                onSelect={(k) => setUnitMode(k as UnitMode)}
              />
            </View>
          ) : null}

          <Text style={[styles.subText, { color: theme.textMuted }]}>Số lượng:</Text>
          <View style={styles.presetRow}>
            <ActionButton label="1" variant="outline" style={styles.flexOne} onPress={() => setQtyText('1')} />
            <ActionButton label="2" variant="outline" style={styles.flexOne} onPress={() => setQtyText('2')} />
            <ActionButton label="5" variant="outline" style={styles.flexOne} onPress={() => setQtyText('5')} />
            <ActionButton label="10" variant="outline" style={styles.flexOne} onPress={() => setQtyText('10')} />
          </View>

          <TextInput
            value={qtyText}
            onChangeText={setQtyText}
            keyboardType="numeric"
            placeholder="Nhập số lượng..."
            placeholderTextColor={theme.textMuted}
            style={[
              styles.input,
              { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
            ]}
          />

          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Ghi chú (VD: Ca sáng, Nhà cung cấp giao...)"
            placeholderTextColor={theme.textMuted}
            style={[
              styles.input,
              { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
            ]}
          />

          {anomalyPending ? (
            <View style={[styles.anomalyBox, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}>
              <Text style={[styles.anomalyText, { color: theme.text }]}>{anomalyPending.message}</Text>
              <View style={styles.presetRow}>
                <ActionButton
                  label="Hủy (Gõ nhầm)"
                  variant="outline"
                  style={styles.flexOne}
                  onPress={() => setAnomalyPending(null)}
                />
                <ActionButton
                  label="Chắc chắn xuất"
                  variant="danger"
                  style={styles.flexOne}
                  loading={submitting}
                  onPress={() => {
                    if (activeProduct) {
                      void submitMovementPayload(
                        { ...anomalyPending.payload, confirm_anomaly: true },
                        activeProduct,
                      );
                    }
                  }}
                />
              </View>
            </View>
          ) : null}

          <ActionButton
            label={
              mode === 'stockin'
                ? 'Xác nhận Nhập kho'
                : reason === 'OUT_DAMAGE_EXPIRED'
                  ? 'Ghi nhận Hàng hỏng / Hủy'
                  : 'Xác nhận Đã tiêu thụ'
            }
            icon={mode === 'stockin' ? 'arrow-down-circle-outline' : 'checkmark-done-outline'}
            variant={mode === 'stockin' ? 'primary' : reason === 'OUT_DAMAGE_EXPIRED' ? 'danger' : 'primary'}
            loading={submitting}
            onPress={() =>
              handleSingleSubmit(mode === 'stockin' ? 'IN_PURCHASE' : reason)
            }
          />
        </View>
      </View>
    ),
    [
      theme,
      productChipOptions,
      activeProduct,
      mode,
      reason,
      unitMode,
      qtyText,
      note,
      anomalyPending,
      submitting,
      submitMovementPayload,
      handleSingleSubmit,
    ],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.topBar, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <ChipRow
          options={MODE_TABS}
          selectedKey={mode}
          onSelect={(k) => {
            setStatusMsg(null);
            setMode(k as 'flow1' | 'flow2' | 'stockin' | 'history');
          }}
        />
        {pending.length > 0 ? (
          <ActionButton
            label={`Đang có ${pending.length} giao dịch Offline — Đồng bộ ngay`}
            variant="warning"
            icon="cloud-upload-outline"
            onPress={() => void flushQueue().then(refreshAll)}
          />
        ) : null}
        {statusMsg ? (
          <Text style={[styles.statusMsg, { color: theme.secondary }]}>{statusMsg}</Text>
        ) : null}
      </View>

      {mode === 'flow2' ? (
        <View style={styles.flexOne}>
          <FlatList
            data={products}
            renderItem={renderShiftRow}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
          />
          <View style={[styles.bottomBar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
            <ActionButton
              label="Gửi Chốt tiêu thụ cuối ca (Batch)"
              icon="send-outline"
              loading={submitting}
              onPress={() => void handleSubmitShiftBatch()}
            />
          </View>
        </View>
      ) : mode === 'history' ? (
        <FlatList
          data={movementsQuery.data || []}
          renderItem={renderHistoryRow}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={movementsQuery.isRefetching}
              onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['movements'] })}
              tintColor={theme.primary}
            />
          }
        />
      ) : (
        <FlatList
          data={singleFormSections.slice(0, 1)}
          renderItem={renderSingleForm}
          keyExtractor={(i) => i}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <BarcodeScannerModal
        visible={scannerOpen}
        title="Quét mã sản phẩm Nhập / Xuất"
        onScan={handleBarcodeScan}
        onClose={() => setScannerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flexOne: { flex: 1 },
  topBar: {
    padding: SPACING.md,
    borderBottomWidth: 1,
    gap: SPACING.sm,
  },
  statusMsg: { fontSize: 13, fontWeight: '500' },
  listContent: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  formWrap: { gap: SPACING.md },
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  shiftCard: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  rowGap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  gapSm: { gap: SPACING.xs },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  itemName: { fontSize: 15, fontWeight: '600', flex: 1 },
  subText: { fontSize: 13, lineHeight: 18 },
  presetRow: { flexDirection: 'row', gap: SPACING.sm },
  input: {
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 15,
  },
  anomalyBox: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  anomalyText: { fontSize: 13, fontWeight: '500' },
  stepperWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  stepBtn: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepVal: {
    fontSize: 17,
    fontWeight: '700',
    minWidth: TOUCH_MIN,
    textAlign: 'center',
  },
  bottomBar: {
    padding: SPACING.lg,
    borderTopWidth: 1,
  },
  reverseBtn: {
    minHeight: TOUCH_MIN,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    alignSelf: 'flex-start',
  },
  reverseBtnText: { fontSize: 13, fontWeight: '600' },
});
