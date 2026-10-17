import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Badge from '../components/Badge';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { getKolkataDateString } from '../utils/foodRules';
import { apiFetch } from '../services/apiClient';
import './Dashboard.css';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatRupees(paise = 0) {
  return `₹${(paise / 100).toFixed(2)}`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, checkAuth } = useAuth();
  const { unreadCount, notifications, fetchNotifications } = useNotifications();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Live data states
  const [vesselSchedule, setVesselSchedule] = useState([]);
  const [foodRecords, setFoodRecords] = useState([]);
  const [foodConfig, setFoodConfig] = useState(null);
  const [myBill, setMyBill] = useState(null);
  const [myCycle, setMyCycle] = useState(null);
  const [myChores, setMyChores] = useState([]);

  // Admin schedule edit modal
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [householdMembers, setHouseholdMembers] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(null);

  // Calculate today's date & day name in Asia/Kolkata timezone
  const todayDateStr = getKolkataDateString(); // 'YYYY-MM-DD'
  const currentMonth = todayDateStr.substring(0, 7); // 'YYYY-MM'
  
  // Calculate day of week using Kolkata date
  const [y, m, d] = todayDateStr.split('-').map(Number);
  const kolkataDateObj = new Date(Date.UTC(y, m - 1, d));
  const currentDayName = DAY_NAMES[kolkataDateObj.getUTCDay()];

  const fetchDashboardData = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    try {
      const [vesselRes, foodRes, configRes, billsRes, cyclesRes, choresRes] = await Promise.all([
        apiFetch('/api/v1/chores/vessel-schedule'),
        apiFetch(`/api/v1/food?month=${currentMonth}`),
        apiFetch('/api/v1/food/config'),
        apiFetch(`/api/v1/billing?month=${currentMonth}`),
        apiFetch('/api/v1/billing/members/cycles'),
        apiFetch('/api/v1/chores/assignments')
      ]);

      if (
        vesselRes.status === 401 ||
        foodRes.status === 401 ||
        configRes.status === 401 ||
        billsRes.status === 401 ||
        cyclesRes.status === 401 ||
        choresRes.status === 401
      ) {
        if (checkAuth) checkAuth();
        return;
      }

      // Shared vessel schedule
      if (vesselRes.ok) {
        const schedData = await vesselRes.json();
        setVesselSchedule(schedData.schedule || []);
      }

      // Personal food records
      if (foodRes.ok) {
        const foodData = await foodRes.json();
        setFoodRecords(foodData.records || []);
      }

      // Food config (shared rate)
      if (configRes.ok) {
        const confData = await configRes.json();
        setFoodConfig(confData.config || null);
      }

      // Personal billing (backend enforces non-admins only receive their own bill)
      if (billsRes.ok) {
        const billsData = await billsRes.json();
        const userBills = (billsData.bills || []).filter(b => b.userId === user.id);
        setMyBill(userBills.length > 0 ? userBills[0] : null);
      }

      // Billing cycles (for member start dates)
      if (cyclesRes.ok) {
        const cyclesData = await cyclesRes.json();
        const membersList = cyclesData.members || [];
        setHouseholdMembers(membersList);
        const myCycleData = membersList.find(c => c.userId === user.id);
        setMyCycle(myCycleData || null);
      }

      // Personal chores (filtered to this user or pending)
      if (choresRes.ok) {
        const choresData = await choresRes.json();
        const allAssignments = choresData.assignments || [];
        const personal = allAssignments.filter(c => c.userId === user.id && c.status === 'PENDING');
        setMyChores(personal);
      }

      // Trigger notifications refresh
      fetchNotifications();
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError('Failed to load dashboard data. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  }, [user, currentMonth, checkAuth, fetchNotifications]);

  useEffect(() => {
    if (user) {
      fetchDashboardData();
    }
  }, [user, fetchDashboardData]);

  // Handle Admin update vessel schedule
  const handleSaveScheduleEntry = async (e) => {
    e.preventDefault();
    if (!editingSchedule) return;

    setModalLoading(true);
    setModalError(null);
    try {
      const assignedUserId = selectedAssignee === 'ALL' || selectedAssignee === '' ? null : selectedAssignee;
      const res = await apiFetch(`/api/v1/chores/vessel-schedule/${editingSchedule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedUserId })
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to update schedule');
      }

      setSuccessMessage(`Updated vessel schedule for ${editingSchedule.dayOfWeek} successfully.`);
      setEditingSchedule(null);
      fetchDashboardData();
    } catch (err) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
    }
  };

  // Find today's food status for current member
  const todayFoodRecord = foodRecords.find(r => r.recordDate === todayDateStr);
  const myFoodStatusToday = todayFoodRecord ? todayFoodRecord.status : 'FOOD_REQUIRED';

  // Filter today's vessel duties
  const todayDuties = vesselSchedule.filter(s => s.dayOfWeek === currentDayName);

  // Compute upcoming duty (next scheduled slot after today or tomorrow)
  const currentDayIndex = DAY_NAMES.indexOf(currentDayName);
  let upcomingDuty = null;
  for (let offset = 1; offset <= 7; offset++) {
    const nextDay = DAY_NAMES[(currentDayIndex + offset) % 7];
    const nextDuties = vesselSchedule.filter(s => s.dayOfWeek === nextDay);
    if (nextDuties.length > 0) {
      upcomingDuty = { day: nextDay, duties: nextDuties };
      break;
    }
  }

  // Daily food rate
  const dailyRateRupees = foodConfig ? (foodConfig.defaultRatePaise / 100) : 130;

  // Member's dynamic cycle breakdown & daily accumulation metrics from backend source of truth
  const cycleInfo = myCycle?.currentCycle;
  const currentFoodAmountPaise = cycleInfo?.accumulatedFoodPaise ?? (myBill ? myBill.totalAmountPaise : 0);
  const todayFoodChargePaise = cycleInfo?.todayFoodChargePaise ?? (myFoodStatusToday === 'FOOD_REQUIRED' ? dailyRateRupees * 100 : 0);
  const daysEatenCount = cycleInfo?.chargeableDays ?? 0;
  const daysTotalCount = cycleInfo?.totalDays ?? 30;
  const daysCancelledCount = cycleInfo?.cancelledDays ?? 0;
  const approvedLeaveDaysCount = cycleInfo?.leaveDays ?? 0;
  const amountPaidPaise = cycleInfo?.paidAmountPaise ?? (myBill ? myBill.paidAmountPaise : 0);
  const remainingAmountToPayPaise = cycleInfo?.remainingBalancePaise ?? (myBill ? myBill.balancePaise : currentFoodAmountPaise);

  // Format today's duty summary text
  const todayDutySummary = todayDuties.length > 0
    ? todayDuties.map(d => {
        if (d.isGroupDuty || d.assignedUserId === null) {
          return 'All Members (Group Duty)';
        }
        return `${d.assignedUserName}${d.timePeriod !== 'ALL_DAY' ? ` (${d.timePeriod})` : ''}`;
      }).join(', ')
    : 'No assigned duty';

  return (
    <div className="dashboard">
      <PageHeader 
        title={`Welcome, ${user?.name || 'Member'}`}
        description={`Shared House Mess & Chores Dashboard • ${currentDayName}, ${todayDateStr} (IST)`} 
      />

      {error && (
        <div className="chores-error-banner" data-testid="dashboard-error">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={fetchDashboardData}>
            Retry
          </Button>
        </div>
      )}

      {successMessage && (
        <div style={{ backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.9rem', marginBottom: '1rem' }}>
          {successMessage}
        </div>
      )}

      {isLoading ? (
        <Card><p style={{ textAlign: 'center', color: '#6b7280', padding: '2rem 0' }}>Loading your dashboard...</p></Card>
      ) : (
        <>
          {/* Quick House Info Link Banner */}
          <div 
            className="animate-slide-up"
            style={{ 
              marginBottom: '1.25rem',
              padding: '0.85rem 1.25rem',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(139, 92, 246, 0.08) 100%)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.75rem',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.5rem' }}>🏡</span>
              <div>
                <strong style={{ color: 'var(--color-text-main)', fontSize: '0.95rem' }}>
                  Flat 402, Green Valley Enclave
                </strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  WiFi: <strong>SharedHouse_5G</strong> • Emergency & Landlord contacts available
                </div>
              </div>
            </div>
            <Button 
              variant="secondary" 
              size="sm"
              onClick={() => navigate('/house-info')}
            >
              View House & Emergency Details &rarr;
            </Button>
          </div>

          {/* Top Summary Cards */}
          <div className="dashboard-summary-grid">
            {/* 1. Current Food Amount (Dynamic Daily Accumulation) */}
            <Card className="summary-card highlight-card" data-testid="card-current-food-amount">
              <h3 className="summary-title">Current Food Amount</h3>
              <p className="summary-value text-primary" style={{ color: 'var(--color-primary)' }}>
                {formatRupees(currentFoodAmountPaise)}
              </p>
              <p className="summary-subtext">
                Cycle: {daysEatenCount} / {daysTotalCount} days eaten
              </p>
            </Card>

            {/* 2. Today's Food Charge */}
            <Card className="summary-card" data-testid="card-today-food-charge">
              <h3 className="summary-title">Today's Food Charge</h3>
              <p className="summary-value">
                {formatRupees(todayFoodChargePaise)}
              </p>
              <p className="summary-subtext">
                Status: {todayFoodChargePaise > 0 ? 'Chargeable (Ate)' : (myFoodStatusToday === 'ON_LEAVE' ? 'Approved Leave (₹0)' : 'Cancelled (₹0)')}
              </p>
            </Card>

            {/* 3. Today's Vessel Responsibility (Shared Household Info) */}
            <Card className="summary-card">
              <h3 className="summary-title">Today's Vessel Duty</h3>
              <p className="summary-value" style={{ fontSize: '1rem', lineHeight: '1.4' }}>
                {todayDutySummary}
              </p>
              <p className="summary-subtext">{currentDayName} Washing Duty</p>
            </Card>

            {/* 4. Remaining Balance to Pay */}
            <Card className="summary-card" data-testid="card-remaining-amount">
              <h3 className="summary-title">Remaining Amount to Pay</h3>
              <p className="summary-value" style={{ color: remainingAmountToPayPaise > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                {formatRupees(remainingAmountToPayPaise)}
              </p>
              <p className="summary-subtext">
                Paid: {formatRupees(amountPaidPaise)}
              </p>
            </Card>
            {/* 4. My Notifications (Private to Logged-in Member) */}
            <Card className="summary-card">
              <h3 className="summary-title">My Notifications</h3>
              <p className="summary-value">{unreadCount}</p>
              <p className="summary-subtext">Unread alerts</p>
            </Card>
          </div>

          <div className="dashboard-main-grid">
            {/* Left Column: Shared Household Duties & Schedule */}
            <div className="dashboard-column">
              {/* Weekly Vessel Washing Schedule (Shared across all members) */}
              <Card className="dashboard-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h2 className="section-title" style={{ margin: 0 }}>
                      🍽️ Weekly Vessel-Cleaning Schedule
                    </h2>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#6b7280' }}>
                      Shared household rotation. Sunday is collective duty for all members.
                    </p>
                  </div>
                  {user?.role === 'ADMIN' && (
                    <Badge variant="primary">Admin Managed</Badge>
                  )}
                </div>

                <div className="vessel-table-wrapper">
                  <table className="vessel-table">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Period</th>
                        <th>Assigned Responsibility</th>
                        {user?.role === 'ADMIN' && <th>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {vesselSchedule.length === 0 ? (
                        <tr>
                          <td colSpan={user?.role === 'ADMIN' ? 4 : 3} style={{ textAlign: 'center', color: '#6b7280' }}>
                            Loading schedule...
                          </td>
                        </tr>
                      ) : (
                        vesselSchedule.map(s => {
                          const isToday = s.dayOfWeek === currentDayName;
                          return (
                            <tr 
                              key={s.id} 
                              className={`${isToday ? 'today-row' : ''} ${s.isGroupDuty ? 'group-duty' : ''}`}
                            >
                              <td>
                                <strong>{s.dayOfWeek}</strong>
                                {isToday && (
                                  <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#059669', fontWeight: 700 }}>
                                    (TODAY)
                                  </span>
                                )}
                              </td>
                              <td>
                                <span className={`time-badge ${s.timePeriod.toLowerCase()}`}>
                                  {s.timePeriod === 'ALL_DAY' ? 'All Day' : s.timePeriod === 'MORNING' ? 'Morning' : 'Evening'}
                                </span>
                              </td>
                              <td>
                                {s.isGroupDuty ? (
                                  <Badge variant="primary">👥 All Four Members (Group Duty)</Badge>
                                ) : (
                                  <span style={{ fontWeight: 500 }}>{s.assignedUserName}</span>
                                )}
                              </td>
                              {user?.role === 'ADMIN' && (
                                <td>
                                  <Button 
                                    variant="secondary" 
                                    size="sm"
                                    onClick={() => {
                                      setEditingSchedule(s);
                                      setSelectedAssignee(s.assignedUserId || 'ALL');
                                      setModalError(null);
                                    }}
                                  >
                                    ✏️ Edit
                                  </Button>
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Upcoming Responsibility Box */}
                {upcomingDuty && (
                  <div style={{ marginTop: '1.25rem', padding: '0.875rem', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 600, letterSpacing: '0.05em' }}>
                      Upcoming Vessel Responsibility
                    </span>
                    <div style={{ marginTop: '0.25rem', fontSize: '0.95rem', fontWeight: 500, color: '#1e293b' }}>
                      <strong>{upcomingDuty.day}:</strong>{' '}
                      {upcomingDuty.duties.map(d => 
                        d.isGroupDuty || d.assignedUserId === null
                          ? 'All Members (Group Duty)'
                          : `${d.assignedUserName} (${d.timePeriod})`
                      ).join(', ')}
                    </div>
                  </div>
                )}
              </Card>

              {/* My Pending Household Chores */}
              <Card className="dashboard-section">
                <h2 className="section-title">🧹 My Pending Chore Assignments</h2>
                {myChores.length === 0 ? (
                  <p style={{ margin: 0, color: '#6b7280', fontSize: '0.9rem' }}>
                    You have no pending chore duties assigned today.
                  </p>
                ) : (
                  <div className="chore-list">
                    {myChores.map(c => (
                      <div key={c.id} className="chore-item">
                        <div className="chore-info">
                          <strong>{c.choreName}</strong>
                          <span className="chore-meta">Due Date: {c.dueDate}</span>
                        </div>
                        <Badge status="Pending">Pending</Badge>
                      </div>
                    ))}
                  </div>
                )}
                <Button variant="ghost" onClick={() => navigate('/chores')} className="full-width mt-4">
                  View Household Chores Page
                </Button>
              </Card>
            </div>

            {/* Right Column: Private Member Account & Financials */}
            <div className="dashboard-column">
              {/* My Personal Food Status */}
              <Card className="dashboard-section">
                <h2 className="section-title">🍽️ My Food Status</h2>
                <div className="section-content split">
                  <div>
                    <span className="date-text">{todayDateStr}</span>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#6b7280' }}>
                      Cutoff for tomorrow's cancellations is 11:00 PM IST.
                    </p>
                  </div>
                  <Badge status={myFoodStatusToday === 'FOOD_REQUIRED' ? 'Food Required' : 'Cancelled'}>
                    {myFoodStatusToday === 'FOOD_REQUIRED' ? 'Food Required' : 'Cancelled'}
                  </Badge>
                </div>
                <Button variant="secondary" onClick={() => navigate('/food')} className="full-width mt-4">
                  Manage Food Attendance
                </Button>
              </Card>

              {/* My Private Monthly Billing Overview */}
              <Card className="dashboard-section" data-testid="dashboard-billing-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h2 className="section-title" style={{ margin: 0 }}>💰 Daily Accumulating Mess Billing</h2>
                  {cycleInfo?.calculatedAt && (
                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                      Updated: {new Date(cycleInfo.calculatedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST
                    </span>
                  )}
                </div>
                
                <div className="bill-details">
                  <div className="bill-row">
                    <span>Configured Start Date:</span>
                    <strong>{myCycle?.messStartDate || 'Calendar Month Default'}</strong>
                  </div>
                  {myCycle?.currentCycle && (
                    <div className="bill-row">
                      <span>Current Billing Cycle:</span>
                      <strong>{myCycle.currentCycle.periodStart} to {myCycle.currentCycle.periodEnd}</strong>
                    </div>
                  )}
                  {myCycle?.currentCycle && (
                    <div className="bill-row">
                      <span>Next Billing Date:</span>
                      <strong style={{ color: 'var(--color-primary)' }}>{myCycle.currentCycle.nextBillingDate}</strong>
                    </div>
                  )}
                  <div className="bill-row" style={{ backgroundColor: 'var(--color-primary-light)', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>Current Food Amount (Accumulated):</span>
                    <strong style={{ fontSize: '1.15rem', color: 'var(--color-primary)' }}>
                      {formatRupees(currentFoodAmountPaise)}
                    </strong>
                  </div>
                  <div className="bill-row">
                    <span>Today's Food Charge:</span>
                    <strong style={{ color: todayFoodChargePaise > 0 ? 'var(--color-success-text)' : 'var(--color-text-muted)' }}>
                      {formatRupees(todayFoodChargePaise)}
                    </strong>
                  </div>
                  <div className="bill-row">
                    <span>Days Eaten:</span>
                    <strong>{daysEatenCount} / {daysTotalCount}</strong>
                  </div>
                  <div className="bill-row">
                    <span>Days Cancelled:</span>
                    <strong style={{ color: daysCancelledCount > 0 ? '#d97706' : '#374151' }}>
                      {daysCancelledCount}
                    </strong>
                  </div>
                  <div className="bill-row">
                    <span>Approved Leave Days:</span>
                    <strong style={{ color: approvedLeaveDaysCount > 0 ? '#2563eb' : '#374151' }}>
                      {approvedLeaveDaysCount}
                    </strong>
                  </div>
                  <div className="bill-row">
                    <span>Amount Paid:</span>
                    <strong style={{ color: '#059669' }}>
                      {formatRupees(amountPaidPaise)}
                    </strong>
                  </div>
                  <div className="bill-row">
                    <span>Remaining Amount to Pay:</span>
                    <strong style={{ color: remainingAmountToPayPaise > 0 ? '#dc2626' : '#4b5563' }}>
                      {formatRupees(remainingAmountToPayPaise)}
                    </strong>
                  </div>
                  <div className="bill-row">
                    <span>Payment Status:</span>
                    <Badge variant={myBill?.paymentStatus === 'PAID' ? 'success' : myBill?.paymentStatus === 'PARTIAL' ? 'warning' : 'danger'}>
                      {myBill?.paymentStatus || 'PENDING'}
                    </Badge>
                  </div>
                </div>
                <Button variant="secondary" onClick={() => navigate('/billing')} className="full-width mt-4">
                  View Full Billing & Payment Records
                </Button>
              </Card>

              {/* My Recent Notifications */}
              <Card className="dashboard-section">
                <h2 className="section-title">🔔 My Recent Notifications</h2>
                {notifications.length === 0 ? (
                  <p style={{ margin: 0, color: '#6b7280', fontSize: '0.9rem' }}>
                    No recent notifications.
                  </p>
                ) : (
                  <div className="notification-list">
                    {notifications.slice(0, 3).map(n => (
                      <div key={n.id} className={`notification-item ${!n.isRead ? 'unread' : ''}`}>
                        <div className="notification-header">
                          <strong>{n.title}</strong>
                          {!n.isRead && <span className="unread-dot"></span>}
                        </div>
                        <p className="notification-message">{n.message}</p>
                      </div>
                    ))}
                  </div>
                )}
                <Button variant="ghost" onClick={() => navigate('/notifications')} className="full-width mt-2">
                  View All Notifications
                </Button>
              </Card>
            </div>
          </div>

          {/* Quick Navigation */}
          <h2 className="section-title mt-8">Quick Navigation</h2>
          <div className="quick-nav-grid">
            <Card className="quick-nav-card" onClick={() => navigate('/food')}>
              🍽️ Food Attendance
            </Card>
            <Card className="quick-nav-card" onClick={() => navigate('/billing')}>
              💰 Billing & Payments
            </Card>
            <Card className="quick-nav-card" onClick={() => navigate('/chores')}>
              🧹 Chores & Vessel Schedule
            </Card>
            <Card className="quick-nav-card" onClick={() => navigate('/notifications')}>
              🔔 Notifications ({unreadCount})
            </Card>
          </div>
        </>
      )}

      {/* Admin Vessel Schedule Edit Modal */}
      {editingSchedule && (
        <div className="modal-overlay" onClick={() => setEditingSchedule(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Vessel Responsibility</h3>
              <button className="close-btn" onClick={() => setEditingSchedule(null)}>&times;</button>
            </div>

            {modalError && (
              <div style={{ backgroundColor: '#fef2f2', color: '#991b1b', padding: '0.75rem', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {modalError}
              </div>
            )}

            <form onSubmit={handleSaveScheduleEntry} className="modal-form">
              <div className="form-group">
                <span className="form-label">Day of Week:</span>
                <span style={{ fontWeight: 600 }}>{editingSchedule.dayOfWeek}</span>
              </div>

              <div className="form-group">
                <span className="form-label">Time Period:</span>
                <span style={{ fontWeight: 600 }}>{editingSchedule.timePeriod}</span>
              </div>

              <div className="form-group">
                <label htmlFor="assignee-select" className="form-label">
                  Assigned Member:
                </label>
                <select 
                  id="assignee-select"
                  className="form-select"
                  value={selectedAssignee}
                  onChange={e => setSelectedAssignee(e.target.value)}
                >
                  <option value="ALL">👥 All Four Members (Group Duty)</option>
                  {householdMembers.map(m => (
                    <option key={m.userId} value={m.userId}>
                      {m.userName} ({m.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="modal-actions">
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => setEditingSchedule(null)}
                  disabled={modalLoading}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="primary"
                  disabled={modalLoading}
                >
                  {modalLoading ? 'Saving...' : 'Save Schedule'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
