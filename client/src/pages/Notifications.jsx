import React, { useState, useEffect } from 'react';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import Badge from '../components/Badge';
import { useNotifications } from '../contexts/NotificationContext';
import './Notifications.css';

function getNotificationIcon(title = '') {
  const lower = title.toLowerCase();
  if (lower.includes('food')) return '🍽️';
  if (lower.includes('chore') || lower.includes('duty') || lower.includes('cleaning')) return '🧹';
  if (lower.includes('bill') || lower.includes('payment')) return '💰';
  return '🔔';
}

function formatNotificationTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;

  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

export default function Notifications() {
  const {
    notifications,
    unreadCount,
    loading,
    error,
    fetchNotifications,
    markAsRead,
    markAllAsRead
  } = useNotifications();

  const [filter, setFilter] = useState('ALL'); // 'ALL' or 'UNREAD'
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchNotifications({ unreadOnly: filter === 'UNREAD' });
  }, [fetchNotifications, filter]);

  const handleMarkAsRead = async (id, e) => {
    e.stopPropagation();
    await markAsRead(id);
  };

  const handleMarkAllAsRead = async () => {
    setActionLoading(true);
    try {
      await markAllAsRead();
    } finally {
      setActionLoading(false);
    }
  };

  const displayedNotifications = filter === 'UNREAD'
    ? notifications.filter(n => !n.isRead)
    : notifications;

  return (
    <div className="notifications-container">
      <PageHeader 
        title="Notifications" 
        description="View system alerts, mess announcements, and household chore updates." 
      />

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => fetchNotifications({ unreadOnly: filter === 'UNREAD' })}>
            Retry
          </Button>
        </div>
      )}

      <div className="notifications-controls">
        <div className="notification-filter-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={filter === 'ALL'}
            className={`filter-tab ${filter === 'ALL' ? 'active' : ''}`}
            onClick={() => setFilter('ALL')}
          >
            All
          </button>
          <button
            role="tab"
            aria-selected={filter === 'UNREAD'}
            className={`filter-tab ${filter === 'UNREAD' ? 'active' : ''}`}
            onClick={() => setFilter('UNREAD')}
          >
            Unread
            {unreadCount > 0 && <span className="filter-badge">{unreadCount}</span>}
          </button>
        </div>

        <div className="notifications-actions">
          {unreadCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleMarkAllAsRead}
              disabled={actionLoading}
            >
              Mark all as read
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchNotifications({ unreadOnly: filter === 'UNREAD' })}
            disabled={loading}
          >
            🔄 Refresh
          </Button>
        </div>
      </div>

      {loading && notifications.length === 0 ? (
        <div className="loading-state">Loading notifications...</div>
      ) : displayedNotifications.length === 0 ? (
        <div className="empty-notifications">
          <div className="empty-icon">🎉</div>
          <h3 className="empty-title">
            {filter === 'UNREAD' ? 'No unread notifications' : 'No notifications yet'}
          </h3>
          <p className="empty-description">
            {filter === 'UNREAD'
              ? "You are all caught up! There are no unread alerts at this time."
              : "When housemates cancel food, chores are rotated, or bills are generated, you will see updates here."}
          </p>
        </div>
      ) : (
        <div className="notifications-list">
          {displayedNotifications.map(notification => (
            <div
              key={notification.id}
              className={`notification-card ${!notification.isRead ? 'unread' : 'read'}`}
              onClick={() => {
                if (!notification.isRead) {
                  markAsRead(notification.id);
                }
              }}
            >
              <div className="notification-icon-wrapper">
                {getNotificationIcon(notification.title)}
              </div>
              <div className="notification-body">
                <div className="notification-header-row">
                  <h4 className="notification-title">{notification.title}</h4>
                  <span className="notification-time">
                    {formatNotificationTime(notification.createdAt)}
                  </span>
                </div>
                <p className="notification-message">{notification.message}</p>
                <div className="notification-footer">
                  <Badge variant={notification.isRead ? 'default' : 'warning'}>
                    {notification.isRead ? 'Read' : 'New'}
                  </Badge>
                  {!notification.isRead && (
                    <button
                      className="mark-read-btn"
                      onClick={(e) => handleMarkAsRead(notification.id, e)}
                    >
                      ✓ Mark as read
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
