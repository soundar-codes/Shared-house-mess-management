import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

function TestComponent() {
  const { user, loading, error, isAuthenticated, checkAuth, loginUser, logoutUser } = useAuth();
  return (
    <div>
      <div data-testid="loading">{loading ? 'true' : 'false'}</div>
      <div data-testid="error">{error || 'none'}</div>
      <div data-testid="is-authenticated">{isAuthenticated ? 'true' : 'false'}</div>
      <div data-testid="user-name">{user ? user.name : 'no-user'}</div>
      <button onClick={() => checkAuth()}>Retry</button>
      <button onClick={() => loginUser({ id: 1, name: 'Test', role: 'user', householdId: 1 })}>Login</button>
      <button onClick={() => logoutUser()}>Logout</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles successful session restoration', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: 1, name: 'Alice', role: 'admin', householdId: 1 } })
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    // Initial state
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('false');

    // Wait for effect
    await screen.findByText('false'); // loading becomes false

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/auth/me', expect.any(Object));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('user-name')).toHaveTextContent('Alice');
  });

  it('handles HTTP 401 unauthenticated response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await screen.findByText('false'); // loading becomes false

    expect(screen.getByTestId('error')).toHaveTextContent('none');
    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('user-name')).toHaveTextContent('no-user');
  });

  it('handles HTTP 500 server error response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await screen.findByText('false'); // loading becomes false

    expect(screen.getByTestId('error')).toHaveTextContent('Authentication service error. Please try again.');
    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('false');
  });

  it('handles network failure', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await screen.findByText('false'); // loading becomes false

    expect(screen.getByTestId('error')).toHaveTextContent('Network error. Please check your connection and try again.');
    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('false');
  });

  it('allows retry after an authentication service failure', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await screen.findByText('false');
    expect(screen.getByTestId('error')).toHaveTextContent('Network error. Please check your connection and try again.');

    // Mock success for the retry
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: 1, name: 'Alice', role: 'admin', householdId: 1 } })
    });

    act(() => {
      screen.getByText('Retry').click();
    });

    // Wait for the next check to complete (loading becomes false again)
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByTestId('error')).toHaveTextContent('none');
    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('true');
  });

  it('updates state on successful login and clears on logout', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await screen.findByText('false');

    act(() => {
      screen.getByText('Login').click();
    });

    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('user-name')).toHaveTextContent('Test');

    // Mock logout response
    global.fetch.mockResolvedValueOnce({ ok: true });

    await act(async () => {
      screen.getByText('Logout').click();
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/auth/logout', expect.any(Object));
    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('user-name')).toHaveTextContent('no-user');
  });
});
