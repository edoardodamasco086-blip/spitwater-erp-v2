import React, { useEffect, useState } from 'react';
import { productsApi } from '../../../api/products';
import { useAuth } from '../../../context/AuthContext';
import styles from './AdminProducts.module.css';

const COLORS = ['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252','#3BBCD4'];


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
export default function CategoryManager() {
  const { isAdmin } = useAuth();
  const [tree,     setTree]     = useState([]);
  const [flat,     setFlat]     = useState([]); // depth-aware flat for parent picker
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(null); // null | 'new' | id
  const [form,     setForm]     = useState({ name: '', description: '', parent_id: '', sort_order: 0 });
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data } = await productsApi.categories();
      setTree(data.data || []);
      setFlat(data.flat || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  if (!isAdmin) {
    return (
      <div className={styles.page}>
        <div className={styles.stateBlock}>You don't have permission to manage categories.</div>
      </div>
    );
  }

  function startNew(parentId = '') {
    setForm({ name: '', description: '', parent_id: parentId, sort_order: 0 });
    setEditing('new');
    setError('');
  }

  function startEdit(cat) {
    setForm({
      name:        cat.name        || '',
      description: cat.description || '',
      parent_id:   cat.parent_id   || '',
      sort_order:  cat.sort_order  || 0,
    });
    setEditing(cat.id);
    setError('');
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Category name is required.'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        name:        form.name.trim(),
        description: form.description.trim() || null,
        parent_id:   form.parent_id ? parseInt(form.parent_id) : null,
        sort_order:  parseInt(form.sort_order) || 0,
      };
      if (editing === 'new') {
        await productsApi.createCategory(payload);
        setSuccess('Category created.');
      } else {
        await productsApi.updateCategory(editing, payload);
        setSuccess('Category updated.');
      }
      setEditing(null);
      setTimeout(() => setSuccess(''), 3000);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed.');
    } finally { setSaving(false); }
  }

  async function handleToggleActive(cat) {
    try {
      await productsApi.updateCategory(cat.id, { is_active: !cat.is_active });
      load();
    } catch { alert('Failed to update category.'); }
  }

  function renderNode(node, depth = 0) {
    return (
      <div key={node.id}>
        <div className={styles.catRow} style={{ paddingLeft: 16 + depth * 24 }}>
          <div className={styles.catIcon} style={{ background: COLORS[depth % COLORS.length] + '22', color: COLORS[depth % COLORS.length] }}>
            <TagIcon />
          </div>
          <div className={styles.catInfo}>
            <div className={styles.catName}>{node.name}</div>
            {node.description && <div className={styles.catDesc}>{node.description}</div>}
          </div>
          <div className={styles.catMeta}>
            <span className="pill pill-grey">{node.product_count || 0} products</span>
            {!node.is_active && <span className="pill pill-red">Inactive</span>}
          </div>
          <div className={styles.catActions}>
            <button className="btn btn-outline btn-sm" onClick={() => startNew(node.id)}>
              + Sub
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => startEdit(node)}>
              Edit
            </button>
            <button
              className={`btn btn-sm ${node.is_active ? 'btn-outline' : 'btn-primary'}`}
              onClick={() => handleToggleActive(node)}
            >
              {node.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </div>

        {/* Edit form inline */}
        {editing === node.id && (
          <CategoryForm
            form={form} set={f => setForm(prev => ({ ...prev, ...f }))}
            flat={flat} error={error} saving={saving}
            onSave={handleSave} onCancel={() => setEditing(null)}
            isNew={false}
            style={{ marginLeft: 16 + depth * 24, marginBottom: 8 }}
          />
        )}

        {/* Children */}
        {node.children?.map(child => renderNode(child, depth + 1))}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Product Categories</h1>
          <p className={styles.sub}>Organise products into a hierarchical category tree.</p>
        </div>
        <button className="btn btn-primary" onClick={() => startNew()}>
          <PlusIcon /> New Category
        </button>
      </div>

      {success && <div className={styles.successBox}>{success}</div>}

      {/* New category form */}
      {editing === 'new' && (
        <CategoryForm
          form={form} set={f => setForm(prev => ({ ...prev, ...f }))}
          flat={flat} error={error} saving={saving}
          onSave={handleSave} onCancel={() => setEditing(null)}
          isNew={true}
        />
      )}

      {/* Category tree */}
      <div className={styles.treeCard}>
        {loading ? (
          <div className={styles.stateBlock}><div className="spinner-dark" /><span>Loading...</span></div>
        ) : tree.length === 0 && editing !== 'new' ? (
          <div className={styles.stateBlock}>
            <TagIcon size={32} />
            <span>No categories yet. Create your first one to start organising products.</span>
            <button className="btn btn-primary btn-sm" onClick={() => startNew()}>Create category</button>
          </div>
        ) : (
          <div className={styles.catTree}>
            {tree.map(node => renderNode(node, 0))}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryForm({ form, set, flat, error, saving, onSave, onCancel, isNew, style }) {
  return (
    <form className={styles.inlineForm} style={style} onSubmit={onSave}>
      {error && <div className={styles.errorBox}>{error}</div>}
      <div className={styles.formRow}>
        <div className="form-group" style={{ flex: 2 }}>
          <label className="form-label">Category name *</label>
          <input className="form-input" autoFocus value={form.name}
            onChange={e => set({ name: e.target.value })} placeholder="e.g. Pressure Washers" />
        </div>
        <div className="form-group" style={{ flex: 2 }}>
          <label className="form-label">Description</label>
          <input className="form-input" value={form.description}
            onChange={e => set({ description: e.target.value })} placeholder="Optional description..." />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Parent category</label>
          <select className="form-input" value={form.parent_id}
            onChange={e => set({ parent_id: e.target.value })}>
            <option value="">Top level</option>
            {flat.map(cat => (
              <option key={cat.id} value={cat.id}>
                {'\u00A0\u00A0'.repeat(cat.depth || 0)}{(cat.depth || 0) > 0 ? '— ' : ''}{cat.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ flex: 0, minWidth: 80 }}>
          <label className="form-label">Sort order</label>
          <input className="form-input" type="number" value={form.sort_order}
            onChange={e => set({ sort_order: e.target.value })} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !form.name.trim()}>
          {saving ? 'Saving...' : isNew ? 'Create category' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function SvgIcon({ children, size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
function PlusIcon() { return <SvgIcon><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function TagIcon({ size = 15 }) { return <SvgIcon size={size}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></SvgIcon>; }
