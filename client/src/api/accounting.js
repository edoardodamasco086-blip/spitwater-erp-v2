import client from './client';

export const accountingApi = {
  // COA
  listAccounts:   (params)   => client.get('/accounting/accounts', { params }),
  createAccount:  (data)     => client.post('/accounting/accounts', data),
  updateAccount:  (id, data) => client.patch(`/accounting/accounts/${id}`, data),
  deleteAccount:  (id)       => client.delete(`/accounting/accounts/${id}`),

  // Journal entries
  listJournals:    (params)   => client.get('/accounting/journals', { params }),
  getJournal:      (id)       => client.get(`/accounting/journals/${id}`),
  postJournal:     (data)     => client.post('/accounting/journals', data),
  reverseJournal:  (id, data) => client.post(`/accounting/journals/${id}/reverse`, data),

  // Account determination (OBYC matrix)
  listDetermination:         (params)   => client.get('/accounting/account-determination', { params }),
  createDetermination:       (data)     => client.post('/accounting/account-determination', data),
  updateDetermination:       (id, data) => client.patch(`/accounting/account-determination/${id}`, data),
  deleteDetermination:       (id)       => client.delete(`/accounting/account-determination/${id}`),

  // Reports
  trialBalance:   (params)            => client.get('/accounting/trial-balance', { params }),
  glRegister:     (accountId, params) => client.get(`/accounting/gl-register/${accountId}`, { params }),
};
