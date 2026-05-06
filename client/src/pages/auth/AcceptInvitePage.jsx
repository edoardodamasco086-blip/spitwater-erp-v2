import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { inviteApi } from '../../api/settings';
import { useAuth } from '../../context/AuthContext';
import styles from './AcceptInvitePage.module.css';

export default function AcceptInvitePage() {
  const [params]   = useSearchParams();
  const navigate   = useNavigate();
  const { login }  = useAuth();
  const token      = params.get('token');

  const [invite,   setInvite]   = useState(null);
  const [status,   setStatus]   = useState('loading'); // loading | valid | invalid | done
  const [errorMsg, setErrorMsg] = useState('');

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [formErr,  setFormErr]  = useState('');

  useEffect(() => {
    if (!token) { setStatus('invalid'); setErrorMsg('No invite token found in the URL.'); return; }
    inviteApi.verify(token)
      .then(({ data }) => { setInvite(data.data); setStatus('valid'); })
      .catch(err => {
        setStatus('invalid');
        setErrorMsg(err.response?.data?.error || 'This invite is invalid or has expired.');
      });
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormErr('');
    if (!fullName.trim())       { setFormErr('Your name is required.');               return; }
    if (password.length < 8)    { setFormErr('Password must be at least 8 characters.'); return; }
    if (password !== confirm)   { setFormErr('Passwords do not match.');               return; }

    setSaving(true);
    try {
      const { data } = await inviteApi.accept({ token, full_name: fullName.trim(), password });
      // Store tokens directly (bypass login() which calls /api/auth/login)
      localStorage.setItem('accessToken',  data.data.accessToken);
      localStorage.setItem('refreshToken', data.data.refreshToken);
      localStorage.setItem('user',         JSON.stringify(data.data.user));
      setStatus('done');
      setTimeout(() => navigate('/', { replace: true }), 2000);
    } catch (err) {
      setFormErr(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.bg} />
      <div className={styles.card}>
        <div className={styles.logoRow}>
          <div className={styles.logoMark}>
            <GridIcon />
          </div>
          <span className={styles.logoName}>Spitwater ERP</span>
        </div>

        {status === 'loading' && (
          <div className={styles.stateBlock}>
            <div className="spinner-lg" />
            <p>Verifying your invitation...</p>
          </div>
        )}

        {status === 'invalid' && (
          <div className={styles.stateBlock}>
            <div className={styles.errorIcon}>!</div>
            <h2>Invite not valid</h2>
            <p>{errorMsg}</p>
            <button className="btn btn-outline" onClick={() => navigate('/login')}>Back to login</button>
          </div>
        )}

        {status === 'done' && (
          <div className={styles.stateBlock}>
            <div className={styles.successIcon}>✓</div>
            <h2>Welcome to the team!</h2>
            <p>Your account has been created. Taking you to the dashboard...</p>
          </div>
        )}

        {status === 'valid' && invite && (
          <>
            <div className={styles.header}>
              <h1 className={styles.title}>You're invited</h1>
              <p className={styles.sub}>
                You've been invited to join <strong>{invite.orgName}</strong> as <strong>{invite.role}</strong>.
                <br />Set your name and password to get started.
              </p>
              <div className={styles.emailBadge}>{invite.email}</div>
            </div>

            {formErr && (
              <div className={styles.errorBox}>
                <AlertIcon /> {formErr}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Your full name</label>
                <input
                  className={styles.input}
                  placeholder="Jane Smith"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Create a password</label>
                <div className={styles.inputWrap}>
                  <input
                    className={styles.input}
                    type={showPwd ? 'text' : 'password'}
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                  <button type="button" className={styles.eyeBtn} onClick={() => setShowPwd(v => !v)}>
                    {showPwd ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className={styles.strength}>
                    <div className={styles.strengthBar}>
                      <div className={styles.strengthFill} style={{
                        width: `${Math.min(100, password.length * 8)}%`,
                        background: password.length < 8 ? 'var(--red)' : password.length < 12 ? 'var(--orange)' : 'var(--green)',
                      }} />
                    </div>
                    <span style={{ color: password.length < 8 ? 'var(--red)' : password.length < 12 ? 'var(--orange)' : 'var(--green)' }}>
                      {password.length < 8 ? 'Too short' : password.length < 12 ? 'Good' : 'Strong'}
                    </span>
                  </div>
                )}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Confirm password</label>
                <input
                  className={styles.input}
                  type="password"
                  placeholder="Re-enter your password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className={`btn btn-primary btn-lg ${styles.submitBtn}`}
                disabled={saving || !fullName || !password || !confirm}
              >
                {saving ? <><span className="spinner" /> Creating account...</> : 'Create my account'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function GridIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="9" height="9" rx="2"/><rect x="13" y="3" width="9" height="9" rx="2"/><rect x="2" y="14" width="9" height="9" rx="2"/><rect x="13" y="14" width="9" height="9" rx="2"/></svg>; }
function AlertIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>; }
function EyeIcon()   { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>; }
function EyeOffIcon(){ return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>; }
