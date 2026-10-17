import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Chores from './Chores';
import * as AuthContextModule from '../contexts/AuthContext';

describe('Chores Page Component', () => {
  const mockUser = {
    id: 'user_sanjay',
    name: 'Sanjay K',
    role: 'MEMBER'
  };

  const mockSchedule = [
    { id: 1, dayOfWeek: 'Monday', timePeriod: 'ALL_DAY', assignedUserId: 'user_soundar', assignedUserName: 'Soundar M', isGroupDuty: false },
    { id: 9, dayOfWeek: 'Sunday', timePeriod: 'ALL_DAY', assignedUserId: null, assignedUserName: 'All Members (Group Duty)', isGroupDuty: true }
  ];

  const mockAssignments = [
    {
      id: 101,
      choreName: 'Bathroom Cleaning',
      userId: 'user_sanjay',
      userName: 'Sanjay K',
      dueDate: '2026-10-20',
      status: 'PENDING'
    },
    {
      id: 102,
      choreName: 'Water Duty',
      userId: 'user_soundar',
      userName: 'Soundar M',
      dueDate: '2026-10-21',
      status: 'COMPLETED'
    }
  ];

  const mockDustbin = {
    id: 50,
    claimantUserId: 'user_sanjay',
    claimantName: 'Sanjay K',
    cycleStartDate: '2026-10-16',
    status: 'OPEN'
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: mockUser,
      checkAuth: vi.fn()
    });
  });

  it('renders loading state initially', () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
    render(<Chores />);
    expect(screen.getByText(/Loading household chores/i)).toBeInTheDocument();
  });

  it('renders vessel schedule, assignments, and dustbin duty correctly', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('vessel-schedule')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ schedule: mockSchedule }) });
      }
      if (url.includes('assignments')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ assignments: mockAssignments }) });
      }
      if (url.includes('dustbin/current')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cycle: mockDustbin }) });
      }
      if (url.includes('dustbin/history')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ history: [] }) });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<Chores />);

    await waitFor(() => {
      expect(screen.getByText(/Vessel Washing Schedule/i)).toBeInTheDocument();
    });

    // Check Sunday group duty rendering
    expect(screen.getByText(/All Members \(Group Duty\)/i)).toBeInTheDocument();
    expect(screen.getByText('Monday')).toBeInTheDocument();

    // Check assignment rendering
    expect(screen.getByText('Bathroom Cleaning')).toBeInTheDocument();
    expect(screen.getByText('Water Duty')).toBeInTheDocument();

    // Check dustbin rendering
    expect(screen.getAllByText(/Sanjay K/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Mark Duty Completed/i)).toBeInTheDocument();
  });

  it('allows user to update their own assignment status', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (url.includes('vessel-schedule')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ schedule: mockSchedule }) });
      }
      if (url.includes('assignments') && opts?.method === 'PATCH') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ assignment: { ...mockAssignments[0], status: 'COMPLETED' } }) });
      }
      if (url.includes('assignments')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ assignments: mockAssignments }) });
      }
      if (url.includes('dustbin/current')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cycle: null }) });
      }
      if (url.includes('dustbin/history')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ history: [] }) });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<Chores />);

    await waitFor(() => {
      expect(screen.getByText('Bathroom Cleaning')).toBeInTheDocument();
    });

    const select = screen.getByLabelText(/Update status for Bathroom Cleaning/i);
    fireEvent.change(select, { target: { value: 'COMPLETED' } });

    await waitFor(() => {
      expect(screen.getAllByText('COMPLETED').length).toBeGreaterThan(0);
    });
  });

  it('handles dustbin duty completion', async () => {
    let completed = false;
    vi.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (url.includes('vessel-schedule')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ schedule: mockSchedule }) });
      }
      if (url.includes('assignments')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ assignments: [] }) });
      }
      if (url.includes('dustbin/50/complete') && opts?.method === 'POST') {
        completed = true;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cycle: { id: 50, status: 'COMPLETED' } }) });
      }
      if (url.includes('dustbin/current')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cycle: completed ? null : mockDustbin }) });
      }
      if (url.includes('dustbin/history')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ history: [] }) });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<Chores />);

    await waitFor(() => {
      expect(screen.getByText(/Mark Duty Completed/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Mark Duty Completed/i));

    await waitFor(() => {
      expect(completed).toBe(true);
    });
  });
});
