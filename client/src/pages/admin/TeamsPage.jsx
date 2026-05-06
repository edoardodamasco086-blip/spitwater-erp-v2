import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { permissionsApi } from '../../api/permissions';
import { useAuth } from '../../context/AuthContext';
import styles from './TeamsPage.module.css';

const AVATAR_COLORS = ['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252','#3BBCD4'];
function avatarColor(name) { return AVATAR_COLORS[(name||'').charCodeAt(0) % AVATAR_COLORS.length]; }
function initials(name)    { return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

const TEAM_COLORS = ['#2F7FE8','#2ECC8A','#E89B2F','#9366E8','#E05252','#3BBCD4','#E84F8C'];

export default function TeamsPage() {
  const navigate   = useNavigate();
  const { isAdmin } = useAuth();

  const [teams,      setTeams]      = useState([]);
  const [allUsers,   setAllUsers]   = useState([]);
  const [members,    setMembers]    = useState({}); // teamId -> members[]
  const [loading,    setLoading]    = useState(true);
  const [expanded,   setExpanded]   = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTeam,    setNewTeam]    = useState({ name: '', description: '', color: TEAM_COLORS[0] });
  const [creating,   setCreating]   = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [editForm,   setEditForm]   = useState({});
  const [addUserId,  setAddUserId]  = useState('');
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');

  async function load() {
    setLoading(true);
    try {
      const [tRes, uRes] = await Promise.all([
        permissionsApi.listTeams(),
        permissionsApi.listUsers(),
      ]);
      setTeams(tRes.data.data || []);
      setAllUsers(uRes.data.data || []);
    } catch (e) {
      setError('Failed to load teams.');
    } finally {
      setLoading(false);
    }
  }

  async function loadMembers(teamId) {
    try {
      const { data } = await permissionsApi.getMembers(teamId);
      setMembers(prev => ({ ...prev, [teamId]: data.data || [] }));
    } catch {}
  }

  useEffect(() => { load(); }, []);

  async function toggleExpand(teamId) {
    if (expanded === teamId) {
      setExpanded(null);
    } else {
      setExpanded(teamId);
      if (!members[teamId]) await loadMembers(teamId);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newTeam.name.trim()) return;
    setCreating(true); setError('');
    try {
      await permissionsApi.createTeam(newTeam);
      setNewTeam({ name: '', description: '', color: TEAM_COLORS[0] });
      setShowCreate(false);
      setSuccess('Team created.');
      setTimeout(() => setSuccess(''), 3000);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create team.');
    } finally { setCreating(false); }
  }

  async function handleUpdate(teamId) {
    try {
      await permissionsApi.updateTeam(teamId, editForm);
      setEditId(null);
      setSuccess('Team updated.');
      setTimeout(() => setSuccess(''), 3000);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Update failed.');
    }
  }

  async function handleDelete(team) {
    if (!confirm(`Delete team "${team.name}"? It must have no members.`)) return;
    try {
      await permissionsApi.deleteTeam(team.id);
      if (expanded === team.id) setExpanded(null);
      setSuccess('Team deleted.');
      setTimeout(() => setSuccess(''), 3000);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Cannot delete — remove all members first.');
    }
  }

  async function handleAddMember(teamId) {
    if (!addUserId) return;
    try {
      await permissionsApi.addMember(teamId, parseInt(addUserId));
      setAddUserId('');
      await loadMembers(teamId);
      load(); // refresh member count
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add member.');
    }
  }

  async function handleRemoveMember(teamId, userId) {
    try {
      await permissionsApi.removeMember(teamId, userId);
      await loadMembers(teamId);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove member.');
    }
  }

  if (!isAdmin) {
    return (
      <div className={styles.page}>
        <div className={styles.stateBlock}>You don't have permission to manage teams.</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Teams</h1>
          <p className={styles.sub}>
            Organise users into teams. Team permissions are managed in{' '}
            <button className={styles.inlineLink} onClick={() => navigate('/admin/permissions')}>
              Roles &amp; Permissions
            </button>.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowCreate(true); setError(''); }}>
          <PlusIcon /> New Team
        </button>
      </div>

      {error   && <div className={styles.errorBox}>{error}</div>}
      {success && <div className={styles.successBox}>{success}</div>}

      {/* Create form */}
      {showCreate && (
        <div className={styles.createCard}>
          <div className={styles.createTitle}>Create New Team</div>
          <form onSubmit={handleCreate}>
            <div className={styles.createRow}>
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Team name *</label>
                <input className="form-input" autoFocus placeholder="e.g. Service Technicians"
                  value={newTeam.name} onChange={e => setNewTeam(t => ({ ...t, name: e.target.value }))} />
              </div>
              <div className="form-group" style={{ flex: 3 }}>
                <label className="form-label">Description</label>
                <input className="form-input" placeholder="What does this team do?"
                  value={newTeam.description} onChange={e => setNewTeam(t => ({ ...t, description: e.target.value }))} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="form-label" style={{ marginBottom: 8 }}>Team colour</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {TEAM_COLORS.map(col => (
                  <button key={col} type="button"
                    style={{ width: 26, height: 26, borderRadius: '50%', background: col, border: newTeam.color === col ? '3px solid var(--text)' : '2px solid transparent', cursor: 'pointer' }}
                    onClick={() => setNewTeam(t => ({ ...t, color: col }))} />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={creating || !newTeam.name.trim()}>
                {creating ? 'Creating...' : 'Create team'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Teams list */}
      {loading ? (
        <div className={styles.stateBlock}><div className="spinner-dark" /> Loading teams...</div>
      ) : teams.length === 0 ? (
        <div className={styles.stateBlock}>
          <TeamsIcon />
          <span>No teams yet. Run the permissions migration first, or create a new team.</span>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>Create first team</button>
        </div>
      ) : (
        <div className={styles.teamsList}>
          {teams.map(team => {
            const teamMembers = members[team.id] || [];
            const isExpanded  = expanded === team.id;

            return (
              <div key={team.id} className={styles.teamCard}>
                {/* Team header row */}
                <div className={styles.teamHead} onClick={() => toggleExpand(team.id)}>
                  <div className={styles.teamColor} style={{ background: team.color || '#2F7FE8' }} />

                  {editId === team.id ? (
                    <input
                      className="form-input"
                      style={{ fontSize: 14, padding: '4px 8px', width: 200 }}
                      value={editForm.name}
                      onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                      onClick={e => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <div className={styles.teamInfo}>
                      <div className={styles.teamName}>
                        {team.name}
                        {team.is_system && <span className={styles.systemBadge}>System</span>}
                      </div>
                      {team.description && <div className={styles.teamDesc}>{team.description}</div>}
                    </div>
                  )}

                  <span className="pill pill-grey">{team.member_count || 0} member{team.member_count !== 1 ? 's' : ''}</span>

                  <div className={styles.teamActions} onClick={e => e.stopPropagation()}>
                    {editId === team.id ? (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => handleUpdate(team.id)}>Save</button>
                        <button className="btn btn-outline btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        {!team.is_system && (
                          <button className="btn btn-outline btn-sm"
                            onClick={() => { setEditId(team.id); setEditForm({ name: team.name, description: team.description, color: team.color }); }}>
                            Edit
                          </button>
                        )}
                        <button className="btn btn-outline btn-sm" onClick={() => navigate('/admin/permissions')}>
                          Permissions
                        </button>
                        {!team.is_system && (
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(team)}>Delete</button>
                        )}
                      </>
                    )}
                    <div className={styles.chevron} style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      <ChevronIcon />
                    </div>
                  </div>
                </div>

                {/* Expanded members */}
                {isExpanded && (
                  <div className={styles.teamBody}>
                    {teamMembers.length === 0 ? (
                      <div className={styles.noMembers}>No members yet.</div>
                    ) : (
                      <div className={styles.memberList}>
                        {teamMembers.map(u => (
                          <div key={u.id} className={styles.memberRow}>
                            <div className={styles.memberAvatar} style={{ background: avatarColor(u.full_name) }}>
                              {initials(u.full_name)}
                            </div>
                            <div className={styles.memberInfo}>
                              <div className={styles.memberName}>{u.full_name}</div>
                              <div className={styles.memberEmail}>{u.email}</div>
                            </div>
                            <span className={`pill ${u.role === 'super_admin' ? 'pill-blue' : u.role === 'admin' ? 'pill-green' : 'pill-grey'}`}>
                              {u.role}
                            </span>
                            <button className="btn btn-outline btn-sm" onClick={() => handleRemoveMember(team.id, u.id)}>
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add member */}
                    <div className={styles.addMember}>
                      <select className="form-input" style={{ flex: 1 }} value={addUserId} onChange={e => setAddUserId(e.target.value)}>
                        <option value="">Select user to add...</option>
                        {allUsers
                          .filter(u => !teamMembers.find(m => m.id === u.id))
                          .map(u => (
                            <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
                          ))}
                      </select>
                      <button className="btn btn-primary btn-sm" disabled={!addUserId} onClick={() => handleAddMember(team.id)}>
                        Add to team
                      </button>
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

function SvgIcon({ children, size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
function PlusIcon()    { return <SvgIcon><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></SvgIcon>; }
function ChevronIcon() { return <SvgIcon><polyline points="6 9 12 15 18 9"/></SvgIcon>; }
function TeamsIcon()   { return <SvgIcon size={32}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></SvgIcon>; }
