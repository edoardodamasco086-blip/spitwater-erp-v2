import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { productsApi } from '../../api/products';
import styles from './ProductsPage.module.css';

const TYPE_LABELS = {
  product:   'Product',
  service:   'Service',
  component: 'Component',
  kit:       'Kit / Bundle',
};

function formatCurrency(v) {
  if (v == null) return '-';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);
}

function formatQty(v) {
  if (v == null) return '-';
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 }).format(v);
}

const AVATAR_COLORS = ['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252','#3BBCD4'];
function productColor(code) {
  if (!code) return AVATAR_COLORS[0];
  return AVATAR_COLORS[code.charCodeAt(0) % AVATAR_COLORS.length];
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
export default function ProductsPage() {
  const navigate = useNavigate();
  const [products,   setProducts]   = useState([]);
  const [categories, setCategories] = useState([]); // flat ordered for dropdown
  const [meta,       setMeta]       = useState({ total: 0, page: 1, pages: 1 });
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [catFilter,  setCatFilter]  = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page,       setPage]       = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async (p = page, s = search, cat = catFilter, type = typeFilter) => {
    setLoading(true);
    try {
      const { data } = await productsApi.list({ search: s, category: cat, type, page: p, limit: 50 });
      setProducts(data.data);
      setMeta(data.meta);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [page, search, catFilter, typeFilter]);

  useEffect(() => {
    productsApi.categories().then(({ data }) => setCategories(data.flat || []));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(1, search, catFilter, typeFilter); }, 300);
    return () => clearTimeout(t);
  }, [search, catFilter, typeFilter]); // eslint-disable-line

  useEffect(() => { load(page, search, catFilter, typeFilter); }, [page]); // eslint-disable-line

  function openDetail(id) { navigate(`/products/${id}`); }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Products</h1>
          <p className={styles.sub}>{meta.total} product{meta.total !== 1 ? 's' : ''} in your catalogue</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" onClick={() => navigate('/admin/products/custom-fields')}>
            <FieldsIcon /> Custom Fields
          </button>
          <button className="btn btn-outline" onClick={() => navigate('/admin/products/categories')}>
            <TagIcon /> Categories
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/products/new')}>
            <PlusIcon /> New Product
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <SearchIcon />
          <input
            placeholder="Search by code, name, barcode..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className={styles.clearBtn} onClick={() => setSearch('')}>
              <CloseIcon />
            </button>
          )}
        </div>

        <select
          className={styles.filterSelect}
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map(cat => (
            <option
              key={cat.id}
              value={cat.id}
              disabled={!!cat.has_children}
              style={cat.has_children ? { color: 'var(--text-sub)', fontStyle: 'italic' } : {}}
            >
              {'\u00A0\u00A0'.repeat(cat.depth || 0)}{(cat.depth || 0) > 0 ? '— ' : ''}{cat.name}{cat.has_children ? ' ▾' : ''}
            </option>
          ))}
        </select>

        <select
          className={styles.filterSelect}
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      {/* Product list */}
      <div className={styles.listCard}>
        {loading ? (
          <div className={styles.stateBlock}><div className="spinner-dark" /><span>Loading products...</span></div>
        ) : products.length === 0 ? (
          <div className={styles.stateBlock}>
            <EmptyIcon />
            <span>{search ? 'No products match your search.' : 'No products yet.'}</span>
            {!search && (
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/products/new')}>
                Create first product
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Type</th>
                    <th>Category</th>
                    <th>Sales Price</th>
                    <th>Cost</th>
                    <th>Stock</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id} className={styles.row} onClick={() => openDetail(p.id)}>
                      <td>
                        <div className={styles.productCell}>
                          {/* Image or colour avatar */}
                          {p.primary_image_url ? (
                            <img
                              src={p.primary_image_url}
                              alt={p.name}
                              className={styles.productThumb}
                              onError={e => { e.target.style.display = 'none'; }}
                            />
                          ) : (
                            <div className={styles.productAvatar} style={{ background: productColor(p.product_code) }}>
                              {p.product_code?.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className={styles.productName}>{p.name}</div>
                            <div className={styles.productCode}>{p.product_code}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="pill pill-grey">{TYPE_LABELS[p.product_type] || p.product_type}</span>
                      </td>
                      <td className={styles.metaCell}>{p.category_name || '-'}</td>
                      <td className={styles.priceCell}>{formatCurrency(p.default_sales_price)}</td>
                      <td className={styles.priceCell}>{formatCurrency(p.last_cost)}</td>
                      <td>
                        <div className={styles.stockCell}>
                          <span className={[
                            styles.stockNum,
                            p.total_stock <= 0 ? styles.stockZero :
                            p.total_stock <= p.min_stock_level ? styles.stockLow : styles.stockOk
                          ].join(' ')}>
                            {formatQty(p.total_stock)}
                          </span>
                          {p.uom_code && <span className={styles.uomLabel}>{p.uom_code}</span>}
                        </div>
                      </td>
                      <td>
                        <span className={`pill ${p.is_active ? 'pill-green' : 'pill-grey'}`}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <button className="btn btn-outline btn-sm" onClick={() => openDetail(p.id)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {meta.pages > 1 && (
              <div className={styles.pagination}>
                <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                <span className={styles.pageInfo}>Page {page} of {meta.pages} ({meta.total} products)</span>
                <button className="btn btn-outline btn-sm" disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* Icons */
function SvgIcon({ children, size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
function PlusIcon()   { return <SvgIcon><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function SearchIcon() { return <SvgIcon><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></SvgIcon>; }
function CloseIcon()  { return <SvgIcon size={13}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></SvgIcon>; }
function EmptyIcon()  { return <SvgIcon size={32}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></SvgIcon>; }
function TagIcon()    { return <SvgIcon><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></SvgIcon>; }
function FieldsIcon() { return <SvgIcon><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></SvgIcon>; }
