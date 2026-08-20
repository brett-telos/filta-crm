import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { UserClaims } from '@workspace/api-client-react';
import { Platform } from 'react-native';

interface AuthState {
  token: string | null;
  user: UserClaims | null;
  isReady: boolean;
  signIn: (token: string, user: UserClaims) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

let _globalToken: string | null = null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserClaims | null>(null);
  const [isReady, setIsReady] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    async function loadAuth() {
      try {
        if (Platform.OS !== 'web') {
          const storedToken = await SecureStore.getItemAsync('filta_token');
          const storedUser = await SecureStore.getItemAsync('filta_user');
          if (storedToken && storedUser) {
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
            _globalToken = storedToken;
          }
        } else {
          const storedToken = localStorage.getItem('filta_token');
          const storedUser = localStorage.getItem('filta_user');
          if (storedToken && storedUser) {
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
            _globalToken = storedToken;
          }
        }
      } catch (e) {
        console.error('Failed to load auth', e);
      } finally {
        setIsReady(true);
      }
    }
    loadAuth();
    setAuthTokenGetter(() => _globalToken);
  }, []);

  const signIn = async (newToken: string, newUser: UserClaims) => {
    setToken(newToken);
    setUser(newUser);
    _globalToken = newToken;
    try {
      if (Platform.OS !== 'web') {
        await SecureStore.setItemAsync('filta_token', newToken);
        await SecureStore.setItemAsync('filta_user', JSON.stringify(newUser));
      } else {
        localStorage.setItem('filta_token', newToken);
        localStorage.setItem('filta_user', JSON.stringify(newUser));
      }
    } catch (e) {
      console.error('Failed to save auth', e);
    }
  };

  const signOut = async () => {
    setToken(null);
    setUser(null);
    _globalToken = null;
    try {
      if (Platform.OS !== 'web') {
        await SecureStore.deleteItemAsync('filta_token');
        await SecureStore.deleteItemAsync('filta_user');
      } else {
        localStorage.removeItem('filta_token');
        localStorage.removeItem('filta_user');
      }
    } catch (e) {
      console.error('Failed to delete auth', e);
    }
    queryClient.clear();
  };

  return (
    <AuthContext.Provider value={{ token, user, isReady, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
