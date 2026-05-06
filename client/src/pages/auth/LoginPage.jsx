import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const { login, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await login(email.trim(), password);
      // Redirect based on role
      navigate(
        user.role === 'super_admin' || user.role === 'admin' ? '/admin' : '/',
        { replace: true }
      );
    } catch (err) {
      const msg = err.response?.data?.error || 'Login failed. Please try again.';
      const hint = err.response?.data?.hint || '';
      setError(hint ? `${msg} ${hint}` : msg);
    } finally {
      setLoading(false);
    }
  }

  function fillDemo(e, demoEmail, demoPass) {
    e.preventDefault();
    setEmail(demoEmail);
    setPassword(demoPass);
  }

  return (
    <div className={styles.page}>
      {/* Background */}
      <div className={styles.bg} />
      <div className={styles.bgGrid} />

      {/* Brand panel */}
      <div className={styles.brand}>
        <div className={styles.brandLogo}>
          <div className={styles.logoMark}>
            <GridIcon />
          </div>
          <span className={styles.brandName}>Spitwater <em>ERP</em></span>
        </div>

        <h2 className={styles.tagline}>
          <strong>One platform</strong><br />
          for every part of<br />your business.
        </h2>

        <ul className={styles.featureList}>
          {[
            ['Inventory & WMS', 'FIFO tracked, bin-directed'],
            ['Sales & CPQ',     'Quotes, orders, dealer portal'],
            ['Service & Warranty', 'Jobs, claims, scheduling'],
            ['Accounting',      'Double-entry, GST & BAS'],
            ['Purchasing',      'POs, receipts, landed costs'],
          ].map(([title, sub]) => (
            <li key={title} className={styles.feature}>
              <span className={styles.featureDot} />
              <span><strong>{title}</strong> — {sub}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Login card */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h1 className={styles.cardTitle}>Welcome back</h1>
          <p className={styles.cardSub}>Sign in to continue to your workspace</p>
        </div>

        {/* Error message */}
        {error && (
          <div className={styles.errorBox}>
            <AlertIcon />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Email */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="email">Email address</label>
            <div className={styles.inputWrap}>
              <input
                id="email"
                type="email"
                className={styles.input}
                placeholder="you@spitwater.com.au"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                autoComplete="email"
                required
                autoFocus
              />
              <span className={styles.inputIcon}><MailIcon /></span>
            </div>
          </div>

          {/* Password */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="password">Password</label>
            <div className={styles.inputWrap}>
              <input
                id="password"
                type={showPwd ? 'text' : 'password'}
                className={styles.input}
                placeholder="••••••••••••"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                autoComplete="current-password"
                required
              />
              <span className={styles.inputIcon}><LockIcon /></span>
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowPwd(v => !v)}
                aria-label={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          {/* Options row */}
          <div className={styles.options}>
            <label className={styles.checkWrap}>
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
              />
              <span className={styles.checkBox}>
                {remember && <CheckIcon />}
              </span>
              <span className={styles.checkLabel}>Keep me signed in</span>
            </label>
            <a href="#" className={styles.forgotLink}>Forgot password?</a>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className={`btn btn-primary btn-lg ${styles.submitBtn}`}
            disabled={loading || !email || !password}
          >
            {loading ? <><span className="spinner" />Signing in…</> : 'Sign in'}
          </button>
        </form>

        {/* Demo quick-fill — dev only */}
        {import.meta.env.DEV && (
          <div className={styles.demoBadge}>
            <div className={styles.demoTitle}>Dev accounts — click to fill</div>
            {[
              ['edoardo@spitwater.com', 'Poi1poiolo!', 'Super Admin'],
            ].map(([e, p, role]) => (
              <button
                key={e}
                className={styles.demoRow}
                onClick={ev => fillDemo(ev, e, p)}
              >
                <span className={styles.demoEmail}>{e}</span>
                <span className={`pill pill-blue ${styles.demoRole}`}>{role}</span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.cardFooter}>
          Spitwater Australia ERP &nbsp;·&nbsp; v1.0.0 &nbsp;·&nbsp; Invite-only access
        </div>
      </div>
    </div>
  );
}

// ── Icons (inline SVG — no icon library needed) ───────────────
function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="3" width="9" height="9" rx="2"/><rect x="13" y="3" width="9" height="9" rx="2"/>
      <rect x="2" y="14" width="9" height="9" rx="2"/><rect x="13" y="14" width="9" height="9" rx="2"/>
    </svg>
  );
}
function MailIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
}
function LockIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
}
function EyeIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
}
function EyeOffIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
}
function AlertIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
}
function CheckIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2.5"><polyline points="1,5 4,8 9,2"/></svg>;
}
