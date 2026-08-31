import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { trpc } from '@/providers/trpc';

export type AuthUser = {
  id: number;
  email: string;
  displayName: string;
};

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const logoutMutation = trpc.auth.logout.useMutation();

  const refresh = useCallback(async () => {
    await utils.auth.me.invalidate();
  }, [utils]);

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
    await utils.invalidate();
  }, [logoutMutation, utils]);

  const value = useMemo<AuthState>(
    () => ({
      user: me.data ?? null,
      loading: me.isLoading,
      refresh,
      logout,
    }),
    [me.data, me.isLoading, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
