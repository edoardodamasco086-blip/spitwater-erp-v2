import client from './client';

export const bpApi = {
  list:               (params = {})      => client.get('/business-partners', { params }),
  create:             (data)             => client.post('/business-partners', data),
  get:                (id)               => client.get(`/business-partners/${id}`),
  update:             (id, data)         => client.patch(`/business-partners/${id}`, data),
  delete:             (id)               => client.delete(`/business-partners/${id}`),
  get360:             (id)               => client.get(`/business-partners/${id}/360`),
  getRelationships:   (id)               => client.get(`/business-partners/${id}/relationships`),
  addRelationship:    (id, data)         => client.post(`/business-partners/${id}/relationships`, data),
  removeRelationship: (id, relId)        => client.delete(`/business-partners/${id}/relationships/${relId}`),
  enrich:             (id)               => client.post(`/business-partners/${id}/enrich`),
  listProposals:      (params = {})      => client.get('/business-partners/proposals', { params }),
  reviewProposal:     (id, data)         => client.patch(`/business-partners/proposals/${id}`, data),
};
