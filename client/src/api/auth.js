import client from './client';

export const authApi = {
  login: (email, password) =>
    client.post('/auth/login', { email, password }),

  logout: (refreshToken) =>
    client.post('/auth/logout', { refreshToken }),

  refresh: (refreshToken) =>
    client.post('/auth/refresh', { refreshToken }),

  me: () =>
    client.get('/auth/me'),

  changePassword: (currentPassword, newPassword) =>
    client.post('/auth/change-password', { currentPassword, newPassword }),
};
