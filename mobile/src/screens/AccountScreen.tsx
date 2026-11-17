import React, { useCallback, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ActionButton,
  ChipOption,
  SegmentedToggle,
  StatusPill,
} from '../components/CommonUI';
import { api } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { ThemePreference, useUiStore } from '../store/uiStore';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { triggerSuccessHaptic } from '../utils/formatters';

const THEME_OPTIONS: ChipOption[] = [
  { key: 'system', label: 'Tự động' },
  { key: 'light', label: 'Sáng' },
  { key: 'dark', label: 'Tối' },
];

export function AccountScreen() {
  const theme = useTheme();
  const { user, store, logout } = useAuthStore();
  const { themePref, setThemePref } = useUiStore();

  const [currentSecret, setCurrentSecret] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [confirmSecret, setConfirmSecret] = useState('');
  const [changingSecret, setChangingSecret] = useState(false);
  const [secretStatus, setSecretStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const handleChangeSecret = useCallback(async () => {
    setSecretStatus(null);
    if (!currentSecret.trim() || newSecret.trim().length < 4) {
      setSecretStatus({ ok: false, text: 'Nhập mật khẩu hiện tại và mật khẩu mới từ 4 ký tự.' });
      return;
    }
    if (newSecret !== confirmSecret) {
      setSecretStatus({ ok: false, text: 'Mật khẩu mới nhập lại không khớp.' });
      return;
    }
    setChangingSecret(true);
    try {
      await api.changeSecret(currentSecret, newSecret);
      await triggerSuccessHaptic();
      setCurrentSecret('');
      setNewSecret('');
      setConfirmSecret('');
      setSecretStatus({ ok: true, text: 'Đã đổi mật khẩu thành công.' });
    } catch (err) {
      setSecretStatus({
        ok: false,
        text: err instanceof Error ? err.message : 'Không đổi được mật khẩu.',
      });
    } finally {
      setChangingSecret(false);
    }
  }, [currentSecret, newSecret, confirmSecret]);

  const blocks = ['profile', 'security', 'theme'];

  const renderBlock = useCallback(
    ({ item }: { item: string }) => {
      if (item === 'profile') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.title, { color: theme.text }]}>{user?.full_name}</Text>
              <StatusPill
                text={user?.role === 'MANAGER' ? 'Chủ kho' : 'Nhân viên'}
                tone={user?.role === 'MANAGER' ? 'primary' : 'secondary'}
              />
            </View>
            <Text style={[styles.subText, { color: theme.textMuted }]}>
              @{user?.username} · {store?.name}
            </Text>
            <ActionButton
              label="Đăng xuất"
              icon="log-out-outline"
              variant="danger"
              onPress={() => void logout()}
            />
          </View>
        );
      }

      if (item === 'security') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.title, { color: theme.text }]}>Đổi mật khẩu</Text>
            <TextInput
              value={currentSecret}
              onChangeText={setCurrentSecret}
              secureTextEntry
              placeholder="Mật khẩu hiện tại (mặc định: 1234)"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />
            <TextInput
              value={newSecret}
              onChangeText={setNewSecret}
              secureTextEntry
              placeholder="Mật khẩu mới (tối thiểu 4 ký tự)"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />
            <TextInput
              value={confirmSecret}
              onChangeText={setConfirmSecret}
              secureTextEntry
              placeholder="Nhập lại mật khẩu mới"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />
            {secretStatus ? (
              <Text style={[styles.subText, { color: secretStatus.ok ? theme.primary : theme.danger }]}>
                {secretStatus.text}
              </Text>
            ) : null}
            <ActionButton
              label="Cập nhật mật khẩu"
              icon="key-outline"
              variant="secondary"
              loading={changingSecret}
              onPress={() => void handleChangeSecret()}
            />
          </View>
        );
      }

      return (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.text }]}>Giao diện</Text>
          <SegmentedToggle
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
      currentSecret,
      newSecret,
      confirmSecret,
      secretStatus,
      changingSecret,
      handleChangeSecret,
      themePref,
      setThemePref,
    ],
  );

  return (
    <KeyboardAvoidingView
      style={styles.flexOne}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        data={blocks}
        renderItem={renderBlock}
        keyExtractor={(i) => i}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
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
  },
  input: {
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 15,
  },
});
