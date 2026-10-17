import React from 'react';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Admin from './Admin';
import * as AuthContextModule from '../contexts/AuthContext';

describe('Admin Portal Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders access denied message for non-admin members', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'user_sanjay', name: 'Sanjay K', role: 'MEMBER' }
    });

    render(
      <BrowserRouter>
        <Admin />
      </BrowserRouter>
    );

    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText(/You must have the ADMIN role/i)).toBeInTheDocument();
  });

  it('renders all 9 admin section tabs and initial overview data for admin', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'user_soundar', name: 'Soundar M', role: 'ADMIN' }
    });

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/v1/admin/overview')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            overview: {
              totalMembers: 4,
              activeMembers: 4,
              dailyRatePaise: 13000,
              dailyRateRupees: 130,
              todayDate: '2026-10-17',
              todayStats: { ate: 3, cancelled: 1, onLeave: 0, sparse: 0 },
              activeLeaves: [],
              billingSummary: { totalBilledPaise: 520000, totalPaidPaise: 100000, outstandingPaise: 420000, pendingBillsCount: 2, totalBillsCount: 4 },
              recentAuditLogs: [],
              automationStatus: { status: 'SUCCESS', executed_at: new Date().toISOString(), generated_count: 1, preserved_count: 3 },
              householdSettings: { name: 'Shared House', timezone: 'Asia/Kolkata', cancellation_cutoff_time: '23:00' }
            }
          })
        });
      }
      if (url.includes('/api/v1/admin/members')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            members: [
              { id: 'user_soundar', name: 'Soundar M', role: 'ADMIN', isActive: true, messStartDate: '2026-10-10', financials: { totalBilledPaise: 230000, totalPaidPaise: 100000, balancePaise: 130000 } }
            ]
          })
        });
      }
      if (url.includes('/api/v1/food/attendance')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ members: [], records: [], leaves: [], messUnavailability: [] })
        });
      }
      if (url.includes('/api/v1/billing')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ bills: [] })
        });
      }
      if (url.includes('/api/v1/chores/vessel-schedule')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ schedule: [] })
        });
      }
      if (url.includes('/api/v1/chores/assignments')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ assignments: [] })
        });
      }
      if (url.includes('/api/v1/admin/audit-logs')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ logs: [] })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(
      <BrowserRouter>
        <Admin />
      </BrowserRouter>
    );

    // Verify Tab headers
    expect(await screen.findByText(/1\. Overview/i)).toBeInTheDocument();
    expect(screen.getByText(/2\. Members/i)).toBeInTheDocument();
    expect(screen.getByText(/3\. Food Attendance/i)).toBeInTheDocument();
    expect(screen.getByText(/4\. Leave Management/i)).toBeInTheDocument();
    expect(screen.getByText(/5\. Billing & Payments/i)).toBeInTheDocument();
    expect(screen.getByText(/6\. Vessel Cleaning & Chores/i)).toBeInTheDocument();
    expect(screen.getByText(/7\. Household Settings/i)).toBeInTheDocument();
    expect(screen.getByText(/8\. Audit Logs/i)).toBeInTheDocument();
    expect(screen.getByText(/9\. Automatic Billing Status/i)).toBeInTheDocument();

    // Verify ₹130 rate displayed
    expect(screen.getAllByText(/130/i).length).toBeGreaterThan(0);
  });
});
