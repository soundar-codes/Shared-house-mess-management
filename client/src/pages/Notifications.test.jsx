import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Notifications from './Notifications';
import * as NotificationContextModule from '../contexts/NotificationContext';

describe('Notifications Page', () => {
  const mockFetchNotifications = vi.fn();
  const mockMarkAsRead = vi.fn();
  const mockMarkAllAsRead = vi.fn();

  const defaultMockContext = {
    notifications: [],
    unreadCount: 0,
    loading: false,
    error: null,
    fetchNotifications: mockFetchNotifications,
    markAsRead: mockMarkAsRead,
    markAllAsRead: mockMarkAllAsRead
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderNotifications = (contextOverrides = {}) => {
    vi.spyOn(NotificationContextModule, 'useNotifications').mockReturnValue({
      ...defaultMockContext,
      ...contextOverrides
    });
    return render(<Notifications />);
  };

  it('renders empty state when there are no notifications', () => {
    renderNotifications({ notifications: [], unreadCount: 0 });

    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    expect(screen.getByText(/When housemates cancel food/i)).toBeInTheDocument();
  });

  it('renders loading state initially', () => {
    renderNotifications({ notifications: [], loading: true });

    expect(screen.getByText('Loading notifications...')).toBeInTheDocument();
  });

  it('renders list of notifications with titles, messages, and read status badges', () => {
    const mockNotifications = [
      {
        id: 1,
        title: 'Food Cancelled',
        message: 'Soundar cancelled dinner for tomorrow',
        isRead: false,
        createdAt: new Date().toISOString()
      },
      {
        id: 2,
        title: 'Chore Reminder',
        message: 'Bathroom cleaning is due today',
        isRead: true,
        createdAt: new Date(Date.now() - 3600000).toISOString()
      }
    ];

    renderNotifications({ notifications: mockNotifications, unreadCount: 1 });

    expect(screen.getByText('Food Cancelled')).toBeInTheDocument();
    expect(screen.getByText('Soundar cancelled dinner for tomorrow')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();

    expect(screen.getByText('Chore Reminder')).toBeInTheDocument();
    expect(screen.getByText('Bathroom cleaning is due today')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
  });

  it('calls markAsRead when clicking mark as read button', async () => {
    const mockNotifications = [
      {
        id: 42,
        title: 'Food Cancelled',
        message: 'Cancelled food for tomorrow',
        isRead: false,
        createdAt: new Date().toISOString()
      }
    ];

    renderNotifications({ notifications: mockNotifications, unreadCount: 1 });

    const markBtn = screen.getByText('✓ Mark as read');
    await act(async () => {
      fireEvent.click(markBtn);
    });

    expect(mockMarkAsRead).toHaveBeenCalledWith(42);
  });

  it('calls markAllAsRead when clicking Mark all as read button', async () => {
    const mockNotifications = [
      {
        id: 1,
        title: 'Food Cancelled',
        message: 'Cancelled food',
        isRead: false,
        createdAt: new Date().toISOString()
      }
    ];

    renderNotifications({ notifications: mockNotifications, unreadCount: 1 });

    const markAllBtn = screen.getByText('Mark all as read');
    await act(async () => {
      fireEvent.click(markAllBtn);
    });

    expect(mockMarkAllAsRead).toHaveBeenCalled();
  });

  it('switches between All and Unread filter tabs', () => {
    const mockNotifications = [
      { id: 1, title: 'Item 1', message: 'Read item', isRead: true },
      { id: 2, title: 'Item 2', message: 'Unread item', isRead: false }
    ];

    renderNotifications({ notifications: mockNotifications, unreadCount: 1 });

    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();

    const unreadTab = screen.getByRole('tab', { name: /unread/i });
    fireEvent.click(unreadTab);

    expect(mockFetchNotifications).toHaveBeenCalledWith({ unreadOnly: true });
  });

  it('renders error banner and allows retry', () => {
    renderNotifications({ error: 'Failed to load notifications' });

    expect(screen.getByText('Failed to load notifications')).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    expect(mockFetchNotifications).toHaveBeenCalled();
  });
});
