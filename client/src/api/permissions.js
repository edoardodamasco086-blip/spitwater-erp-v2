import client from './client';

export const permissionsApi = {
  // Resources
  getResources: ()          => client.get('/permissions/resources'),
  getMyPerms:   ()          => client.get('/permissions/my'),

  // Teams
  listTeams:    ()          => client.get('/permissions/teams'),
  createTeam:   (data)      => client.post('/permissions/teams', data),
  updateTeam:   (id, data)  => client.patch(`/permissions/teams/${id}`, data),
  deleteTeam:   (id)        => client.delete(`/permissions/teams/${id}`),

  // Members
  getMembers:   (id)        => client.get(`/permissions/teams/${id}/members`),
  addMember:    (id, userId)=> client.post(`/permissions/teams/${id}/members`, { userId }),
  removeMember: (id, userId)=> client.delete(`/permissions/teams/${id}/members/${userId}`),

  // Permissions matrix
  getPerms:     (id)        => client.get(`/permissions/teams/${id}/perms`),
  savePerms:    (id, perms) => client.put(`/permissions/teams/${id}/perms`, { permissions: perms }),

  // Users list
  listUsers:    ()          => client.get('/permissions/users/list'),
};
