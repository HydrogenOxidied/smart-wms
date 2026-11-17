import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActionButton, ChipOption, ChipRow, StatusPill } from '../components/CommonUI';
import { api, getActiveBaseUrl, updateApiBaseUrl } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { TemplateKey } from '../types/wms';
import { triggerSuccessHaptic } from '../utils/formatters';

const TEMPLATE_OPTIONS: ChipOption[] = [
  { key: 'MAM_TEP', label: 'Shop Mắm Tép' },
  { key: 'CAFE_BAKERY', label: 'Tiệm Bánh & Cafe' },
  { key: 'MINI_MART', label: 'Tạp hóa Mini' },
  { key: 'HARDWARE', label: 'Kim khí / Điện nước' },
  { key: 'EMPTY', label: 'Kho trống' },
];

export function LoginScreen() {
  const theme = useTheme();
  const { login, demoLogin, registerStore, isLoading } = useAuthStore();

  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [serverUrl, setServerUrl] = useState(getActiveBaseUrl());
  const [showServerBox, setShowServerBox] = useState(false);
  const [serverStatus, setServerStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [registerModal, setRegisterModal] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [newMgrUser, setNewMgrUser] = useState('');
  const [newMgrName, setNewMgrName] = useState('');
  const [newMgrSecret, setNewMgrSecret] = useState('');
  const [newStaffUser, setNewStaffUser] = useState('');
  const [newStaffSecret, setNewStaffSecret] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateKey>('MAM_TEP');

  useEffect(() => {
    setServerUrl(getActiveBaseUrl());
  }, []);

  const handleSaveServer = useCallback(async () => {
    const next = await updateApiBaseUrl(serverUrl);
    setServerUrl(next);
    try {
      await api.health();
      await triggerSuccessHaptic();
      setServerStatus('Kết nối máy chủ thành công.');
    } catch {
      setServerStatus('Không kết nối được tới máy chủ này. Kiểm tra IP LAN và cổng 8000.');
    }
  }, [serverUrl]);

  const handleLogin = useCallback(async () => {
    setErrorMsg(null);
    if (!username.trim() || !secret.trim()) {
      setErrorMsg('Vui lòng nhập tên đăng nhập và mật khẩu.');
      return;
    }
    try {
      await login(username.trim(), secret);
      await triggerSuccessHaptic();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    }
  }, [username, secret, login]);

  const handleDemo = useCallback(
    async (role: 'MANAGER' | 'STAFF') => {
      setErrorMsg(null);
      try {
        await demoLogin(role);
        await triggerSuccessHaptic();
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? `${err.message} (Kiểm tra Backend đang chạy ở ${getActiveBaseUrl()})`
            : 'Không thể kết nối máy chủ demo.',
        );
      }
    },
    [demoLogin],
  );

  const handleRegister = useCallback(async () => {
    setErrorMsg(null);
    if (!newStoreName.trim() || !newMgrUser.trim() || !newMgrSecret.trim()) {
      setErrorMsg('Vui lòng nhập Tên cửa hàng, Tài khoản Quản lý và Mật khẩu.');
      return;
    }
    try {
      await registerStore({
        store_name: newStoreName.trim(),
        manager_username: newMgrUser.trim(),
        manager_full_name: newMgrName.trim() || newMgrUser.trim(),
        manager_secret: newMgrSecret,
        staff_username: newStaffUser.trim() || undefined,
        staff_secret: newStaffSecret || undefined,
        industry_template: selectedTemplate,
        lite_mode: true,
      });
      await triggerSuccessHaptic();
      setRegisterModal(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Tạo cửa hàng thất bại.');
    }
  }, [
    newStoreName,
    newMgrUser,
    newMgrName,
    newMgrSecret,
    newStaffUser,
    newStaffSecret,
    selectedTemplate,
    registerStore,
  ]);

  const loginBlocks = ['hero', 'demo', 'form', 'server'];

  const renderLoginBlock = useCallback(
    ({ item }: { item: string }) => {
      if (item === 'hero') {
        return (
          <View style={styles.heroWrap}>
            <View style={[styles.badgeRow]}>
              <StatusPill text="Mobile-First WMS + AI" tone="primary" />
            </View>
            <Text style={[styles.brandTitle, { color: theme.text }]}>PocketWMS</Text>
            <Text style={[styles.brandSub, { color: theme.textMuted }]}>
              Quản lý kho linh hoạt từ tiệm nhỏ tới kho chuẩn, kiểm kê mù bằng mã vạch và dự báo nhập hàng 3 tầng.
            </Text>
          </View>
        );
      }

      if (item === 'demo') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.primary }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Trải nghiệm nhanh Dữ liệu mẫu (65 ngày)
            </Text>
            <Text style={[styles.helperText, { color: theme.textMuted }]}>
              Kho mẫu: Tiệm Bánh & Cafe Mộc (10 mặt hàng, hàng xé lẻ, vật tư ước lượng %).
            </Text>
            <ActionButton
              label="Vào nhanh: Chủ kho (Manager)"
              icon="shield-checkmark-outline"
              onPress={() => void handleDemo('MANAGER')}
              loading={isLoading}
            />
            <ActionButton
              label="Vào nhanh: Nhân viên kho (Staff)"
              icon="barcode-outline"
              variant="secondary"
              onPress={() => void handleDemo('STAFF')}
              loading={isLoading}
            />
          </View>
        );
      }

      if (item === 'form') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Đăng nhập tài khoản riêng</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              placeholder="Tên đăng nhập"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />
            <TextInput
              value={secret}
              onChangeText={setSecret}
              secureTextEntry
              placeholder="Mật khẩu"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />
            {errorMsg ? <Text style={[styles.errText, { color: theme.danger }]}>{errorMsg}</Text> : null}
            <ActionButton
              label="Đăng nhập"
              variant="outline"
              onPress={() => void handleLogin()}
              loading={isLoading}
            />
            <ActionButton
              label="Tạo cửa hàng mới (Bộ mẫu 1 phút)"
              icon="add-circle-outline"
              variant="outline"
              onPress={() => {
                setErrorMsg(null);
                setRegisterModal(true);
              }}
            />
          </View>
        );
      }

      return (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Pressable
            onPress={() => setShowServerBox((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Cấu hình địa chỉ máy chủ API"
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => [styles.serverHeader, { opacity: pressed ? 0.75 : 1 }]}
          >
            <View style={styles.serverLabelWrap}>
              <Ionicons name="server-outline" size={20} color={theme.secondary} />
              <Text style={[styles.serverTitle, { color: theme.text }]}>
                Máy chủ API ({getActiveBaseUrl()})
              </Text>
            </View>
            <Ionicons
              name={showServerBox ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={theme.textMuted}
            />
          </Pressable>

          {showServerBox ? (
            <View style={styles.serverBody}>
              <Text style={[styles.helperText, { color: theme.textMuted }]}>
                Khi mở trên điện thoại thật qua Expo Go, điền IP LAN của máy tính (VD: http://192.168.1.15:8000/api/v1).
              </Text>
              <TextInput
                value={serverUrl}
                onChangeText={setServerUrl}
                autoCapitalize="none"
                style={[
                  styles.input,
                  { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
                ]}
              />
              {serverStatus ? (
                <Text style={[styles.helperText, { color: theme.secondary }]}>{serverStatus}</Text>
              ) : null}
              <ActionButton
                label="Lưu & Kiểm tra kết nối"
                variant="secondary"
                onPress={() => void handleSaveServer()}
              />
            </View>
          ) : null}
        </View>
      );
    },
    [
      theme,
      isLoading,
      username,
      secret,
      errorMsg,
      showServerBox,
      serverUrl,
      serverStatus,
      handleDemo,
      handleLogin,
      handleSaveServer,
    ],
  );

  const registerSections = ['fields'];

  const renderRegisterSection = useCallback(
    () => (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Tên cửa hàng / kho *</Text>
        <TextInput
          value={newStoreName}
          onChangeText={setNewStoreName}
          placeholder="Ví dụ: Tiệm Bánh Hạnh Phúc"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
          ]}
        />

        <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Chọn bộ danh mục mẫu khởi tạo</Text>
        <ChipRow
          options={TEMPLATE_OPTIONS}
          selectedKey={selectedTemplate}
          onSelect={(k) => setSelectedTemplate(k as TemplateKey)}
        />

        <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Tên đăng nhập Quản lý *</Text>
        <TextInput
          value={newMgrUser}
          onChangeText={setNewMgrUser}
          autoCapitalize="none"
          placeholder="chu_shop"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
          ]}
        />

        <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Họ tên Quản lý</Text>
        <TextInput
          value={newMgrName}
          onChangeText={setNewMgrName}
          placeholder="Nguyễn Văn A"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
          ]}
        />

        <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Mật khẩu Quản lý *</Text>
        <TextInput
          value={newMgrSecret}
          onChangeText={setNewMgrSecret}
          secureTextEntry
          placeholder="Tối thiểu 4 ký tự"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
          ]}
        />

        <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
          Tài khoản Nhân viên kiểm kho (Tùy chọn)
        </Text>
        <TextInput
          value={newStaffUser}
          onChangeText={setNewStaffUser}
          autoCapitalize="none"
          placeholder="nhanvien_01"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
          ]}
        />
        <TextInput
          value={newStaffSecret}
          onChangeText={setNewStaffSecret}
          secureTextEntry
          placeholder="Mật khẩu nhân viên"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
          ]}
        />
        {errorMsg ? <Text style={[styles.errText, { color: theme.danger }]}>{errorMsg}</Text> : null}
      </View>
    ),
    [
      theme,
      newStoreName,
      selectedTemplate,
      newMgrUser,
      newMgrName,
      newMgrSecret,
      newStaffUser,
      newStaffSecret,
      errorMsg,
    ],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <KeyboardAvoidingView
        style={styles.flexOne}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          data={loginBlocks}
          renderItem={renderLoginBlock}
          keyExtractor={(item) => item}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      </KeyboardAvoidingView>

      <Modal visible={registerModal} animationType="slide" onRequestClose={() => setRegisterModal(false)}>
        <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
          <View style={[styles.modalHeader, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Khởi tạo Cửa hàng mới</Text>
            <Pressable
              onPress={() => setRegisterModal(false)}
              accessibilityRole="button"
              accessibilityLabel="Đóng đăng ký cửa hàng"
              android_ripple={{ color: theme.ripple }}
              style={({ pressed }) => [
                styles.closeBtn,
                { backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>
          <FlatList
            data={registerSections}
            renderItem={renderRegisterSection}
            keyExtractor={(i) => i}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          />
          <View style={[styles.modalFooter, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
            <ActionButton
              label="Hoàn tất & Tạo kho ngay"
              icon="rocket-outline"
              onPress={() => void handleRegister()}
              loading={isLoading}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flexOne: { flex: 1 },
  listContent: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  heroWrap: {
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
  },
  badgeRow: {
    flexDirection: 'row',
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: '700',
  },
  brandSub: {
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 460,
  },
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 13,
    lineHeight: 19,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  input: {
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 15,
  },
  errText: {
    fontSize: 13,
    fontWeight: '500',
  },
  serverHeader: {
    minHeight: TOUCH_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  serverLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
  },
  serverTitle: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  serverBody: {
    gap: SPACING.sm,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 18, fontWeight: '600' },
  closeBtn: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalFooter: {
    padding: SPACING.lg,
    borderTopWidth: 1,
  },
});
