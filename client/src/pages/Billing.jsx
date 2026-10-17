import React, { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Badge from '../components/Badge';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../services/apiClient';
import './Billing.css';

function formatRupees(paise = 0) {
  return `₹${(paise / 100).toFixed(2)}`;
}

function getPaymentBadgeVariant(status) {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'PARTIAL':
      return 'warning';
    case 'PENDING':
      return 'danger';
    default:
      return 'default';
  }
}

export default function Billing() {
  const { user, checkAuth } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const [bills, setBills] = useState([]);
  const [memberCycles, setMemberCycles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Modals state
  const [activeBillForPay, setActiveBillForPay] = useState(null);
  const [payAmountRupees, setPayAmountRupees] = useState('');
  const [payError, setPayError] = useState(null);

  const [activeBillForReopen, setActiveBillForReopen] = useState(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenError, setReopenError] = useState(null);

  const [activeBillForHistory, setActiveBillForHistory] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [revokeActionLoading, setRevokeActionLoading] = useState(false);
  const [revokeError, setRevokeError] = useState(null);

  const [activeBillForBreakdown, setActiveBillForBreakdown] = useState(null);

  // Admin edit start date modal state
  const [editingMember, setEditingMember] = useState(null);
  const [inputStartDate, setInputStartDate] = useState('');
  const [editDateError, setEditDateError] = useState(null);
  const [editDateLoading, setEditDateLoading] = useState(false);

  // Admin edit paid amount modal state
  const [activeBillForEditPaid, setActiveBillForEditPaid] = useState(null);
  const [editPaidRupees, setEditPaidRupees] = useState('');
  const [editPaidReason, setEditPaidReason] = useState('');
  const [editPaidError, setEditPaidError] = useState(null);

  // Automation Status state
  const [automationStatus, setAutomationStatus] = useState(null);

  const fetchBillsAndCycles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchList = [
        apiFetch(`/api/v1/billing?month=${selectedMonth}`),
        apiFetch('/api/v1/billing/members/cycles')
      ];

      if (user?.role === 'ADMIN') {
        fetchList.push(apiFetch('/api/v1/billing/automation-status'));
      }

      const results = await Promise.all(fetchList);
      const billsRes = results[0];
      const cyclesRes = results[1];
      const autoRes = results[2];

      if (billsRes.status === 401 || cyclesRes.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!billsRes.ok) {
        throw new Error('Failed to load billing records');
      }

      const billsData = await billsRes.json();
      setBills(billsData.bills || []);

      if (cyclesRes.ok) {
        const cyclesData = await cyclesRes.json();
        setMemberCycles(cyclesData.members || []);
      }

      if (autoRes && autoRes.ok) {
        const autoData = await autoRes.json();
        setAutomationStatus(autoData.automationStatus);
      }
    } catch (err) {
      setError(err.message || 'Error connecting to server');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth, checkAuth, user]);

  useEffect(() => {
    if (user) {
      fetchBillsAndCycles();
    }
  }, [user, fetchBillsAndCycles]);

  const handleGenerateBills = async () => {
    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await apiFetch('/api/v1/billing/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingMonth: selectedMonth })
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Bill generation failed');
      }

      setSuccessMessage(`Bills generated successfully for cycle ${selectedMonth}!`);
      fetchBillsAndCycles();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!activeBillForPay) return;

    setPayError(null);
    const amountFloat = parseFloat(payAmountRupees);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setPayError('Please enter a valid positive payment amount');
      return;
    }

    const amountPaise = Math.round(amountFloat * 100);
    const idempotencyKey = `pay_${activeBillForPay.id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/v1/billing/${activeBillForPay.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountPaise, idempotencyKey })
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Payment processing failed');
      }

      setActiveBillForPay(null);
      setPayAmountRupees('');
      setSuccessMessage('Payment recorded successfully!');
      fetchBillsAndCycles();
    } catch (err) {
      setPayError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdatePaidAmount = async (e) => {
    e.preventDefault();
    if (!activeBillForEditPaid) return;

    setEditPaidError(null);
    const amountFloat = parseFloat(editPaidRupees);
    if (isNaN(amountFloat) || amountFloat < 0) {
      setEditPaidError('Please enter a valid non-negative amount');
      return;
    }

    const paidAmountPaise = Math.round(amountFloat * 100);

    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/v1/billing/${activeBillForEditPaid.id}/paid-amount`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          paidAmountPaise, 
          reason: editPaidReason.trim() || undefined 
        })
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to update paid amount');
      }

      setActiveBillForEditPaid(null);
      setEditPaidRupees('');
      setEditPaidReason('');
      setSuccessMessage(paidAmountPaise === 0 ? 'Bill marked as unpaid (₹0.00)' : `Paid amount updated to ₹${amountFloat.toFixed(2)}`);
      fetchBillsAndCycles();
    } catch (err) {
      setEditPaidError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkBillUnpaid = async (bill) => {
    if (!window.confirm(`Are you sure you want to mark ${bill.userName}'s bill as NOT PAID (reset to ₹0.00)?`)) {
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/billing/${bill.id}/paid-amount`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          paidAmountPaise: 0, 
          reason: 'Admin marked bill as unpaid' 
        })
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to mark bill as unpaid');
      }

      setSuccessMessage(`Marked ${bill.userName}'s bill as unpaid!`);
      fetchBillsAndCycles();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleFinalizeBill = async (billId) => {
    if (!window.confirm('Finalizing a bill locks it against automatic recalculations. Proceed?')) {
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/billing/${billId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to finalize bill');
      }

      setSuccessMessage('Bill finalized successfully');
      fetchBillsAndCycles();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReopenBill = async (e) => {
    e.preventDefault();
    if (!activeBillForReopen) return;

    if (!reopenReason.trim()) {
      setReopenError('A non-empty reason is required to reopen a finalized bill');
      return;
    }

    setActionLoading(true);
    setReopenError(null);
    try {
      const res = await apiFetch(`/api/v1/billing/${activeBillForReopen.id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reopenReason.trim() })
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to reopen bill');
      }

      setActiveBillForReopen(null);
      setReopenReason('');
      setSuccessMessage('Bill reopened for modifications');
      fetchBillsAndCycles();
    } catch (err) {
      setReopenError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleViewHistory = async (bill) => {
    setActiveBillForHistory(bill);
    setRevokeError(null);
    setHistoryLoading(true);
    try {
      const res = await apiFetch(`/api/v1/billing/${bill.id}/payments`);
      if (res.ok) {
        const data = await res.json();
        setPaymentHistory(data.payments || []);
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleRevokePayment = async (paymentId, amountPaise) => {
    if (!window.confirm(`Are you sure you want to revoke this payment of ${formatRupees(amountPaise)}? This will subtract it from the paid balance.`)) {
      return;
    }

    setRevokeActionLoading(true);
    setRevokeError(null);
    try {
      const res = await apiFetch(`/api/v1/billing/payments/${paymentId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Admin revoked payment' })
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to revoke payment');
      }

      setSuccessMessage('Payment revoked successfully');
      
      // Refresh current bill's payment history
      if (activeBillForHistory) {
        const historyRes = await apiFetch(`/api/v1/billing/${activeBillForHistory.id}/payments`);
        if (historyRes.ok) {
          const histData = await historyRes.json();
          setPaymentHistory(histData.payments || []);
        }
      }

      // Refresh billing overview list
      fetchBillsAndCycles();
    } catch (err) {
      setRevokeError(err.message);
    } finally {
      setRevokeActionLoading(false);
    }
  };

  const handleSaveStartDate = async (e) => {
    e.preventDefault();
    if (!editingMember) return;
    setEditDateError(null);

    if (!inputStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(inputStartDate)) {
      setEditDateError('Please choose a valid start date (YYYY-MM-DD)');
      return;
    }

    setEditDateLoading(true);
    try {
      const res = await apiFetch(`/api/v1/billing/members/${editingMember.userId}/mess-start-date`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messStartDate: inputStartDate })
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to update start date');
      }

      setSuccessMessage(`Mess start date for ${editingMember.userName} updated to ${inputStartDate}`);
      setEditingMember(null);
      setInputStartDate('');
      fetchBillsAndCycles();
    } catch (err) {
      setEditDateError(err.message);
    } finally {
      setEditDateLoading(false);
    }
  };

  // Calculations for summary cards
  const totalBilledPaise = bills.reduce((acc, b) => acc + (b.totalAmountPaise || 0), 0);
  const totalPaidPaise = bills.reduce((acc, b) => acc + (b.paidAmountPaise || 0), 0);
  const totalBalancePaise = bills.reduce((acc, b) => acc + (b.balancePaise || 0), 0);

  return (
    <div className="billing-container">
      <PageHeader 
        title="Billing & Expenses" 
        description="Track monthly shared mess expenses, configure custom billing cycles, record payments, and manage bill finalization." 
      />

      {error && (
        <div className="chores-error-banner" data-testid="billing-error">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={fetchBillsAndCycles}>Retry</Button>
        </div>
      )}

      {successMessage && (
        <div style={{ backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.9rem' }}>
          {successMessage}
        </div>
      )}

      {/* Member Mess Start Dates & Cycle Status (Admin Dashboard) */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 className="chores-section-title" style={{ margin: 0 }}>
              📅 Member Mess Service Cycles & Automatic Billing
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)', margin: '0.25rem 0 0 0' }}>
              Individual monthly billing cycles calculated from each member’s actual service start date.
            </p>
          </div>
          {isAdmin && automationStatus && (
            <div style={{ fontSize: '0.85rem', padding: '0.4rem 0.75rem', borderRadius: '6px', backgroundColor: automationStatus.status === 'SUCCESS' ? '#ecfdf5' : '#fef2f2', border: `1px solid ${automationStatus.status === 'SUCCESS' ? '#a7f3d0' : '#fecaca'}`, color: automationStatus.status === 'SUCCESS' ? '#065f46' : '#991b1b' }}>
              <span>🤖 Automatic Billing: <strong>{automationStatus.status}</strong></span>
              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', opacity: 0.85 }}>
                (Last run: {new Date(automationStatus.executed_at).toLocaleTimeString()})
              </span>
            </div>
          )}
        </div>

        {isAdmin && automationStatus?.error_message && (
          <div style={{ padding: '0.75rem', marginBottom: '1rem', backgroundColor: '#fef2f2', border: '1px solid #f87171', borderRadius: '6px', color: '#b91c1c', fontSize: '0.85rem' }}>
            ⚠️ <strong>Scheduler Warning:</strong> {automationStatus.error_message}
          </div>
        )}

        <div className="bills-table-wrapper">
          <table className="bills-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Mess Start Date</th>
                <th>Current Billing Period</th>
                <th>Live Food Balance</th>
                <th>Next Billing Date</th>
                <th>Bill Status</th>
                {isAdmin && <th>Configure</th>}
              </tr>
            </thead>
            <tbody>
              {memberCycles.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} style={{ textAlign: 'center', color: '#6b7280' }}>
                    Loading member cycles...
                  </td>
                </tr>
              ) : (
                memberCycles.map(m => (
                  <tr key={m.userId}>
                    <td><strong>{m.userName}</strong></td>
                    <td>
                      <Badge variant={m.role === 'ADMIN' ? 'primary' : 'default'}>
                        {m.role}
                      </Badge>
                    </td>
                    <td>
                      {m.messStartDate ? (
                        <span style={{ fontWeight: 600 }}>{m.messStartDate}</span>
                      ) : (
                        <span style={{ color: 'var(--color-warning-text)', backgroundColor: 'var(--color-warning-bg)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          ⚠️ Not Configured (Action Required)
                        </span>
                      )}
                    </td>
                    <td>
                      {m.currentCycle ? (
                        <span>{m.currentCycle.periodStart} → {m.currentCycle.periodEnd}</span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>{selectedMonth}-01 → Month End</span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: (m.currentCycle?.remainingBalancePaise || 0) > 0 ? '#dc2626' : '#059669' }}>
                        {formatRupees(m.currentCycle?.remainingBalancePaise ?? m.currentCycle?.accumulatedFoodPaise ?? 0)}
                      </span>
                      {m.currentCycle?.paidAmountPaise > 0 && (
                        <span style={{ display: 'block', fontSize: '0.75rem', color: '#059669' }}>
                          (Paid: {formatRupees(m.currentCycle.paidAmountPaise)})
                        </span>
                      )}
                    </td>
                    <td>
                      {m.currentCycle ? (
                        <span style={{ fontWeight: 600, color: '#4f46e5' }}>{m.currentCycle.nextBillingDate}</span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>Next 1st</span>
                      )}
                    </td>
                    <td>
                      {m.isBillGenerated ? (
                        <Badge variant={m.billStatus === 'FINALIZED' ? 'success' : 'primary'}>
                          ✓ {m.billStatus || 'Generated'}
                        </Badge>
                      ) : (
                        <Badge variant="warning">Pending Cycle</Badge>
                      )}
                    </td>
                    {isAdmin && (
                      <td>
                        <Button 
                          variant="secondary" 
                          size="sm"
                          onClick={() => {
                            setEditingMember(m);
                            setInputStartDate(m.messStartDate || '');
                            setEditDateError(null);
                          }}
                        >
                          ✏️ Edit Start Date
                        </Button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Controls & Filter */}
      <div className="billing-controls">
        <div className="month-picker-group">
          <label htmlFor="billing-month-input" className="form-label" style={{ marginBottom: 0 }}>
            Cycle Month:
          </label>
          <input
            id="billing-month-input"
            type="month"
            className="month-input"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          />
        </div>

        {isAdmin && (
          <Button 
            variant="primary" 
            size="sm" 
            onClick={handleGenerateBills}
            disabled={actionLoading}
          >
            ⚡ Generate Bills for {selectedMonth}
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="summary-cards-grid">
        <Card>
          <div className="summary-card-inner">
            <span className="summary-card-title">{isAdmin ? 'Total Household Dues' : 'My Total Dues'}</span>
            <span className="summary-card-amount">{formatRupees(totalBilledPaise)}</span>
          </div>
        </Card>
        <Card>
          <div className="summary-card-inner">
            <span className="summary-card-title">Paid Amount</span>
            <span className="summary-card-amount" style={{ color: '#059669' }}>
              {formatRupees(totalPaidPaise)}
            </span>
          </div>
        </Card>
        <Card>
          <div className="summary-card-inner">
            <span className="summary-card-title">Pending Balance</span>
            <span className="summary-card-amount" style={{ color: totalBalancePaise > 0 ? '#dc2626' : '#4b5563' }}>
              {formatRupees(totalBalancePaise)}
            </span>
          </div>
        </Card>
      </div>

      {/* Bills Table */}
      <Card>
        <h3 className="chores-section-title">📄 Member Bills for {selectedMonth}</h3>

        {isLoading ? (
          <p className="empty-state-text">Loading monthly bills...</p>
        ) : bills.length === 0 ? (
          <p className="empty-state-text">
            No bills found for {selectedMonth}. {isAdmin ? 'Click "Generate Bills" above to calculate monthly dues.' : ''}
          </p>
        ) : (
          <div className="bills-table-wrapper">
            <table className="bills-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Billing Period</th>
                  <th>Total Due</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Payment Status</th>
                  <th>Bill State</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bills.map(bill => {
                  const canPay = isAdmin && bill.balancePaise > 0;
                  return (
                    <tr key={bill.id}>
                      <td><strong>{bill.userName}</strong></td>
                      <td>
                        <span style={{ fontSize: '0.85rem' }}>
                          {bill.periodStart && bill.periodEnd ? (
                            `${bill.periodStart} to ${bill.periodEnd}`
                          ) : (
                            `${bill.billingMonth}-01 to End`
                          )}
                        </span>
                      </td>
                      <td>{formatRupees(bill.totalAmountPaise)}</td>
                      <td style={{ color: '#059669' }}>{formatRupees(bill.paidAmountPaise)}</td>
                      <td style={{ fontWeight: 600, color: bill.balancePaise > 0 ? '#dc2626' : '#4b5563' }}>
                        {formatRupees(bill.balancePaise)}
                      </td>
                      <td>
                        <Badge variant={getPaymentBadgeVariant(bill.paymentStatus)}>
                          {bill.paymentStatus}
                        </Badge>
                      </td>
                      <td>
                        <Badge variant={bill.status === 'FINALIZED' ? 'success' : 'default'}>
                          {bill.status}
                        </Badge>
                      </td>
                      <td>
                        <div className="bill-actions">
                          {canPay && (
                            <Button 
                              variant="primary" 
                              size="sm"
                              onClick={() => {
                                setActiveBillForPay(bill);
                                setPayAmountRupees((bill.balancePaise / 100).toFixed(2));
                              }}
                            >
                              💳 Pay
                            </Button>
                          )}

                          {isAdmin && (
                            <>
                              <Button 
                                variant="secondary" 
                                size="sm"
                                onClick={() => {
                                  setActiveBillForEditPaid(bill);
                                  setEditPaidRupees((bill.paidAmountPaise / 100).toFixed(2));
                                  setEditPaidReason('');
                                  setEditPaidError(null);
                                }}
                              >
                                ✏️ Paid Amt
                              </Button>
                              {bill.paidAmountPaise > 0 && (
                                <Button 
                                  variant="danger" 
                                  size="sm"
                                  onClick={() => handleMarkBillUnpaid(bill)}
                                  disabled={actionLoading}
                                >
                                  ❌ Not Paid
                                </Button>
                              )}
                            </>
                          )}

                          <Button 
                            variant="secondary" 
                            size="sm"
                            onClick={() => setActiveBillForBreakdown(bill)}
                          >
                            🔍 Breakdown
                          </Button>

                          <Button 
                            variant="secondary" 
                            size="sm"
                            onClick={() => handleViewHistory(bill)}
                          >
                            📜 History
                          </Button>

                          {isAdmin && bill.status !== 'FINALIZED' && (
                            <Button 
                              variant="secondary" 
                              size="sm"
                              onClick={() => handleFinalizeBill(bill.id)}
                              disabled={actionLoading}
                            >
                              🔒 Finalize
                            </Button>
                          )}

                          {isAdmin && bill.status === 'FINALIZED' && (
                            <Button 
                              variant="secondary" 
                              size="sm"
                              onClick={() => {
                                setActiveBillForReopen(bill);
                                setReopenReason('');
                              }}
                              disabled={actionLoading}
                            >
                              🔓 Reopen
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Edit Start Date Modal */}
      {editingMember && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Configure Mess Start Date</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)' }}>
              Set actual mess service start date for <strong>{editingMember.userName}</strong>. Subsequent monthly billing periods will begin and cycle from this date.
            </p>

            <form onSubmit={handleSaveStartDate}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="mess-start-date-input" className="form-label">Service Start Date:</label>
                  <input
                    id="mess-start-date-input"
                    type="date"
                    className="form-input"
                    value={inputStartDate}
                    onChange={(e) => setInputStartDate(e.target.value)}
                    required
                  />
                </div>

                {editDateError && (
                  <p style={{ color: 'var(--danger, #ef4444)', fontSize: '0.85rem' }}>{editDateError}</p>
                )}
              </div>

              <div className="modal-footer">
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => setEditingMember(null)}
                  disabled={editDateLoading}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="primary" 
                  disabled={editDateLoading}
                >
                  {editDateLoading ? 'Saving...' : 'Save Start Date'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {activeBillForPay && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Record Payment</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)' }}>
              Bill for <strong>{activeBillForPay.userName}</strong> ({activeBillForPay.periodStart} to {activeBillForPay.periodEnd}). Outstanding balance: {formatRupees(activeBillForPay.balancePaise)}.
            </p>

            <form onSubmit={handleRecordPayment}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="payment-amount-input" className="form-label">Payment Amount (₹):</label>
                  <input
                    id="payment-amount-input"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={(activeBillForPay.balancePaise / 100).toFixed(2)}
                    className="form-input"
                    value={payAmountRupees}
                    onChange={(e) => setPayAmountRupees(e.target.value)}
                    required
                  />
                </div>

                {payError && (
                  <p style={{ color: 'var(--danger, #ef4444)', fontSize: '0.85rem' }}>{payError}</p>
                )}
              </div>

              <div className="modal-footer">
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => setActiveBillForPay(null)}
                  disabled={actionLoading}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="primary" 
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Processing...' : 'Confirm Payment'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Edit Paid Amount Modal */}
      {activeBillForEditPaid && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">✏️ Edit Paid Amount (Admin)</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)' }}>
              Update paid amount for <strong>{activeBillForEditPaid.userName}</strong>. Total bill: {formatRupees(activeBillForEditPaid.totalAmountPaise)}. Enter <strong>0</strong> to mark as Not Paid.
            </p>

            <form onSubmit={handleUpdatePaidAmount}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="edit-paid-amount-input" className="form-label">Paid Amount (₹):</label>
                  <input
                    id="edit-paid-amount-input"
                    type="number"
                    step="0.01"
                    min="0"
                    max={(activeBillForEditPaid.totalAmountPaise / 100).toFixed(2)}
                    className="form-input"
                    value={editPaidRupees}
                    onChange={(e) => setEditPaidRupees(e.target.value)}
                    required
                  />
                  <div style={{ marginTop: '0.25rem', display: 'flex', gap: '0.5rem' }}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditPaidRupees('0.00')}
                    >
                      Set to ₹0.00 (Not Paid)
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditPaidRupees((activeBillForEditPaid.totalAmountPaise / 100).toFixed(2))}
                    >
                      Set Full (₹{(activeBillForEditPaid.totalAmountPaise / 100).toFixed(2)})
                    </Button>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="edit-paid-reason-input" className="form-label">Reason / Note (optional):</label>
                  <input
                    id="edit-paid-reason-input"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Cash payment received or correction"
                    value={editPaidReason}
                    onChange={(e) => setEditPaidReason(e.target.value)}
                  />
                </div>

                {editPaidError && (
                  <p style={{ color: 'var(--danger, #ef4444)', fontSize: '0.85rem' }}>{editPaidError}</p>
                )}
              </div>

              <div className="modal-footer">
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => setActiveBillForEditPaid(null)}
                  disabled={actionLoading}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="primary" 
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Saving...' : 'Save Paid Amount'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reopen Modal */}
      {activeBillForReopen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Reopen Finalized Bill</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)' }}>
              Reopening allows recalculation and modifications. Please provide an audit reason.
            </p>

            <form onSubmit={handleReopenBill}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="reopen-reason-input" className="form-label">Reason for Reopening:</label>
                  <textarea
                    id="reopen-reason-input"
                    className="form-input"
                    rows="3"
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    placeholder="e.g. Rate adjustment or guest meal correction"
                    required
                  />
                </div>

                {reopenError && (
                  <p style={{ color: 'var(--danger, #ef4444)', fontSize: '0.85rem' }}>{reopenError}</p>
                )}
              </div>

              <div className="modal-footer">
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => setActiveBillForReopen(null)}
                  disabled={actionLoading}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="primary" 
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Reopening...' : 'Reopen Bill'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment History Modal */}
      {activeBillForHistory && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Payment History</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)' }}>
              Past payments recorded for <strong>{activeBillForHistory.userName}</strong> ({activeBillForHistory.periodStart || activeBillForHistory.billingMonth} to {activeBillForHistory.periodEnd || 'End'}).
            </p>

            <div className="modal-body">
              {revokeError && (
                <div style={{ color: 'var(--danger, #dc2626)', backgroundColor: '#fee2e2', padding: '0.5rem 0.75rem', borderRadius: '4px', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
                  {revokeError}
                </div>
              )}

              {historyLoading ? (
                <p className="empty-state-text">Loading history...</p>
              ) : paymentHistory.length === 0 ? (
                <p className="empty-state-text">No payments recorded yet for this bill.</p>
              ) : (
                <div className="payment-history-list">
                  {paymentHistory.map(p => {
                    const isRevoked = p.status === 'REVOKED';
                    return (
                      <div key={p.id} className="payment-history-item" style={{ alignItems: 'center', opacity: isRevoked ? 0.6 : 1 }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <strong style={{ textDecoration: isRevoked ? 'line-through' : 'none' }}>
                              {formatRupees(p.amountPaise)}
                            </strong>
                            <Badge variant={isRevoked ? 'danger' : 'success'}>
                              {p.status || 'VALID'}
                            </Badge>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #6b7280)', marginTop: '2px' }}>
                            Key: {p.idempotencyKey.substring(0, 18)}... &bull; {new Date(p.createdAt).toLocaleDateString()}
                          </div>
                        </div>

                        {isAdmin && !isRevoked && (
                          <Button
                            variant="secondary"
                            size="sm"
                            style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                            disabled={revokeActionLoading}
                            onClick={() => handleRevokePayment(p.id, p.amountPaise)}
                          >
                            Revoke
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <Button 
                type="button" 
                variant="secondary" 
                onClick={() => setActiveBillForHistory(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Itemized Daily Breakdown Modal */}
      {activeBillForBreakdown && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px', maxHeight: '80vh', overflowY: 'auto' }}>
            <h3 className="modal-title">Itemized Breakdown: {activeBillForBreakdown.userName}</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)', marginBottom: '1rem' }}>
              Cycle Period: <strong>{activeBillForBreakdown.periodStart} &rarr; {activeBillForBreakdown.periodEnd}</strong> | Total: {formatRupees(activeBillForBreakdown.totalAmountPaise)}
            </p>

            <div className="breakdown-table-wrapper" style={{ maxHeight: '350px', overflowY: 'auto' }}>
              {(() => {
                const snapshot = typeof activeBillForBreakdown.snapshotData === 'string'
                  ? JSON.parse(activeBillForBreakdown.snapshotData || '{}')
                  : (activeBillForBreakdown.snapshotData || {});
                const breakdown = snapshot.dailyBreakdown || [];

                if (breakdown.length === 0) {
                  return <p className="empty-state-text">No daily breakdown details recorded in snapshot.</p>;
                }

                return (
                  <table className="bills-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Reason / Notes</th>
                        <th>Charge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdown.map(item => (
                        <tr key={item.date}>
                          <td><strong>{item.date}</strong></td>
                          <td>
                            <Badge variant={
                              item.status === 'MESS_UNAVAILABLE' ? 'warning' :
                              item.status === 'CANCELLED' ? 'danger' : 'success'
                            }>
                              {item.status}
                            </Badge>
                          </td>
                          <td style={{ color: 'var(--text-muted, #6b7280)' }}>
                            {item.reason || item.source || '-'}
                          </td>
                          <td style={{ fontWeight: 600 }}>
                            {formatRupees(item.chargedPaise ?? item.chargePaise ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>

            <div className="modal-footer" style={{ marginTop: '1rem' }}>
              <Button 
                type="button" 
                variant="secondary" 
                onClick={() => setActiveBillForBreakdown(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
