import client from './client';

// ── Quotes ────────────────────────────────────────────────────
export const listQuotes      = (params)     => client.get('/o2c/quotes', { params });
export const createQuote     = (data)       => client.post('/o2c/quotes', data);
export const getQuote        = (id)         => client.get(`/o2c/quotes/${id}`);
export const updateQuote     = (id, data)   => client.patch(`/o2c/quotes/${id}`, data);
export const addQuoteItem    = (id, data)   => client.post(`/o2c/quotes/${id}/items`, data);
export const updateQuoteItem = (id, iid, data) => client.patch(`/o2c/quotes/${id}/items/${iid}`, data);
export const deleteQuoteItem = (id, iid)    => client.delete(`/o2c/quotes/${id}/items/${iid}`);
export const sendQuote       = (id)         => client.post(`/o2c/quotes/${id}/send`);
export const acceptQuote     = (id)         => client.post(`/o2c/quotes/${id}/accept`);
export const rejectQuote     = (id)         => client.post(`/o2c/quotes/${id}/reject`);
export const convertQuote    = (id, data)   => client.post(`/o2c/quotes/${id}/convert`, data);
export const cancelQuote     = (id)         => client.post(`/o2c/quotes/${id}/cancel`);

// ── Sales Orders ──────────────────────────────────────────────
export const listSOs         = (params)     => client.get('/o2c/so', { params });
export const createSO        = (data)       => client.post('/o2c/so', data);
export const getSO           = (id)         => client.get(`/o2c/so/${id}`);
export const updateSO        = (id, data)   => client.patch(`/o2c/so/${id}`, data);
export const addSOItem       = (id, data)   => client.post(`/o2c/so/${id}/items`, data);
export const updateSOItem    = (id, iid, data) => client.patch(`/o2c/so/${id}/items/${iid}`, data);
export const deleteSOItem    = (id, iid)    => client.delete(`/o2c/so/${id}/items/${iid}`);
export const confirmSO       = (id)         => client.post(`/o2c/so/${id}/confirm`);
export const releaseHold     = (id)         => client.post(`/o2c/so/${id}/release-hold`);
export const cancelSO        = (id)         => client.post(`/o2c/so/${id}/cancel`);

// ── Pricing Conditions ────────────────────────────────────────
export const listPricing     = (params)     => client.get('/o2c/pricing', { params });
export const createPricing   = (data)       => client.post('/o2c/pricing', data);
export const updatePricing   = (id, data)   => client.patch(`/o2c/pricing/${id}`, data);
export const deletePricing   = (id)         => client.delete(`/o2c/pricing/${id}`);
export const simulatePrice   = (data)       => client.post('/o2c/pricing/simulate', data);

// ── Outbound Deliveries ───────────────────────────────────────
export const listOutbound    = (params)     => client.get('/o2c/outbound', { params });
export const getOutbound     = (id)         => client.get(`/o2c/outbound/${id}`);
export const updateOutbound  = (id, data)   => client.patch(`/o2c/outbound/${id}`, data);
export const startPicking    = (id)         => client.post(`/o2c/outbound/${id}/start-picking`);
export const pickItem        = (id, iid, data) => client.post(`/o2c/outbound/${id}/items/${iid}/pick`, data);
export const shipDelivery    = (id, data)   => client.post(`/o2c/outbound/${id}/ship`, data);
export const cancelOutbound  = (id)         => client.post(`/o2c/outbound/${id}/cancel`);
