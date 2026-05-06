import client from './client';

export const contactsApi = {
  list:      (params = {}) => client.get('/contacts',              { params }),
  get:       (id)          => client.get(`/contacts/${id}`),
  create:    (data)        => client.post('/contacts',             data),
  update:    (id, data)    => client.patch(`/contacts/${id}`,      data),
  void:      (id, reason)  => client.patch(`/contacts/${id}/void`, { reason }),
  companies: (search = '') => client.get('/contacts/companies/list', { params: { search } }),
  createCompany: (data)    => client.post('/contacts/companies',    data),
};
