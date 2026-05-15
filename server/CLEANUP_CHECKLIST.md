# ERP Codebase Cleanup Checklist
Generated: 2026-05-15

## ⚠️ Deprecated API Routes (Safe to Remove After Data Migration)

### Product Supplier Routes
- [ ] `GET/POST/PATCH/DELETE /api/products/:id/suppliers` → `server/routes/product-suppliers.js`
  - **Replace with**: Source List in `server/routes/pir.js`
  - **When safe**: After all product_suppliers data migrated to PIR (run migrate-sourcing-unify.js and verify)

### Supplier Pricing Routes  
- [ ] `GET/POST/PATCH/DELETE /api/product-uom/:productId/supplier-prices` → `server/routes/product-uom.js` (lines 310-401)
  - **Replace with**: PIR Conditions in `server/routes/pir.js`
  - **When safe**: After all product_supplier_prices migrated to pir_conditions

## ⚠️ Deprecated Database Tables (Do NOT Drop Without Data Audit)

- [ ] `product_suppliers` — data migrated to `purchase_info_records`
  - Verify: `SELECT COUNT(*) FROM product_suppliers WHERE contact_id NOT IN (SELECT vendor_id FROM purchase_info_records)`
  - If count = 0: safe to archive
  
- [ ] `product_supplier_prices` — data migrated to `pir_conditions`
  - Verify: run cross-count check before dropping

## ⚠️ Deprecated UI Components

- [ ] `SuppliersTab` inline component in `ProductDetailPage.jsx` — REMOVED in this refactor
- [ ] "Purchase Pricing" section in `PricingTab` — REMOVED in this refactor
- [ ] `productUomApi.listSupplierPrices()` in `client/src/api/productUom.js` — can be removed after verifying no other callers

## ✅ Database Indexes to Verify

Run these to check index coverage:

```sql
-- Check indexes on new FK columns
SELECT t.name AS table_name, i.name AS index_name, c.name AS column_name
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = i.object_id AND c.column_id = ic.column_id
JOIN sys.tables t ON t.object_id = i.object_id
WHERE c.name IN ('bp_id', 'customer_bp_id', 'vendor_bp_id', 'supplier_bp_id',
                 'ship_to_address_id', 'bill_to_address_id', 'legacy_contact_id')
ORDER BY t.name, c.name;
```

Expected: Each FK column should have at least one index.

## ✅ API Response Standardization

All endpoints must return:
```json
{ "success": true, "data": ..., "message": "..." }
// or on error:
{ "success": false, "error": "Human-readable message" }
```

Non-compliant endpoints found during audit:
- [ ] Check all routes that return `res.json({ data: ... })` without `success` field → update to `{ success: true, data: ... }`

## ✅ Cascade/Restrict FK Rules

| Table | FK Column | Rule | Status |
|-------|-----------|------|--------|
| contact_addresses | contact_id → contacts.id | RESTRICT (no orphan addresses) | ⚠️ Verify |
| bp_relationships | person_bp_id → business_partners.id | RESTRICT | ⚠️ Verify |
| bp_relationships | org_bp_id → business_partners.id | RESTRICT | ⚠️ Verify |
| bp_enrichment_proposals | bp_id → business_partners.id | RESTRICT | ⚠️ Verify |
| pir_conditions | pir_id → purchase_info_records.id | CASCADE DELETE (remove conditions when PIR deleted) | ⚠️ Verify |
| pir_scales | pir_condition_id → pir_conditions.id | CASCADE DELETE | ⚠️ Verify |
| sales_orders | customer_bp_id → business_partners.id | RESTRICT (cannot delete BP with open orders) | ⚠️ Add constraint |

To add the SO constraint:
```sql
-- Only run after verifying no orphaned data
ALTER TABLE sales_orders 
ADD CONSTRAINT fk_so_customer_bp FOREIGN KEY (customer_bp_id) REFERENCES business_partners(id);
```

## ✅ Next Steps Priority Order

1. Run smoke tests: `cd server && npm test`
2. Run migration: `node scripts/migrate-sourcing-unify.js`
3. Verify data: cross-count checks above
4. Remove deprecated UI (already done in this refactor)
5. Soft-deprecate API routes (add deprecation headers but keep functional)
6. Schedule table drops for next quarter after audit
