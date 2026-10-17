import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Badge from '../components/Badge';
import Button from '../components/Button';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../services/apiClient';

export default function Settings() {
  const { user } = useAuth();
  const [config, setConfig] = useState(null);

  useEffect(() => {
    apiFetch('/api/v1/food/config')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.config) setConfig(data.config);
      })
      .catch(err => console.error('Error fetching food config:', err));
  }, []);

  const dailyRateRupees = config ? (config.default_rate_paise / 100) : 130;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <PageHeader 
        title="Settings & Preferences" 
        description="Manage your account profile and view shared household configuration." 
      />

      <Card title="👤 User Profile" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block' }}>User ID</label>
            <strong>{user?.id}</strong>
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block' }}>Full Name</label>
            <strong>{user?.name}</strong>
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block' }}>Role</label>
            <Badge variant={user?.role === 'ADMIN' ? 'primary' : 'secondary'}>{user?.role}</Badge>
          </div>
        </div>
      </Card>

      <Card title="🎨 Appearance & Theme" style={{ marginBottom: '1.5rem' }}>
        <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
          Choose your interface theme. High contrast and calibrated colors ensure all text and amounts remain fully readable.
        </p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Button 
            variant="secondary" 
            onClick={() => {
              const current = document.documentElement.getAttribute('data-theme') || 'dark';
              const next = current === 'dark' ? 'light' : 'dark';
              document.documentElement.setAttribute('data-theme', next);
              localStorage.setItem('app-theme', next);
            }}
          >
            🌓 Toggle Dark / Light Theme
          </Button>
        </div>
      </Card>

      <Card title="🏠 Shared Household Mess Configuration" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block' }}>Standard Daily Food Rate</label>
            <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-success)' }}>₹{dailyRateRupees} / day</span>
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block' }}>Cancellation Cutoff</label>
            <strong>11:00 PM IST (23:00)</strong>
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'block' }}>Timezone</label>
            <strong>Asia/Kolkata (+05:30)</strong>
          </div>
        </div>
      </Card>

      {user?.role === 'ADMIN' && (
        <Card title="🛠️ Administrator Access">
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
            As a household administrator, you have access to the complete Admin Control Panel for members, ₹130 daily rates, leaves, vessel schedule, and dynamic billing.
          </p>
          <Link to="/admin">
            <Button variant="primary">
              Open Admin Control Panel &rarr;
            </Button>
          </Link>
        </Card>
      )}
    </div>
  );
}

