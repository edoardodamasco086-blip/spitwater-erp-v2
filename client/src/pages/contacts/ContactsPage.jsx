import React, { useEffect, useState, useCallback } from 'react';
import { contactsApi } from '../../api/contacts';
import ContactModal   from './ContactModal';
import ContactDetail  from './ContactDetail';
import styles from './ContactsPage.module.css';

const TYPE_OPTIONS = [
  { value: '',           label: 'All contacts' },
  { value: 'customer',   label: 'Customers' },
  { value: 'supplier',   label: 'Suppliers' },
  { value: 'both',       label: 'Both' },
];

const TYPE_PILLS = {
  customer: 'pill-blue',
  supplier: 'pill-green',
  both:     'pill-purple',
  dealer:   'pill-orange',
};

function formatPhone(p) {
  return p || '';
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = ['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252','#3BBCD4','#E84F8C'];
function avatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  const i = name.charCodeAt(0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[i];
}

export default function ContactsPage() {
  const [contacts,    setContacts]    = useState([]);
  const [meta,        setMeta]        = useState({ total: 0, page: 1, pages: 1 });
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [typeFilter,  setTypeFilter]  = useState('');
  const [page,        setPage]        = useState(1);
  const [selected,    setSelected]    = useState(null);  // contact shown in detail panel
  const [showModal,   setShowModal]   = useState(false);
  const [editContact, setEditContact] = useState(null);  // null = create, object = edit

  const load = useCallback(async (p = page, s = search, t = typeFilter) => {
    setLoading(true);
    try {
      const { data } = await contactsApi.list({ search: s, type: t, page: p, limit: 50 });
      setContacts(data.data);
      setMeta(data.meta);
      // If selected contact no longer in list, clear it
      if (selected && !data.data.find(c => c.id === selected.id)) {
        setSelected(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter, selected]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(1, search, typeFilter); }, 300);
    return () => clearTimeout(t);
  }, [search, typeFilter]); // eslint-disable-line

  useEffect(() => { load(page, search, typeFilter); }, [page]); // eslint-disable-line

  function openCreate() { setEditContact(null); setShowModal(true); }
  function openEdit(c)  { setEditContact(c);    setShowModal(true); }

  async function handleSaved() {
    setShowModal(false);
    await load(page, search, typeFilter);
    setEditContact(null);
  }

  async function selectContact(c) {
    // Fetch full detail
    try {
      const { data } = await contactsApi.get(c.id);
      setSelected(data.data);
    } catch {
      setSelected(c);
    }
  }

  return (
    <div className={styles.page}>

      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Contacts</h1>
          <p className={styles.sub}>{meta.total} contact{meta.total !== 1 ? 's' : ''} in your organisation</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <PlusIcon /> New Contact
        </button>
      </div>

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <SearchIcon />
          <input
            placeholder="Search by name, email, phone, ABN..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className={styles.clearBtn} onClick={() => setSearch('')}>
              <CloseIcon />
            </button>
          )}
        </div>

        <div className={styles.filters}>
          {TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={[styles.filterBtn, typeFilter === opt.value ? styles.filterActive : ''].join(' ')}
              onClick={() => setTypeFilter(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main area: list + optional detail panel ── */}
      <div className={[styles.body, selected ? styles.withPanel : ''].join(' ')}>

        {/* List */}
        <div className={styles.listWrap}>
          {loading ? (
            <div className={styles.stateBlock}>
              <div className="spinner-dark" />
              <span>Loading contacts...</span>
            </div>
          ) : contacts.length === 0 ? (
            <div className={styles.stateBlock}>
              <EmptyIcon />
              <span>No contacts found.{search ? ' Try a different search.' : ''}</span>
              {!search && (
                <button className="btn btn-primary btn-sm" onClick={openCreate}>
                  Create your first contact
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>ABN</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map(c => (
                      <tr
                        key={c.id}
                        className={selected?.id === c.id ? styles.rowSelected : ''}
                        onClick={() => selectContact(c)}
                      >
                        <td>
                          <div className={styles.nameCell}>
                            <div className={styles.avatar} style={{ background: avatarColor(c.full_name) }}>
                              {initials(c.full_name)}
                            </div>
                            <div>
                              <div className={styles.contactName}>{c.full_name}</div>
                              {c.company_name && (
                                <div className={styles.contactCompany}>{c.company_name}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={['pill', TYPE_PILLS[c.contact_type] || 'pill-grey'].join(' ')}>
                            {c.contact_type ? c.contact_type.charAt(0).toUpperCase() + c.contact_type.slice(1) : '-'}
                          </span>
                        </td>
                        <td className={styles.monoCell}>{c.email || '-'}</td>
                        <td className={styles.monoCell}>{formatPhone(c.phone || c.mobile)}</td>
                        <td className={styles.monoCell}>{c.abn || '-'}</td>
                        <td>
                          {c.credit_hold
                            ? <span className="pill pill-red">Credit Hold</span>
                            : c.is_active
                              ? <span className="pill pill-green">Active</span>
                              : <span className="pill pill-grey">Inactive</span>
                          }
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => openEdit(c)}
                          >
                            Edit
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
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={page <= 1}
                    onClick={() => setPage(p => p - 1)}
                  >
                    Previous
                  </button>
                  <span className={styles.pageInfo}>
                    Page {page} of {meta.pages} ({meta.total} contacts)
                  </span>
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={page >= meta.pages}
                    onClick={() => setPage(p => p + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <ContactDetail
            contact={selected}
            onEdit={() => openEdit(selected)}
            onClose={() => setSelected(null)}
            onVoided={() => { setSelected(null); load(page, search, typeFilter); }}
          />
        )}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <ContactModal
          contact={editContact}
          onSaved={handleSaved}
          onClose={() => { setShowModal(false); setEditContact(null); }}
        />
      )}
    </div>
  );
}

/* Icons */
function SvgIcon({ children, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function PlusIcon()   { return <SvgIcon><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function SearchIcon() { return <SvgIcon><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></SvgIcon>; }
function CloseIcon()  { return <SvgIcon size={13}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></SvgIcon>; }
function EmptyIcon()  { return <SvgIcon size={32}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></SvgIcon>; }
