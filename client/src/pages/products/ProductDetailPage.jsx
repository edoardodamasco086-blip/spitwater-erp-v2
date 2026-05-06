import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { productsApi } from '../../api/products';
import { productUomApi, currencyApi } from '../../api/productUom';
import { useFieldValidation } from '../../hooks/useFieldValidation';
import styles from './ProductDetailPage.module.css';

const TABS = [
  { key: 'overview',  label: 'Overview'       },
  { key: 'images',    label: 'Images'         },
  { key: 'documents', label: 'Documents'      },
  { key: 'custom',    label: 'Custom Fields'  },
  { key: 'pricing',   label: 'Pricing'        },
  { key: 'stock',     label: 'Stock'          },
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
  const [currencies,     setCurrencies]     = useState([]);
  const [saving,       setSaving]       = useState(false);
  const [activeTab,    setActiveTab]    = useState('overview');
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');

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

    productsApi.customFields()
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
      const [prodRes, cvRes, pricingRes, stockRes, uomRes, suppRes] = await Promise.all([
        productsApi.get(id),
        productsApi.getCustomValues(id),
        productsApi.getPricing(id),
        productsApi.getStock(id),
        productUomApi.list(id).catch(() => ({ data: { data: [] } })),
        productUomApi.listSupplierPrices(id).catch(() => ({ data: { data: [] } })),
      ]);
      const p = prodRes.data.data;
      setProduct(p);
      setPricing(pricingRes.data.data);
      setStock(stockRes.data.data);
      setCustomValues(cvRes.data.data || {});
      setUomConversions(uomRes.data.data || []);
      setSupplierPrices(suppRes.data.data || []);
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
        preferred_supplier_id:   form.preferred_supplier_id  || null,
        default_sales_price:     parseFloat(form.default_sales_price)    || 0,
        default_purchase_price:  parseFloat(form.default_purchase_price) || 0,
        lead_time_days:          parseInt(form.lead_time_days)  || 0,
        min_order_qty:           parseFloat(form.min_order_qty) || 1,
        order_multiple:          parseFloat(form.order_multiple)|| 1,
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
      await productsApi.saveCustomValues(id, customValues);
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
                  productsApi.customFields()
                    .then(({ data }) => setCustomFields(data.data || []))
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
                    <label className="form-label">
                      Unit of Measure {isRequired('base_uom_id') && <span className="req-star">*</span>}
                    </label>
                    <select
                      className={['form-input', fieldErrors.base_uom_id ? 'input-error' : ''].join(' ')}
                      value={form.base_uom_id}
                      onChange={e => { set('base_uom_id', e.target.value); clearErrors('base_uom_id'); }}
                      onBlur={e => liveValidate('base_uom_id', e.target.value)}
                    >
                      <option value="">Select UOM...</option>
                      {uoms.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                    </select>
                    {fieldErrors.base_uom_id && <div className="field-error">{fieldErrors.base_uom_id}</div>}
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

              {/* Purchasing section */}
              <div className={styles.card}>
                <div className={styles.cardTitle}>Purchasing & Stock</div>
                <div className={styles.grid3}>
                  <div className="form-group">
                    <label className="form-label">Lead time (days)</label>
                    <input className="form-input" type="number" min="0" value={form.lead_time_days} onChange={e => set('lead_time_days', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Min order qty</label>
                    <input className="form-input" type="number" step="0.0001" min="0" value={form.min_order_qty} onChange={e => set('min_order_qty', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Order multiple</label>
                    <input className="form-input" type="number" step="0.0001" min="0" value={form.order_multiple} onChange={e => set('order_multiple', e.target.value)} />
                  </div>
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
              </div>

              {/* Physical / Warranty */}
              <div className={styles.card}>
                <div className={styles.cardTitle}>Physical & Warranty</div>
                <div className={styles.grid4}>
                  <div className="form-group">
                    <label className="form-label">Weight (kg)</label>
                    <input className="form-input" type="number" step="0.0001" min="0" placeholder="0.00" value={form.weight_kg} onChange={e => set('weight_kg', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Length (cm)</label>
                    <input className="form-input" type="number" step="0.01" min="0" placeholder="0.00" value={form.length_cm} onChange={e => set('length_cm', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Width (cm)</label>
                    <input className="form-input" type="number" step="0.01" min="0" placeholder="0.00" value={form.width_cm} onChange={e => set('width_cm', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Height (cm)</label>
                    <input className="form-input" type="number" step="0.01" min="0" placeholder="0.00" value={form.height_cm} onChange={e => set('height_cm', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Warranty (months)</label>
                    <input className="form-input" type="number" min="0" value={form.warranty_months} onChange={e => set('warranty_months', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Extended warranty (months)</label>
                    <input className="form-input" type="number" min="0" value={form.extended_warranty_months} onChange={e => set('extended_warranty_months', e.target.value)} />
                  </div>
                </div>
              </div>

              {/* UOM Conversions — only shown on existing products */}
              {!isNew && (
                <UomConversionsCard
                  productId={id}
                  uoms={uoms}
                  uomConversions={uomConversions}
                  onReload={async () => {
                    const r = await productUomApi.list(id);
                    setUomConversions(r.data.data || []);
                  }}
                />
              )}
            </div>

            {/* Right column — meta */}
            <div className={styles.sideCol}>
              {/* Primary image */}
              {!isNew && (
                <div className={styles.card}>
                  <div className={styles.cardTitle}>Primary Image</div>
                  {product?.primary_image_url ? (
                    <img src={product.primary_image_url} alt={form.name} className={styles.primaryImg} />
                  ) : (
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

              {/* Supplier */}
              <div className={styles.card}>
                <div className={styles.cardTitle}>Preferred Supplier</div>
                <div className="form-group">
                  <label className="form-label">Supplier part number</label>
                  <input className="form-input" value={form.supplier_part_number} onChange={e => set('supplier_part_number', e.target.value)} placeholder="MFR-SKU-1234" style={{ fontFamily: 'DM Mono' }} />
                </div>
              </div>

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
                {images.map(img => (
                  <div key={img.id} className={[styles.imageCard, img.is_primary ? styles.imagePrimary : ''].join(' ')}>
                    <img src={img.image_url} alt={img.alt_text || form.name} className={styles.imagePreview} />
                    {img.is_primary && <div className={styles.primaryBadge}>Primary</div>}
                    <div className={styles.imageActions}>
                      {!img.is_primary && (
                        <button className="btn btn-outline btn-sm" onClick={() => handleSetPrimary(img.id)}>Set primary</button>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={() => handleDeleteImage(img.id)}>Delete</button>
                    </div>
                  </div>
                ))}
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
              <>
                <div className={styles.customGrid}>
                  {customFields.map(field => {
                    const val = customValues[field.field_key];
                    const isEmpty = val === undefined || val === null || val === '';
                    const showRequired = field.is_required && isEmpty;
                    return (
                    <div key={field.id} className="form-group">
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
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
                  <button className="btn btn-primary" onClick={handleSaveCustom} disabled={saving}>
                    {saving ? 'Saving...' : 'Save custom fields'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── PRICING TAB ── */}
        {!isNew && activeTab === 'pricing' && (
          <div className={styles.tabContent}>
            <PricingTab
              productId={id}
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
              onReloadSupplier={async () => {
                const r = await productUomApi.listSupplierPrices(id);
                setSupplierPrices(r.data.data || []);
              }}
            />
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
function ArrowIcon()  { return <SvgIcon><polyline points="15 18 9 12 15 6"/></SvgIcon>; }
function AlertIcon()  { return <SvgIcon size={14}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></SvgIcon>; }
function UploadIcon() { return <SvgIcon><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></SvgIcon>; }
function PlusIcon()   { return <SvgIcon><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function TrashIcon()  { return <SvgIcon size={13}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></SvgIcon>; }

// ── PricingTab ─────────────────────────────────────────────────
function PricingTab({ productId, pricing, setPricing, uomConversions, supplierPrices,
  setSupplierPrices, uoms, currencies, saving, onSavePricing, navigate, onReloadSupplier }) {

  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ contact_id: '', uom_id: '', unit_price: '', currency_code: 'AUD', min_order_qty: 1, lead_time_days: '', notes: '' });
  const [suppliers, setSuppliers] = useState([]);
  const [savingSupp, setSavingSupp] = useState(false);

  // Load suppliers (contacts of type supplier)
  useEffect(() => {
    fetch('/api/contacts?type=supplier&limit=200', { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` } })
      .then(r => r.json()).then(d => setSuppliers(d.data || [])).catch(() => {});
  }, []);

  // Available UOMs = base + all conversions
  const allUoms = [
    ...uoms.filter(u => uomConversions.find(c => c.uom_id === u.id || c.uom_role === 'base') || true),
  ].filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i);

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
    await productUomApi.removeSupplierPrice(productId, suppId);
    await onReloadSupplier();
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
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: '1 1 120px' }}>
              <label className="form-label">UOM *</label>
              <select className="form-input" value={newSupplier.uom_id} onChange={e => setNewSupplier(s => ({...s, uom_id: e.target.value}))}>
                <option value="">Select UOM...</option>
                {uoms.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}
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

// ── Shared icon helper ─────────────────────────────────────────
function ic(p) { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p}</svg>; }
function PlusSmIcon()  { return ic(<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>); }
function TrashSmIcon() { return ic(<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></>); }

// ── UOM Conversions Card ───────────────────────────────────────
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
