import client from './client';

export const dashboardApi = {
  kpis:      () => client.get('/dashboard/kpis'),
  activity:  (limit = 10) => client.get(`/dashboard/activity?limit=${limit}`),
  documents: (limit = 10) => client.get(`/dashboard/documents?limit=${limit}`),
};
