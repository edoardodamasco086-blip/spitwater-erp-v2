import client from './client';

export const usersApi = {
  list: ()                        => client.get('/users'),
  get:  (id)                      => client.get(`/users/${id}`),
  update: (id, data)              => client.patch(`/users/${id}`, data),
  changeRole: (id, role)          => client.patch(`/users/${id}/role`, { role }),
  deactivate: (id)                => client.patch(`/users/${id}/deactivate`),
  invite: (email, role, fullName) => client.post('/users/invite', { email, role, full_name: fullName }),
  listInvites: ()                 => client.get('/users/invites/list'),
  revokeInvite: (id)              => client.delete(`/users/invites/${id}`),
};
