import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div style={{ padding: '80px 36px', textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>404</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Page not found</div>
      <div style={{ fontSize: 14, color: 'var(--text-sub)', marginBottom: 24 }}>
        This section hasn't been built yet or the URL is wrong.
      </div>
      <button className="btn btn-primary" onClick={() => navigate(-1)}>Go back</button>
    </div>
  );
}
