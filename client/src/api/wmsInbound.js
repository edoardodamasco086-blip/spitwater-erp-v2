import client from './client';

export const wmsInboundApi = {
  list:       (params)         => client.get('/wms/inbound', { params }),
  create:     (data)           => client.post('/wms/inbound', data),
  get:        (id)             => client.get(`/wms/inbound/${id}`),
  update:     (id, data)       => client.patch(`/wms/inbound/${id}`, data),
  addItem:    (id, data)       => client.post(`/wms/inbound/${id}/items`, data),
  updateItem: (id, iid, data)  => client.patch(`/wms/inbound/${id}/items/${iid}`, data),
  removeItem: (id, iid)        => client.delete(`/wms/inbound/${id}/items/${iid}`),
  open:       (id)             => client.post(`/wms/inbound/${id}/open`),
  createHu:   (id, data)       => client.post(`/wms/inbound/${id}/hu`, data),
  listHus:    (id)             => client.get(`/wms/inbound/${id}/hu`),
  scan:       (id, data)       => client.post(`/wms/inbound/${id}/scan`, data),
  confirm:    (id, data)       => client.post(`/wms/inbound/${id}/confirm`, data),
  post:       (id)             => client.post(`/wms/inbound/${id}/post`),
  cancel:     (id)             => client.post(`/wms/inbound/${id}/cancel`),
};

export const wmsPutawayApi = {
  list:   (params)       => client.get('/wms/putaway-rules', { params }),
  create: (data)         => client.post('/wms/putaway-rules', data),
  update: (id, data)     => client.patch(`/wms/putaway-rules/${id}`, data),
  delete: (id)           => client.delete(`/wms/putaway-rules/${id}`),
};
