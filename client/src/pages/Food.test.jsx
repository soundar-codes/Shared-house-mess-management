import React from 'react';
import { render, screen, act } from '@testing-library/react';
import Food from './Food';
import * as AuthContextModule from '../contexts/AuthContext';
import * as foodRulesModule from '../utils/foodRules';

const mockCheckAuth = vi.fn();

const renderFood = () => {
  return render(<Food />);
};

describe('Food Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'user-1' },
      checkAuth: mockCheckAuth
    });

    vi.spyOn(foodRulesModule, 'getKolkataDateString').mockReturnValue('2026-10-10');
    vi.spyOn(foodRulesModule, 'getNextDayString').mockReturnValue('2026-10-11');
    vi.spyOn(foodRulesModule, 'getFoodActionState').mockReturnValue({ allowed: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state initially', () => {
    renderFood();
    expect(screen.getByText('Loading food data...')).toBeInTheDocument();
  });

  it('handles 401 on initial fetch by calling checkAuth', async () => {
    global.fetch.mockResolvedValueOnce({ status: 401 }); // config fetch
    global.fetch.mockResolvedValueOnce({ status: 200 }); // food fetch

    renderFood();
    
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockCheckAuth).toHaveBeenCalled();
  });

  it('displays default FOOD_REQUIRED for sparse records', async () => {
    // Config fetch
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ config: { default_rate_paise: 10000 } })
    });
    // Food fetch - EMPTY array (sparse)
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ records: [] })
    });

    renderFood();

    // Wait for loading to finish
    await screen.findByText("Today's Food");

    // Today should default to FOOD REQUIRED
    const badge = screen.getByText('FOOD REQUIRED');
    expect(badge).toBeInTheDocument();
    
    // Tomorrow should show the cancel button
    const cancelBtn = screen.getByText("Cancel Tomorrow's Food");
    expect(cancelBtn).toBeInTheDocument();
    expect(screen.getAllByText('₹100/day')[0]).toBeInTheDocument();
  });

  it('displays actual records if returned by backend', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ config: { default_rate_paise: 10000 } })
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [
          { date: '2026-10-10', status: 'CANCELLED', rate_paise: 10000 },
          { date: '2026-10-11', status: 'CANCELLED', rate_paise: 10000 }
        ]
      })
    });

    renderFood();
    await screen.findByText("Today's Food");

    // Today is cancelled
    expect(screen.getByText('CANCELLED')).toBeInTheDocument();
    
    // Tomorrow is cancelled, so button says Restore
    expect(screen.getByText("Restore Tomorrow's Food")).toBeInTheDocument();
  });

  it('submits a cancellation and updates the UI', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ config: { default_rate_paise: 10000 } })
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ records: [] }) // default required
    });

    renderFood();
    await screen.findByText("Today's Food");

    // Click "Cancel Tomorrow's Food"
    const cancelBtn = screen.getByText("Cancel Tomorrow's Food");
    act(() => cancelBtn.click());

    // Click Confirm
    const confirmBtn = screen.getByText("Confirm Cancellation");
    
    // Mock the PUT request
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ record: { date: '2026-10-11', status: 'CANCELLED', rate_paise: 10000 } })
    });

    await act(async () => {
      confirmBtn.click();
    });

    // The PUT request should have been sent
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/food/2026-10-11', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ status: 'CANCELLED' })
    }));

    // Should now show Cancelled instead of Restore (Wait, the button text changes)
    expect(await screen.findByText("Restore Tomorrow's Food")).toBeInTheDocument();
  });

  it('handles server validation errors correctly during update', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ config: { default_rate_paise: 10000 } })
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ records: [] }) // default required
    });

    renderFood();
    await screen.findByText("Today's Food");

    act(() => screen.getByText("Cancel Tomorrow's Food").click());

    // Mock PUT error
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "Food updates are only allowed for tomorrow before 23:00 IST" } })
    });

    await act(async () => {
      screen.getByText("Confirm Cancellation").click();
    });

    // Error should be visible, and UI not updated optimistically
    expect(screen.getByText("Food updates are only allowed for tomorrow before 23:00 IST")).toBeInTheDocument();
    
    // The button should still say "Confirm Cancellation" because it failed
    expect(screen.getByText("Confirm Cancellation")).toBeInTheDocument();
  });

  it('displays cutoff rejection message natively if foodRules rejects it', async () => {
    // If foodRules says it's not allowed natively
    vi.spyOn(foodRulesModule, 'getFoodActionState').mockReturnValue({ allowed: false, reason: 'CUTOFF_PASSED' });
    
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ config: { default_rate_paise: 10000 } })
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ records: [] })
    });

    renderFood();
    await screen.findByText("Today's Food");

    // The button shouldn't exist
    expect(screen.queryByText("Cancel Tomorrow's Food")).not.toBeInTheDocument();
    
    // Error message should be shown natively
    expect(screen.getByText("Food changes are closed for tomorrow after 11:00 PM.")).toBeInTheDocument();
  });

  it('displays mess unavailable banner and disables cancellation if tomorrow has active declaration', async () => {
    // Config
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ config: { default_rate_paise: 10000 } })
    });
    // Food records
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [
          { date: '2026-10-11', status: 'MESS_UNAVAILABLE', isMessUnavailable: true, messUnavailableReason: 'Cook on festival leave' }
        ]
      })
    });
    // Unavailability declarations
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        declarations: [
          { id: 1, declarationDate: '2026-10-11', reason: 'Cook on festival leave', status: 'ACTIVE' }
        ]
      })
    });

    renderFood();
    await screen.findByText("Today's Food");

    // Member button should NOT be rendered
    expect(screen.queryByText("Cancel Tomorrow's Food")).not.toBeInTheDocument();
    expect(screen.queryByText("Restore Tomorrow's Food")).not.toBeInTheDocument();

    // Unavailable alert and reason must be visible
    expect(screen.getByText(/Cook on festival leave/i)).toBeInTheDocument();
    expect(screen.getByText(/Food is declared unavailable by the administrator/i)).toBeInTheDocument();
  });

  it('admin sees admin controls to declare and revoke mess food unavailability', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'admin-1', role: 'ADMIN' },
      checkAuth: mockCheckAuth
    });

    // Config
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ config: { default_rate_paise: 10000 } })
    });
    // Food records
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ records: [] })
    });
    // Unavailability declarations
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        declarations: [
          { id: 99, declarationDate: '2026-10-15', reason: 'Gas leakage inspection', status: 'ACTIVE' }
        ]
      })
    });

    renderFood();
    await screen.findByText(/Admin: Declare Mess Food Unavailable/i);

    // Form inputs and button should exist
    expect(screen.getByLabelText(/Date:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reason:/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Declare Unavailable/i })).toBeInTheDocument();

    // Active declaration list with Revoke button
    expect(screen.getByText('Gas leakage inspection')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revoke/i })).toBeInTheDocument();
    expect(screen.getAllByText('2026-10-15').length).toBeGreaterThan(0);
  });

  it('admin sees Mess Food Management (Attendance & Leaves) section with attendance table', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'admin-1', role: 'ADMIN' },
      checkAuth: mockCheckAuth
    });

    // Mock initial 3 calls (config, food, unavailable)
    global.fetch.mockImplementation((url) => {
      if (url.includes('/api/v1/food/config')) {
        return Promise.resolve({ ok: true, json: async () => ({ config: { default_rate_paise: 10000 } }) });
      }
      if (url.includes('/api/v1/food?month=')) {
        return Promise.resolve({ ok: true, json: async () => ({ records: [] }) });
      }
      if (url.includes('/api/v1/food/unavailable')) {
        return Promise.resolve({ ok: true, json: async () => ({ declarations: [] }) });
      }
      if (url.includes('/api/v1/food/attendance')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            members: [
              { id: 'u1', name: 'Soundar M', email: 'soundar@example.com' },
              { id: 'u2', name: 'Sanjay K', email: 'sanjay@example.com' }
            ],
            records: [
              { user_id: 'u1', date: '2026-10-12', status: 'FOOD_REQUIRED' },
              { user_id: 'u2', date: '2026-10-12', status: 'FOOD_REQUIRED' },
              { user_id: 'u1', date: '2026-10-13', status: 'CANCELLED' },
              { user_id: 'u2', date: '2026-10-13', status: 'CANCELLED' }
            ],
            leaves: [
              {
                id: 10,
                userId: 'u1',
                userName: 'Soundar M',
                startDate: '2026-10-15',
                endDate: '2026-10-21',
                reason: 'Diwali break',
                status: 'ACTIVE'
              }
            ],
            messUnavailability: []
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderFood();
    await screen.findByText(/Admin: Mess Food Management \(Attendance & Leaves\)/i);

    // Verify presence of elements
    expect(screen.getAllByText('Soundar M').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sanjay K').length).toBeGreaterThan(0);
    expect(screen.getByText(/Schedule Leave Period/i)).toBeInTheDocument();
    expect(screen.getByText(/All Four Members/i)).toBeInTheDocument();
    expect(screen.getByText('Diwali break')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel Leave/i })).toBeInTheDocument();
  });
});

