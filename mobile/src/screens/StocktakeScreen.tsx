import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { ActionButton, ChipOption, ChipRow, StatusPill } from '../components/CommonUI';
import { api } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { StocktakeItem } from '../types/wms';
import { formatNumber, triggerLightHaptic, triggerSuccessHaptic } from '../utils/formatters';

const GAUGE_PRESETS: ChipOption[] = [
  { key: '100', label: 'Đầy 100%' },
  { key: '75', label: '3/4 (75%)' },
  { key: '50', label: 'Một nửa (50%)' },
  { key: '20', label: 'Sắp hết (20%)' },
  { key: '0', label: 'Cạn (0%)' },
];

const StocktakeLineCard = React.memo(
  ({
    item,
    isStaffBlindOpen,
    canToggleImplied,
    impliedOverride,
    onToggleImplied,
  }: {
    item: StocktakeItem;
    isStaffBlindOpen: boolean;
    canToggleImplied: boolean;
    impliedOverride: boolean;
    onToggleImplied: (productId: number, val: boolean) => void;
  }) => {
    const theme = useTheme();
    const variance = item.variance_qty;
    const isNegative = variance !== null && variance < 0;

    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.rowBetween}>
          <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <StatusPill
            text={`${formatNumber(item.counted_qty)} ${item.unit}`}
            tone={isNegative ? 'warning' : 'primary'}
          />
        </View>

        {isStaffBlindOpen ? (
          <Text style={[styles.subText, { color: theme.secondary }]}>
            Kiểm kê mù: Số tồn máy được ẩn · Thực đếm: {formatNumber(item.counted_qty)} {item.unit}
            {item.gauge_percent !== null ? ` (~${item.gauge_percent}%)` : ''}
          </Text>
        ) : (
          <Text style={[styles.subText, { color: theme.textMuted }]}>
            Tồn máy: {item.system_qty_snapshot !== null ? formatNumber(item.system_qty_snapshot) : '—'}{' '}
            · Thực đếm: {formatNumber(item.counted_qty)} · Lệch:{' '}
            {variance !== null ? `${variance > 0 ? '+' : ''}${formatNumber(variance)}` : '—'}{' '}
            {item.unit}
          </Text>
        )}

        {canToggleImplied && isNegative ? (
          <View style={[styles.impliedRow, { backgroundColor: theme.surfaceAlt }]}>
            <Text style={[styles.subText, { color: theme.text, flex: 1 }]}>
              Tính phần hụt là Tiêu thụ thực tế (AI học)
            </Text>
            <Switch
              value={impliedOverride}
              onValueChange={(v) => onToggleImplied(item.product_id, v)}
              trackColor={{ false: theme.border, true: theme.primarySoft }}
              thumbColor={impliedOverride ? theme.primary : theme.textMuted}
            />
          </View>
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

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [countedText, setCountedText] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('Kiểm kê cuối ca');
  const [newIsBlind, setNewIsBlind] = useState(true);
  const [impliedOverrides, setImpliedOverrides] = useState<Record<number, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sessionsQuery = useQuery({
    queryKey: ['stocktakes'],
    queryFn: api.listStocktakes,
  });

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => api.listProducts(),
  });

  const sessions = sessionsQuery.data || [];
  const products = productsQuery.data || [];

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || sessions[0] || null,
    [sessions, selectedSessionId],
  );

  const activeProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || products[0] || null,
    [products, selectedProductId],
  );

  useEffect(() => {
    if (!activeSession) return;
    const nextMap: Record<number, boolean> = {};
    for (const item of activeSession.items) {
      nextMap[item.product_id] = item.treat_negative_variance_as_consumption;
    }
    setImpliedOverrides(nextMap);
  }, [activeSession]);

  const sessionChips = useMemo<ChipOption[]>(
    () =>
      sessions.map((s) => ({
        key: String(s.id),
        label: `#${s.id} (${s.status})`,
      })),
    [sessions],
  );

  const productChips = useMemo<ChipOption[]>(
    () => products.map((p) => ({ key: String(p.id), label: p.name })),
    [products],
  );

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['stocktakes'] });
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['movements'] });
    void queryClient.invalidateQueries({ queryKey: ['forecast-overview'] });
  }, [queryClient]);

  const handleCreateSession = useCallback(async () => {
    if (!newTitle.trim()) return;
    setBusy(true);
    try {
      const created = await api.createStocktake(newTitle.trim(), newIsBlind);
      await triggerSuccessHaptic();
      setSelectedSessionId(created.id);
      setNewModalOpen(false);
      setNotice(`Đã mở phiên kiểm kê #${created.id}.`);
      refreshAll();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Không thể tạo phiên kiểm kê.');
    } finally {
      setBusy(false);
    }
  }, [newTitle, newIsBlind, refreshAll]);

  const handleRecordCount = useCallback(
    async (opts: { countedQty?: number; gaugePercent?: number }) => {
      if (!activeSession || !activeProduct) return;
      setBusy(true);
      setNotice(null);
      try {
        await api.scanStocktakeItem(activeSession.id, {
          product_id: activeProduct.id,
          counted_qty: opts.countedQty,
          gauge_percent: opts.gaugePercent,
        });
        await triggerSuccessHaptic();
        setCountedText('');
        setNotice(`Đã ghi nhận kiểm kê cho "${activeProduct.name}".`);
        refreshAll();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Không thể lưu kiểm kê.');
      } finally {
        setBusy(false);
      }
    },
    [activeSession, activeProduct, refreshAll],
  );

  const handleBarcodeScan = useCallback(
    (code: string) => {
      setScannerOpen(false);
      const found = products.find(
        (p) => p.barcode === code || p.sku.toUpperCase() === code.toUpperCase(),
      );
      if (!found) {
        setNotice(`Không tìm thấy sản phẩm khớp mã "${code}".`);
        return;
      }
      setSelectedProductId(found.id);
      setNotice(`Đã chọn "${found.name}". Nhập số lượng thực đếm rồi bấm Lưu.`);
    },
    [products],
  );

  const handleSubmit = useCallback(async () => {
    if (!activeSession) return;
    setBusy(true);
    try {
      await api.submitStocktake(activeSession.id);
      await triggerSuccessHaptic();
      setNotice('Đã gửi phiên kiểm kê cho Quản lý đối soát và duyệt.');
      refreshAll();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Không thể gửi phiên kiểm kê.');
    } finally {
      setBusy(false);
    }
  }, [activeSession, refreshAll]);

  const handleApprove = useCallback(async () => {
    if (!activeSession) return;
    setBusy(true);
    try {
      const options = Object.entries(impliedOverrides).map(([pid, val]) => ({
        product_id: Number(pid),
        treat_negative_variance_as_consumption: val,
      }));
      await api.approveStocktake(activeSession.id, options);
      await triggerSuccessHaptic();
      setNotice('Đã duyệt kiểm kê và ghi bút toán cân bằng vào Sổ cái.');
      refreshAll();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Không thể duyệt kiểm kê.');
    } finally {
      setBusy(false);
    }
  }, [activeSession, impliedOverrides, refreshAll]);

  const handleToggleImplied = useCallback((productId: number, val: boolean) => {
    void triggerLightHaptic();
    setImpliedOverrides((prev) => ({ ...prev, [productId]: val }));
  }, []);

  const isStaffBlindOpen = Boolean(
    activeSession && !isManager && activeSession.is_blind && activeSession.status === 'OPEN',
  );

  const renderLineItem = useCallback(
    ({ item }: { item: StocktakeItem }) => (
      <StocktakeLineCard
        item={item}
        isStaffBlindOpen={isStaffBlindOpen}
        canToggleImplied={Boolean(isManager && activeSession && activeSession.status !== 'APPROVED')}
        impliedOverride={impliedOverrides[item.product_id] ?? item.treat_negative_variance_as_consumption}
        onToggleImplied={handleToggleImplied}
      />
    ),
    [isStaffBlindOpen, isManager, activeSession, impliedOverrides, handleToggleImplied],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.topPanel, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <View style={styles.rowBetween}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Phiên kiểm kê kho</Text>
          <ActionButton
            label="+ Phiên mới"
            variant="outline"
            onPress={() => setNewModalOpen(true)}
          />
        </View>
        {sessionChips.length > 0 ? (
          <ChipRow
            options={sessionChips}
            selectedKey={activeSession ? String(activeSession.id) : ''}
            onSelect={(k) => setSelectedSessionId(Number(k))}
          />
        ) : null}
        {notice ? <Text style={[styles.noticeText, { color: theme.secondary }]}>{notice}</Text> : null}
      </View>

      <FlatList
        data={activeSession?.items || []}
        renderItem={renderLineItem}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={sessionsQuery.isRefetching}
            onRefresh={refreshAll}
            tintColor={theme.primary}
          />
        }
        ListHeaderComponent={
          activeSession ? (
            <View style={styles.headerSections}>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={2}>
                    {activeSession.title}
                  </Text>
                  <StatusPill
                    text={activeSession.status}
                    tone={
                      activeSession.status === 'APPROVED'
                        ? 'primary'
                        : activeSession.status === 'SUBMITTED'
                          ? 'warning'
                          : 'secondary'
                    }
                  />
                </View>

                {isStaffBlindOpen ? (
                  <View style={[styles.blindNotice, { backgroundColor: theme.secondarySoft }]}>
                    <Ionicons name="eye-off-outline" size={20} color={theme.secondary} />
                    <Text style={[styles.subText, { color: theme.text, flex: 1 }]}>
                      Chế độ Kiểm kê mù (Blind Count): Số tồn máy được ẩn để chống đối phó số liệu.
                    </Text>
                  </View>
                ) : null}

                {activeSession.status === 'OPEN' ? (
                  <View style={styles.gapSm}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.subText, { color: theme.textMuted }]}>Chọn mặt hàng kiểm:</Text>
                      <ActionButton
                        label="Quét mã"
                        icon="barcode-outline"
                        variant="secondary"
                        onPress={() => setScannerOpen(true)}
                      />
                    </View>
                    <ChipRow
                      options={productChips}
                      selectedKey={activeProduct ? String(activeProduct.id) : ''}
                      onSelect={(k) => setSelectedProductId(Number(k))}
                    />

                    {activeProduct?.tracking_type === 'CONSUMABLE' ? (
                      <View style={styles.gapSm}>
                        <Text style={[styles.subText, { color: theme.primary }]}>
                          Ước lượng vật tư nhỏ lẻ (% mức đầy):
                        </Text>
                        <ChipRow
                          options={GAUGE_PRESETS}
                          selectedKey=""
                          onSelect={(k) => void handleRecordCount({ gaugePercent: Number(k) })}
                        />
                      </View>
                    ) : null}

                    <View style={styles.countRow}>
                      <TextInput
                        value={countedText}
                        onChangeText={setCountedText}
                        keyboardType="numeric"
                        placeholder={`Nhập số thực đếm (${activeProduct?.unit || 'ĐV'})`}
                        placeholderTextColor={theme.textMuted}
                        style={[
                          styles.input,
                          styles.flexOne,
                          {
                            backgroundColor: theme.surfaceAlt,
                            color: theme.text,
                            borderColor: theme.border,
                          },
                        ]}
                      />
                      <ActionButton
                        label="Lưu đếm"
                        loading={busy}
                        onPress={() => {
                          const num = Number(countedText.replace(',', '.'));
                          if (!Number.isNaN(num) && num >= 0) {
                            void handleRecordCount({ countedQty: num });
                          }
                        }}
                      />
                    </View>

                    <ActionButton
                      label="Gửi Quản lý duyệt phiên này"
                      icon="send-outline"
                      variant="outline"
                      loading={busy}
                      onPress={() => void handleSubmit()}
                    />
                  </View>
                ) : null}

                {isManager && activeSession.status !== 'APPROVED' ? (
                  <ActionButton
                    label="Duyệt lệch & Cân bằng Sổ cái"
                    icon="checkmark-done-circle-outline"
                    loading={busy}
                    onPress={() => void handleApprove()}
                  />
                ) : null}
              </View>
              <Text style={[styles.sectionSub, { color: theme.textMuted }]}>
                Danh sách đã kiểm ({activeSession.items.length} mặt hàng):
              </Text>
            </View>
          ) : undefined
        }
      />

      <BarcodeScannerModal
        visible={scannerOpen}
        title="Quét mã vạch kiểm kê"
        onScan={handleBarcodeScan}
        onClose={() => setScannerOpen(false)}
      />

      <Modal visible={newModalOpen} animationType="slide" onRequestClose={() => setNewModalOpen(false)}>
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
          <View style={[styles.modalHeader, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Mở phiên kiểm kê mới</Text>
            <Pressable
              onPress={() => setNewModalOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Đóng tạo phiên kiểm kê"
              android_ripple={{ color: theme.ripple }}
              style={({ pressed }) => [
                styles.closeBtn,
                { backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>
          <View style={styles.modalBody}>
            <Text style={[styles.subText, { color: theme.textMuted }]}>Tên phiên kiểm kê</Text>
            <TextInput
              value={newTitle}
              onChangeText={setNewTitle}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />
            <View style={[styles.impliedRow, { backgroundColor: theme.surface }]}>
              <Text style={[styles.subText, { color: theme.text, flex: 1 }]}>
                Bật Kiểm kê mù (Ẩn tồn máy với Nhân viên)
              </Text>
              <Switch
                value={newIsBlind}
                onValueChange={setNewIsBlind}
                trackColor={{ false: theme.border, true: theme.primarySoft }}
                thumbColor={newIsBlind ? theme.primary : theme.textMuted}
              />
            </View>
            <ActionButton
              label="Tạo phiên kiểm kê"
              loading={busy}
              onPress={() => void handleCreateSession()}
            />
          </View>
        </SafeAreaView>
      </Modal>
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
  itemName: { fontSize: 15, fontWeight: '600', flex: 1 },
  subText: { fontSize: 13, lineHeight: 19 },
  blindNotice: {
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  gapSm: { gap: SPACING.sm },
  countRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
  },
  input: {
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 15,
  },
  impliedRow: {
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  sectionSub: { fontSize: 13, fontWeight: '600' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
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
  },
});
