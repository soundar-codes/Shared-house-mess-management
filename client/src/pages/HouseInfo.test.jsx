import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import HouseInfo from './HouseInfo';
import * as AuthContextModule from '../contexts/AuthContext';

describe('HouseInfo Page Component', () => {
  const mockAdminUser = {
    id: 'user_soundar',
    name: 'Soundar M',
    role: 'ADMIN'
  };

  const mockMemberUser = {
    id: 'user_raj',
    name: 'Raj Priyan A',
    role: 'MEMBER'
  };

  const mockInfo = {
    id: 1,
    householdId: 1,
    householdName: 'Shared House',
    address: 'Flat 402, Green Valley Enclave, 4th Cross Road',
    landmark: 'Near Metro Station',
    pincode: '560037',
    googleMapsUrl: 'https://maps.google.com/?q=Flat402',
    wifiSsid: 'SharedHouse_5G',
    wifiPassword: 'HousePeace@2026',
    emergencyContacts: [
      { role: 'House Owner', name: 'Mr. Ramanathan', phone: '+91 98450 12345' },
      { role: 'Electrician', name: 'Suresh Kumar', phone: '+91 98401 54321' }
    ],
    houseRules: '1. Food cancellation cutoff 11:00 PM IST.\n2. Wash vessels promptly.',
    notes: 'Common dustbin clearance every Tuesday.'
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders house info details for regular member (read-only)', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: mockMemberUser,
      checkAuth: vi.fn()
    });

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/api/v1/household/info')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ info: mockInfo })
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });

    render(<HouseInfo />);

    await waitFor(() => {
      expect(screen.getByText(/Flat 402, Green Valley Enclave/i)).toBeInTheDocument();
      expect(screen.getByText('SharedHouse_5G')).toBeInTheDocument();
      expect(screen.getByText('Mr. Ramanathan')).toBeInTheDocument();
      expect(screen.getByText('Suresh Kumar')).toBeInTheDocument();
    });

    // Regular member should NOT see the edit button
    expect(screen.queryByText(/Edit House Details/i)).not.toBeInTheDocument();
  });

  it('allows admin to open modal and edit household details', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: mockAdminUser,
      checkAuth: vi.fn()
    });

    let putUrl = '';
    let putBody = null;

    vi.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (url.includes('/api/v1/household/info')) {
        if (opts?.method === 'PUT') {
          putUrl = url;
          putBody = JSON.parse(opts.body);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ info: { ...mockInfo, ...putBody } })
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ info: mockInfo })
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });

    render(<HouseInfo />);

    await waitFor(() => {
      expect(screen.getByText(/Edit House Details/i)).toBeInTheDocument();
    });

    // Open edit modal
    fireEvent.click(screen.getByText(/Edit House Details/i));

    await waitFor(() => {
      expect(screen.getByText(/Edit Household Information \(Admin\)/i)).toBeInTheDocument();
    });

    // Submit form
    fireEvent.click(screen.getByText('Save House Information'));

    await waitFor(() => {
      expect(putUrl).toContain('/api/v1/household/info');
      expect(screen.getByText(/Household information updated successfully/i)).toBeInTheDocument();
    });
  });
});
