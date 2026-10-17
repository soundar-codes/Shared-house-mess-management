import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Billing from './Billing';
import * as AuthContextModule from '../contexts/AuthContext';

describe('Billing Page Component', () => {
  const mockAdminUser = {
    id: 'user_soundar',
    name: 'Soundar M',
    role: 'ADMIN'
  };

  const mockBills = [
    {
      id: 1,
      userId: 'user_sanjay',
      userName: 'Sanjay K',
      billingMonth: '2026-09',
      totalAmountPaise: 300000,
      paidAmountPaise: 150000,
      balancePaise: 150000,
      status: 'OPEN',
      paymentStatus: 'PARTIAL'
    },
    {
      id: 2,
      userId: 'user_soundar',
      userName: 'Soundar M',
      billingMonth: '2026-09',
      totalAmountPaise: 280000,
      paidAmountPaise: 280000,
      balancePaise: 0,
      status: 'FINALIZED',
      paymentStatus: 'PAID'
    }
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: mockAdminUser,
      checkAuth: vi.fn()
    });
  });

  it('renders loading state initially', () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
    render(<Billing />);
    expect(screen.getByText(/Loading monthly bills/i)).toBeInTheDocument();
  });

  it('renders summary cards, member bills, and admin controls', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/members/cycles')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ members: [] })
        });
      }
      if (url.includes('/api/v1/billing')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ bills: mockBills })
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('Sanjay K')).toBeInTheDocument();
      expect(screen.getByText('Soundar M')).toBeInTheDocument();
    });

    // Check summary calculation: Total = ₹5800.00, Paid = ₹4300.00, Balance = ₹1500.00
    expect(screen.getByText('₹5800.00')).toBeInTheDocument();
    expect(screen.getByText('₹4300.00')).toBeInTheDocument();
    expect(screen.getAllByText('₹1500.00').length).toBeGreaterThan(0);

    // Check status badges
    expect(screen.getByText('PARTIAL')).toBeInTheDocument();
    expect(screen.getByText('PAID')).toBeInTheDocument();

    // Check admin generate button
    expect(screen.getByText(/Generate Bills/i)).toBeInTheDocument();
  });

  it('allows opening payment modal and recording a payment', async () => {
    let paymentSent = null;
    vi.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (url.includes('/pay') && opts?.method === 'POST') {
        paymentSent = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ payment: { id: 10, amountPaise: 150000 } })
        });
      }
      if (url.includes('/members/cycles')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ members: [] })
        });
      }
      if (url.includes('/api/v1/billing')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ bills: mockBills })
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('Sanjay K')).toBeInTheDocument();
    });

    // Click pay button for Sanjay K
    const payBtn = screen.getByText('💳 Pay');
    fireEvent.click(payBtn);

    // Modal opens
    expect(screen.getByText('Record Payment')).toBeInTheDocument();

    // Submit payment
    const confirmBtn = screen.getByText('Confirm Payment');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(paymentSent).not.toBeNull();
      expect(paymentSent.amountPaise).toBe(150000); // 1500.00 * 100
      expect(paymentSent.idempotencyKey).toBeDefined();
    });
  });

  it('allows admin to finalize an open bill', async () => {
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    let finalizedBillId = null;
    vi.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (url.includes('/finalize') && opts?.method === 'POST') {
        finalizedBillId = url.split('/')[4];
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ bill: { id: 1, status: 'FINALIZED' } })
        });
      }
      if (url.includes('/members/cycles')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ members: [] })
        });
      }
      if (url.includes('/api/v1/billing')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ bills: mockBills })
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('🔒 Finalize')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('🔒 Finalize'));

    await waitFor(() => {
      expect(finalizedBillId).toBe('1');
    });
  });

  it('displays member mess service cycles and allows admin to edit start date', async () => {
    const mockMembers = [
      {
        userId: 'user_sanjay',
        userName: 'Sanjay K',
        role: 'MEMBER',
        messStartDate: '2026-10-10',
        currentCycle: {
          periodStart: '2026-10-10',
          periodEnd: '2026-11-10',
          nextBillingDate: '2026-11-10',
          cycleIndex: 0
        }
      }
    ];

    let patchPayload = null;

    vi.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (url.includes('/members/cycles')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ members: mockMembers })
        });
      }
      if (url.includes('/mess-start-date') && opts?.method === 'PATCH') {
        patchPayload = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ membership: { user_id: 'user_sanjay', mess_start_date: patchPayload.messStartDate } })
        });
      }
      if (url.includes('/api/v1/billing')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ bills: mockBills })
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });

    render(<Billing />);

    // Check member cycles table renders
    await waitFor(() => {
      expect(screen.getByText(/Member Mess Service Cycles/i)).toBeInTheDocument();
      expect(screen.getByText(/2026-10-10 → 2026-11-10/)).toBeInTheDocument();
    });

    // Click edit start date button
    const editBtn = screen.getByText('✏️ Edit Start Date');
    fireEvent.click(editBtn);

    expect(screen.getByText('Configure Mess Start Date')).toBeInTheDocument();

    // Change date and submit
    const dateInput = screen.getByLabelText(/Service Start Date:/i);
    fireEvent.change(dateInput, { target: { value: '2026-10-15' } });

    const saveBtn = screen.getByText('Save Start Date');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(patchPayload).toEqual({ messStartDate: '2026-10-15' });
    });
  });

  it('does not display Pay button for regular members', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'user_sanjay', name: 'Sanjay K', role: 'MEMBER' },
      checkAuth: vi.fn()
    });

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/api/v1/billing')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ bills: mockBills })
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getByText('Sanjay K')).toBeInTheDocument();
    });

    // Pay button should NOT be present for member
    expect(screen.queryByText('💳 Pay')).toBeNull();
  });

  it('allows admin to revoke a payment from the payment history modal', async () => {
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    let revokeUrl = null;

    vi.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (url.includes('/payments/101/revoke') && opts?.method === 'POST') {
        revokeUrl = url;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ payment: { id: 101, status: 'REVOKED' } })
        });
      }
      if (url.includes('/payments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            payments: [
              { id: 101, billId: 1, amountPaise: 50000, idempotencyKey: 'key_101', status: 'VALID', createdAt: '2026-10-16' }
            ]
          })
        });
      }
      if (url.includes('/members/cycles')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ members: [] })
        });
      }
      if (url.includes('/api/v1/billing')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ bills: mockBills })
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getAllByText('📜 History').length).toBeGreaterThan(0);
    });

    // Open history modal for first bill
    fireEvent.click(screen.getAllByText('📜 History')[0]);

    await waitFor(() => {
      expect(screen.getByText('Payment History')).toBeInTheDocument();
      expect(screen.getByText('Revoke')).toBeInTheDocument();
    });

    // Click revoke button
    fireEvent.click(screen.getByText('Revoke'));

    await waitFor(() => {
      expect(revokeUrl).toContain('/api/v1/billing/payments/101/revoke');
      expect(screen.getByText('Payment revoked successfully')).toBeInTheDocument();
    });
  });

  it('allows admin to edit paid amount and mark bill as unpaid', async () => {
    let patchUrl = '';
    let patchBody = null;

    vi.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      if (url.includes('/paid-amount') && opts?.method === 'PATCH') {
        patchUrl = url;
        patchBody = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ bill: { id: 1, paidAmountPaise: patchBody.paidAmountPaise } })
        });
      }
      if (url.includes('/members/cycles')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ members: [] })
        });
      }
      if (url.includes('/api/v1/billing')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ bills: mockBills })
        });
      }
      return Promise.reject(new Error('Unknown url: ' + url));
    });

    render(<Billing />);

    await waitFor(() => {
      expect(screen.getAllByText('✏️ Paid Amt').length).toBeGreaterThan(0);
      expect(screen.getAllByText('❌ Not Paid').length).toBeGreaterThan(0);
    });

    // Click Edit Paid Amt on first bill
    fireEvent.click(screen.getAllByText('✏️ Paid Amt')[0]);

    await waitFor(() => {
      expect(screen.getByText(/Edit Paid Amount \(Admin\)/i)).toBeInTheDocument();
    });

    // Click "Set to ₹0.00 (Not Paid)" shortcut
    fireEvent.click(screen.getByText('Set to ₹0.00 (Not Paid)'));
    fireEvent.click(screen.getByText('Save Paid Amount'));

    await waitFor(() => {
      expect(patchUrl).toContain('/api/v1/billing/1/paid-amount');
      expect(patchBody.paidAmountPaise).toBe(0);
      expect(screen.getByText(/Bill marked as unpaid/i)).toBeInTheDocument();
    });
  });
});

