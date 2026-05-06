import React from 'react';
import { useAuth } from '../../context/AuthContext';

export default function ProfilePage() {
  const { user } = useAuth();
  const initials = user?.name?.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || '??';

  return (
    <div style={{ padding: '32px 36px', maxWidth: 700 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>My Profile</h1>
      <div className="card">
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'var(--accent)', display: 'grid', placeItems: 'center',
              fontSize: 20, fontWeight: 600, color: 'white'
            }}>{initials}</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{user?.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-sub)', marginTop: 3 }}>{user?.email}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              ['Role',         user?.role],
              ['Organisation', user?.orgName],
              ['Org ID',       user?.orgId],
              ['User ID',      user?.id],
            ].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{val || '—'}</div>
              </div>
            ))}
          </div>
          <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <p style={{ fontSize: 13, color: 'var(--text-sub)' }}>
              Full profile editing coming in Phase 4. Use the API endpoint <code>POST /api/auth/change-password</code> to change your password.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
