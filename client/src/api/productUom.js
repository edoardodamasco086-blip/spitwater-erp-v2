import client from './client';

export const productUomApi = {
  // UOM conversions per product
  list:   (productId)      => client.get(`/product-uom/${productId}`),
  add:    (productId, data)=> client.post(`/product-uom/${productId}`, data),
  update: (productId, id, data) => client.patch(`/product-uom/${productId}/${id}`, data),
  remove: (productId, id)  => client.delete(`/product-uom/${productId}/${id}`),

  // Supplier prices
  listSupplierPrices:   (productId)      => client.get(`/product-uom/${productId}/supplier-prices`),
  addSupplierPrice:     (productId, data)=> client.post(`/product-uom/${productId}/supplier-prices`, data),
  updateSupplierPrice:  (productId, id, data) => client.patch(`/product-uom/${productId}/supplier-prices/${id}`, data),
  removeSupplierPrice:  (productId, id)  => client.delete(`/product-uom/${productId}/supplier-prices/${id}`),

  // Customer tiers
  listTiers:       ()         => client.get('/product-uom/tiers'),
  createTier:      (data)     => client.post('/product-uom/tiers', data),
  updateTier:      (id, data) => client.patch(`/product-uom/tiers/${id}`, data),
  deleteTier:      (id)       => client.delete(`/product-uom/tiers/${id}`),
  getTierContacts: (id)       => client.get(`/product-uom/tiers/${id}/contacts`),
  assignContact:   (id, contactId) => client.post(`/product-uom/tiers/${id}/contacts`, { contactId }),
  removeContact:   (id, contactId) => client.delete(`/product-uom/tiers/${id}/contacts/${contactId}`),
};

export const currencyApi = {
  list:    ()           => client.get('/currency'),
  getRate: (from, to)   => client.get(`/currency/rate/${from}/${to}`),
  refresh: ()           => client.post('/currency/refresh'),
  add:     (data)       => client.post('/currency', data),
  update:  (code, data) => client.patch(`/currency/${code}`, data),
};
