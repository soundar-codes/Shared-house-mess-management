import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Dashboard from './Dashboard';
import * as AuthContextModule from '../contexts/AuthContext';
import * as NotificationContextModule from '../contexts/NotificationContext';
import { BrowserRouter } from 'react-router-dom';

describe('Dashboard Component - Shared House Mess & Chores', () => {
  const mockSoundarAdmin = {
    id: 'user_soundar',
    name: 'Soundar M',
    role: 'ADMIN',
    householdId: 1
  };

  const mockSanjayMember = {
    id: 'user_sanjay',
    name: 'Sanjay K',
    role: 'MEMBER',
    householdId: 1
  };

  const mockVesselSchedule = [
    { id: 1, dayOfWeek: 'Monday', timePeriod: 'ALL_DAY', assignedUserId: 'user_soundar', assignedUserName: 'Soundar M', isGroupDuty: false },
    { id: 2, dayOfWeek: 'Tuesday', timePeriod: 'ALL_DAY', assignedUserId: 'user_sanjay', assignedUserName: 'Sanjay K', isGroupDuty: false },
    { id: 3, dayOfWeek: 'Wednesday', timePeriod: 'ALL_DAY', assignedUserId: 'user_mukesh', assignedUserName: 'Mukesh S', isGroupDuty: false },
    { id: 4, dayOfWeek: 'Thursday', timePeriod: 'ALL_DAY', assignedUserId: 'user_raj', assignedUserName: 'Raj Priyan A', isGroupDuty: false },
    { id: 5, dayOfWeek: 'Friday', timePeriod: 'MORNING', assignedUserId: 'user_soundar', assignedUserName: 'Soundar M', isGroupDuty: false },
    { id: 6, dayOfWeek: 'Friday', timePeriod: 'EVENING', assignedUserId: 'user_raj', assignedUserName: 'Raj Priyan A', isGroupDuty: false },
    { id: 7, dayOfWeek: 'Saturday', timePeriod: 'MORNING', assignedUserId: 'user_sanjay', assignedUserName: 'Sanjay K', isGroupDuty: false },
    { id: 8, dayOfWeek: 'Saturday', timePeriod: 'EVENING', assignedUserId: 'user_mukesh', assignedUserName: 'Mukesh S', isGroupDuty: false },
    { id: 9, dayOfWeek: 'Sunday', timePeriod: 'ALL_DAY', assignedUserId: null, assignedUserName: 'All Members (Group Duty)', isGroupDuty: true }
  ];

  const mockFoodRecords = [
    { id: 1, recordDate: '2026-10-17', status: 'FOOD_REQUIRED' }
  ];

  const mockFoodConfig = {
    id: 1,
    defaultRatePaise: 10000
  };

  const mockSoundarBills = [
    {
      id: 101,
      userId: 'user_soundar',
      totalAmountPaise: 280000,
      paidAmountPaise: 280000,
      balancePaise: 0,
      paymentStatus: 'PAID'
    }
  ];

  const mockSanjayBills = [
    {
      id: 102,
      userId: 'user_sanjay',
      totalAmountPaise: 300000,
      paidAmountPaise: 150000,
      balancePaise: 150000,
      paymentStatus: 'PARTIAL'
    }
  ];

  const mockMemberCycles = [
    {
      userId: 'user_soundar',
      userName: 'Soundar M',
      role: 'ADMIN',
      messStartDate: '2026-10-01',
      currentCycle: {
        periodStart: '2026-10-01',
        periodEnd: '2026-11-01',
        nextBillingDate: '2026-11-01',
        totalDays: 31,
        chargeableDays: 20,
        cancelledDays: 2,
        leaveDays: 1,
        messUnavailableDays: 0,
        accumulatedFoodPaise: 260000,
        todayFoodChargePaise: 13000,
        paidAmountPaise: 260000,
        remainingBalancePaise: 0,
        calculatedAt: '2026-10-17T06:00:00.000Z'
      }
    },
    {
      userId: 'user_sanjay',
      userName: 'Sanjay K',
      role: 'MEMBER',
      messStartDate: '2026-10-10',
      currentCycle: {
        periodStart: '2026-10-10',
        periodEnd: '2026-11-10',
        nextBillingDate: '2026-11-10',
        totalDays: 31,
        chargeableDays: 12,
        cancelledDays: 2,
        leaveDays: 3,
        messUnavailableDays: 0,
        accumulatedFoodPaise: 156000,
        todayFoodChargePaise: 0,
        paidAmountPaise: 50000,
        remainingBalancePaise: 106000,
        calculatedAt: '2026-10-17T06:00:00.000Z'
      }
    }
  ];

  const mockAssignments = [
    {
      id: 1,
      choreName: 'Bathroom Cleaning',
      userId: 'user_soundar',
      dueDate: '2026-10-20',
      status: 'PENDING'
    }
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(NotificationContextModule, 'useNotifications').mockReturnValue({
      unreadCount: 2,
      notifications: [
        { id: 1, title: 'Bill Generated', message: 'Your bill is ready', isRead: false }
      ],
      fetchNotifications: vi.fn()
    });
  });

  function setupFetchMock(currentUser, customBills = null, customSchedule = null) {
    const billsToReturn = customBills || (currentUser.id === 'user_soundar' ? mockSoundarBills : mockSanjayBills);
    const scheduleToReturn = customSchedule || mockVesselSchedule;

    vi.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (url.includes('/api/v1/chores/vessel-schedule') && opts?.method === 'PATCH') {
        const body = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            scheduleEntry: {
              id: 1,
              dayOfWeek: 'Monday',
              timePeriod: 'ALL_DAY',
              assignedUserId: body.assignedUserId,
              assignedUserName: body.assignedUserId === 'user_sanjay' ? 'Sanjay K' : 'Soundar M',
              isGroupDuty: !body.assignedUserId
            }
          })
        });
      }
      if (url.includes('/api/v1/chores/vessel-schedule')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ schedule: scheduleToReturn })
        });
      }
      if (url.includes('/api/v1/food/config')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ config: mockFoodConfig })
        });
      }
      if (url.includes('/api/v1/food')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ records: mockFoodRecords })
        });
      }
      if (url.includes('/api/v1/billing/members/cycles')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ members: mockMemberCycles })
        });
      }
      if (url.includes('/api/v1/billing')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ bills: billsToReturn })
        });
      }
      if (url.includes('/api/v1/chores/assignments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ assignments: mockAssignments })
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });
  }

  it('renders shared vessel cleaning schedule for Soundar (admin)', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: mockSoundarAdmin,
      checkAuth: vi.fn()
    });
    setupFetchMock(mockSoundarAdmin);

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Weekly Vessel-Cleaning Schedule/i)).toBeInTheDocument();
      expect(screen.getAllByText('Soundar M').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Raj Priyan A').length).toBeGreaterThan(0);
      expect(screen.getByText(/All Four Members \(Group Duty\)/i)).toBeInTheDocument();
    });

    // Check Soundar private bill details are shown
    expect(screen.getAllByText('₹2600.00').length).toBeGreaterThan(0);
    expect(screen.getByText('PAID')).toBeInTheDocument();
    // Sanjay's ₹1560 dues must NOT appear on Soundar's personal dues card
    expect(screen.queryByText('₹1560.00')).not.toBeInTheDocument();
  });

  it('renders shared vessel schedule for Sanjay (member) with Sanjay private financials only', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: mockSanjayMember,
      checkAuth: vi.fn()
    });
    setupFetchMock(mockSanjayMember);

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      // Shared schedule is completely visible
      expect(screen.getByText(/Weekly Vessel-Cleaning Schedule/i)).toBeInTheDocument();
      expect(screen.getByText(/All Four Members \(Group Duty\)/i)).toBeInTheDocument();
      // Morning and Evening periods are visible
      expect(screen.getAllByText('Morning').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Evening').length).toBeGreaterThan(0);
    });

    // Sanjay's private financial data (12 days = ₹1,560)
    expect(screen.getAllByText('₹1560.00').length).toBeGreaterThan(0);
    expect(screen.getByText('PARTIAL')).toBeInTheDocument();
    // Soundar's ₹2600 bill must NOT appear on Sanjay's dashboard
    expect(screen.queryByText('₹2600.00')).not.toBeInTheDocument();

    // Member cannot see schedule edit buttons
    expect(screen.queryByText('✏️ Edit')).not.toBeInTheDocument();
  });

  it('prominently displays daily accumulating food charges and breakdown for member', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: mockSanjayMember,
      checkAuth: vi.fn()
    });
    setupFetchMock(mockSanjayMember);

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      // 1. Current food amount: accumulated food charges for individual cycle (12 days eaten = ₹1,560)
      expect(screen.getByTestId('card-current-food-amount')).toBeInTheDocument();
      expect(screen.getAllByText('₹1560.00').length).toBeGreaterThan(0);
      expect(screen.getByText(/12 \/ 31 days eaten/i)).toBeInTheDocument();

      // 2. Today's food charge: ₹0.00 if cancelled / on leave
      expect(screen.getByTestId('card-today-food-charge')).toBeInTheDocument();

      // 3. Prominently shows days eaten, cancelled, leave days in billing card
      expect(screen.getByTestId('dashboard-billing-section')).toBeInTheDocument();
      expect(screen.getByText('12 / 31')).toBeInTheDocument();
      expect(screen.getByText('Approved Leave Days:')).toBeInTheDocument();
      expect(screen.getByText('Days Cancelled:')).toBeInTheDocument();
      expect(screen.getByText('Remaining Amount to Pay:')).toBeInTheDocument();
    });
  });

  it('allows admin to open edit modal, change vessel assignment, and saves persistently', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: mockSoundarAdmin,
      checkAuth: vi.fn()
    });
    setupFetchMock(mockSoundarAdmin);

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('✏️ Edit').length).toBeGreaterThan(0);
    });

    // Click edit on the first schedule row
    fireEvent.click(screen.getAllByText('✏️ Edit')[0]);

    // Modal opens
    expect(screen.getByText('Edit Vessel Responsibility')).toBeInTheDocument();

    // Select Sanjay K as assignee
    const select = screen.getByLabelText(/Assigned Member:/i);
    fireEvent.change(select, { target: { value: 'user_sanjay' } });

    // Submit form
    const saveBtn = screen.getByText('Save Schedule');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Updated vessel schedule/i)).toBeInTheDocument();
    });
  });
});
