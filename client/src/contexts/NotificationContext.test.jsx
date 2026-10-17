import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { NotificationProvider, useNotifications } from './NotificationContext';
import * as AuthContextModule from './AuthContext';

function TestConsumer() {
  const {
    notifications,
    unreadCount,
    loading,
    error,
    fetchNotifications,
    markAsRead,
    markAllAsRead
  } = useNotifications();

  return (
    <div>
      <div data-testid="unread-count">{unreadCount}</div>
      <div data-testid="loading">{loading ? 'loading' : 'idle'}</div>
      <div data-testid="error">{error || 'none'}</div>
      <div data-testid="count">{notifications.length}</div>
      <button onClick={() => fetchNotifications()}>Fetch All</button>
      <button onClick={() => fetchNotifications({ unreadOnly: true })}>Fetch Unread</button>
      <button onClick={() => markAsRead(1)}>Mark 1 Read</button>
      <button onClick={() => markAllAsRead()}>Mark All Read</button>
    </div>
  );
}

describe('NotificationContext', () => {
  const mockCheckAuth = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    global.fetch = vi.fn();

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'test-user-1', name: 'Test User' },
      checkAuth: mockCheckAuth
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fetches unread count on mount and starts polling interval', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ unreadCount: 5 })
    });

    render(
      <NotificationProvider>
        <TestConsumer />
      </NotificationProvider>
    );

    // Let the initial fetch resolve
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('unread-count').textContent).toBe('5');
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/notifications/unread-count', {
      credentials: 'include'
    });

    // Advance 30 seconds to trigger polling
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ unreadCount: 6 })
    });

    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
    });

    expect(screen.getByTestId('unread-count').textContent).toBe('6');
  });

  it('handles 401 session expiration by clearing state and calling checkAuth', async () => {
    global.fetch.mockResolvedValueOnce({
      status: 401,
      ok: false
    });

    render(
      <NotificationProvider>
        <TestConsumer />
      </NotificationProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCheckAuth).toHaveBeenCalled();
    expect(screen.getByTestId('unread-count').textContent).toBe('0');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('clears state and stops timer when user is logged out (user is null)', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: null,
      checkAuth: mockCheckAuth
    });

    render(
      <NotificationProvider>
        <TestConsumer />
      </NotificationProvider>
    );

    expect(screen.getByTestId('unread-count').textContent).toBe('0');
    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('marks a notification as read and decrements unread count', async () => {
    // Initial mount unread count
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ unreadCount: 2 })
    });

    render(
      <NotificationProvider>
        <TestConsumer />
      </NotificationProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('unread-count').textContent).toBe('2');

    // Mark as read
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ notification: { id: 1, isRead: true } })
    });

    await act(async () => {
      screen.getByText('Mark 1 Read').click();
      await Promise.resolve();
    });

    expect(screen.getByTestId('unread-count').textContent).toBe('1');
  });

  it('marks all as read and sets unread count to 0', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ unreadCount: 4 })
    });

    render(
      <NotificationProvider>
        <TestConsumer />
      </NotificationProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('unread-count').textContent).toBe('4');

    // Mark all as read
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ updatedCount: 4 })
    });

    await act(async () => {
      screen.getByText('Mark All Read').click();
      await Promise.resolve();
    });

    expect(screen.getByTestId('unread-count').textContent).toBe('0');
  });

  it('handles fetch error without setting misleading unread count', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network offline'));

    render(
      <NotificationProvider>
        <TestConsumer />
      </NotificationProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('unread-count').textContent).toBe('0');
  });
});
