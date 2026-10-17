import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';

function TestConsumer() {
  const { theme, themePreference, setThemePreference, toggleTheme } = useTheme();
  return (
    <div>
      <div data-testid="current-theme">{theme}</div>
      <div data-testid="current-preference">{themePreference}</div>
      <button onClick={() => setThemePreference('light')}>Set Light</button>
      <button onClick={() => setThemePreference('dark')}>Set Dark</button>
      <button onClick={() => setThemePreference('system')}>Set System</button>
      <button onClick={toggleTheme}>Toggle</button>
    </div>
  );
}

describe('ThemeContext - Light / Dark / System', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false, // light by default in mock
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it('defaults to dark theme and sets data-theme attribute on document', () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId('current-preference').textContent).toBe('dark');
    expect(screen.getByTestId('current-theme').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('persists selected preference to localStorage and updates DOM', () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText('Set Light'));

    expect(screen.getByTestId('current-preference').textContent).toBe('light');
    expect(screen.getByTestId('current-theme').textContent).toBe('light');
    expect(localStorage.getItem('app-theme-preference')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('supports system theme preference and matches device preference', () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText('Set System'));

    expect(screen.getByTestId('current-preference').textContent).toBe('system');
    expect(localStorage.getItem('app-theme-preference')).toBe('system');
    const evaluated = screen.getByTestId('current-theme').textContent;
    expect(['dark', 'light']).toContain(evaluated);
  });

  it('toggles cyclically through preferences', () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    // Initial is dark
    expect(screen.getByTestId('current-preference').textContent).toBe('dark');

    // dark -> light
    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.getByTestId('current-preference').textContent).toBe('light');

    // light -> system
    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.getByTestId('current-preference').textContent).toBe('system');

    // system -> dark
    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.getByTestId('current-preference').textContent).toBe('dark');
  });
});
