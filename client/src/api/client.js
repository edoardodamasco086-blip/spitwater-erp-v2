// ============================================================
// src/api/client.js
// Central Axios instance. Handles:
//   - Attaching the Bearer token to every request (from memory, not localStorage)
//   - Silently refreshing the access token when it expires (401)
//     The refresh token lives in an HttpOnly cookie — never touched by JS
//   - Logging out when refresh also fails
// ============================================================

import axios from 'axios';

const BASE_URL = '/api'; // Vite proxies this to http://localhost:3000

// ── In-memory access token ────────────────────────────────────
// Never written to localStorage — survives the tab session only.
// The HttpOnly refresh cookie lets us restore the session on reload.
let _accessToken = null;
export function setAccessToken(token)  { _accessToken = token; }
export function clearAccessToken()     { _accessToken = null; }
export function getAccessToken()       { return _accessToken; }

const client = axios.create({
  baseURL:         BASE_URL,
  headers:         { 'Content-Type': 'application/json' },
  timeout:         15000,
  withCredentials: true, // Send HttpOnly cookies on every request
});

// ── Request interceptor — attach access token ─────────────────
client.interceptors.request.use(
  (config) => {
    if (_accessToken) {
      config.headers.Authorization = `Bearer ${_accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor — silent token refresh on 401 ────────
let isRefreshing = false;
let failedQueue  = [];

function processQueue(error, token = null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token);
  });
  failedQueue = [];
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url.includes('/auth/refresh') &&
      !originalRequest.url.includes('/auth/login')
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return client(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // No body needed — refresh token is read from the HttpOnly cookie automatically
        const { data } = await axios.post(
          `${BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        );
        const newToken = data.data.accessToken;

        setAccessToken(newToken);
        client.defaults.headers.Authorization  = `Bearer ${newToken}`;
        originalRequest.headers.Authorization  = `Bearer ${newToken}`;

        processQueue(null, newToken);
        return client(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        forceLogout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

function forceLogout() {
  clearAccessToken();
  if (!window.location.pathname.includes('/login')) {
    window.location.href = '/login';
  }
}

export default client;
