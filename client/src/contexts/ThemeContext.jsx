import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  // Stored preference: 'dark' | 'light' | 'system'
  const [themePreference, setThemePreference] = useState(() => {
    const saved = localStorage.getItem('app-theme-preference') || localStorage.getItem('app-theme');
    if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
    return 'dark'; // Default to modern dark theme
  });

  // Evaluated theme: 'dark' | 'light'
  const [theme, setTheme] = useState(() => {
    if (themePreference === 'system') {
      if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return 'dark';
    }
    return themePreference;
  });

  useEffect(() => {
    localStorage.setItem('app-theme-preference', themePreference);
    localStorage.setItem('app-theme', theme); // backward compatibility

    let activeTheme = themePreference;
    if (themePreference === 'system') {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        activeTheme = mediaQuery?.matches ? 'dark' : 'light';

        const handleChange = (e) => {
          const newTheme = e.matches ? 'dark' : 'light';
          setTheme(newTheme);
          applyThemeToDom(newTheme);
        };

        if (mediaQuery?.addEventListener) {
          mediaQuery.addEventListener('change', handleChange);
          return () => mediaQuery.removeEventListener('change', handleChange);
        } else if (mediaQuery?.addListener) {
          mediaQuery.addListener(handleChange);
          return () => mediaQuery.removeListener(handleChange);
        }
      } else {
        activeTheme = 'dark';
      }
    }

    setTheme(activeTheme);
    applyThemeToDom(activeTheme);
  }, [themePreference]);

  const applyThemeToDom = (targetTheme) => {
    document.documentElement.setAttribute('data-theme', targetTheme);
    if (targetTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const toggleTheme = () => {
    setThemePreference(prev => {
      if (prev === 'dark') return 'light';
      if (prev === 'light') return 'system';
      return 'dark';
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, themePreference, setThemePreference, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
