import React, { useEffect, useState } from 'react';
import { usersApi } from '../../api/users';
import styles from './UsersPage.module.css';

const ROLES = ['admin', 'editor', 'viewer'];
const ROLE_LABELS = { super_admin: 'Super Admin', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };
const ROLE_PILLS  = { super_admin: 'pill-blue', admin: 'pill-green', editor: 'pill-grey', viewer: 'pill-grey' };

export default function UsersPage() {
  const [users,       setUsers]       = useState([]);
  const [invites,     setInvites]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [showInvite,  setShowInvite]  = useState(false);
  const [inviteForm,  setInviteForm]  = useState({ email: '', role: 'editor', name: '' });
  const [inviting,    setInviting]    = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteLink,  setInviteLink]  = useState('');

  async function load() {
    setLoading(true);
    try {
      const [uRes, iRes] = await Promise.all([usersApi.list(), usersApi.listInvites()]);
      setUsers(uRes.data.data);
      setInvites(iRes.data.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleInvite(e) {
    e.preventDefault();
    setInviteError('');
    setInviting(true);
    try {
      const res = await usersApi.invite(inviteForm.email, inviteForm.role, inviteForm.name);
      setInviteLink(res.data.data.inviteLink);
      setInviteForm({ email: '', role: 'editor', name: '' });
      load();
    } catch (err) {
      setInviteError(err.response?.data?.error || 'Invite failed.');
    } finally {
      setInviting(false);
    }
  }

  async function handleDeactivate(userId, userName) {
    if (!confirm(`Deactivate ${userName}? They will be logged out immediately.`)) return;
    try {
      await usersApi.deactivate(userId);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to deactivate.');
    }
  }

  async function handleRoleChange(userId, newRole) {
    try {
      await usersApi.changeRole(userId, newRole);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to change role.');
    }
  }

  async function revokeInvite(inviteId) {
    try {
      await usersApi.revokeInvite(inviteId);
      load();
    } catch (e) {
      alert('Failed to revoke invite.');
    }
  }

  const filtered = users.filter(u =>
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Users &amp; Teams</h1>
          <p className={styles.sub}>Manage access, roles and invitations.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowInvite(true); setInviteLink(''); }}>
          <PlusIcon /> Invite User
        </button>
      </div>

      {/* Users table */}
      <div className="card fade-up" style={{ marginBottom: 20 }}>
        <div className={styles.toolbar}>
          <div className={styles.searchBox}>
            <SearchIcon />
            <input
              placeholder="Search users…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className={styles.toolbarRight}>
            <span className={styles.countLabel}>{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div className={styles.loadingRow}><div className="spinner-dark" /> Loading users…</div>
          ) : (
            <table>
              <thead>
                <tr><th>User</th><th>Role</th><th>Last active</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div className={styles.userCell}>
                        <div className={styles.avatar} style={{ background: avatarColor(u.full_name) }}>
                          {initials(u.full_name)}
                        </div>
                        <div>
                          <div className={styles.userName}>{u.full_name}</div>
                          <div className={styles.userEmail}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <select
                        className={styles.roleSelect}
                        value={u.role}
                        onChange={e => handleRoleChange(u.id, e.target.value)}
                        disabled={u.role === 'super_admin'}
                      >
                        {u.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
                        {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                    <td className={styles.metaCell}>
                      {u.last_active_at
                        ? new Date(u.last_active_at).toLocaleDateString('en-AU')
                        : u.last_login_at
                          ? new Date(u.last_login_at).toLocaleDateString('en-AU')
                          : '—'}
                    </td>
                    <td>
                      <span className={`pill ${u.is_active ? 'pill-green' : 'pill-red'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      {u.role !== 'super_admin' && u.is_active && (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => handleDeactivate(u.id, u.full_name)}
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="card fade-up">
          <div className="card-head">
            <span className="card-title">Pending Invitations ({invites.length})</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Email</th><th>Role</th><th>Invited by</th><th>Expires</th><th></th></tr></thead>
              <tbody>
                {invites.map(i => (
                  <tr key={i.id}>
                    <td style={{ fontFamily: 'DM Mono', fontSize: 13 }}>{i.email}</td>
                    <td><span className={`pill ${ROLE_PILLS[i.role] || 'pill-grey'}`}>{ROLE_LABELS[i.role] || i.role}</span></td>
                    <td className={styles.metaCell}>{i.invited_by_name || '—'}</td>
                    <td className={styles.metaCell}>{new Date(i.expires_at).toLocaleDateString('en-AU')}</td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => revokeInvite(i.id)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div className="modal-backdrop" onClick={() => setShowInvite(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">Invite User</span>
              <button className="btn btn-outline btn-sm btn-icon" onClick={() => setShowInvite(false)}>✕</button>
            </div>

            {inviteLink ? (
              <div className="modal-body">
                <div className={styles.successBox}>
                  <div className={styles.successTitle}>✅ Invite created!</div>
                  <div className={styles.successSub}>In production this will be emailed. For dev, copy the link below:</div>
                  <div className={styles.inviteLink}>{inviteLink}</div>
                  <button className="btn btn-primary btn-sm" onClick={() => navigator.clipboard.writeText(inviteLink)}>
                    Copy Link
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleInvite}>
                <div className="modal-body">
                  {inviteError && <div className={styles.errorBox}>{inviteError}</div>}
                  <div className="form-group">
                    <label className="form-label">Full name</label>
                    <input className="form-input" placeholder="Jane Smith"
                      value={inviteForm.name}
                      onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email address *</label>
                    <input className="form-input" type="email" placeholder="jane@company.com" required
                      value={inviteForm.email}
                      onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Role *</label>
                    <select className="form-input"
                      value={inviteForm.role}
                      onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}
                    >
                      {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  </div>
                </div>
                <div className="modal-foot">
                  <button type="button" className="btn btn-outline" onClick={() => setShowInvite(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={inviting || !inviteForm.email}>
                    {inviting ? <><span className="spinner" />Sending…</> : 'Send Invite'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* helpers */
const COLORS = ['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252','#3BBCD4'];
function avatarColor(name) { const c = (name||'').charCodeAt(0) % COLORS.length; return COLORS[c]; }
function initials(name) { return (name||'??').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

const ic = (d) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
function PlusIcon()   { return ic(<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>); }
function SearchIcon() { return ic(<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>); }
