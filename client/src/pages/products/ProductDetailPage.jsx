import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { productsApi } from '../../api/products';
import { productUomApi, currencyApi } from '../../api/productUom';
import { useFieldValidation } from '../../hooks/useFieldValidation';
import RelationshipsTab from './RelationshipsTab';
import styles from './ProductDetailPage.module.css';

const TABS = [
  { key: 'overview',   label: 'Overview'       },
  { key: 'suppliers',  label: 'Suppliers'      },
  { key: 'packaging',  label: 'Packaging'      },
  { key: 'images',     label: 'Images'         },
  { key: 'documents',  label: 'Documents'      },
  { key: 'custom',     label: 'Custom Fields'  },
  { key: 'pricing',    label: 'Pricing'        },
  { key: 'stock',      label: 'Stock'          },
  { key: 'relationships', label: 'Relationships' },
];

function formatCurrency(v) {
  if (v == null) return '-';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 4 }).format(v);
}
function formatQty(v) {
  if (v == null) return '0';
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 4 }).format(v);
}
function formatFileSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1048576).toFixed(1)} MB`;
}


// Flatten category tree preserving hierarchy order for dropdowns
function flattenCategoryTree(tree, depth = 0, result = []) {
  for (const node of tree) {
    result.push({ ...node, depth });
    if (node.children?.length) {
      flattenCategoryTree(node.children, depth + 1, result);
    }
  }
  return result;
}
export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  // Field validation — loads rules from DB, validates on save
  const [categories4Validation, setCategories4Validation] = useState([]);

  const [product,      setProduct]      = useState(null);
  const [categories,   setCategories]   = useState([]); // flat ordered list for dropdown
  const [categoryTree,  setCategoryTree]  = useState([]);
  const [uoms,         setUoms]         = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [customValues, setCustomValues] = useState({});
  const [pricing,      setPricing]      = useState([]);
  const [stock,        setStock]        = useState([]);
  const [loading,      setLoading]      = useState(!isNew);
  const [uomConversions, setUomConversions] = useState([]);
  const [supplierPrices, setSupplierPrices] = useState([]);
  const [productSuppliers, setProductSuppliers] = useState([]);
  const [currencies,     setCurrencies]     = useState([]);
  const [saving,       setSaving]       = useState(false);
  const [activeTab,    setActiveTab]    = useState('overview');
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');
  const [uomLock,      setUomLock]      = useState({ locked: false, reasons: [] });

  // Form state for overview
  const [form, setForm] = useState({
    name: '', product_code: '', barcode: '', description: '',
    product_type: 'product', category_id: '', base_uom_id: '',
    tracking_type: 'none', can_be_sold: true, default_sales_price: '',
    can_be_purchased: true, default_purchase_price: '',
    preferred_supplier_id: '', supplier_part_number: '',
    lead_time_days: 0, min_order_qty: 1, order_multiple: 1,
    min_stock_level: 0, max_stock_level: 0, reorder_qty: 0,
    warranty_months: 0, extended_warranty_months: 0,
    weight_kg: '', length_cm: '', width_cm: '', height_cm: '',
    is_active: true,
  });

  const { rules, errors: fieldErrors, validate: validateFields, liveValidate, clearErrors, isRequired } = useFieldValidation('product', { categories: categories4Validation });

  // Image upload
  const imgInputRef  = useRef(null);
  const docInputRef  = useRef(null);
  const [uploading,  setUploading]  = useState(false);
  const [uploadErr,  setUploadErr]  = useState('');

  useEffect(() => {
    // Load reference data independently so one failure doesn't block others
    productsApi.categories()
      .then(({ data }) => { setCategories(data.flat || []); setCategories4Validation(data.flat || []); })
      .catch(() => {});

    productsApi.uom()
      .then(({ data }) => setUoms(data.data || []))
      .catch(() => {});

    currencyApi.list()
      .then(({ data }) => {
        const curs = data.data || [];
        // Fallback: if no currencies returned, use hardcoded common ones
        if (curs.length === 0) {
          setCurrencies([
            { code: 'AUD', name: 'Australian Dollar', symbol: '$', is_active: true, is_base: true },
            { code: 'USD', name: 'US Dollar',          symbol: '$', is_active: true, is_base: false },
            { code: 'EUR', name: 'Euro',               symbol: '€', is_active: true, is_base: false },
            { code: 'GBP', name: 'British Pound',      symbol: '£', is_active: true, is_base: false },
            { code: 'NZD', name: 'New Zealand Dollar', symbol: '$', is_active: true, is_base: false },
          ]);
        } else {
          setCurrencies(curs);
        }
      })
      .catch(() => {
        // Fallback on error
        setCurrencies([
          { code: 'AUD', name: 'Australian Dollar', symbol: '$', is_active: true, is_base: true },
          { code: 'USD', name: 'US Dollar',          symbol: '$', is_active: true, is_base: false },
          { code: 'EUR', name: 'Euro',               symbol: '€', is_active: true, is_base: false },
        ]);
      });

    // Custom fields: initial load without scope (will be reloaded with category when tab is opened)
    productsApi.customFields(null)
      .then(({ data }) => {
        setCustomFields(data.data || []);
      })
      .catch((err) => {
        console.warn('Custom fields load failed:', err?.response?.data?.error || err.message);
      });

    if (!isNew) loadProduct();
  }, [id]); // eslint-disable-line

  async function loadProduct() {
    setLoading(true);
    try {
      const [prodRes, cvRes, pricingRes, stockRes, uomRes, suppRes, lockRes, suppliersRes] = await Promise.all([
        productsApi.get(id),
        productsApi.getCustomValues(id),
        productsApi.getPricing(id),
        productsApi.getStock(id),
        productUomApi.list(id).catch(() => ({ data: { data: [] } })),
        productUomApi.listSupplierPrices(id).catch(() => ({ data: { data: [] } })),
        productsApi.uomLockStatus(id).catch(() => ({ data: { data: { locked: false, reasons: [] } } })),
        productsApi.getSuppliers(id).catch(() => ({ data: { data: [] } })),
      ]);
      const p = prodRes.data.data;
      const catScopeKey = p.category_id ? String(p.category_id) : null;
      setProduct(p);
      setPricing(pricingRes.data.data);
      setStock(stockRes.data.data);
      setCustomValues(cvRes.data.data || {});
      setUomConversions(uomRes.data.data || []);
      setSupplierPrices(suppRes.data.data || []);
      setUomLock(lockRes.data.data || { locked: false, reasons: [] });
      setProductSuppliers(suppliersRes.data.data || []);
      // Reload custom fields scoped to this product's category
      productsApi.customFields(catScopeKey)
        .then(({ data }) => setCustomFields(data.data || []))
        .catch(() => {});
      // Populate form
      setForm({
        name:                    p.name || '',
        product_code:            p.product_code || '',
        barcode:                 p.barcode || '',
        description:             p.description || '',
        product_type:            p.product_type || 'product',
        category_id:             p.category_id || '',
        base_uom_id:             p.base_uom_id || '',
        tracking_type:           p.tracking_type || 'none',
        can_be_sold:             !!p.can_be_sold,
        default_sales_price:     p.default_sales_price ?? '',
        can_be_purchased:        !!p.can_be_purchased,
        default_purchase_price:  p.default_purchase_price ?? '',
        preferred_supplier_id:   p.preferred_supplier_id || '',
        supplier_part_number:    p.supplier_part_number || '',
        lead_time_days:          p.lead_time_days ?? 0,
        min_order_qty:           p.min_order_qty ?? 1,
        order_multiple:          p.order_multiple ?? 1,
        min_stock_level:         p.min_stock_level ?? 0,
        max_stock_level:         p.max_stock_level ?? 0,
        reorder_qty:             p.reorder_qty ?? 0,
        warranty_months:         p.warranty_months ?? 0,
        extended_warranty_months: p.extended_warranty_months ?? 0,
        weight_kg:               p.weight_kg ?? '',
        length_cm:               p.length_cm ?? '',
        width_cm:                p.width_cm ?? '',
        height_cm:               p.height_cm ?? '',
        is_active:               !!p.is_active,
      });
    } catch (e) { setError('Failed to load product.'); }
    finally { setLoading(false); }
  }

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    setSuccess('');
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Product name is required.'); return; }
    setSaving(true); setError(''); setSuccess('');

    // Run field validation engine (only if rules loaded)
    let cleaned = form;
    if (rules.length > 0) {
      cleaned = validateFields(form);
      if (!cleaned) {
        setSaving(false);
        setError('Please fix the highlighted fields before saving.');
        return;
      }
    }
    try {
      const payload = {
        ...cleaned,
        category_id:             form.category_id            || null,
        base_uom_id:             form.base_uom_id            || null,
        default_sales_price:     parseFloat(form.default_sales_price)    || 0,
        default_purchase_price:  parseFloat(form.default_purchase_price) || 0,
        min_stock_level:         parseFloat(form.min_stock_level)|| 0,
        max_stock_level:         parseFloat(form.max_stock_level)|| 0,
        reorder_qty:             parseFloat(form.reorder_qty)   || 0,
        warranty_months:         parseInt(form.warranty_months) || 0,
        extended_warranty_months: parseInt(form.extended_warranty_months) || 0,
        weight_kg:   form.weight_kg  !== '' ? parseFloat(form.weight_kg)  : null,
        length_cm:   form.length_cm  !== '' ? parseFloat(form.length_cm)  : null,
        width_cm:    form.width_cm   !== '' ? parseFloat(form.width_cm)   : null,
        height_cm:   form.height_cm  !== '' ? parseFloat(form.height_cm)  : null,
      };
      if (isNew) {
        const res = await productsApi.create(payload);
        const newId = res.data.data.id;
        setSuccess(`Product created: ${res.data.data.product_code}`);
        setTimeout(() => navigate(`/products/${newId}`, { replace: true }), 800);
      } else {
        await productsApi.update(id, payload);
        setSuccess('Product saved.');
        setTimeout(() => setSuccess(''), 3000);
        loadProduct();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed.');
    } finally { setSaving(false); }
  }

  async function handleSavePricing() {
    setSaving(true);
    try {
      await productsApi.savePricing(id, pricing.map(p => ({
        price_list_id: p.price_list_id,
        unit_price:    p.unit_price,
        min_qty:       p.min_qty || 1,
        discount_pct:  p.discount_pct || 0,
      })));
      setSuccess('Pricing saved.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError('Failed to save pricing.'); }
    finally { setSaving(false); }
  }

  async function handleSaveCustom() {
    // Validate required fields
    const missing = customFields.filter(f => {
      if (!f.is_required) return false;
      const val = customValues[f.field_key];
      return val === undefined || val === null || val === '';
    });
    if (missing.length > 0) {
      setError(`Required fields missing: ${missing.map(f => f.field_label).join(', ')}`);
      return;
    }
    setSaving(true);
    try {
      await productsApi.saveCustomValues(id, customValues, form.category_id ? String(form.category_id) : null);
      setSuccess('Custom fields saved.');
      setError('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError('Failed to save custom fields.'); }
    finally { setSaving(false); }
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadErr('');
    try {
      await productsApi.uploadImage(id, file);
      loadProduct();
    } catch (err) { setUploadErr(err.response?.data?.error || 'Upload failed.'); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function handleDocUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadErr('');
    try {
      await productsApi.uploadDocument(id, file);
      loadProduct();
    } catch (err) { setUploadErr(err.response?.data?.error || 'Upload failed.'); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function handleSetPrimary(imgId) {
    await productsApi.setPrimaryImage(id, imgId);
    loadProduct();
  }

  async function handleDeleteImage(imgId) {
    if (!confirm('Delete this image?')) return;
    await productsApi.deleteImage(id, imgId);
    loadProduct();
  }

  async function handleDeleteDoc(docId) {
    if (!confirm('Delete this document?')) return;
    await productsApi.deleteDocument(id, docId);
    loadProduct();
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 32, color: 'var(--text-sub)' }}>
      <div className="spinner-dark" /> Loading product...
    </div>
  );

  const images    = product?.images    || [];
  const documents = product?.documents || [];

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.breadcrumb}>
          <button className={styles.backBtn} onClick={() => navigate('/products')}>
            <ArrowIcon /> Products
          </button>
          <span className={styles.breadSep}>/</span>
          <span>{isNew ? 'New Product' : form.name || 'Loading...'}</span>
        </div>
        {!isNew && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span className={`pill ${form.is_active ? 'pill-green' : 'pill-grey'}`}>
              {form.is_active ? 'Active' : 'Inactive'}
            </span>
            {product?.product_code && (
              <span className={styles.codeChip}>{product.product_code}</span>
            )}
          </div>
        )}
      </div>

      {/* Alerts */}
      {error   && <div className={styles.errorBox}><AlertIcon /> {error}</div>}
      {success && <div className={styles.successBox}>{success}</div>}
      {uploadErr && <div className={styles.errorBox}><AlertIcon /> {uploadErr}</div>}

      {/* Tabs */}
      {!isNew && (
        <div className={styles.tabs}>
          {TABS.map(t => (
            <button
              key={t.key}
              className={[styles.tab, activeTab === t.key ? styles.tabActive : ''].join(' ')}
              onClick={() => {
                setActiveTab(t.key);
                // Reload custom fields each time tab is opened to pick up newly created fields
                if (t.key === 'custom') {
                  const scopeKey = form.category_id ? String(form.category_id) : null;
                  productsApi.customFields(scopeKey)
                    .then(({ data }) => setCustomFields(data.data || []))
                    .catch(() => {});
                  productsApi.getCustomValues(id, scopeKey)
                    .then(({ data }) => setCustomValues(data.data || {}))
                    .catch(() => {});
                }
              }}
            >
              {t.label}
              {t.key === 'images'    && images.length > 0    && <span className={styles.tabBadge}>{images.length}</span>}
              {t.key === 'documents' && documents.length > 0 && <span className={styles.tabBadge}>{documents.length}</span>}
            </button>
          ))}
        </div>
      )}

      <div className={styles.body}>

        {/* ── OVERVIEW TAB ── */}
        {(isNew || activeTab === 'overview') && (
          <form className={styles.formLayout} onSubmit={handleSave}>

            {/* Left column — main fields */}
            <div className={styles.mainCol}>

              <div className={styles.card}>
                <div className={styles.cardTitle}>Product Details</div>
                <div className={styles.grid2}>

                  {/* Name */}
                  <div className="form-group" style={{gridColumn:'1/-1'}}>
                    <label className="form-label">
                      Product Name {isRequired('name') && <span className="req-star">*</span>}
                    </label>
                    <input
                      className={['form-input', fieldErrors.name ? 'input-error' : ''].join(' ')}
                      value={form.name}
                      onChange={e => { set('name', e.target.value); clearErrors('name'); }}
                      onBlur={e => liveValidate('name', e.target.value)}
                      placeholder="e.g. SW-1500D Pressure Washer"
                      autoFocus
                    />
                    {fieldErrors.name && <div className="field-error">{fieldErrors.name}</div>}
                  </div>

                  {/* Product Code */}
                  <div className="form-group">
                    <label className="form-label">
                      Product Code {isNew && <span style={{fontWeight:400,color:'var(--text-sub)'}}>(auto-generated if empty)</span>}
                      {isRequired('product_code') && <span className="req-star">*</span>}
                    </label>
                    <input className="form-input" value={form.product_code}
                      onChange={e => set('product_code', e.target.value)}
                      placeholder="SW-00001" style={{ fontFamily: 'DM Mono' }} disabled={!isNew} />
                  </div>

                  {/* Barcode */}
                  <div className="form-group">
                    <label className="form-label">
                      Barcode / EAN {isRequired('barcode') && <span className="req-star">*</span>}
                    </label>
                    <input
                      className={['form-input', fieldErrors.barcode ? 'input-error' : ''].join(' ')}
                      value={form.barcode}
                      onChange={e => { set('barcode', e.target.value); clearErrors('barcode'); }}
                      onBlur={e => liveValidate('barcode', e.target.value)}
                      placeholder="9312345678901" style={{ fontFamily: 'DM Mono' }} />
                    {fieldErrors.barcode && <div className="field-error">{fieldErrors.barcode}</div>}
                  </div>

                  {/* Product Type */}
                  <div className="form-group">
                    <label className="form-label">Product Type</label>
                    <select className="form-input" value={form.product_type} onChange={e => set('product_type', e.target.value)}>
                      <option value="product">Product</option>
                      <option value="service">Service</option>
                      <option value="component">Component</option>
                      <option value="kit">Kit / Bundle</option>
                    </select>
                  </div>

                  {/* Category */}
                  <div className="form-group">
                    <label className="form-label">
                      Category {isRequired('category_id') && <span className="req-star">*</span>}
                    </label>
                    <select
                      className={['form-input', fieldErrors.category_id ? 'input-error' : ''].join(' ')}
                      value={form.category_id}
                      onChange={e => { set('category_id', e.target.value); clearErrors('category_id'); }}
                      onBlur={e => liveValidate('category_id', e.target.value)}
                    >
                      <option value="">No category</option>
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}
                          disabled={!!cat.has_children}
                          style={cat.has_children ? { color: 'var(--text-sub)', fontStyle: 'italic' } : {}}>
                          {'\u00A0\u00A0'.repeat(cat.depth || 0)}{(cat.depth || 0) > 0 ? '— ' : ''}{cat.name}{cat.has_children ? ' (select a subcategory)' : ''}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.category_id && <div className="field-error">{fieldErrors.category_id}</div>}
                  </div>

                  {/* Unit of Measure */}
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Unit of Measure {isRequired('base_uom_id') && <span className="req-star">*</span>}
                      {!isNew && uomLock.locked && (
                        <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 600, background: '#fef3cd', color: '#856404', border: '1px solid #ffc107', borderRadius: 4, padding: '1px 6px', letterSpacing: '0.04em' }}>
                          🔒 LOCKED
                        </span>
                      )}
                    </label>
                    <select
                      className={['form-input', fieldErrors.base_uom_id ? 'input-error' : ''].join(' ')}
                      value={form.base_uom_id}
                      disabled={!isNew && uomLock.locked}
                      style={!isNew && uomLock.locked ? { opacity: 0.65, cursor: 'not-allowed', background: 'var(--bg)' } : {}}
                      onChange={e => { set('base_uom_id', e.target.value); clearErrors('base_uom_id'); }}
                      onBlur={e => liveValidate('base_uom_id', e.target.value)}
                    >
                      <option value="">Select UOM...</option>
                      {uoms.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                    </select>
                    {fieldErrors.base_uom_id && <div className="field-error">{fieldErrors.base_uom_id}</div>}
                    {!isNew && uomLock.locked && (
                      <div style={{ marginTop: 5, fontSize: 11, color: '#856404', background: '#fffbea', border: '1px solid #ffc10730', borderRadius: 5, padding: '5px 8px', lineHeight: 1.5 }}>
                        <strong>Why locked?</strong> {uomLock.reasons.join(' · ')}
                      </div>
                    )}
                  </div>

                  {/* Tracking */}
                  <div className="form-group">
                    <label className="form-label">Serial / Lot Tracking</label>
                    <select className="form-input" value={form.tracking_type} onChange={e => set('tracking_type', e.target.value)}>
                      <option value="none">No tracking</option>
                      <option value="serial">Serial number</option>
                      <option value="lot">Lot / batch</option>
                    </select>
                  </div>

                  {/* Description */}
                  <div className="form-group" style={{gridColumn:'1/-1'}}>
                    <label className="form-label">
                      Description {isRequired('description') && <span className="req-star">*</span>}
                    </label>
                    <textarea className="form-input" rows={4} style={{ resize: 'vertical' }}
                      value={form.description}
                      onChange={e => set('description', e.target.value)}
                      placeholder="Product description, features, specifications..." />
                  </div>

                </div>
              </div>

              {/* Can be sold/purchased flags — kept for document logic */}
              <div className={styles.card}>
                <div className={styles.cardTitle}>Sales & Purchasing</div>
                <div style={{display:'flex',gap:24,marginBottom:4}}>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13.5}}>
                    <input type="checkbox" checked={form.can_be_sold} onChange={e => set('can_be_sold', e.target.checked)} style={{accentColor:'var(--accent)',width:15,height:15}} />
                    Can be sold
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13.5}}>
                    <input type="checkbox" checked={form.can_be_purchased} onChange={e => set('can_be_purchased', e.target.checked)} style={{accentColor:'var(--accent)',width:15,height:15}} />
                    Can be purchased
                  </label>
                </div>
                <div style={{fontSize:12,color:'var(--text-sub)',marginTop:6}}>
                  Pricing is managed per UOM in the <button type="button" className="btn-link" onClick={() => setActiveTab('pricing')}>Pricing tab</button>.
                </div>
              </div>

              {/* Stock thresholds (kept) */}
              <div className={styles.card}>
                <div className={styles.cardTitle}>Purchasing &amp; Stock</div>
                <div className={styles.grid3}>
                  <div className="form-group">
                    <label className="form-label">Min stock level</label>
                    <input className="form-input" type="number" step="0.0001" min="0" value={form.min_stock_level} onChange={e => set('min_stock_level', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max stock level</label>
                    <input className="form-input" type="number" step="0.0001" min="0" value={form.max_stock_level} onChange={e => set('max_stock_level', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Reorder qty</label>
                    <input className="form-input" type="number" step="0.0001" min="0" value={form.reorder_qty} onChange={e => set('reorder_qty', e.target.value)} />
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-sub)', marginTop: 6 }}>
                  Lead time, MOQ and order multiple are managed per supplier in the <button type="button" className="btn-link" onClick={() => setActiveTab('suppliers')}>Suppliers tab</button>.
                </div>
              </div>

              {/* Warranty — kept here, physical moved to Packaging tab */}
              <div className={styles.card}>
                <div className={styles.cardTitle}>Warranty</div>
                <div className={styles.grid4}>
                  <div className="form-group">
                    <label className="form-label">Warranty (months)</label>
                    <input className="form-input" type="number" min="0" value={form.warranty_months} onChange={e => set('warranty_months', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Extended warranty (months)</label>
                    <input className="form-input" type="number" min="0" value={form.extended_warranty_months} onChange={e => set('extended_warranty_months', e.target.value)} />
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-sub)', marginTop: 6 }}>
                  Physical dimensions and packaging formats are managed in the <button type="button" className="btn-link" onClick={() => setActiveTab('packaging')}>Packaging tab</button>.
                </div>
              </div>
            </div>

            {/* Right column — meta */}
            <div className={styles.sideCol}>
              {/* Primary image */}
              {!isNew && (
                <div className={styles.card}>
                  <div className={styles.cardTitle}>Primary Image</div>
                  {product?.primary_image_url ? (() => {
                    const parts = product.primary_image_url.split('.');
                    const ext = parts.pop();
                    const mdUrl = `${parts.join('.')}_md.${ext}`;
                    return <img src={mdUrl} alt={form.name} className={styles.primaryImg} onError={(e) => { e.target.src = product.primary_image_url; }} />;
                  })() : (
                    <div className={styles.noImage}>No image yet</div>
                  )}
                  <button type="button" className="btn btn-outline btn-sm" style={{marginTop:10,width:'100%'}} onClick={() => setActiveTab('images')}>
                    Manage images
                  </button>
                </div>
              )}

              {/* Status */}
              <div className={styles.card}>
                <div className={styles.cardTitle}>Status</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5 }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} style={{ accentColor: 'var(--accent)', width: 16, height: 16 }} />
                  Active (visible in documents & portal)
                </label>
              </div>

              {/* Preferred Supplier — read-only, managed via Suppliers tab */}
              {!isNew && (() => {
                const preferred = productSuppliers.find(s => s.is_preferred) || productSuppliers[0];
                return (
                  <div className={styles.card}>
                    <div className={styles.cardTitle}>Preferred Supplier</div>
                    {preferred ? (
                      <>
                        <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>{preferred.supplier_name}</div>
                        {preferred.supplier_part_number && (
                          <div style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--text-sub)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', display: 'inline-block', marginBottom: 6 }}>
                            {preferred.supplier_part_number}
                          </div>
                        )}
                        {preferred.lead_time_days > 0 && (
                          <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>Lead time: {preferred.lead_time_days} day{preferred.lead_time_days !== 1 ? 's' : ''}</div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: 'var(--text-sub)' }}>No supplier linked yet.</div>
                    )}
                    <button type="button" className="btn btn-outline btn-sm" style={{ width: '100%', marginTop: 10 }} onClick={() => setActiveTab('suppliers')}>
                      Manage suppliers
                    </button>
                  </div>
                );
              })()}

              {/* Save button */}
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={saving || !form.name.trim()}>
                {saving ? <><span className="spinner" /> Saving...</> : isNew ? 'Create product' : 'Save changes'}
              </button>

              {!isNew && (
                <button type="button" className="btn btn-outline" style={{ width: '100%' }}
                  onClick={() => { if (confirm('Archive this product?')) productsApi.void(id, 'Archived by user').then(() => navigate('/products')); }}>
                  Archive product
                </button>
              )}
            </div>
          </form>
        )}

        {/* ── IMAGES TAB ── */}
        {!isNew && activeTab === 'images' && (
          <div className={styles.tabContent}>
            <div className={styles.uploadArea}>
              <input ref={imgInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
              <button className={styles.uploadBtn} onClick={() => imgInputRef.current.click()} disabled={uploading}>
                {uploading ? <><span className="spinner-dark" /> Uploading...</> : <><UploadIcon /> Upload image</>}
              </button>
              <div className={styles.uploadHint}>JPEG, PNG, WebP — max 10 MB</div>
            </div>

            {images.length === 0 ? (
              <div className={styles.emptyTab}>No images uploaded yet.</div>
            ) : (
              <div className={styles.imageGrid}>
                {images.map(img => {
                  const parts = img.image_url.split('.');
                  const ext = parts.pop();
                  const mdUrl = `${parts.join('.')}_md.${ext}`;
                  return (
                    <div key={img.id} className={[styles.imageCard, img.is_primary ? styles.imagePrimary : ''].join(' ')}>
                      <img src={mdUrl} alt={img.alt_text || form.name} className={styles.imagePreview} onError={(e) => { e.target.src = img.image_url; }} />
                      {img.is_primary && <div className={styles.primaryBadge}>Primary</div>}
                      <div className={styles.imageActions}>
                        {!img.is_primary && (
                          <button className="btn btn-outline btn-sm" onClick={() => handleSetPrimary(img.id)}>Set primary</button>
                        )}
                        <a href={img.image_url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" style={{textDecoration:'none',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>Download</a>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteImage(img.id)}>Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── DOCUMENTS TAB ── */}
        {!isNew && activeTab === 'documents' && (
          <div className={styles.tabContent}>
            <div className={styles.uploadArea}>
              <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.png" style={{ display: 'none' }} onChange={handleDocUpload} />
              <button className={styles.uploadBtn} onClick={() => docInputRef.current.click()} disabled={uploading}>
                {uploading ? <><span className="spinner-dark" /> Uploading...</> : <><UploadIcon /> Upload document</>}
              </button>
              <div className={styles.uploadHint}>PDF, Word, Excel, images — max 50 MB</div>
            </div>

            {documents.length === 0 ? (
              <div className={styles.emptyTab}>No documents uploaded yet. Upload spec sheets, manuals, MSDS etc.</div>
            ) : (
              <div className={styles.docList}>
                {documents.map(doc => (
                  <div key={doc.id} className={styles.docRow}>
                    <div className={styles.docIcon}><DocIcon mime={doc.mime_type} /></div>
                    <div className={styles.docInfo}>
                      <div className={styles.docName}>{doc.file_name}</div>
                      <div className={styles.docMeta}>
                        {formatFileSize(doc.file_size)}
                        {doc.description && ` · ${doc.description}`}
                        {doc.is_visible_to_dealer    && ' · Dealer visible'}
                        {doc.is_visible_to_customer  && ' · Customer visible'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <a href={`/uploads/${doc.storage_path}`} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">Download</a>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDeleteDoc(doc.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── CUSTOM FIELDS TAB ── */}
        {!isNew && activeTab === 'custom' && (
          <div className={styles.tabContent}>
            {customFields.length === 0 ? (
              <div className={styles.emptyTab}>
                No custom fields defined for products yet.
                <button className="btn btn-outline btn-sm" style={{marginTop:12}} onClick={() => navigate('/admin/products/custom-fields')}>
                  Add custom fields
                </button>
              </div>
            ) : (
              <div style={{ maxWidth: 860 }}>
                <div className={styles.card}>
                  <div className={styles.cardTitle}>Custom Fields</div>
                  <div className={styles.grid2}>
                    {customFields.map(field => {
                      const val = customValues[field.field_key];
                      const isEmpty = val === undefined || val === null || val === '';
                      const showRequired = field.is_required && isEmpty;
                      const fullWidth = field.field_type === 'textarea';
                      return (
                        <div
                          key={field.id}
                          className="form-group"
                          style={{ gridColumn: fullWidth ? '1 / -1' : undefined, marginBottom: 0 }}
                        >
                          <label className="form-label">
                            {field.field_label}
                            {field.is_required && <span style={{color:'var(--red)',marginLeft:3}}>*</span>}
                          </label>
                          {field.help_text && <div style={{fontSize:11.5,color:'var(--text-sub)',marginBottom:5}}>{field.help_text}</div>}

                          {field.field_type === 'text' && (
                            <input className={['form-input', showRequired ? 'error' : ''].join(' ')} value={customValues[field.field_key] || ''} onChange={e => setCustomValues(v => ({...v,[field.field_key]:e.target.value}))} placeholder={field.placeholder || ''} />
                          )}
                          {field.field_type === 'textarea' && (
                            <textarea className="form-input" rows={3} value={customValues[field.field_key] || ''} onChange={e => setCustomValues(v => ({...v,[field.field_key]:e.target.value}))} />
                          )}
                          {field.field_type === 'number' && (
                            <input className={['form-input', showRequired ? 'error' : ''].join(' ')} type="number" value={customValues[field.field_key] ?? ''} onChange={e => setCustomValues(v => ({...v,[field.field_key]:e.target.value}))} />
                          )}
                          {field.field_type === 'boolean' && (
                            <label style={{display:'flex',alignItems:'center',gap:7,cursor:'pointer',fontSize:13.5}}>
                              <input type="checkbox" checked={!!customValues[field.field_key]} onChange={e => setCustomValues(v => ({...v,[field.field_key]:e.target.checked}))} style={{accentColor:'var(--accent)',width:15,height:15}} />
                              Yes
                            </label>
                          )}
                          {field.field_type === 'date' && (
                            <input className="form-input" type="date" value={customValues[field.field_key] || ''} onChange={e => setCustomValues(v => ({...v,[field.field_key]:e.target.value}))} />
                          )}
                          {(field.field_type === 'select' || field.field_type === 'multi_select') && (
                            <select className="form-input" value={customValues[field.field_key] || ''} onChange={e => setCustomValues(v => ({...v,[field.field_key]:e.target.value}))}>
                              <option value="">Select...</option>
                              {field.options?.map(o => <option key={o.option_key} value={o.option_key}>{o.option_label}</option>)}
                            </select>
                          )}
                          {showRequired && (
                            <div style={{fontSize:11.5,color:'var(--red)',marginTop:4}}>This field is required</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                  <button className="btn btn-primary" onClick={handleSaveCustom} disabled={saving}>
                    {saving ? 'Saving...' : 'Save custom fields'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}


        {/* ── PRICING TAB ── */}
        {!isNew && activeTab === 'pricing' && (
          <div className={styles.tabContent}>
            <PricingTab
              productId={id}
              baseUomId={form.base_uom_id}
              pricing={pricing}
              setPricing={setPricing}
              uomConversions={uomConversions}
              supplierPrices={supplierPrices}
              setSupplierPrices={setSupplierPrices}
              uoms={uoms}
              currencies={currencies}
              saving={saving}
              onSavePricing={handleSavePricing}
              navigate={navigate}
              productSuppliers={productSuppliers}
              onReloadSupplier={async () => {
                const r = await productUomApi.listSupplierPrices(id);
                setSupplierPrices(r.data.data || []);
              }}
            />
          </div>
        )}

        {/* ── RELATIONSHIPS TAB ── */}
        {!isNew && activeTab === 'relationships' && (
          <div className={styles.tabContent}>
            <RelationshipsTab productId={id} />
          </div>
        )}

        {/* ── STOCK TAB ── */}
        {!isNew && activeTab === 'stock' && (
          <div className={styles.tabContent}>
            {stock.length === 0 ? (
              <div className={styles.emptyTab}>No stock levels recorded yet. Stock is updated when goods receipts are posted.</div>
            ) : (
              <>
                <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Warehouse</th>
                        <th>On hand</th>
                        <th>Reserved</th>
                        <th>Available</th>
                        <th>On order</th>
                        <th>Last updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stock.map(s => (
                        <tr key={s.id}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{s.warehouse_name}</div>
                            <div style={{ fontSize: 11.5, fontFamily: 'DM Mono', color: 'var(--text-sub)' }}>{s.warehouse_code}</div>
                          </td>
                          <td style={{ fontFamily: 'DM Mono', fontWeight: 600 }}>{formatQty(s.qty_on_hand)}</td>
                          <td style={{ fontFamily: 'DM Mono', color: 'var(--orange)' }}>{formatQty(s.qty_reserved)}</td>
                          <td style={{ fontFamily: 'DM Mono', color: s.qty_available > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                            {formatQty(s.qty_available)}
                          </td>
                          <td style={{ fontFamily: 'DM Mono', color: 'var(--accent)' }}>{formatQty(s.qty_on_order)}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                            {new Date(s.updated_at).toLocaleDateString('en-AU')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg)', borderRadius: 8, fontSize: 13, color: 'var(--text-sub)' }}>
                  Total on hand: <strong>{formatQty(stock.reduce((s, r) => s + (r.qty_on_hand || 0), 0))}</strong>
                  {' · '}
                  Total available: <strong>{formatQty(stock.reduce((s, r) => s + (r.qty_available || 0), 0))}</strong>
                </div>
              </>
            )}
          </div>
        )}
        {/* ── SUPPLIERS TAB ── */}
        {!isNew && activeTab === 'suppliers' && (
          <div className={styles.tabContent}>
            <SuppliersTab
              productId={id}
              productSuppliers={productSuppliers}
              onReload={async () => {
                const r = await productsApi.getSuppliers(id);
                setProductSuppliers(r.data.data || []);
              }}
            />
          </div>
        )}

        {/* ── PACKAGING TAB ── */}
        {!isNew && activeTab === 'packaging' && (
          <div className={styles.tabContent}>
            <PackagingTab
              productId={id}
              uoms={uoms}
              uomConversions={uomConversions}
              baseUom={uoms.find(u => u.id === parseInt(form.base_uom_id))}
              productForm={form}
              onSaveProduct={handleSave}
              saving={saving}
              onReload={async () => {
                const r = await productUomApi.list(id);
                setUomConversions(r.data.data || []);
              }}
            />
          </div>
        )}

      </div>
    </div>
  );
}

function DocIcon({ mime }) {
  const isImg = mime?.startsWith('image');
  const isPdf = mime === 'application/pdf';
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 6,
      background: isPdf ? 'var(--red-dim)' : isImg ? 'var(--accent-dim)' : 'var(--bg)',
      border: '1px solid var(--border)',
      display: 'grid', placeItems: 'center',
      fontSize: 10, fontWeight: 700, color: isPdf ? 'var(--red)' : 'var(--accent)',
    }}>
      {isPdf ? 'PDF' : isImg ? 'IMG' : 'DOC'}
    </div>
  );
}

function SvgIcon({ children, size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
function ArrowIcon()    { return <SvgIcon><polyline points="15 18 9 12 15 6"/></SvgIcon>; }
function AlertIcon()    { return <SvgIcon size={14}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></SvgIcon>; }
function UploadIcon()   { return <SvgIcon><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></SvgIcon>; }
function PlusIcon()     { return <SvgIcon><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function TrashIcon()    { return <SvgIcon size={13}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></SvgIcon>; }
function PlusSmIcon()   { return <SvgIcon size={13}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function TrashSmIcon()  { return <SvgIcon size={12}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></SvgIcon>; }

// ── SuppliersTab ─────────────────────────────────────────────
function SuppliersTab({ productId, productSuppliers, onReload }) {
  const PILL = { purchase: 'pill-green', sales: 'pill-orange', other: 'pill-grey' };
  const [allSuppliers, setAllSuppliers] = useState([]);
  const [edits,    setEdits]    = useState({});
  const [saving2,  setSaving2]  = useState({});
  const [showAdd,  setShowAdd]  = useState(false);
  const [addSaving,setAddSaving]= useState(false);
  const [addErr,   setAddErr]   = useState('');
  const [newRow,   setNewRow]   = useState({ contact_id: '', supplier_part_number: '', lead_time_days: '', min_order_qty: '', order_multiple: '', notes: '' });

  useEffect(() => {
    fetch('/api/contacts?type=supplier&limit=500', { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` } })
      .then(r => r.json()).then(d => setAllSuppliers(d.data || [])).catch(() => {});
  }, []);

  const linkedIds = new Set(productSuppliers.map(s => s.contact_id));
  const available = allSuppliers.filter(s => !linkedIds.has(s.id));

  function startEdit(s) {
    setEdits(e => ({ ...e, [s.id]: {
      supplier_part_number: s.supplier_part_number || '',
      lead_time_days:  String(s.lead_time_days ?? ''),
      min_order_qty:   String(s.min_order_qty  ?? ''),
      order_multiple:  String(s.order_multiple ?? ''),
      notes:           s.notes || '',
    }}));
  }
  function cancelEdit(id) { setEdits(e => { const n={...e}; delete n[id]; return n; }); }
  function setField(id, field, val) { setEdits(e => ({ ...e, [id]: { ...e[id], [field]: val } })); }

  async function saveEdit(s) {
    const d = edits[s.id];
    setSaving2(sv => ({ ...sv, [s.id]: true }));
    try {
      await productsApi.updateSupplier(productId, s.id, {
        supplier_part_number: d.supplier_part_number || null,
        lead_time_days:  d.lead_time_days !== '' ? parseInt(d.lead_time_days) : 0,
        min_order_qty:   d.min_order_qty  !== '' ? parseFloat(d.min_order_qty) : 1,
        order_multiple:  d.order_multiple !== '' ? parseFloat(d.order_multiple) : 1,
        notes:           d.notes || null,
      });
      cancelEdit(s.id);
      await onReload();
    } catch(e) { alert(e.response?.data?.error || 'Save failed.'); }
    finally { setSaving2(sv => ({ ...sv, [s.id]: false })); }
  }

  async function handleSetPreferred(id) {
    try { await productsApi.setPreferredSupplier(productId, id); await onReload(); }
    catch(e) { alert(e.response?.data?.error || 'Failed to set default.'); }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this supplier from this product?')) return;
    try { await productsApi.deleteSupplier(productId, id); await onReload(); }
    catch(e) { alert(e.response?.data?.error || 'Remove failed.'); }
  }

  async function handleAdd() {
    if (!newRow.contact_id) { setAddErr('Please select a supplier.'); return; }
    setAddSaving(true); setAddErr('');
    try {
      await productsApi.addSupplier(productId, {
        contact_id:          parseInt(newRow.contact_id),
        supplier_part_number:newRow.supplier_part_number || null,
        lead_time_days:      newRow.lead_time_days !== '' ? parseInt(newRow.lead_time_days) : 0,
        min_order_qty:       newRow.min_order_qty  !== '' ? parseFloat(newRow.min_order_qty) : 1,
        order_multiple:      newRow.order_multiple !== '' ? parseFloat(newRow.order_multiple) : 1,
        notes:               newRow.notes || null,
        is_preferred:        productSuppliers.length === 0, // first one auto-preferred
      });
      setNewRow({ contact_id: '', supplier_part_number: '', lead_time_days: '', min_order_qty: '', order_multiple: '', notes: '' });
      setShowAdd(false);
      await onReload();
    } catch(e) { setAddErr(e.response?.data?.error || 'Failed to add supplier.'); }
    finally { setAddSaving(false); }
  }

  const inputS = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: 12, width: '100%' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Linked Suppliers</div>
          <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 2 }}>Manage which suppliers provide this product, with per-supplier terms.</div>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => { setShowAdd(v => !v); setAddErr(''); }}>
          <PlusSmIcon /> Add supplier
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ padding: '16px 18px', background: 'var(--accent-dim)', border: '1px solid rgba(47,127,232,0.15)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 10 }}>Link a new supplier</div>
          {addErr && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{addErr}</div>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
            <div className="form-group" style={{ flex: '3 1 180px', marginBottom: 0 }}>
              <label className="form-label">Supplier *</label>
              <select className="form-input" value={newRow.contact_id} onChange={e => setNewRow(r => ({...r, contact_id: e.target.value}))}>
                <option value="">Select supplier...</option>
                {available.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: '2 1 130px', marginBottom: 0 }}>
              <label className="form-label">Supplier part number</label>
              <input style={inputS} placeholder="MFR-SKU-001" value={newRow.supplier_part_number} onChange={e => setNewRow(r => ({...r, supplier_part_number: e.target.value}))} />
            </div>
            <div className="form-group" style={{ flex: '1 1 80px', marginBottom: 0 }}>
              <label className="form-label">Lead time (days)</label>
              <input style={inputS} type="number" min="0" placeholder="0" value={newRow.lead_time_days} onChange={e => setNewRow(r => ({...r, lead_time_days: e.target.value}))} />
            </div>
            <div className="form-group" style={{ flex: '1 1 80px', marginBottom: 0 }}>
              <label className="form-label">Min order qty</label>
              <input style={inputS} type="number" step="0.0001" min="0" placeholder="1" value={newRow.min_order_qty} onChange={e => setNewRow(r => ({...r, min_order_qty: e.target.value}))} />
            </div>
            <div className="form-group" style={{ flex: '1 1 80px', marginBottom: 0 }}>
              <label className="form-label">Order multiple</label>
              <input style={inputS} type="number" step="0.0001" min="0" placeholder="1" value={newRow.order_multiple} onChange={e => setNewRow(r => ({...r, order_multiple: e.target.value}))} />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label className="form-label">Notes</label>
            <textarea style={{...inputS, minHeight: 56, resize: 'vertical'}} placeholder="Internal notes about this supplier..." value={newRow.notes} onChange={e => setNewRow(r => ({...r, notes: e.target.value}))} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={addSaving || !newRow.contact_id} onClick={handleAdd}>{addSaving ? '...' : 'Link supplier'}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* List */}
      {productSuppliers.length === 0 && !showAdd ? (
        <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-sub)', fontSize: 13, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}>
          No suppliers linked yet. Click "Add supplier" to start.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {productSuppliers.map(s => {
            const isEditing = Boolean(edits[s.id]);
            const d = edits[s.id] || {};
            return (
              <div key={s.id} style={{ border: `2px solid ${s.is_preferred ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden' }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: s.is_preferred ? 'rgba(47,127,232,0.05)' : 'var(--card)', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.supplier_name}</div>
                    {s.supplier_code && <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>{s.supplier_code}</div>}
                  </div>
                  {s.is_preferred && <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--accent)', color: '#fff', borderRadius: 5, padding: '2px 8px', letterSpacing: '0.05em' }}>⭐ DEFAULT</span>}
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {!s.is_preferred && <button type="button" className="btn btn-outline btn-sm" onClick={() => handleSetPreferred(s.id)}>Set as default</button>}
                    {!isEditing
                      ? <button type="button" className="btn btn-outline btn-sm" onClick={() => startEdit(s)}>Edit</button>
                      : <>
                          <button type="button" className="btn btn-primary btn-sm" disabled={saving2[s.id]} onClick={() => saveEdit(s)}>{saving2[s.id] ? '...' : 'Save'}</button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => cancelEdit(s.id)}>Cancel</button>
                        </>}
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(s.id)}><TrashSmIcon /></button>
                  </div>
                </div>

                {/* Details / edit */}
                {!isEditing ? (
                  <div style={{ padding: '10px 16px', background: 'rgba(240,244,249,0.4)', borderTop: '1px solid var(--border)', display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
                    <div><span style={{ color: 'var(--text-sub)' }}>Part #: </span><span style={{ fontFamily: 'DM Mono', fontWeight: 500 }}>{s.supplier_part_number || <span style={{ color: 'var(--text-sub)' }}>—</span>}</span></div>
                    <div><span style={{ color: 'var(--text-sub)' }}>Lead time: </span><span style={{ fontFamily: 'DM Mono', fontWeight: 500 }}>{s.lead_time_days > 0 ? `${s.lead_time_days} day${s.lead_time_days !== 1 ? 's' : ''}` : '—'}</span></div>
                    <div><span style={{ color: 'var(--text-sub)' }}>MOQ: </span><span style={{ fontFamily: 'DM Mono', fontWeight: 500 }}>{parseFloat(s.min_order_qty) || '—'}</span></div>
                    <div><span style={{ color: 'var(--text-sub)' }}>Order ×: </span><span style={{ fontFamily: 'DM Mono', fontWeight: 500 }}>{parseFloat(s.order_multiple) || '—'}</span></div>
                    {s.notes && <div style={{ flexBasis: '100%', color: 'var(--text-sub)', fontStyle: 'italic' }}>{s.notes}</div>}
                  </div>
                ) : (
                  <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'rgba(47,127,232,0.02)' }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                      <div className="form-group" style={{ flex: '2 1 140px', marginBottom: 0 }}>
                        <label className="form-label">Supplier part number</label>
                        <input style={inputS} placeholder="MFR-SKU-001" value={d.supplier_part_number} onChange={e => setField(s.id, 'supplier_part_number', e.target.value)} />
                      </div>
                      <div className="form-group" style={{ flex: '1 1 80px', marginBottom: 0 }}>
                        <label className="form-label">Lead time (days)</label>
                        <input style={inputS} type="number" min="0" value={d.lead_time_days} onChange={e => setField(s.id, 'lead_time_days', e.target.value)} />
                      </div>
                      <div className="form-group" style={{ flex: '1 1 80px', marginBottom: 0 }}>
                        <label className="form-label">Min order qty</label>
                        <input style={inputS} type="number" step="0.0001" min="0" value={d.min_order_qty} onChange={e => setField(s.id, 'min_order_qty', e.target.value)} />
                      </div>
                      <div className="form-group" style={{ flex: '1 1 80px', marginBottom: 0 }}>
                        <label className="form-label">Order multiple</label>
                        <input style={inputS} type="number" step="0.0001" min="0" value={d.order_multiple} onChange={e => setField(s.id, 'order_multiple', e.target.value)} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Notes</label>
                      <textarea style={{...inputS, minHeight: 56, resize: 'vertical'}} value={d.notes} onChange={e => setField(s.id, 'notes', e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── PricingTab ─────────────────────────────────────────────────
function PricingTab({ productId, baseUomId, pricing, setPricing, uomConversions, supplierPrices,
  setSupplierPrices, uoms, currencies, saving, onSavePricing, navigate, onReloadSupplier, productSuppliers }) {

  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ contact_id: '', uom_id: '', unit_price: '', currency_code: 'AUD', min_order_qty: 1, lead_time_days: '', notes: '' });
  const [savingSupp, setSavingSupp] = useState(false);

  // Suppliers filtered to only those linked to this product
  const suppliers = productSuppliers || [];

  // Available UOMs = base + all conversions
  const allUoms = uoms.filter(u => 
    u.id === parseInt(baseUomId) || 
    uomConversions.some(c => c.uom_id === u.id)
  );

  const activeCurrencies = currencies.filter(c => c.is_active);

  async function handleAddSupplierPrice() {
    if (!newSupplier.contact_id || !newSupplier.uom_id || !newSupplier.unit_price) return;
    setSavingSupp(true);
    try {
      await productUomApi.addSupplierPrice(productId, {
        ...newSupplier,
        unit_price:     parseFloat(newSupplier.unit_price),
        min_order_qty:  parseFloat(newSupplier.min_order_qty) || 1,
        lead_time_days: newSupplier.lead_time_days ? parseInt(newSupplier.lead_time_days) : null,
      });
      setShowAddSupplier(false);
      setNewSupplier({ contact_id: '', uom_id: '', unit_price: '', currency_code: 'AUD', min_order_qty: 1, lead_time_days: '', notes: '' });
      await onReloadSupplier();
    } finally { setSavingSupp(false); }
  }

  async function handleRemoveSupplierPrice(suppId) {
    if (!confirm('Remove this supplier price?')) return;
    try {
      await productUomApi.removeSupplierPrice(productId, suppId);
      await onReloadSupplier();
    } catch(err) {
      alert(err.response?.data?.error || err.message || 'Failed to remove supplier price.');
    }
  }

  const baseCurrency = currencies.find(c => c.is_base)?.code || 'AUD';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 32 }}>

      {/* ── Sales Pricing ─── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Sales Pricing</div>
            <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 2 }}>
              Prices per price list. Each price list can have multiple rows for different UOMs or quantity breaks.
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={onSavePricing} disabled={saving}>
            {saving ? 'Saving...' : 'Save sales pricing'}
          </button>
        </div>

        {pricing.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-sub)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}>
            No price lists configured.{' '}
            <button className="btn-link" onClick={() => navigate('/settings')}>Create price lists in Settings</button>
          </div>
        ) : (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(240,244,249,0.6)' }}>
                  <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>Price List</th>
                  <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>UOM</th>
                  <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>Currency</th>
                  <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>Unit Price</th>
                  <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>Min Qty</th>
                  <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>Discount %</th>
                </tr>
              </thead>
              <tbody>
                {pricing.map((p, i) => (
                  <tr key={`${p.price_list_id}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 14px' }}>
                      <div style={{ fontWeight: 500 }}>{p.price_list_name}</div>
                      {p.is_default && <div style={{ fontSize: 11, color: 'var(--accent)' }}>Default</div>}
                    </td>
                    <td style={{ padding: '8px 14px' }}>
                      <select style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
                        value={p.uom_id || ''}
                        onChange={e => { const v=[...pricing]; v[i]={...v[i],uom_id:e.target.value||null}; setPricing(v); }}>
                        <option value="">Base UOM</option>
                        {uomConversions.map(u => <option key={u.uom_id} value={u.uom_id}>{u.uom_code} ({u.qty_in_base}x)</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '8px 14px' }}>
                      <select style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
                        value={p.currency_code || baseCurrency}
                        onChange={e => { const v=[...pricing]; v[i]={...v[i],currency_code:e.target.value}; setPricing(v); }}>
                        {activeCurrencies.map(c => <option key={c.code} value={c.code}>{c.code} {c.symbol}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '8px 14px' }}>
                      <input style={{ width: 110, fontFamily: 'DM Mono', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: 13 }}
                        type="number" step="0.0001" min="0" placeholder="Not set"
                        value={p.unit_price ?? ''}
                        onChange={e => { const v=[...pricing]; v[i]={...v[i],unit_price:e.target.value===''?null:parseFloat(e.target.value)}; setPricing(v); }} />
                    </td>
                    <td style={{ padding: '8px 14px' }}>
                      <input style={{ width: 70, fontFamily: 'DM Mono', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: 13 }}
                        type="number" step="0.0001" min="1" value={p.min_qty || 1}
                        onChange={e => { const v=[...pricing]; v[i]={...v[i],min_qty:parseFloat(e.target.value)||1}; setPricing(v); }} />
                    </td>
                    <td style={{ padding: '8px 14px' }}>
                      <input style={{ width: 70, fontFamily: 'DM Mono', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: 13 }}
                        type="number" step="0.01" min="0" max="100" value={p.discount_pct || 0}
                        onChange={e => { const v=[...pricing]; v[i]={...v[i],discount_pct:parseFloat(e.target.value)||0}; setPricing(v); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Purchase / Supplier Pricing ─── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Purchase Pricing</div>
            <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 2 }}>
              Supplier prices per UOM and currency. Automatically converted to {baseCurrency} at today's rate.
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => setShowAddSupplier(v => !v)}>
            <PlusIcon /> Add supplier price
          </button>
        </div>

        {/* Add supplier price form */}
        {showAddSupplier && (
          <div style={{ background: 'var(--accent-dim)', border: '1px solid rgba(47,127,232,0.2)', borderRadius: 8, padding: '14px 16px', marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: '2 1 160px' }}>
              <label className="form-label">Supplier *</label>
              <select className="form-input" value={newSupplier.contact_id} onChange={e => setNewSupplier(s => ({...s, contact_id: e.target.value}))}>
                <option value="">Select supplier...</option>
                {suppliers.map(s => <option key={s.contact_id} value={s.contact_id}>{s.supplier_name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: '1 1 120px' }}>
              <label className="form-label">UOM *</label>
              <select className="form-input" value={newSupplier.uom_id} onChange={e => setNewSupplier(s => ({...s, uom_id: e.target.value}))}>
                <option value="">Select UOM...</option>
                {allUoms.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: '1 1 100px' }}>
              <label className="form-label">Price *</label>
              <input className="form-input" type="number" step="0.0001" min="0" placeholder="0.00" value={newSupplier.unit_price} onChange={e => setNewSupplier(s => ({...s, unit_price: e.target.value}))} style={{ fontFamily: 'DM Mono' }} />
            </div>
            <div className="form-group" style={{ flex: '0 1 90px' }}>
              <label className="form-label">Currency</label>
              <select className="form-input" value={newSupplier.currency_code} onChange={e => setNewSupplier(s => ({...s, currency_code: e.target.value}))}>
                {activeCurrencies.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: '0 1 80px' }}>
              <label className="form-label">Min Qty</label>
              <input className="form-input" type="number" step="1" min="1" value={newSupplier.min_order_qty} onChange={e => setNewSupplier(s => ({...s, min_order_qty: e.target.value}))} />
            </div>
            <div className="form-group" style={{ flex: '0 1 80px' }}>
              <label className="form-label">Lead (days)</label>
              <input className="form-input" type="number" min="0" value={newSupplier.lead_time_days} onChange={e => setNewSupplier(s => ({...s, lead_time_days: e.target.value}))} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-primary btn-sm" disabled={savingSupp || !newSupplier.contact_id || !newSupplier.uom_id || !newSupplier.unit_price} onClick={handleAddSupplierPrice}>
                {savingSupp ? 'Adding...' : 'Add'}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => setShowAddSupplier(false)}>Cancel</button>
            </div>
          </div>
        )}

        {supplierPrices.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-sub)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}>
            No supplier prices yet. Add one above.
          </div>
        ) : (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(240,244,249,0.6)' }}>
                  {['Supplier','UOM','Price','Currency','Rate','AUD Equiv.','Min Qty','Lead (days)',''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {supplierPrices.map(sp => (
                  <tr key={sp.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 500 }}>{sp.supplier_name}</td>
                    <td style={{ padding: '8px 12px' }}><span className="pill pill-grey">{sp.uom_code}</span></td>
                    <td style={{ padding: '8px 12px', fontFamily: 'DM Mono' }}>{parseFloat(sp.unit_price).toFixed(4)}</td>
                    <td style={{ padding: '8px 12px' }}>{sp.currency_code}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'DM Mono', fontSize: 11, color: 'var(--text-sub)' }}>{sp.fx_rate ? sp.fx_rate.toFixed(4) : '—'}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'DM Mono', fontWeight: 600, color: 'var(--accent)' }}>
                      {sp.aud_equiv ? `${baseCurrency} ${parseFloat(sp.aud_equiv).toFixed(4)}` : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'DM Mono' }}>{sp.min_order_qty}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-sub)' }}>{sp.lead_time_days ?? '—'}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <button className="btn btn-danger btn-sm" onClick={() => handleRemoveSupplierPrice(sp.id)}><TrashIcon /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── UOM Conversions Card ───────────────────────────────────────
// ── PackagingTab ─────────────────────────────────────────────────
function PackagingTab({ productId, uoms, uomConversions, baseUom, productForm, onSaveProduct, saving, onReload }) {
  const ROLE_LABELS = { base: 'Base', purchase: 'Purchase', sales: 'Sales', other: 'Other' };
  const ROLE_PILLS  = { base: 'pill-blue', purchase: 'pill-green', sales: 'pill-orange', other: 'pill-grey' };

  // inline-edit state: { [id]: { ...fields } } — null means collapsed
  const [edits,   setEdits]   = useState({});
  const [saving2, setSaving2] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [newRow,  setNewRow]  = useState({ uom_id: '', uom_role: 'purchase', qty_in_base: '', barcode: '', weight_kg: '', length_cm: '', width_cm: '', height_cm: '' });
  const [addSaving, setAddSaving] = useState(false);
  const [addError,  setAddError]  = useState('');

  function startEdit(u) {
    setEdits(e => ({ ...e, [u.id]: {
      uom_role:   u.uom_role,
      qty_in_base: String(u.qty_in_base ?? ''),
      barcode:    u.barcode || '',
      weight_kg:  String(u.weight_kg ?? ''),
      length_cm:  String(u.length_cm ?? ''),
      width_cm:   String(u.width_cm ?? ''),
      height_cm:  String(u.height_cm ?? ''),
    }}));
  }
  function cancelEdit(id) { setEdits(e => { const n = {...e}; delete n[id]; return n; }); }
  function setField(id, field, val) { setEdits(e => ({ ...e, [id]: { ...e[id], [field]: val } })); }

  async function saveEdit(id) {
    const d = edits[id];
    setSaving2(s => ({ ...s, [id]: true }));
    try {
      await productUomApi.update(productId, id, {
        uom_role:   d.uom_role,
        qty_in_base: parseFloat(d.qty_in_base) || 1,
        barcode:    d.barcode || null,
        weight_kg:  d.weight_kg !== '' ? parseFloat(d.weight_kg) : null,
        length_cm:  d.length_cm !== '' ? parseFloat(d.length_cm) : null,
        width_cm:   d.width_cm  !== '' ? parseFloat(d.width_cm)  : null,
        height_cm:  d.height_cm !== '' ? parseFloat(d.height_cm) : null,
      });
      cancelEdit(id);
      await onReload();
    } catch(e) { alert(e.response?.data?.error || 'Save failed.'); }
    finally { setSaving2(s => ({ ...s, [id]: false })); }
  }

  async function handleRemove(id) {
    if (!confirm('Remove this packaging unit?')) return;
    try { await productUomApi.remove(productId, id); await onReload(); }
    catch(e) { alert(e.response?.data?.error || 'Remove failed.'); }
  }

  const addedIds     = new Set(uomConversions.map(u => u.uom_id));
  const availableUoms = uoms.filter(u => !addedIds.has(u.id));

  async function handleAdd() {
    if (!newRow.uom_id || !newRow.qty_in_base) { setAddError('UOM and quantity are required.'); return; }
    setAddSaving(true); setAddError('');
    try {
      await productUomApi.add(productId, {
        uom_id:      parseInt(newRow.uom_id),
        uom_role:    newRow.uom_role,
        qty_in_base: parseFloat(newRow.qty_in_base),
        barcode:     newRow.barcode || null,
        weight_kg:   newRow.weight_kg !== '' ? parseFloat(newRow.weight_kg) : null,
        length_cm:   newRow.length_cm !== '' ? parseFloat(newRow.length_cm) : null,
        width_cm:    newRow.width_cm  !== '' ? parseFloat(newRow.width_cm)  : null,
        height_cm:   newRow.height_cm !== '' ? parseFloat(newRow.height_cm) : null,
      });
      setNewRow({ uom_id: '', uom_role: 'purchase', qty_in_base: '', barcode: '', weight_kg: '', length_cm: '', width_cm: '', height_cm: '' });
      setShowAdd(false);
      await onReload();
    } catch(e) { setAddError(e.response?.data?.error || 'Failed to add.'); }
    finally { setAddSaving(false); }
  }

  const dimStyle = { width: 90, fontFamily: 'DM Mono', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontSize: 12 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Base unit physical info ─────────────────── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '18px 20px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
          Base Unit Physical Dimensions
          {baseUom && <span style={{ marginLeft: 8, fontFamily: 'DM Mono', background: 'var(--accent-dim)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>{baseUom.code}</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 12 }}>
          Dimensions for 1 base unit ({baseUom?.name || 'base'}). These are saved with the main product.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[['weight_kg','Weight (kg)','0.0001'],['length_cm','Length (cm)','0.01'],['width_cm','Width (cm)','0.01'],['height_cm','Height (cm)','0.01']].map(([field, label, step]) => (
            <div key={field} className="form-group">
              <label className="form-label">{label}</label>
              <input className="form-input" type="number" step={step} min="0" placeholder="0.00"
                value={productForm[field]}
                onChange={e => { /* handled by parent form save */ }}
                readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed' }}
              />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-sub)', marginTop: 8 }}>
          Edit base unit dimensions in the <button type="button" className="btn-link" onClick={onSaveProduct}>Overview tab → Save changes</button>.
        </div>
      </div>

      {/* ── Packaging / UOM conversions ─────────────── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Packaging Formats / UOM Conversions</div>
            <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 2 }}>Define alternative packaging (e.g. BOX100 = 100 each). Each format can have its own physical dimensions.</div>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => { setShowAdd(v => !v); setAddError(''); }}>
            <PlusSmIcon /> Add packaging
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--accent-dim)', borderRadius: 8, border: '1px solid rgba(47,127,232,0.15)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--accent)' }}>New packaging format</div>
            {addError && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{addError}</div>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: '2 1 140px', marginBottom: 0 }}>
                <label className="form-label">UOM *</label>
                <select className="form-input" value={newRow.uom_id} onChange={e => setNewRow(r => ({...r, uom_id: e.target.value}))}>
                  <option value="">Select UOM...</option>
                  {availableUoms.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ flex: '1 1 110px', marginBottom: 0 }}>
                <label className="form-label">Role</label>
                <select className="form-input" value={newRow.uom_role} onChange={e => setNewRow(r => ({...r, uom_role: e.target.value}))}>
                  <option value="purchase">Purchase</option>
                  <option value="sales">Sales</option>
                  <option value="base">Base (inventory)</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: '0 1 90px', marginBottom: 0 }}>
                <label className="form-label">Qty in base *</label>
                <input className="form-input" type="number" step="0.000001" min="0.000001" placeholder="100"
                  value={newRow.qty_in_base} onChange={e => setNewRow(r => ({...r, qty_in_base: e.target.value}))}
                  style={{ fontFamily: 'DM Mono' }} />
              </div>
              <div className="form-group" style={{ flex: '2 1 130px', marginBottom: 0 }}>
                <label className="form-label">Barcode (auto if blank)</label>
                <input className="form-input" placeholder="Auto-generated"
                  value={newRow.barcode} onChange={e => setNewRow(r => ({...r, barcode: e.target.value}))}
                  style={{ fontFamily: 'DM Mono' }} />
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Physical dimensions for this packaging</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[['weight_kg','Weight (kg)','0.0001'],['length_cm','Length (cm)','0.01'],['width_cm','Width (cm)','0.01'],['height_cm','Height (cm)','0.01']].map(([field, label, step]) => (
                  <div key={field} className="form-group" style={{ flex: '1 1 90px', marginBottom: 0 }}>
                    <label className="form-label">{label}</label>
                    <input style={dimStyle} type="number" step={step} min="0" placeholder="—"
                      value={newRow[field]} onChange={e => setNewRow(r => ({...r, [field]: e.target.value}))} />
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={addSaving || !newRow.uom_id || !newRow.qty_in_base} onClick={handleAdd}>
                {addSaving ? '...' : 'Add packaging'}
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* List */}
        {uomConversions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-sub)', fontSize: 13, marginTop: 12 }}>
            No packaging formats defined. The base UOM is set in Overview.
          </div>
        ) : (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {uomConversions.map(u => {
              const isEditing = Boolean(edits[u.id]);
              const d = edits[u.id] || {};
              return (
                <div key={u.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  {/* Row header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: isEditing ? 'rgba(47,127,232,0.04)' : 'var(--card)' }}>
                    <span style={{ fontFamily: 'DM Mono', fontWeight: 700, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>{u.uom_code}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-sub)' }}>{u.uom_name}</span>
                    <span className={`pill ${ROLE_PILLS[u.uom_role] || 'pill-grey'}`} style={{ fontSize: 10 }}>{ROLE_LABELS[u.uom_role] || u.uom_role}</span>
                    <span style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--text)' }}>× {parseFloat(u.qty_in_base).toLocaleString('en-AU', { maximumFractionDigits: 6 })}</span>
                    {u.barcode && <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--text-sub)', background: 'var(--bg)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 4 }}>{u.barcode}</span>}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      {!isEditing ? (
                        <>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => startEdit(u)}>Edit</button>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => handleRemove(u.id)}><TrashSmIcon /></button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" disabled={saving2[u.id]} onClick={() => saveEdit(u.id)}>{saving2[u.id] ? '...' : 'Save'}</button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => cancelEdit(u.id)}>Cancel</button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Existing dims (read) or edit form */}
                  {!isEditing ? (
                    <div style={{ padding: '8px 14px', background: 'rgba(240,244,249,0.4)', borderTop: '1px solid var(--border)', display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
                      {[['Weight', u.weight_kg, 'kg'], ['Length', u.length_cm, 'cm'], ['Width', u.width_cm, 'cm'], ['Height', u.height_cm, 'cm']].map(([label, val, unit]) => (
                        <div key={label}>
                          <span style={{ color: 'var(--text-sub)' }}>{label}: </span>
                          <span style={{ fontFamily: 'DM Mono', fontWeight: 500 }}>{val != null ? `${parseFloat(val)} ${unit}` : <span style={{ color: 'var(--text-sub)' }}>—</span>}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', background: 'rgba(47,127,232,0.03)' }}>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                        <div className="form-group" style={{ flex: '1 1 110px', marginBottom: 0 }}>
                          <label className="form-label">Role</label>
                          <select className="form-input" value={d.uom_role} onChange={e => setField(u.id, 'uom_role', e.target.value)}>
                            <option value="purchase">Purchase</option>
                            <option value="sales">Sales</option>
                            <option value="base">Base</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <div className="form-group" style={{ flex: '0 1 100px', marginBottom: 0 }}>
                          <label className="form-label">Qty in base</label>
                          <input className="form-input" type="number" step="0.000001" min="0.000001"
                            value={d.qty_in_base} onChange={e => setField(u.id, 'qty_in_base', e.target.value)}
                            style={{ fontFamily: 'DM Mono' }} />
                        </div>
                        <div className="form-group" style={{ flex: '2 1 140px', marginBottom: 0 }}>
                          <label className="form-label">Barcode</label>
                          <input className="form-input" value={d.barcode} onChange={e => setField(u.id, 'barcode', e.target.value)}
                            style={{ fontFamily: 'DM Mono' }} />
                        </div>
                      </div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Physical dimensions for this packaging</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {[['weight_kg','Weight (kg)','0.0001'],['length_cm','Length (cm)','0.01'],['width_cm','Width (cm)','0.01'],['height_cm','Height (cm)','0.01']].map(([field, label, step]) => (
                          <div key={field} className="form-group" style={{ flex: '1 1 90px', marginBottom: 0 }}>
                            <label className="form-label">{label}</label>
                            <input style={dimStyle} type="number" step={step} min="0" placeholder="—"
                              value={d[field]} onChange={e => setField(u.id, field, e.target.value)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function UomConversionsCard({ productId, uoms, uomConversions, onReload }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newRow,  setNewRow]  = useState({ uom_id: '', uom_role: 'other', qty_in_base: '', barcode: '' });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const ROLE_LABELS = { base: 'Base', purchase: 'Purchase', sales: 'Sales', other: 'Other' };
  const ROLE_PILLS  = { base: 'pill-blue', purchase: 'pill-green', sales: 'pill-orange', other: 'pill-grey' };

  async function handleAdd() {
    if (!newRow.uom_id || !newRow.qty_in_base) { setError('UOM and quantity are required.'); return; }
    setSaving(true); setError('');
    try {
      await productUomApi.add(productId, {
        uom_id:      parseInt(newRow.uom_id),
        uom_role:    newRow.uom_role,
        qty_in_base: parseFloat(newRow.qty_in_base),
        barcode:     newRow.barcode || null,
      });
      setNewRow({ uom_id: '', uom_role: 'other', qty_in_base: '', barcode: '' });
      setShowAdd(false);
      await onReload();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to add. This UOM may already be configured.');
    } finally { setSaving(false); }
  }

  async function handleRemove(uomId) {
    if (!confirm('Remove this UOM conversion?')) return;
    try { await productUomApi.remove(productId, uomId); await onReload(); }
    catch (e) { alert(e.response?.data?.error || 'Failed to remove.'); }
  }

  const addedIds     = new Set(uomConversions.map(u => u.uom_id));
  const availableUoms = uoms.filter(u => !addedIds.has(u.id));

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Packaging / UOM Conversions</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-sub)', marginTop: 2 }}>
            Define how many base units are in each packaging format (BOX50, CTN, etc.)
          </div>
        </div>
        <button type="button" className="btn btn-outline btn-sm"
          onClick={() => { setShowAdd(v => !v); setError(''); }}>
          <PlusSmIcon /> Add UOM
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</div>}

      {showAdd && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12, padding: '10px 12px', background: 'var(--accent-dim)', borderRadius: 8 }}>
          <div className="form-group" style={{ flex: '2 1 140px', marginBottom: 0 }}>
            <label className="form-label">UOM *</label>
            <select className="form-input" value={newRow.uom_id}
              onChange={e => setNewRow(r => ({...r, uom_id: e.target.value}))}>
              <option value="">Select UOM...</option>
              {availableUoms.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: '1 1 110px', marginBottom: 0 }}>
            <label className="form-label">Role</label>
            <select className="form-input" value={newRow.uom_role}
              onChange={e => setNewRow(r => ({...r, uom_role: e.target.value}))}>
              <option value="base">Base (inventory)</option>
              <option value="purchase">Purchase</option>
              <option value="sales">Sales</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: '1 1 90px', marginBottom: 0 }}>
            <label className="form-label">Qty in base *</label>
            <input className="form-input" type="number" step="0.000001" min="0.000001"
              placeholder="100" value={newRow.qty_in_base}
              onChange={e => setNewRow(r => ({...r, qty_in_base: e.target.value}))}
              style={{ fontFamily: 'DM Mono' }} />
          </div>
          <div className="form-group" style={{ flex: '2 1 130px', marginBottom: 0 }}>
            <label className="form-label">Barcode (auto if blank)</label>
            <input className="form-input" placeholder="Auto-generated"
              value={newRow.barcode} onChange={e => setNewRow(r => ({...r, barcode: e.target.value}))}
              style={{ fontFamily: 'DM Mono' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, paddingBottom: 2 }}>
            <button type="button" className="btn btn-primary btn-sm"
              disabled={saving || !newRow.uom_id || !newRow.qty_in_base}
              onClick={handleAdd}>
              {saving ? '...' : 'Add'}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAdd(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {uomConversions.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-sub)', textAlign: 'center', padding: '14px 0' }}>
          No packaging units defined. The base UOM is set in Product Details above.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['UOM', 'Role', 'Qty in base', 'Barcode', ''].map(h => (
                <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {uomConversions.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 8px' }}>
                  <span style={{ fontFamily: 'DM Mono', fontWeight: 700, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '2px 7px', borderRadius: 4, fontSize: 12 }}>
                    {u.uom_code}
                  </span>
                  <span style={{ marginLeft: 6, fontSize: 11.5, color: 'var(--text-sub)' }}>{u.uom_name}</span>
                </td>
                <td style={{ padding: '7px 8px' }}>
                  <span className={`pill ${ROLE_PILLS[u.uom_role] || 'pill-grey'}`}>
                    {ROLE_LABELS[u.uom_role] || u.uom_role}
                  </span>
                </td>
                <td style={{ padding: '7px 8px', fontFamily: 'DM Mono', fontWeight: 600 }}>
                  &times; {parseFloat(u.qty_in_base).toLocaleString('en-AU', { maximumFractionDigits: 6 })}
                </td>
                <td style={{ padding: '7px 8px', fontFamily: 'DM Mono', fontSize: 11.5, color: 'var(--text-sub)' }}>
                  {u.barcode || '—'}
                </td>
                <td style={{ padding: '7px 8px' }}>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => handleRemove(u.id)}>
                    <TrashSmIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
