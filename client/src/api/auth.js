import client from './client';

export const authApi = {
  login: (email, password) =>
    client.post('/auth/login', { email, password }),

  logout: () =>
    client.post('/auth/logout', {}),

  refresh: () =>
    client.post('/auth/refresh', {}),

  me: () =>
    client.get('/auth/me'),

  changePassword: (currentPassword, newPassword) =>
    client.post('/auth/change-password', { currentPassword, newPassword }),
};
