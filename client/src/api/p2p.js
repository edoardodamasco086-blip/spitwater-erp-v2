'use strict';
import api from './client';

// ── Purchase Requisitions ─────────────────────────────────────
export const getPRs        = (params) => api.get('/p2p/requisitions', { params });
export const getPR         = (id)     => api.get(`/p2p/requisitions/${id}`);
export const createPR      = (data)   => api.post('/p2p/requisitions', data);
export const updatePR      = (id, data) => api.patch(`/p2p/requisitions/${id}`, data);
export const addPRItem     = (id, data) => api.post(`/p2p/requisitions/${id}/items`, data);
export const updatePRItem  = (id, itemId, data) => api.patch(`/p2p/requisitions/${id}/items/${itemId}`, data);
export const deletePRItem  = (id, itemId) => api.delete(`/p2p/requisitions/${id}/items/${itemId}`);
export const submitPR      = (id)     => api.post(`/p2p/requisitions/${id}/submit`);
export const approvePR     = (id)     => api.post(`/p2p/requisitions/${id}/approve`);
export const rejectPR      = (id, data) => api.post(`/p2p/requisitions/${id}/reject`, data);
export const cancelPR      = (id)     => api.post(`/p2p/requisitions/${id}/cancel`);

// ── RFQs ─────────────────────────────────────────────────────
export const getRFQs           = (params) => api.get('/p2p/rfq', { params });
export const getRFQ            = (id)     => api.get(`/p2p/rfq/${id}`);
export const createRFQ         = (data)   => api.post('/p2p/rfq', data);
export const updateRFQ         = (id, data) => api.patch(`/p2p/rfq/${id}`, data);
export const manageRFQItems    = (id, data) => api.post(`/p2p/rfq/${id}/items`, data);
export const sendRFQ           = (id)     => api.post(`/p2p/rfq/${id}/send`);
export const addRFQResponse    = (id, data) => api.post(`/p2p/rfq/${id}/responses`, data);
export const addRFQResponseItems = (id, rid, data) => api.post(`/p2p/rfq/${id}/responses/${rid}/items`, data);
export const awardRFQ          = (id, responseId) => api.post(`/p2p/rfq/${id}/award/${responseId}`);
export const cancelRFQ         = (id)     => api.post(`/p2p/rfq/${id}/cancel`);

// ── Purchase Orders ───────────────────────────────────────────
export const getPOs       = (params) => api.get('/p2p/orders', { params });
export const getPO        = (id)     => api.get(`/p2p/orders/${id}`);
export const createPO     = (data)   => api.post('/p2p/orders', data);
export const updatePO     = (id, data) => api.patch(`/p2p/orders/${id}`, data);
export const addPOItem    = (id, data) => api.post(`/p2p/orders/${id}/items`, data);
export const updatePOItem = (id, itemId, data) => api.patch(`/p2p/orders/${id}/items/${itemId}`, data);
export const deletePOItem = (id, itemId) => api.delete(`/p2p/orders/${id}/items/${itemId}`);
export const submitPO     = (id)     => api.post(`/p2p/orders/${id}/submit`);
export const approvePO    = (id, data) => api.post(`/p2p/orders/${id}/approve`, data);
export const rejectPO     = (id, data) => api.post(`/p2p/orders/${id}/reject`, data);
export const sendPO       = (id)     => api.post(`/p2p/orders/${id}/send`);
export const cancelPO     = (id)     => api.post(`/p2p/orders/${id}/cancel`);

// ── Approval Levels ───────────────────────────────────────────
export const getApprovalLevels    = ()       => api.get('/p2p/approval-levels');
export const createApprovalLevel  = (data)   => api.post('/p2p/approval-levels', data);
export const updateApprovalLevel  = (id, data) => api.patch(`/p2p/approval-levels/${id}`, data);
export const deleteApprovalLevel  = (id)     => api.delete(`/p2p/approval-levels/${id}`);

// ── Reports ───────────────────────────────────────────────────
export const getBackorders        = ()       => api.get('/p2p/reports/backorders');
export const getSpendBySupplier   = (params) => api.get('/p2p/reports/spend-by-supplier', { params });
export const getPendingApprovals  = ()       => api.get('/p2p/reports/pending-approvals');
