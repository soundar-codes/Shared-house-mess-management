import React, { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Input from '../components/Input';
import Button from '../components/Button';
import Card from '../components/Card';
import { apiFetch } from '../services/apiClient';
import './Login.css';

export default function Login() {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { loginUser, isAuthenticated, loading: authLoading } = useAuth();
  
  const from = location.state?.from?.pathname || '/';

  if (authLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    
    if (!userId.trim() || !password) {
      setError('User ID and Password are required.');
      return;
    }
    
    setLoading(true);
    try {
      const response = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId, password })
      });
      
      if (!response.ok) {
        const data = await response.json();
        setError(data?.error?.message || 'Authentication failed.');
      } else {
        const data = await response.json();
        // Update AuthContext
        loginUser(data.user);
        // We successfully logged in
        navigate(from, { replace: true });
      }
    } catch {
      setError('Network error. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <Card className="login-card">
        <div className="login-header">
          <h2>Shared House</h2>
          <p>Sign in to manage your mess</p>
        </div>
        
        {error && <div className="login-error-alert">{error}</div>}
        
        <form onSubmit={handleLogin} className="login-form">
          <Input 
            id="userId"
            label="User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={loading}
            placeholder="e.g. Soundar, Sanjay, Mukesh, Raj"
          />
          <Input 
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            placeholder="••••••••"
          />
          <Button type="submit" disabled={loading} className="login-btn">
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
