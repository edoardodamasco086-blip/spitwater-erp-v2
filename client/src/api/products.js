import client from './client';

export const productsApi = {
  // Products
  list:        (params = {}) => client.get('/products', { params }),
  get:         (id)          => client.get(`/products/${id}`),
  create:      (data)        => client.post('/products', data),
  update:      (id, data)    => client.patch(`/products/${id}`, data),
  void:        (id, reason)  => client.patch(`/products/${id}/void`, { reason }),

  // Categories
  categories:       ()          => client.get('/products/categories'),
  createCategory:   (data)      => client.post('/products/categories', data),
  updateCategory:   (id, data)  => client.patch(`/products/categories/${id}`, data),

  // UOM
  uom:        ()     => client.get('/products/uom'),
  createUom:  (data) => client.post('/products/uom', data),

  // Price lists
  priceLists:       ()      => client.get('/products/price-lists'),
  createPriceList:  (data)  => client.post('/products/price-lists', data),

  // Custom fields
  customFields:      ()          => client.get('/products/custom-fields'),
  createCustomField: (data)      => client.post('/products/custom-fields', data),
  getCustomValues:   (id)        => client.get(`/products/${id}/custom-values`),
  saveCustomValues:  (id, values)=> client.put(`/products/${id}/custom-values`, { values }),

  // Pricing
  getPricing:  (id)         => client.get(`/products/${id}/pricing`),
  savePricing: (id, prices) => client.put(`/products/${id}/pricing`, { prices }),

  // Stock
  getStock: (id) => client.get(`/products/${id}/stock`),

  // Images — uses FormData
  uploadImage: (id, file, altText) => {
    const fd = new FormData();
    fd.append('image', file);
    if (altText) fd.append('alt_text', altText);
    return client.post(`/products/${id}/images`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  setPrimaryImage: (id, imgId) => client.patch(`/products/${id}/images/${imgId}/primary`),
  deleteImage:     (id, imgId) => client.delete(`/products/${id}/images/${imgId}`),

  // Documents — uses FormData
  uploadDocument: (id, file, description, visibleToDealer, visibleToCustomer) => {
    const fd = new FormData();
    fd.append('document', file);
    if (description)        fd.append('description',            description);
    if (visibleToDealer)    fd.append('is_visible_to_dealer',   '1');
    if (visibleToCustomer)  fd.append('is_visible_to_customer', '1');
    return client.post(`/products/${id}/documents`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deleteDocument: (id, docId) => client.delete(`/products/${id}/documents/${docId}`),
};
