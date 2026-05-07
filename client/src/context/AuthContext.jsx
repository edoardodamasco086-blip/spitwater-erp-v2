import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../api/auth';
import { setAccessToken, clearAccessToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  // ── On mount: restore session via the HttpOnly refresh cookie ──
  // The access token lives only in memory and is gone on reload.
  // Calling /me triggers the Axios interceptor: if the access token is
  // absent/expired it silently calls /auth/refresh (using the cookie),
  // gets a new access token, then retries /me — all transparent.
  useEffect(() => {
    authApi.me()
      .then(({ data }) => {
        setUser(data.data);
      })
      .catch(() => {
        // No valid session — refresh also failed or no cookie
        clearAccessToken();
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // ── Login ─────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    const { data } = await authApi.login(email, password);
    const { accessToken, user: userData } = data.data;

    // Store access token in memory only — refresh token is in HttpOnly cookie
    setAccessToken(accessToken);
    setUser(userData);
    return userData;
  }, []);

  // ── Logout ────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await authApi.logout(); // server clears the HttpOnly cookie
    } catch {
      // Best-effort — always clear local state even if server call fails
    } finally {
      clearAccessToken();
      setUser(null);
    }
  }, []);

  // ── Role helpers ──────────────────────────────────────────────
  const isAdmin      = user?.role === 'super_admin' || user?.role === 'admin';
  const isSuperAdmin = user?.role === 'super_admin';
  const isEditor     = ['super_admin','admin','editor'].includes(user?.role);

  const value = {
    user,
    loading,
    login,
    logout,
    isAdmin,
    isSuperAdmin,
    isEditor,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
