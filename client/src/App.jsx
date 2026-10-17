import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';

// Layout
import AppLayout from './layouts/AppLayout';

// Pages
import Dashboard from './pages/Dashboard';
import Food from './pages/Food';
import Billing from './pages/Billing';
import Chores from './pages/Chores';
import Notifications from './pages/Notifications';
import HouseInfo from './pages/HouseInfo';
import Settings from './pages/Settings';
import Admin from './pages/Admin';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ThemeProvider } from './contexts/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <NotificationProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route 
              path="/" 
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="food" element={<Food />} />
              <Route path="billing" element={<Billing />} />
              <Route path="chores" element={<Chores />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="house-info" element={<HouseInfo />} />
              <Route path="settings" element={<Settings />} />
              <Route path="admin" element={<Admin />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </NotificationProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
