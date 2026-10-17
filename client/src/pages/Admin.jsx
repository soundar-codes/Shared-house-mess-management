import React, { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Badge from '../components/Badge';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../services/apiClient';
import './Admin.css';

const TABS = [
  { id: 'overview', label: '1. Overview', icon: '📊' },
  { id: 'members', label: '2. Members', icon: '👥' },
  { id: 'attendance', label: '3. Food Attendance', icon: '🍽️' },
  { id: 'leave', label: '4. Leave Management', icon: '✈️' },
  { id: 'billing', label: '5. Billing & Payments', icon: '💰' },
  { id: 'vessel', label: '6. Vessel Cleaning & Chores', icon: '🧹' },
  { id: 'settings', label: '7. Household Settings', icon: '⚙️' },
  { id: 'audit', label: '8. Audit Logs', icon: '📜' },
  { id: 'auto-billing', label: '9. Automatic Billing Status', icon: '🤖' }
];

export default function Admin() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  // Data states
  const [overview, setOverview] = useState(null);
  const [members, setMembers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [bills, setBills] = useState([]);
  const [vesselSchedule, setVesselSchedule] = useState([]);
  const [choreAssignments, setChoreAssignments] = useState([]);

  // Attendance state
  const [attendanceRange, setAttendanceRange] = useState({
    startDate: '2026-10-12',
    endDate: '2026-10-25'
  });
  const [attendanceData, setAttendanceData] = useState({ members: [], records: [], leaves: [], messUnavailability: [] });

  // Leave Form state
  const [leaveForm, setLeaveForm] = useState({
    userId: 'ALL',
    startDate: '2026-10-15',
    endDate: '2026-10-21',
    reason: 'Household Long Leave'
  });
  const [leavesList, setLeavesList] = useState([]);

  // Attendance Editing Modal for Admin
  const [editingAttendance, setEditingAttendance] = useState(null);
  const [newAttendanceStatus, setNewAttendanceStatus] = useState('FOOD_REQUIRED');
  const [attendanceEditLoading, setAttendanceEditLoading] = useState(false);

  // Member Management Modals
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [newMemberForm, setNewMemberForm] = useState({ userId: '', name: '', password: '', role: 'MEMBER', messStartDate: '' });

  // Settings Form state
  const [settingsForm, setSettingsForm] = useState({
    defaultRateRupees: 130,
    cancellationCutoffTime: '23:00',
    timezone: 'Asia/Kolkata'
  });

  const fetchOverview = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/admin/overview');
      if (res.ok) {
        const data = await res.json();
        setOverview(data.overview);
        setSettingsForm({
          defaultRateRupees: (data.overview.dailyRatePaise || 13000) / 100,
          cancellationCutoffTime: data.overview.householdSettings?.cancellation_cutoff_time || '23:00',
          timezone: data.overview.householdSettings?.timezone || 'Asia/Kolkata'
        });
      }
    } catch (err) {
      console.error('Error fetching admin overview:', err);
    }
  }, []);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/admin/members');
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      }
    } catch (err) {
      console.error('Error fetching members:', err);
    }
  }, []);

  const fetchAttendance = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/v1/food/attendance?startDate=${attendanceRange.startDate}&endDate=${attendanceRange.endDate}`);
      if (res.ok) {
        const data = await res.json();
        setAttendanceData(data);
        setLeavesList(data.leaves || []);
      }
    } catch (err) {
      console.error('Error fetching attendance:', err);
    }
  }, [attendanceRange]);

  const fetchBills = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/billing');
      if (res.ok) {
        const data = await res.json();
        setBills(data.bills || []);
      }
    } catch (err) {
      console.error('Error fetching bills:', err);
    }
  }, []);

  const fetchChoresAndVessels = useCallback(async () => {
    try {
      const [vsRes, caRes] = await Promise.all([
        apiFetch('/api/v1/chores/vessel-schedule'),
        apiFetch('/api/v1/chores/assignments')
      ]);
      if (vsRes.ok) {
        const vsData = await vsRes.json();
        setVesselSchedule(vsData.schedule || []);
      }
      if (caRes.ok) {
        const caData = await caRes.json();
        setChoreAssignments(caData.assignments || []);
      }
    } catch (err) {
      console.error('Error fetching chores:', err);
    }
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/admin/audit-logs');
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Error fetching audit logs:', err);
    }
  }, []);

  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchOverview(),
        fetchMembers(),
        fetchAttendance(),
        fetchBills(),
        fetchChoresAndVessels(),
        fetchAuditLogs()
      ]);
    } catch (err) {
      setError(err.message || 'Failed to load admin portal data');
    } finally {
      setIsLoading(false);
    }
  }, [fetchOverview, fetchMembers, fetchAttendance, fetchBills, fetchChoresAndVessels, fetchAuditLogs]);

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      loadAllData();
    }
  }, [user, loadAllData]);

  // Actions
  const handleUpdateSettings = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    try {
      const defaultRatePaise = Math.round(parseFloat(settingsForm.defaultRateRupees) * 100);
      const res = await apiFetch('/api/v1/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultRatePaise,
          cancellationCutoffTime: settingsForm.cancellationCutoffTime,
          timezone: settingsForm.timezone
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error?.message || 'Failed to update settings');
      }
      setMessage(`Settings updated successfully. Daily rate is now ₹${settingsForm.defaultRateRupees}/day.`);
      setRatePreview(null);
      fetchOverview();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateMember = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/admin/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMemberForm)
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error?.message || 'Failed to add member');
      }
      setMessage(`Member '${newMemberForm.name}' added successfully.`);
      setShowAddMemberModal(false);
      setNewMemberForm({ userId: '', name: '', password: '', role: 'MEMBER', messStartDate: '' });
      fetchMembers();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleMemberActive = async (member) => {
    setMessage(null);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/admin/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: !member.isActive,
          reason: `Admin ${member.isActive ? 'deactivated' : 'activated'} member account`
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error?.message || 'Failed to update member');
      }
      setMessage(`Member '${member.name}' account status updated.`);
      fetchMembers();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRoleToggle = async (member) => {
    setMessage(null);
    setError(null);
    const targetRole = member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN';
    try {
      const res = await apiFetch(`/api/v1/admin/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: targetRole,
          reason: `Admin changed role to ${targetRole}`
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error?.message || 'Failed to update role');
      }
      setMessage(`Member '${member.name}' role updated to ${targetRole}.`);
      fetchMembers();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleScheduleLeave = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    try {
      const payload = {
        userIds: leaveForm.userId === 'ALL' ? 'ALL' : [leaveForm.userId],
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        reason: leaveForm.reason
      };
      const res = await apiFetch('/api/v1/food/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error?.message || 'Failed to schedule leave');
      }
      setMessage('Leave period successfully created. Normal food tracking resumes the day after end date.');
      fetchAttendance();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCancelLeave = async (leaveId) => {
    setMessage(null);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/food/leaves/${leaveId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by admin from Admin Portal' })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error?.message || 'Failed to cancel leave');
      }
      setMessage('Leave period cancelled. Existing cancelled attendance records were preserved.');
      fetchAttendance();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSaveAttendanceEdit = async (e) => {
    e.preventDefault();
    if (!editingAttendance) return;
    setAttendanceEditLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/food/attendance/members/${editingAttendance.member.id}/dates/${editingAttendance.date}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newAttendanceStatus,
          reason: `Admin updated ${editingAttendance.member.name} status to ${newAttendanceStatus}`
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error?.message || 'Failed to update attendance');
      }
      setMessage(`Updated ${editingAttendance.member.name}'s attendance on ${editingAttendance.date} to ${newAttendanceStatus === 'ON_LEAVE' ? 'On Leave' : newAttendanceStatus === 'CANCELLED' ? 'Did Not Eat' : 'Ate'}.`);
      setEditingAttendance(null);
      fetchAttendance();
    } catch (err) {
      setError(err.message);
    } finally {
      setAttendanceEditLoading(false);
    }
  };

  const handleTriggerBilling = async () => {
    setMessage(null);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/admin/billing/run-check', {
        method: 'POST'
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error?.message || 'Failed to run billing check');
      }
      setMessage('Automatic billing check executed successfully.');
      fetchOverview();
      fetchBills();
    } catch (err) {
      setError(err.message);
    }
  };

  if (user?.role !== 'ADMIN') {
    return (
      <div className="admin-portal p-6">
        <PageHeader title="Access Denied" description="Admin role required." />
        <Card><p>You must have the ADMIN role to access the Admin Control Panel.</p></Card>
      </div>
    );
  }

  return (
    <div className="admin-portal p-4">
      <PageHeader
        title="🛠️ Full Admin Control Panel"
        description="Comprehensive management portal for Mess Food, ₹130 Daily Charges, Leaves, Dynamic Billing, Chores, and Household Settings."
      />

      {/* Success/Error Alerts */}
      {message && (
        <div style={{ padding: '0.75rem 1rem', backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9rem' }}>
          ✓ {message}
        </div>
      )}
      {error && (
        <div style={{ padding: '0.75rem 1rem', backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9rem' }}>
          ⚠️ {error}
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="admin-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`admin-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Card><p>Loading admin portal...</p></Card>
      ) : (
        <>
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && overview && (
            <div>
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-label">Total / Active Members</div>
                  <div className="stat-val">{overview.activeMembers} / {overview.totalMembers}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Daily Food Rate</div>
                  <div className="stat-val" style={{ color: '#059669' }}>₹{overview.dailyRateRupees}/day</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Today's Attendance ({overview.todayDate})</div>
                  <div className="stat-val" style={{ fontSize: '1.1rem' }}>
                    🟢 {overview.todayStats.ate} Ate | 🔴 {overview.todayStats.cancelled} Cancelled | ✈️ {overview.todayStats.onLeave} Leave
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total Outstanding Balance</div>
                  <div className="stat-val" style={{ color: overview.billingSummary.outstandingPaise > 0 ? '#b91c1c' : '#059669' }}>
                    ₹{(overview.billingSummary.outstandingPaise / 100).toFixed(2)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
                <Card title="✈️ Active Leave Periods">
                  {overview.activeLeaves.length === 0 ? (
                    <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>No active leave periods currently recorded.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {overview.activeLeaves.map(l => (
                        <div key={l.id} style={{ padding: '0.75rem', backgroundColor: 'var(--color-secondary)', borderRadius: '6px', border: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <strong>{l.user_name}</strong>
                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                              {l.start_date} to {l.end_date} &bull; {l.reason}
                            </div>
                          </div>
                          <Badge variant="warning">ON LEAVE</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="🤖 Automatic Billing System Status">
                  {overview.automationStatus ? (
                    <div>
                      <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                        Last Run: <strong>{new Date(overview.automationStatus.executed_at).toLocaleString()}</strong>
                      </p>
                      <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                        Status: <Badge variant={overview.automationStatus.status === 'SUCCESS' ? 'success' : 'danger'}>{overview.automationStatus.status}</Badge>
                      </p>
                      <p style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                        Generated: {overview.automationStatus.generated_count} | Preserved: {overview.automationStatus.preserved_count}
                      </p>
                      <Button variant="secondary" size="sm" onClick={handleTriggerBilling}>
                        Run Automatic Billing Check Now
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <p style={{ fontSize: '0.9rem', color: '#6b7280' }}>No execution logs yet.</p>
                      <Button variant="secondary" size="sm" onClick={handleTriggerBilling}>Run Check</Button>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* TAB 2: MEMBERS */}
          {activeTab === 'members' && (
            <Card title="👥 Member Account & Billing Cycle Management">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>
                  Manage account status, assign/revoke admin roles, and view individual mess start dates.
                </p>
                <Button variant="primary" size="sm" onClick={() => setShowAddMemberModal(true)}>
                  + Add Member
                </Button>
              </div>

              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Name / ID</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Mess Start Date</th>
                      <th>Total Billed</th>
                      <th>Total Paid</th>
                      <th>Balance</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(m => (
                      <tr key={m.id}>
                        <td>
                          <strong>{m.name}</strong>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{m.id}</div>
                        </td>
                        <td>
                          <Badge variant={m.role === 'ADMIN' ? 'primary' : 'secondary'}>{m.role}</Badge>
                        </td>
                        <td>
                          <Badge variant={m.isActive ? 'success' : 'danger'}>
                            {m.isActive ? 'Active' : 'Deactivated'}
                          </Badge>
                        </td>
                        <td>{m.messStartDate || 'Calendar Month'}</td>
                        <td>₹{(m.financials.totalBilledPaise / 100).toFixed(2)}</td>
                        <td>₹{(m.financials.totalPaidPaise / 100).toFixed(2)}</td>
                        <td style={{ fontWeight: 600, color: m.financials.balancePaise > 0 ? '#b91c1c' : '#059669' }}>
                          ₹{(m.financials.balancePaise / 100).toFixed(2)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <Button variant="secondary" size="sm" onClick={() => handleRoleToggle(m)}>
                              {m.role === 'ADMIN' ? 'Demote to Member' : 'Promote to Admin'}
                            </Button>
                            <Button 
                              variant={m.isActive ? 'danger' : 'primary'} 
                              size="sm" 
                              onClick={() => handleToggleMemberActive(m)}
                            >
                              {m.isActive ? 'Deactivate' : 'Activate'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* TAB 3: FOOD ATTENDANCE */}
          {activeTab === 'attendance' && (
            <Card title="🍽️ Date-Based Food Attendance Matrix">
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', marginRight: '0.5rem' }}>From:</label>
                  <input
                    type="date"
                    className="form-input"
                    style={{ width: 'auto', display: 'inline-block' }}
                    value={attendanceRange.startDate}
                    onChange={(e) => setAttendanceRange(prev => ({ ...prev, startDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', marginRight: '0.5rem' }}>To:</label>
                  <input
                    type="date"
                    className="form-input"
                    style={{ width: 'auto', display: 'inline-block' }}
                    value={attendanceRange.endDate}
                    onChange={(e) => setAttendanceRange(prev => ({ ...prev, endDate: e.target.value }))}
                  />
                </div>
                <Button variant="secondary" size="sm" onClick={fetchAttendance}>Refresh Range</Button>
              </div>

              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      {attendanceData.members.map(m => (
                        <th key={m.id} style={{ textAlign: 'center' }}>{m.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const dates = [];
                      let cur = new Date(`${attendanceRange.startDate}T00:00:00.000Z`);
                      const end = new Date(`${attendanceRange.endDate}T00:00:00.000Z`);
                      while (cur <= end) {
                        dates.push(cur.toISOString().split('T')[0]);
                        cur.setUTCDate(cur.getUTCDate() + 1);
                      }
                      return dates.map(dStr => (
                        <tr key={dStr}>
                          <td><strong>{dStr}</strong></td>
                          {attendanceData.members.map(member => {
                            const rec = attendanceData.records.find(r => r.user_id === member.id && r.date === dStr);
                            const unavail = attendanceData.messUnavailability.find(u => u.declaration_date === dStr);

                            let text = 'Ate (₹130)';
                            let variant = 'success';
                            let internalStatus = 'FOOD_REQUIRED';
                            if (unavail) {
                              text = 'Mess Unavailable (₹0)';
                              variant = 'warning';
                              internalStatus = 'MESS_UNAVAILABLE';
                            } else if (rec?.status === 'CANCELLED') {
                              text = 'Did Not Eat (₹0)';
                              variant = 'danger';
                              internalStatus = 'CANCELLED';
                            } else if (rec?.status === 'ON_LEAVE') {
                              text = 'On Leave (₹0)';
                              variant = 'warning';
                              internalStatus = 'ON_LEAVE';
                            }

                            return (
                              <td key={member.id} style={{ textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingAttendance({
                                      member,
                                      date: dStr,
                                      currentStatus: internalStatus
                                    });
                                    setNewAttendanceStatus(internalStatus === 'MESS_UNAVAILABLE' ? 'FOOD_REQUIRED' : internalStatus);
                                  }}
                                  style={{
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    padding: '0.2rem 0.4rem',
                                    borderRadius: '4px'
                                  }}
                                  title={`Click to edit ${member.name} on ${dStr}`}
                                >
                                  <Badge variant={variant}>{text}</Badge>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* TAB 4: LEAVE MANAGEMENT */}
          {activeTab === 'leave' && (
            <div>
              <Card title="✈️ Schedule Long Leave Period (Dynamic Billing: ₹0 Charge)">
                <form onSubmit={handleScheduleLeave}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                      <label className="form-label">Member:</label>
                      <select
                        className="form-input"
                        value={leaveForm.userId}
                        onChange={(e) => setLeaveForm(prev => ({ ...prev, userId: e.target.value }))}
                      >
                        <option value="ALL">👥 All Household Members (Household Leave)</option>
                        {members.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">From Date (Inclusive):</label>
                      <input
                        type="date"
                        className="form-input"
                        value={leaveForm.startDate}
                        onChange={(e) => setLeaveForm(prev => ({ ...prev, startDate: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <label className="form-label">To Date (Inclusive):</label>
                      <input
                        type="date"
                        className="form-input"
                        value={leaveForm.endDate}
                        onChange={(e) => setLeaveForm(prev => ({ ...prev, endDate: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <label className="form-label">Reason:</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Vacation, Diwali holiday"
                        value={leaveForm.reason}
                        onChange={(e) => setLeaveForm(prev => ({ ...prev, reason: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                  <Button variant="primary" type="submit">Preview & Schedule Leave</Button>
                </form>
              </Card>

              <Card title="Active & Past Leave Periods" style={{ marginTop: '1.5rem' }}>
                {leavesList.length === 0 ? (
                  <p style={{ color: '#6b7280' }}>No leave records found.</p>
                ) : (
                  <div className="table-responsive">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Dates</th>
                          <th>Reason</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leavesList.map(l => (
                          <tr key={l.id}>
                            <td><strong>{l.user_name || l.user_id}</strong></td>
                            <td>{l.start_date} to {l.end_date}</td>
                            <td>{l.reason}</td>
                            <td><Badge variant={l.status === 'ACTIVE' ? 'warning' : 'secondary'}>{l.status}</Badge></td>
                            <td>
                              {l.status === 'ACTIVE' ? (
                                <Button variant="danger" size="sm" onClick={() => handleCancelLeave(l.id)}>
                                  Cancel Leave
                                </Button>
                              ) : (
                                <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>Cancelled</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* TAB 5: BILLING & PAYMENTS */}
          {activeTab === 'billing' && (
            <Card title="💰 Billing and Recorded Payments">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
                  Showing member bills with draft, finalized, paid, and pending statuses.
                </p>
                <Button variant="primary" size="sm" onClick={handleTriggerBilling}>
                  Recalculate Draft Bills
                </Button>
              </div>

              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Bill ID</th>
                      <th>Member</th>
                      <th>Period</th>
                      <th>Status</th>
                      <th>Total Amount</th>
                      <th>Paid Amount</th>
                      <th>Balance</th>
                      <th>Breakdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map(b => (
                      <tr key={b.id}>
                        <td>#{b.id}</td>
                        <td><strong>{b.userName}</strong></td>
                        <td>{b.periodStart} &rarr; {b.periodEnd}</td>
                        <td>
                          <Badge variant={b.status === 'FINALIZED' ? 'primary' : 'warning'}>{b.status}</Badge>
                        </td>
                        <td>₹{(b.totalAmountPaise / 100).toFixed(2)}</td>
                        <td>₹{(b.paidAmountPaise / 100).toFixed(2)}</td>
                        <td style={{ fontWeight: 600, color: b.balancePaise > 0 ? '#b91c1c' : '#059669' }}>
                          ₹{(b.balancePaise / 100).toFixed(2)}
                        </td>
                        <td style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                          {b.snapshotData ? (
                            <span>
                              {b.snapshotData.chargeableDays} charged &bull; {b.snapshotData.cancelledDays} cancelled &bull; {b.snapshotData.leaveDays || 0} leave
                            </span>
                          ) : 'No snapshot'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* TAB 6: VESSEL & CHORES */}
          {activeTab === 'vessel' && (
            <div>
              <Card title="🍳 Weekly Vessel Cleaning Schedule">
                <div className="table-responsive">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Day of Week</th>
                        <th>Time Period</th>
                        <th>Assigned Member</th>
                        <th>Duty Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vesselSchedule.map(s => (
                        <tr key={s.id}>
                          <td><strong>{s.dayOfWeek}</strong></td>
                          <td>{s.timePeriod}</td>
                          <td>{s.assignedUserName}</td>
                          <td>
                            <Badge variant={s.isGroupDuty ? 'warning' : 'primary'}>
                              {s.isGroupDuty ? 'Group Duty' : 'Single Duty'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="🧹 Chore Assignments" style={{ marginTop: '1.5rem' }}>
                <div className="table-responsive">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Chore</th>
                        <th>Assigned To</th>
                        <th>Due Date</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {choreAssignments.map(c => (
                        <tr key={c.id}>
                          <td><strong>{c.choreName}</strong></td>
                          <td>{c.userName}</td>
                          <td>{c.dueDate}</td>
                          <td>
                            <Badge variant={c.status === 'COMPLETED' ? 'success' : 'warning'}>
                              {c.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* TAB 7: HOUSEHOLD SETTINGS */}
          {activeTab === 'settings' && (
            <Card title="⚙️ Household Configuration & Daily Rate">
              <form onSubmit={handleUpdateSettings} style={{ maxWidth: '600px' }}>
                <div className="form-group mb-3">
                  <label className="form-label">Standard Daily Food Charge (₹):</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    className="form-input"
                    value={settingsForm.defaultRateRupees}
                    onChange={(e) => setSettingsForm(prev => ({ ...prev, defaultRateRupees: e.target.value }))}
                    required
                  />
                  <small style={{ color: '#6b7280' }}>
                    Standard daily food rate is currently <strong>₹{settingsForm.defaultRateRupees}/day</strong>. Example: 1 day = ₹{settingsForm.defaultRateRupees}, 5 days = ₹{settingsForm.defaultRateRupees * 5}, 10 days = ₹{settingsForm.defaultRateRupees * 10}.
                  </small>
                </div>

                <div className="form-group mb-3">
                  <label className="form-label">Food Cancellation Cutoff Time:</label>
                  <input
                    type="time"
                    className="form-input"
                    value={settingsForm.cancellationCutoffTime}
                    onChange={(e) => setSettingsForm(prev => ({ ...prev, cancellationCutoffTime: e.target.value }))}
                    required
                  />
                  <small style={{ color: '#6b7280' }}>Members must cancel tomorrow's food before this cutoff.</small>
                </div>

                <div className="form-group mb-4">
                  <label className="form-label">Household Timezone:</label>
                  <input
                    type="text"
                    className="form-input"
                    value={settingsForm.timezone}
                    onChange={(e) => setSettingsForm(prev => ({ ...prev, timezone: e.target.value }))}
                    required
                  />
                  <small style={{ color: '#6b7280' }}>Default is Asia/Kolkata (+05:30).</small>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <Button variant="primary" type="submit">
                    Save Household Settings
                  </Button>
                  <Button 
                    variant="secondary" 
                    type="button"
                    onClick={() => window.location.href = '/house-info'}
                  >
                    🏡 Manage House Address & Emergency Contacts &rarr;
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {/* TAB 8: AUDIT LOGS */}
          {activeTab === 'audit' && (
            <Card title="📜 Administrative Audit Logs">
              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Entity</th>
                      <th>Reason / Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map(a => (
                      <tr key={a.id}>
                        <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {new Date(a.created_at).toLocaleString()}
                        </td>
                        <td><strong>{a.actor_name || a.actor_id || 'System'}</strong></td>
                        <td><Badge variant="primary">{a.action}</Badge></td>
                        <td>{a.entity_type} ({a.entity_id})</td>
                        <td style={{ fontSize: '0.8rem' }}>{a.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* TAB 9: AUTOMATIC BILLING STATUS */}
          {activeTab === 'auto-billing' && (
            <Card title="🤖 Automatic Billing Scheduler Status & Controls">
              <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                Bills are automatically generated as each member's next billing cycle arrives. Finalized bills and recorded payments are strictly preserved.
              </p>
              <div style={{ margin: '1rem 0' }}>
                <Button variant="primary" onClick={handleTriggerBilling}>
                  Run Automatic Billing Check Now
                </Button>
              </div>

              {overview?.automationStatus && (
                <div style={{ backgroundColor: '#f9fafb', padding: '1rem', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0' }}>Latest Execution Report</h4>
                  <p><strong>Time:</strong> {new Date(overview.automationStatus.executed_at).toLocaleString()}</p>
                  <p><strong>Result:</strong> <Badge variant={overview.automationStatus.status === 'SUCCESS' ? 'success' : 'danger'}>{overview.automationStatus.status}</Badge></p>
                  <p><strong>Generated Count:</strong> {overview.automationStatus.generated_count}</p>
                  <p><strong>Preserved Count:</strong> {overview.automationStatus.preserved_count}</p>
                  {overview.automationStatus.details && (
                    <pre style={{ backgroundColor: '#1f2937', color: '#f9fafb', padding: '0.75rem', borderRadius: '6px', fontSize: '0.75rem', overflowX: 'auto' }}>
                      {JSON.stringify(overview.automationStatus.details, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {/* Add Member Modal */}
      {showAddMemberModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 style={{ marginTop: 0 }}>+ Add Household Member</h3>
            <form onSubmit={handleCreateMember}>
              <div className="form-group mb-2">
                <label className="form-label">User ID (handle):</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. user_anand"
                  value={newMemberForm.userId}
                  onChange={(e) => setNewMemberForm(prev => ({ ...prev, userId: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group mb-2">
                <label className="form-label">Full Name:</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Anand R"
                  value={newMemberForm.name}
                  onChange={(e) => setNewMemberForm(prev => ({ ...prev, name: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group mb-2">
                <label className="form-label">Password:</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Password"
                  value={newMemberForm.password}
                  onChange={(e) => setNewMemberForm(prev => ({ ...prev, password: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group mb-2">
                <label className="form-label">Role:</label>
                <select
                  className="form-input"
                  value={newMemberForm.role}
                  onChange={(e) => setNewMemberForm(prev => ({ ...prev, role: e.target.value }))}
                >
                  <option value="MEMBER">MEMBER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div className="form-group mb-4">
                <label className="form-label">Mess Start Date (optional):</label>
                <input
                  type="date"
                  className="form-input"
                  value={newMemberForm.messStartDate}
                  onChange={(e) => setNewMemberForm(prev => ({ ...prev, messStartDate: e.target.value }))}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <Button variant="secondary" type="button" onClick={() => setShowAddMemberModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Create Member
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Single Attendance Modal for Admin */}
      {editingAttendance && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 style={{ marginTop: 0 }}>Edit Member Attendance</h3>
            <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
              Admin correction for past or future dates. You can mark members as Ate, Did Not Eat, or On Leave (₹0).
            </p>
            <form onSubmit={handleSaveAttendanceEdit}>
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.9rem', margin: '0 0 0.5rem 0' }}>
                  Member: <strong>{editingAttendance.member.name}</strong><br />
                  Date: <strong>{editingAttendance.date}</strong>
                </p>

                <div className="form-group mb-3">
                  <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Attendance Status:</label>
                  <select
                    className="form-input"
                    value={newAttendanceStatus}
                    onChange={(e) => setNewAttendanceStatus(e.target.value)}
                  >
                    <option value="FOOD_REQUIRED">🍽️ Ate (₹130 Charge)</option>
                    <option value="CANCELLED">❌ Did Not Eat / Cancelled (₹0 Charge)</option>
                    <option value="ON_LEAVE">🏖️ On Leave (Official Leave — ₹0 Charge)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => setEditingAttendance(null)}
                  disabled={attendanceEditLoading}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="primary" 
                  disabled={attendanceEditLoading}
                >
                  {attendanceEditLoading ? 'Saving...' : 'Save Attendance'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
