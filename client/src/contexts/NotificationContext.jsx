import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { user, checkAuth } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/v1/notifications/unread-count', {
        credentials: 'include'
      });
      if (res.status === 401) {
        setNotifications([]);
        setUnreadCount(0);
        if (checkAuth) checkAuth();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (err) {
      console.error('Failed to fetch unread notification count:', err);
    }
  }, [user, checkAuth]);

  const fetchNotifications = useCallback(async ({ unreadOnly = false } = {}) => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const url = unreadOnly 
        ? '/api/v1/notifications?unreadOnly=true' 
        : '/api/v1/notifications';
      const res = await fetch(url, { credentials: 'include' });
      if (res.status === 401) {
        setNotifications([]);
        setUnreadCount(0);
        if (checkAuth) checkAuth();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        // Also update unread count based on current data or fetch
        fetchUnreadCount();
      } else {
        setError('Failed to load notifications');
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
      setError('Network error while loading notifications');
    } finally {
      setLoading(false);
    }
  }, [user, checkAuth, fetchUnreadCount]);

  const markAsRead = async (notificationId) => {
    try {
      const res = await fetch(`/api/v1/notifications/${notificationId}/read`, {
        method: 'PATCH',
        credentials: 'include'
      });
      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return false;
      }
      if (res.ok) {
        setNotifications(prev =>
          prev.map(item =>
            item.id === notificationId ? { ...item, isRead: true } : item
          )
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
        return true;
      }
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
    return false;
  };

  const markAllAsRead = async () => {
    try {
      const res = await fetch('/api/v1/notifications/read-all', {
        method: 'PATCH',
        credentials: 'include'
      });
      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return false;
      }
      if (res.ok) {
        setNotifications(prev =>
          prev.map(item => ({ ...item, isRead: true }))
        );
        setUnreadCount(0);
        return true;
      }
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
    return false;
  };

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    if (user) {
      fetchUnreadCount();
      // Poll unread count every 30 seconds
      const interval = setInterval(fetchUnreadCount, 30000);
      return () => clearInterval(interval);
    } else {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [user, fetchUnreadCount]);

  const value = {
    notifications,
    unreadCount,
    loading,
    error,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
