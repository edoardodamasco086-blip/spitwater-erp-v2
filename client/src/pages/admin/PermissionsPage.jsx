import React, { useEffect, useState, useCallback } from 'react';
import { permissionsApi } from '../../api/permissions';
import styles from './PermissionsPage.module.css';

const ACTION_LABELS = { can_read: 'Read', can_write: 'Write', can_update: 'Update', can_delete: 'Delete' };
const ACTION_COLORS = { can_read: 'blue', can_write: 'green', can_update: 'orange', can_delete: 'red' };

const AVATAR_COLORS = ['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252','#3BBCD4'];
function avatarColor(name) { return AVATAR_COLORS[(name||'').charCodeAt(0) % AVATAR_COLORS.length]; }
function initials(name)    { return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

export default function PermissionsPage() {
  const [teams,     setTeams]     = useState([]);
  const [resources, setResources] = useState([]);
  const [allUsers,  setAllUsers]  = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [perms,     setPerms]     = useState({});
  const [members,   setMembers]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [activeTab, setActiveTab] = useState('permissions'); // permissions | members
  const [showCreate,setShowCreate]= useState(false);
  const [newTeam,   setNewTeam]   = useState({ name:'', description:'', color:'#2F7FE8' });
  const [creating,  setCreating]  = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [error,     setError]     = useState('');

  const TEAM_COLORS = ['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252','#3BBCD4','#E84F8C'];

  async function loadTeams() {
    const [tRes, rRes, uRes] = await Promise.all([
      permissionsApi.listTeams(),
      permissionsApi.getResources(),
      permissionsApi.listUsers(),
    ]);
    setTeams(tRes.data.data);
    setResources(rRes.data.data);
    setAllUsers(uRes.data.data);
    setLoading(false);
  }

  useEffect(() => { loadTeams(); }, []);

  async function selectTeam(team) {
    setSelectedTeam(team);
    setSaved(false);
    setError('');

    const [pRes, mRes] = await Promise.all([
      permissionsApi.getPerms(team.id),
      permissionsApi.getMembers(team.id),
    ]);
    setPerms(pRes.data.data);
    setMembers(mRes.data.data);
  }

  function togglePerm(resource, action) {
    if (selectedTeam?.is_system && selectedTeam?.name === 'Admin') return; // Admin perms locked
    setPerms(p => ({
      ...p,
      [resource]: {
        ...(p[resource] || {}),
        [action]: !(p[resource]?.[action]),
      }
    }));
    setSaved(false);
  }

  function setAllForResource(resource, value) {
    if (selectedTeam?.is_system && selectedTeam?.name === 'Admin') return;
    const resDef = resources.find(r => r.key === resource);
    if (!resDef) return;
    const newPerms = { can_read: false, can_write: false, can_update: false, can_delete: false };
    if (value) resDef.actions.forEach(a => { newPerms[`can_${a}`] = true; });
    setPerms(p => ({ ...p, [resource]: newPerms }));
    setSaved(false);
  }

  function setAllActions(action, value) {
    if (selectedTeam?.is_system && selectedTeam?.name === 'Admin') return;
    setPerms(p => {
      const next = { ...p };
      resources.forEach(r => {
        if (r.actions.includes(action)) {
          next[r.key] = { ...(next[r.key] || {}), [`can_${action}`]: value };
        }
      });
      return next;
    });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      await permissionsApi.savePerms(selectedTeam.id, perms);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateTeam(e) {
    e.preventDefault();
    if (!newTeam.name.trim()) return;
    setCreating(true); setError('');
    try {
      await permissionsApi.createTeam(newTeam);
      setNewTeam({ name:'', description:'', color:'#2F7FE8' });
      setShowCreate(false);
      await loadTeams();
    } catch (err) {
      setError(err.response?.data?.error || 'Create failed.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteTeam(team) {
    if (!confirm(`Delete team "${team.name}"? This cannot be undone.`)) return;
    try {
      await permissionsApi.deleteTeam(team.id);
      if (selectedTeam?.id === team.id) { setSelectedTeam(null); setPerms({}); setMembers([]); }
      await loadTeams();
    } catch (err) {
      alert(err.response?.data?.error || 'Cannot delete team.');
    }
  }

  async function handleAddMember() {
    if (!addUserId || !selectedTeam) return;
    try {
      await permissionsApi.addMember(selectedTeam.id, parseInt(addUserId));
      setAddUserId('');
      const mRes = await permissionsApi.getMembers(selectedTeam.id);
      setMembers(mRes.data.data);
      await loadTeams();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add member.');
    }
  }

  async function handleRemoveMember(userId) {
    try {
      await permissionsApi.removeMember(selectedTeam.id, userId);
      const mRes = await permissionsApi.getMembers(selectedTeam.id);
      setMembers(mRes.data.data);
      await loadTeams();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove member.');
    }
  }

  const isAdminTeam = selectedTeam?.name === 'Admin' && selectedTeam?.is_system;
  const availableUsers = allUsers.filter(u => !members.find(m => m.id === u.id));

  if (loading) return <div className={styles.page}><div style={{display:'flex',alignItems:'center',gap:10,color:'var(--text-sub)'}}><div className="spinner-dark"/>Loading...</div></div>;

  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Roles & Permissions</h1>
          <p className={styles.sub}>Manage teams and what each team can access. Most permissive wins when a user belongs to multiple teams.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowCreate(true); setError(''); }}>
          <PlusIcon /> New Team
        </button>
      </div>

      {error && <div className={styles.errorBox}><AlertIcon /> {error}</div>}

      {/* Create team */}
      {showCreate && (
        <div className={styles.createCard}>
          <div className={styles.createTitle}>Create New Team</div>
          <form onSubmit={handleCreateTeam}>
            <div className={styles.createRow}>
              <div className="form-group" style={{flex:2}}>
                <label className="form-label">Team name *</label>
                <input className="form-input" autoFocus placeholder="e.g. Sales Team"
                  value={newTeam.name} onChange={e => setNewTeam(t => ({...t, name:e.target.value}))} />
              </div>
              <div className="form-group" style={{flex:3}}>
                <label className="form-label">Description</label>
                <input className="form-input" placeholder="What does this team do?"
                  value={newTeam.description} onChange={e => setNewTeam(t => ({...t, description:e.target.value}))} />
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <label className="form-label" style={{marginBottom:8}}>Colour</label>
              <div style={{display:'flex',gap:8}}>
                {TEAM_COLORS.map(c => (
                  <button key={c} type="button"
                    style={{width:26,height:26,borderRadius:'50%',background:c,border:newTeam.color===c?'3px solid var(--text)':'2px solid transparent',cursor:'pointer'}}
                    onClick={() => setNewTeam(t => ({...t, color:c}))} />
                ))}
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={creating || !newTeam.name.trim()}>
                {creating ? 'Creating...' : 'Create team'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className={styles.body}>

        {/* Team list sidebar */}
        <div className={styles.teamList}>
          <div className={styles.teamListTitle}>Teams</div>
          {teams.map(t => (
            <div key={t.id}
              className={[styles.teamItem, selectedTeam?.id === t.id ? styles.teamSelected : ''].join(' ')}
              onClick={() => selectTeam(t)}
            >
              <div className={styles.teamDot} style={{background: t.color || '#2F7FE8'}} />
              <div className={styles.teamItemInfo}>
                <div className={styles.teamItemName}>
                  {t.name}
                  {t.is_system && <span className={styles.systemBadge}>System</span>}
                </div>
                <div className={styles.teamItemMeta}>{t.member_count} member{t.member_count !== 1 ? 's' : ''}</div>
              </div>
              {!t.is_system && selectedTeam?.id === t.id && (
                <button className={styles.deleteTeamBtn}
                  onClick={e => { e.stopPropagation(); handleDeleteTeam(t); }}
                  title="Delete team">
                  <TrashIcon />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Right panel */}
        {selectedTeam ? (
          <div className={styles.rightPanel}>
            {/* Team header */}
            <div className={styles.panelHeader}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:12,height:12,borderRadius:'50%',background:selectedTeam.color,flexShrink:0}} />
                <div>
                  <div className={styles.panelTitle}>{selectedTeam.name}</div>
                  {selectedTeam.description && <div className={styles.panelDesc}>{selectedTeam.description}</div>}
                </div>
              </div>
              {/* Tabs */}
              <div className={styles.tabs}>
                <button className={[styles.tab, activeTab==='permissions'?styles.tabActive:''].join(' ')} onClick={() => setActiveTab('permissions')}>Permissions</button>
                <button className={[styles.tab, activeTab==='members'?styles.tabActive:''].join(' ')} onClick={() => setActiveTab('members')}>
                  Members ({members.length})
                </button>
              </div>
            </div>

            {/* PERMISSIONS TAB */}
            {activeTab === 'permissions' && (
              <div className={styles.matrixWrap}>
                {isAdminTeam && (
                  <div className={styles.infoBox}>
                    The Admin team has full access to everything and cannot be modified. Add users to this team to give them admin-level permissions.
                  </div>
                )}

                {saved && <div className={styles.successBox}>Permissions saved successfully.</div>}

                <div className={styles.matrixScroll}>
                  <table className={styles.matrix}>
                    <thead>
                      <tr>
                        <th className={styles.resourceCol}>Resource</th>
                        {['read','write','update','delete'].map(action => (
                          <th key={action} className={styles.actionCol}>
                            <div className={styles.actionHeader}>
                              <span className={`${styles.actionBadge} ${styles[action]}`}>{action.charAt(0).toUpperCase() + action.slice(1)}</span>
                              {!isAdminTeam && (
                                <div className={styles.colToggles}>
                                  <button className={styles.colToggle} onClick={() => setAllActions(action, true)}  title="Grant all">All</button>
                                  <button className={styles.colToggle} onClick={() => setAllActions(action, false)} title="Revoke all">None</button>
                                </div>
                              )}
                            </div>
                          </th>
                        ))}
                        <th className={styles.rowActCol}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {resources.map(r => {
                        const rp = perms[r.key] || {};
                        const allGranted = r.actions.every(a => rp[`can_${a}`]);
                        return (
                          <tr key={r.key} className={styles.matrixRow}>
                            <td className={styles.resourceCell}>{r.label}</td>
                            {['read','write','update','delete'].map(action => {
                              const hasAction = r.actions.includes(action);
                              const field = `can_${action}`;
                              const checked = !!rp[field];
                              return (
                                <td key={action} className={styles.checkCell}>
                                  {hasAction ? (
                                    <button
                                      className={[styles.checkbox, checked ? styles[`check_${action}`] : '', isAdminTeam ? styles.checkLocked : ''].join(' ')}
                                      onClick={() => !isAdminTeam && togglePerm(r.key, field)}
                                      disabled={isAdminTeam}
                                      title={checked ? `Revoke ${action}` : `Grant ${action}`}
                                    >
                                      {checked && <CheckIcon />}
                                    </button>
                                  ) : (
                                    <span className={styles.naCell}>—</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className={styles.rowActCol}>
                              {!isAdminTeam && (
                                <button className={styles.rowToggle}
                                  onClick={() => setAllForResource(r.key, !allGranted)}>
                                  {allGranted ? 'None' : 'All'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {!isAdminTeam && (
                  <div className={styles.saveRow}>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                      {saving ? <><span className="spinner" /> Saving...</> : 'Save permissions'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* MEMBERS TAB */}
            {activeTab === 'members' && (
              <div className={styles.membersPanel}>
                {/* Add member */}
                <div className={styles.addMember}>
                  <select className="form-input" style={{flex:1}} value={addUserId} onChange={e => setAddUserId(e.target.value)}>
                    <option value="">Select user to add...</option>
                    {availableUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name} — {u.email}</option>
                    ))}
                  </select>
                  <button className="btn btn-primary btn-sm" disabled={!addUserId} onClick={handleAddMember}>
                    Add to team
                  </button>
                </div>

                {/* Members list */}
                {members.length === 0 ? (
                  <div className={styles.emptyMembers}>No members in this team yet.</div>
                ) : (
                  <div className={styles.membersList}>
                    {members.map(m => (
                      <div key={m.id} className={styles.memberRow}>
                        <div className={styles.memberAvatar} style={{background: avatarColor(m.full_name)}}>
                          {initials(m.full_name)}
                        </div>
                        <div className={styles.memberInfo}>
                          <div className={styles.memberName}>{m.full_name}</div>
                          <div className={styles.memberEmail}>{m.email}</div>
                        </div>
                        <span className={`pill ${m.role==='super_admin'?'pill-blue':m.role==='admin'?'pill-green':'pill-grey'}`}>
                          {m.role}
                        </span>
                        <button className="btn btn-outline btn-sm" onClick={() => handleRemoveMember(m.id)}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.noSelection}>
            <ShieldIcon />
            <p>Select a team from the left to manage its permissions and members.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SvgIcon({ children, size=15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
function PlusIcon()  { return <SvgIcon><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function CheckIcon() { return <SvgIcon size={11}><polyline points="20 6 9 17 4 12"/></SvgIcon>; }
function TrashIcon() { return <SvgIcon size={13}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></SvgIcon>; }
function AlertIcon() { return <SvgIcon size={14}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></SvgIcon>; }
function ShieldIcon(){ return <SvgIcon size={40}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></SvgIcon>; }
