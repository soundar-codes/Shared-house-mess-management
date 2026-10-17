import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useTheme } from '../contexts/ThemeContext';
import './AppLayout.css';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '🏠' },
  { path: '/food', label: 'Food', icon: '🍽️' },
  { path: '/billing', label: 'Billing', icon: '💰' },
  { path: '/chores', label: 'Chores', icon: '🧹' },
  { path: '/house-info', label: 'House Info', icon: '🏡' },
  { path: '/notifications', label: 'Notifications', icon: '🔔' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function AppLayout() {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const { user, logoutUser } = useAuth();
  const { unreadCount } = useNotifications();
  const { theme, themePreference, setThemePreference, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logoutUser();
    navigate('/login', { replace: true });
  };

  const toggleNav = () => setIsMobileNavOpen(!isMobileNavOpen);

  const filteredNavItems = [
    ...navItems,
    ...(user?.role === 'ADMIN' ? [{ path: '/admin', label: 'Admin Portal', icon: '🛠️' }] : [])
  ];

  return (
    <div className="app-layout">
      {/* Mobile Header */}
      <header className="mobile-header">
        <div className="logo">Shared House</div>
        <div className="mobile-header-actions">
          <button 
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          {unreadCount > 0 && (
            <NavLink to="/notifications" className="mobile-notif-btn" title="Notifications">
              🔔<span className="mobile-badge">{unreadCount}</span>
            </NavLink>
          )}
          <button className="menu-toggle" onClick={toggleNav}>
            {isMobileNavOpen ? '✕' : '☰'}
          </button>
        </div>
      </header>

      {/* Sidebar Navigation */}
      <aside className={`sidebar ${isMobileNavOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo desktop-only">Shared House</div>
        </div>
        
        <nav className="sidebar-nav">
          {filteredNavItems.map(item => (
            <NavLink 
              key={item.path} 
              to={item.path} 
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setIsMobileNavOpen(false)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {item.path === '/notifications' && unreadCount > 0 && (
                <span className="nav-badge" data-testid="unread-badge">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="theme-toggle-row">
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Theme
            </span>
            <div className="theme-segmented-control" role="group" aria-label="Select color theme">
              <button 
                type="button"
                className={`theme-segment-btn ${themePreference === 'light' ? 'active' : ''}`}
                onClick={() => setThemePreference('light')}
                title="Light Theme"
                aria-label="Light Theme"
              >
                ☀️
              </button>
              <button 
                type="button"
                className={`theme-segment-btn ${themePreference === 'dark' ? 'active' : ''}`}
                onClick={() => setThemePreference('dark')}
                title="Dark Theme"
                aria-label="Dark Theme"
              >
                🌙
              </button>
              <button 
                type="button"
                className={`theme-segment-btn ${themePreference === 'system' ? 'active' : ''}`}
                onClick={() => setThemePreference('system')}
                title="System Default Theme"
                aria-label="System Default Theme"
              >
                💻
              </button>
            </div>
          </div>

          <div className="user-profile">
            <div className="user-avatar">{user?.name ? user.name.substring(0, 2).toUpperCase() : 'U'}</div>
            <div className="user-info">
              <div className="user-name">{user?.name || 'User'}</div>
              <div className="user-role">{user?.role || 'Member'}</div>
            </div>
            <button className="logout-btn" onClick={handleLogout} title="Log Out">
              🚪
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <div className="content-container">
          <Outlet />
        </div>
      </main>

      {/* Mobile Overlay */}
      {isMobileNavOpen && (
        <div className="mobile-overlay" onClick={() => setIsMobileNavOpen(false)}></div>
      )}
    </div>
  );
}
