import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import * as AuthContextModule from '../contexts/AuthContext';

function LoginDummy() {
  const location = useLocation();
  return <div data-testid="login-page">Login Page. From: {location.state?.from?.pathname || 'none'}</div>;
}

function ProtectedDummy() {
  return <div data-testid="protected-page">Protected Page</div>;
}

function renderWithRouter(authValue, initialEntry = '/protected') {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(authValue);
  
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LoginDummy />} />
        <Route path="/protected" element={<ProtectedRoute><ProtectedDummy /></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state while authentication is unresolved', () => {
    renderWithRouter({ loading: true, isAuthenticated: false, error: null });
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });

  it('renders error state when there is an authentication error', () => {
    const mockCheckAuth = vi.fn();
    renderWithRouter({ loading: false, isAuthenticated: false, error: 'Network Error', checkAuth: mockCheckAuth });
    
    expect(screen.getByText('Network Error')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-page')).not.toBeInTheDocument();
  });

  it('redirects to /login and preserves location if unauthenticated', () => {
    renderWithRouter({ loading: false, isAuthenticated: false, error: null });
    
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(screen.getByText(/From: \/protected/i)).toBeInTheDocument();
    expect(screen.queryByTestId('protected-page')).not.toBeInTheDocument();
  });

  it('renders the protected content if authenticated', () => {
    renderWithRouter({ loading: false, isAuthenticated: true, error: null });
    
    expect(screen.getByTestId('protected-page')).toBeInTheDocument();
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });
});
