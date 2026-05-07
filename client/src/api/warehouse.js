import client from './client';

export const warehouseApi = {
  // Zones
  listZones:  (warehouseId)  => client.get('/warehouse/zones', { params: { warehouse_id: warehouseId } }),
  createZone: (data)         => client.post('/warehouse/zones', data),
  updateZone: (id, data)     => client.patch(`/warehouse/zones/${id}`, data),
  deleteZone: (id)           => client.delete(`/warehouse/zones/${id}`),

  // Bins
  listBins:   (params)       => client.get('/warehouse/bins', { params }),
  createBin:  (data)         => client.post('/warehouse/bins', data),
  updateBin:  (id, data)     => client.patch(`/warehouse/bins/${id}`, data),
  deleteBin:  (id)           => client.delete(`/warehouse/bins/${id}`),

  // Stock
  getStock:     (params)     => client.get('/warehouse/stock', { params }),
  getMovements: (params)     => client.get('/warehouse/stock/movements', { params }),
  adjust:       (data)       => client.post('/warehouse/stock/adjust', data),

  // Reports
  reportStockValue:       (params) => client.get('/warehouse/reports/stock-value',       { params }),
  reportByLocation:       (params) => client.get('/warehouse/reports/by-location',       { params }),
  reportInventoryLevels:  (params) => client.get('/warehouse/reports/inventory-levels',  { params }),
};
