import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Login from './Login';
import * as AuthContextModule from '../contexts/AuthContext';

describe('Login Page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects authenticated users away from /login', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      loading: false,
      isAuthenticated: true,
      error: null
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div data-testid="dashboard">Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    );

    // Should redirect to Dashboard (/)
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Sign in to manage your mess')).not.toBeInTheDocument();
  });

  it('renders login form for unauthenticated users', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      loading: false,
      isAuthenticated: false,
      error: null
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Sign In')).toBeInTheDocument();
  });
});
