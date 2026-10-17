import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState(null);

  const checkAuth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/auth/me', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setUser({
          id: data.user.id,
          name: data.user.name,
          role: data.user.role,
          householdId: data.user.householdId
        });
        setError(null);
      } else if (response.status === 401) {
        setUser(null);
        setError(null);
      } else {
        setUser(null);
        setError('Authentication service error. Please try again.');
      }
    } catch (err) {
      console.error("Network error during auth check:", err);
      setUser(null);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const loginUser = (userData) => {
    setUser({
      id: userData.id,
      name: userData.name,
      role: userData.role,
      householdId: userData.householdId
    });
  };

  const logoutUser = async () => {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
    }
  };

  const value = {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    loginUser,
    logoutUser,
    checkAuth
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
