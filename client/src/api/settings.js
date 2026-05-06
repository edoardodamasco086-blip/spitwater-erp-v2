import client from './client';

export const settingsApi = {
  // Org
  getOrg:    ()         => client.get('/settings/org'),
  updateOrg: (data)     => client.patch('/settings/org', data),
  getStats:  ()         => client.get('/settings/org-stats'),

  // SMTP
  listSmtp:    ()       => client.get('/settings/smtp'),
  createSmtp:  (data)   => client.post('/settings/smtp', data),
  updateSmtp:  (id, d)  => client.patch(`/settings/smtp/${id}`, d),
  testSmtp:    (id)     => client.post(`/settings/smtp/${id}/test`),
  deleteSmtp:  (id)     => client.delete(`/settings/smtp/${id}`),

  // Numbering
  listNumbering:   ()       => client.get('/settings/numbering'),
  createNumbering: (data)   => client.post('/settings/numbering', data),
  updateNumbering: (id, d)  => client.patch(`/settings/numbering/${id}`, d),

  // Warehouses
  listWarehouses:   ()      => client.get('/settings/warehouses'),
  createWarehouse:  (data)  => client.post('/settings/warehouses', data),
  updateWarehouse:  (id, d) => client.patch(`/settings/warehouses/${id}`, d),

  // Audit
  getAudit: (params) => client.get('/settings/audit', { params }),
};

export const teamsApi = {
  list:          ()           => client.get('/teams'),
  create:        (data)       => client.post('/teams', data),
  update:        (id, data)   => client.patch(`/teams/${id}`, data),
  remove:        (id)         => client.delete(`/teams/${id}`),
  addMember:     (id, userId) => client.post(`/teams/${id}/members`, { userId }),
  removeMember:  (id, userId) => client.delete(`/teams/${id}/members/${userId}`),
  listUsers:     ()           => client.get('/teams/users/list'),
};

export const inviteApi = {
  verify: (token) => client.get(`/invite/verify?token=${token}`),
  accept: (data)  => client.post('/invite/accept', data),
};
