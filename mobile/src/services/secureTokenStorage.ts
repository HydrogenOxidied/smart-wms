import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_STORAGE_KEY = 'pocketwms_access_token';
const SERVER_URL_KEY = 'pocketwms_server_url';

export async function saveSecureToken(tokenValue: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, tokenValue);
    } catch {
      // Ignore storage errors in restricted web contexts
    }
    return;
  }
  await SecureStore.setItemAsync(TOKEN_STORAGE_KEY, tokenValue);
}

export async function loadSecureToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(TOKEN_STORAGE_KEY);
}

export async function clearSecureToken(): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // Ignore
    }
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
}

export async function saveServerUrl(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(SERVER_URL_KEY, url);
    } catch {
      // Ignore
    }
    return;
  }
  await SecureStore.setItemAsync(SERVER_URL_KEY, url);
}

export async function loadServerUrl(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(SERVER_URL_KEY);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(SERVER_URL_KEY);
}
