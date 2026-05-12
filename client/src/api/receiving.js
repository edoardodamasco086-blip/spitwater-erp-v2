import client from './client';

export const receivingApi = {
  list:          (params)         => client.get('/receiving', { params }),
  create:        (data)           => client.post('/receiving', data),
  get:           (id)             => client.get(`/receiving/${id}`),
  update:        (id, data)       => client.patch(`/receiving/${id}`, data),
  addLine:       (id, data)       => client.post(`/receiving/${id}/lines`, data),
  removeLine:    (id, lineId)     => client.delete(`/receiving/${id}/lines/${lineId}`),
  complete:      (id)             => client.post(`/receiving/${id}/complete`),
  void:          (id)             => client.post(`/receiving/${id}/void`),
};
