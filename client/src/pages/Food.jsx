import React, { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Badge from '../components/Badge';
import { getKolkataDateString, getNextDayString, getFoodActionState } from '../utils/foodRules';
import { useAuth } from '../contexts/AuthContext';
import './Food.css';

export default function Food() {
  const { user, checkAuth } = useAuth();
  const currentUser = user?.id;
  const isAdmin = user?.role === 'ADMIN';

  const [config, setConfig] = useState(null);
  const [foodData, setFoodData] = useState([]);
  const [unavailableDates, setUnavailableDates] = useState([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [now] = useState(() => new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState(null);

  // Admin declaration form state
  const [declDate, setDeclDate] = useState('');
  const [declReason, setDeclReason] = useState('');
  const [declSubmitting, setDeclSubmitting] = useState(false);
  const [declError, setDeclError] = useState(null);
  const [declSuccess, setDeclSuccess] = useState(null);

  // Admin revoke state
  const [revokingDate, setRevokingDate] = useState(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);
  const [revokeError, setRevokeError] = useState(null);

  // Admin Food Attendance & Leave Management state
  const [attendanceRange, setAttendanceRange] = useState({
    startDate: '2026-10-12',
    endDate: '2026-10-25'
  });
  const [attendanceData, setAttendanceData] = useState({
    members: [],
    records: [],
    leaves: [],
    messUnavailability: []
  });
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceMessage, setAttendanceMessage] = useState(null);
  const [attendanceError, setAttendanceError] = useState(null);

  // Admin Leave Form State
  const [leaveForm, setLeaveForm] = useState({
    userId: 'ALL',
    startDate: '2026-10-15',
    endDate: '2026-10-21',
    reason: 'Scheduled household leave'
  });
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [confirmingBulkLeave, setConfirmingBulkLeave] = useState(false);

  // Admin Single Attendance Edit Modal
  const [editingAttendance, setEditingAttendance] = useState(null); // { member, date, currentStatus }
  const [newAttendanceStatus, setNewAttendanceStatus] = useState('FOOD_REQUIRED');
  const [editAttendanceSubmitting, setEditAttendanceSubmitting] = useState(false);

  const todayStr = getKolkataDateString(now);
  const tomorrowStr = getNextDayString(todayStr);
  const actionState = getFoodActionState(tomorrowStr, now);

  const fetchAttendanceAndLeaves = useCallback(async () => {
    if (!isAdmin) return;
    setAttendanceLoading(true);
    try {
      const res = await fetch(`/api/v1/food/attendance?startDate=${attendanceRange.startDate}&endDate=${attendanceRange.endDate}`, {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setAttendanceData(data);
      }
    } catch (err) {
      console.error('Failed to load attendance:', err);
    } finally {
      setAttendanceLoading(false);
    }
  }, [isAdmin, attendanceRange]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const yearMonth = todayStr.substring(0, 7);
      const [configRes, foodRes, unavailRes] = await Promise.all([
        fetch('/api/v1/food/config', { credentials: 'include' }),
        fetch(`/api/v1/food?month=${yearMonth}`, { credentials: 'include' }),
        fetch(`/api/v1/food/unavailable?month=${yearMonth}`, { credentials: 'include' })
      ]);
      
      if (configRes?.status === 401 || foodRes?.status === 401 || unavailRes?.status === 401) {
          if (checkAuth) checkAuth();
          return;
      }

      if (!configRes?.ok || !foodRes?.ok) {
         throw new Error("Failed to fetch food data");
      }

      const configData = await configRes.json();
      const foodResData = await foodRes.json();
      let unavailData = [];
      if (unavailRes?.ok) {
        const u = await unavailRes.json();
        unavailData = u.declarations || [];
      }

      setConfig(configData.config);
      setFoodData(foodResData.records || []);
      setUnavailableDates(unavailData);
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setIsLoading(false);
    }
  }, [todayStr, checkAuth]);

  useEffect(() => {
    if (currentUser) {
        fetchData();
        if (isAdmin) {
          fetchAttendanceAndLeaves();
        }
    }
  }, [currentUser, isAdmin, fetchData, fetchAttendanceAndLeaves]);

  const myFoodToday = foodData.find(f => f.date === todayStr) || { status: 'FOOD_REQUIRED' };
  const myFoodTomorrow = foodData.find(f => f.date === tomorrowStr) || { status: 'FOOD_REQUIRED' };

  // Check if tomorrow has an active mess-unavailability declaration
  const tomorrowUnavailableDecl = unavailableDates.find(u => u.declarationDate === tomorrowStr && u.status === 'ACTIVE');
  const isTomorrowMessUnavailable = Boolean(tomorrowUnavailableDecl || myFoodTomorrow.isMessUnavailable || myFoodTomorrow.status === 'MESS_UNAVAILABLE');
  const tomorrowUnavailableReason = tomorrowUnavailableDecl?.reason || myFoodTomorrow.messUnavailableReason || 'Mess food unavailable';

  const todayUnavailableDecl = unavailableDates.find(u => u.declarationDate === todayStr && u.status === 'ACTIVE');
  const isTodayMessUnavailable = Boolean(todayUnavailableDecl || myFoodToday.isMessUnavailable || myFoodToday.status === 'MESS_UNAVAILABLE');

  const handleActionClick = () => {
    setError(null);
    setIsConfirming(true);
  };

  const handleConfirm = async () => {
    setIsUpdating(true);
    setError(null);
    try {
      const newStatus = myFoodTomorrow.status === 'FOOD_REQUIRED' ? 'CANCELLED' : 'FOOD_REQUIRED';
      const response = await fetch(`/api/v1/food/${tomorrowStr}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus })
      });
      
      if (response.status === 401) {
          if (checkAuth) checkAuth();
          return;
      }
      
      if (!response.ok) {
         const errData = await response.json();
         throw new Error(errData.error?.message || "Failed to update food status");
      }
      
      const resData = await response.json();
      
      setFoodData(prev => {
         const existingIndex = prev.findIndex(f => f.date === tomorrowStr);
         if (existingIndex >= 0) {
             const copy = [...prev];
             copy[existingIndex] = resData.record;
             return copy;
         } else {
             return [...prev, resData.record];
         }
      });
      setIsConfirming(false);
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancelConfirm = () => {
    setIsConfirming(false);
  };

  // Admin Declare Mess Food Unavailable
  const handleDeclareUnavailable = async (e) => {
    e.preventDefault();
    setDeclError(null);
    setDeclSuccess(null);

    if (!declDate) {
      setDeclError('Please choose a valid date.');
      return;
    }
    if (!declReason.trim()) {
      setDeclError('Please provide a declaration reason.');
      return;
    }

    setDeclSubmitting(true);
    try {
      const res = await fetch('/api/v1/food/unavailable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ date: declDate, reason: declReason.trim() })
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to declare mess food unavailable');
      }

      setDeclDate('');
      setDeclReason('');
      setDeclSuccess('Mess food unavailability declared successfully.');
      await fetchData();
    } catch (err) {
      setDeclError(err.message);
    } finally {
      setDeclSubmitting(false);
    }
  };

  // Admin Revoke Mess Food Unavailability
  const handleRevokeUnavailable = async (e) => {
    e.preventDefault();
    if (!revokingDate) return;
    setRevokeError(null);

    if (!revokeReason.trim()) {
      setRevokeError('Revocation reason is required.');
      return;
    }

    setRevokeSubmitting(true);
    try {
      const res = await fetch(`/api/v1/food/unavailable/${revokingDate}/revoke`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: revokeReason.trim() })
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to revoke declaration');
      }

      setRevokingDate(null);
      setRevokeReason('');
      await fetchData();
    } catch (err) {
      setRevokeError(err.message);
    } finally {
      setRevokeSubmitting(false);
    }
  };

  // Admin Single Attendance Save
  const handleSaveAttendanceEdit = async (e) => {
    e.preventDefault();
    if (!editingAttendance) return;
    setEditAttendanceSubmitting(true);
    setAttendanceError(null);
    setAttendanceMessage(null);

    try {
      const res = await fetch(`/api/v1/food/attendance/members/${editingAttendance.member.id}/dates/${editingAttendance.date}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newAttendanceStatus, reason: `Manual admin update by ${user?.name}` })
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error?.message || 'Failed to update attendance');
      }

      setAttendanceMessage(`Updated attendance for ${editingAttendance.member.name} on ${editingAttendance.date} to ${newAttendanceStatus === 'FOOD_REQUIRED' ? 'Ate' : newAttendanceStatus === 'CANCELLED' ? 'Did not eat' : 'On Leave'}`);
      setEditingAttendance(null);
      await fetchAttendanceAndLeaves();
      await fetchData();
    } catch (err) {
      setAttendanceError(err.message);
    } finally {
      setEditAttendanceSubmitting(false);
    }
  };

  // Admin Create Leave Period
  const handleCreateLeave = async (e) => {
    e.preventDefault();
    setLeaveSubmitting(true);
    setAttendanceError(null);
    setAttendanceMessage(null);

    try {
      const res = await fetch('/api/v1/food/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userIds: leaveForm.userId,
          startDate: leaveForm.startDate,
          endDate: leaveForm.endDate,
          reason: leaveForm.reason
        })
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error?.message || 'Failed to create leave period');
      }

      const data = await res.json();
      setAttendanceMessage(`Successfully created leave period from ${leaveForm.startDate} to ${leaveForm.endDate} for ${data.affectedMembersCount} member(s). Normal mess food will resume on the day following ${leaveForm.endDate}.`);
      setConfirmingBulkLeave(false);
      await fetchAttendanceAndLeaves();
      await fetchData();
    } catch (err) {
      setAttendanceError(err.message);
    } finally {
      setLeaveSubmitting(false);
    }
  };

  // Admin Cancel Leave Period
  const handleCancelLeave = async (leaveId) => {
    if (!window.confirm('Are you sure you want to cancel this leave period and restore normal food attendance?')) return;
    setAttendanceError(null);
    setAttendanceMessage(null);

    try {
      const res = await fetch(`/api/v1/food/leaves/${leaveId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: 'Admin cancelled leave' })
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error?.message || 'Failed to cancel leave');
      }

      setAttendanceMessage('Leave period cancelled and member attendance restored to Food Required.');
      await fetchAttendanceAndLeaves();
      await fetchData();
    } catch (err) {
      setAttendanceError(err.message);
    }
  };

  if (isLoading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading food data...</div>;
  }

  if (!config) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#d32f2f' }}>Error loading data. {error}</div>;
  }

  // Calendar logic
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  const blanks = Array(firstDay).fill(null);
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  });

  return (
    <div className="food-page">
      <PageHeader 
        title="Food" 
        description="Manage your daily food requirement and cancellations." 
      />

      <div className="food-grid">
        <div className="food-main">
          {/* Current Status */}
          <Card className="mb-6">
            <h2 className="section-title">Today's Food</h2>
            <div className="current-status">
              <div className="current-info">
                <span className="date-display">{todayStr}</span>
                <span className="rate-display">
                  {isTodayMessUnavailable ? '₹0/day (Mess Unavailable)' : `₹${config.default_rate_paise / 100}/day`}
                </span>
              </div>
              <Badge 
                status={isTodayMessUnavailable ? 'MessUnavailable' : (myFoodToday.status === 'FOOD_REQUIRED' ? 'Paid' : 'Cancelled')}
                className="status-badge"
              >
                {isTodayMessUnavailable ? 'MESS UNAVAILABLE' : (myFoodToday.status === 'FOOD_REQUIRED' ? 'FOOD REQUIRED' : 'CANCELLED')}
              </Badge>
            </div>
          </Card>

          {/* Action Section for Tomorrow */}
          <Card className="mb-6 action-card">
            <h2 className="section-title">Tomorrow's Food</h2>
            <p className="mb-4">Date: <strong>{tomorrowStr}</strong></p>
            
            {isTomorrowMessUnavailable ? (
              <div className="blocked-action mess-unavailable-banner">
                <Badge variant="warning" className="status-badge">MESS UNAVAILABLE</Badge>
                <div className="unavailable-reason-box mt-2">
                  <strong>Mess Food Unavailable:</strong> {tomorrowUnavailableReason}
                </div>
                <p className="text-muted mt-2" style={{ fontSize: '0.85rem' }}>
                  Food is declared unavailable by the administrator. Member food cancellation/restoration is disabled. All household members receive zero food charge.
                </p>
              </div>
            ) : actionState.allowed ? (
              !isConfirming ? (
                <Button 
                  variant={myFoodTomorrow.status === 'FOOD_REQUIRED' ? 'danger' : 'primary'} 
                  onClick={handleActionClick}
                >
                  {myFoodTomorrow.status === 'FOOD_REQUIRED' ? "Cancel Tomorrow's Food" : "Restore Tomorrow's Food"}
                </Button>
              ) : (
                <div className="confirmation-box">
                  <h3 className="confirm-title">
                    {myFoodTomorrow.status === 'FOOD_REQUIRED' ? 'Cancel food for tomorrow?' : 'Restore food for tomorrow?'}
                  </h3>
                  <p>Date: <strong>{tomorrowStr}</strong></p>
                  <p>Rate: ₹{config.default_rate_paise / 100}/day</p>
                  <p className="warning-text">⚠️ This action is only available until 11:00 PM today.</p>
                  {error && <p className="error-text mt-2">{error}</p>}
                  <div className="confirm-actions">
                    <Button variant="secondary" onClick={handleCancelConfirm} disabled={isUpdating}>Cancel</Button>
                    <Button 
                      variant={myFoodTomorrow.status === 'FOOD_REQUIRED' ? 'danger' : 'primary'} 
                      onClick={handleConfirm}
                      disabled={isUpdating}
                    >
                      {isUpdating ? "Updating..." : (myFoodTomorrow.status === 'FOOD_REQUIRED' ? "Confirm Cancellation" : "Confirm Restore")}
                    </Button>
                  </div>
                </div>
              )
            ) : (
              <div className="blocked-action">
                <Badge status={myFoodTomorrow.status === 'FOOD_REQUIRED' ? 'Paid' : 'Cancelled'}>
                  {myFoodTomorrow.status === 'FOOD_REQUIRED' ? 'FOOD REQUIRED' : 'CANCELLED'}
                </Badge>
                {actionState.reason === 'CUTOFF_PASSED' && (
                  <p className="error-text mt-2">Food changes are closed for tomorrow after 11:00 PM.</p>
                )}
              </div>
            )}
          </Card>

          {/* Admin Mess Food Unavailability Controls */}
          {isAdmin && (
            <Card className="mb-6 admin-unavailability-card">
              <h2 className="section-title">🛠️ Admin: Declare Mess Food Unavailable</h2>
              <p className="text-muted mb-4" style={{ fontSize: '0.85rem' }}>
                Declare dates when food will not be cooked. Applies to past, today, or future dates. Charges ₹0 for all members and disables member cancellations.
              </p>

              <form onSubmit={handleDeclareUnavailable} className="unavailability-form">
                <div className="form-group mb-3">
                  <label htmlFor="unavail-date-input" className="form-label">Date:</label>
                  <input
                    id="unavail-date-input"
                    type="date"
                    className="form-input"
                    value={declDate}
                    onChange={(e) => setDeclDate(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group mb-3">
                  <label htmlFor="unavail-reason-input" className="form-label">Reason:</label>
                  <input
                    id="unavail-reason-input"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Cook festival leave, kitchen maintenance"
                    value={declReason}
                    onChange={(e) => setDeclReason(e.target.value)}
                    required
                  />
                </div>

                {declError && <p className="error-text mb-3">{declError}</p>}
                {declSuccess && <p className="success-text mb-3" style={{ color: '#059669', fontSize: '0.85rem' }}>{declSuccess}</p>}

                <Button type="submit" variant="primary" disabled={declSubmitting}>
                  {declSubmitting ? 'Declaring...' : 'Declare Unavailable'}
                </Button>
              </form>

              {/* Active Declarations List */}
              <div className="active-declarations-section mt-4">
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Active Declarations for this Month
                </h3>
                {unavailableDates.filter(u => u.status === 'ACTIVE').length === 0 ? (
                  <p className="text-muted" style={{ fontSize: '0.85rem' }}>No active mess unavailability declarations this month.</p>
                ) : (
                  <div className="unavailability-list">
                    {unavailableDates.filter(u => u.status === 'ACTIVE').map(decl => (
                      <div key={decl.id} className="unavailability-item">
                        <div className="unavail-info">
                          <strong>{decl.declarationDate}</strong>
                          <span className="unavail-reason">{decl.reason}</span>
                        </div>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            setRevokingDate(decl.declarationDate);
                            setRevokeReason('');
                            setRevokeError(null);
                          }}
                        >
                          Revoke
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        {/* Calendar Side */}
        <div className="food-sidebar">
          <Card>
            <h2 className="section-title">This Month</h2>
            <div className="calendar">
              <div className="calendar-header">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                  <div key={d} className="calendar-day-name">{d}</div>
                ))}
              </div>
              <div className="calendar-grid">
                {blanks.map((_, i) => <div key={`blank-${i}`} className="calendar-cell empty"></div>)}
                {days.map(dateStr => {
                  const foodRecord = foodData.find(f => f.date === dateStr);
                  const isToday = dateStr === todayStr;
                  const isTomorrow = dateStr === tomorrowStr;
                  const isPast = dateStr < todayStr;
                  
                  // Check if this date has active mess unavailability
                  const activeUnavail = unavailableDates.find(u => u.declarationDate === dateStr && u.status === 'ACTIVE');
                  const isMessUnavail = Boolean(activeUnavail || foodRecord?.isMessUnavailable || foodRecord?.status === 'MESS_UNAVAILABLE');
                  const status = isMessUnavail ? 'MESS_UNAVAILABLE' : (foodRecord ? foodRecord.status : 'FOOD_REQUIRED');

                  let cellClass = 'calendar-cell';
                  if (isToday) cellClass += ' today';
                  if (isTomorrow) cellClass += ' tomorrow';
                  if (isPast) cellClass += ' past';
                  if (status === 'MESS_UNAVAILABLE') cellClass += ' mess-unavailable';
                  else if (status === 'CANCELLED') cellClass += ' cancelled';
                  else cellClass += ' required';

                  const tooltipTitle = isMessUnavail 
                    ? `Mess Unavailable: ${activeUnavail?.reason || foodRecord?.messUnavailableReason || 'No food'}`
                    : status;

                  return (
                    <div key={dateStr} className={cellClass} title={tooltipTitle}>
                      <span className="day-number">{parseInt(dateStr.slice(-2), 10)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="calendar-legend">
              <div className="legend-item"><span className="legend-dot required"></span> Required</div>
              <div className="legend-item"><span className="legend-dot cancelled"></span> Cancelled</div>
              <div className="legend-item"><span className="legend-dot unavailable"></span> Unavailable</div>
              <div className="legend-item"><span className="legend-dot today"></span> Today</div>
            </div>
          </Card>
        </div>
      </div>

      {/* Admin: Mess Food Management Section */}
      {isAdmin && (
        <div className="admin-mess-food-management mt-6" style={{ marginTop: '2rem' }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border, #e5e7eb)', paddingBottom: '1rem' }}>
              <div>
                <h2 className="section-title" style={{ margin: 0 }}>
                  📋 Admin: Mess Food Management (Attendance & Leaves)
                </h2>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)' }}>
                  Manage daily food attendance records and schedule member leaves. All official leave dates are billed at ₹0.
                </p>
              </div>

              {/* Date Filter */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Date Range:</span>
                <input
                  type="date"
                  className="form-input"
                  style={{ width: 'auto', padding: '0.35rem 0.6rem' }}
                  value={attendanceRange.startDate}
                  onChange={(e) => setAttendanceRange(prev => ({ ...prev, startDate: e.target.value }))}
                />
                <span>→</span>
                <input
                  type="date"
                  className="form-input"
                  style={{ width: 'auto', padding: '0.35rem 0.6rem' }}
                  value={attendanceRange.endDate}
                  onChange={(e) => setAttendanceRange(prev => ({ ...prev, endDate: e.target.value }))}
                />
                <Button 
                  variant="secondary" 
                  size="sm" 
                  onClick={fetchAttendanceAndLeaves}
                  disabled={attendanceLoading}
                >
                  {attendanceLoading ? 'Loading...' : 'Refresh'}
                </Button>
              </div>
            </div>

            {attendanceMessage && (
              <div style={{ padding: '0.75rem 1rem', backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem' }}>
                ✓ {attendanceMessage}
              </div>
            )}

            {attendanceError && (
              <div style={{ padding: '0.75rem 1rem', backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem' }}>
                ⚠️ {attendanceError}
              </div>
            )}

            {/* Sub-grid: 1. Schedule Leave Period Form | 2. Active Leaves List */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
              {/* Form: Schedule Leave Period */}
              <div style={{ backgroundColor: 'var(--color-background, #f9fafb)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--color-border, #e5e7eb)' }}>
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 600 }}>
                  ✈️ Schedule Leave Period
                </h3>
                <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)' }}>
                  Mark one or all members on leave. Normal food tracking and billing automatically resumes when leave ends.
                </p>

                <form onSubmit={(e) => {
                  e.preventDefault();
                  setConfirmingBulkLeave(true);
                }}>
                  <div className="form-group mb-2">
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Member:</label>
                    <select
                      className="form-input"
                      value={leaveForm.userId}
                      onChange={(e) => setLeaveForm(prev => ({ ...prev, userId: e.target.value }))}
                    >
                      <option value="ALL">👥 All Four Members (Bulk Leave)</option>
                      {attendanceData.members.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.8rem' }}>Start Date:</label>
                      <input
                        type="date"
                        className="form-input"
                        value={leaveForm.startDate}
                        onChange={(e) => setLeaveForm(prev => ({ ...prev, startDate: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.8rem' }}>End Date (Inclusive):</label>
                      <input
                        type="date"
                        className="form-input"
                        value={leaveForm.endDate}
                        onChange={(e) => setLeaveForm(prev => ({ ...prev, endDate: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group mb-3">
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Reason:</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Festival vacation, semester break"
                      value={leaveForm.reason}
                      onChange={(e) => setLeaveForm(prev => ({ ...prev, reason: e.target.value }))}
                    />
                  </div>

                  <Button type="submit" variant="primary" size="sm" disabled={leaveSubmitting}>
                    Schedule Leave
                  </Button>
                </form>
              </div>

              {/* List: Active & Past Leaves */}
              <div style={{ backgroundColor: 'var(--color-background, #f9fafb)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--color-border, #e5e7eb)' }}>
                <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 600 }}>
                  🏖️ Scheduled Leave Records
                </h3>
                {attendanceData.leaves.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)' }}>No leave periods scheduled.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '240px', overflowY: 'auto' }}>
                    {attendanceData.leaves.map(l => (
                      <div 
                        key={l.id} 
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px' }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                            {attendanceData.members.find(m => m.id === l.user_id)?.name || l.user_id}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#4f46e5' }}>
                            {l.start_date} → {l.end_date} (Inclusive)
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                            {l.reason || 'Leave'}
                          </div>
                        </div>

                        <div>
                          {l.status === 'ACTIVE' ? (
                            <Button 
                              variant="danger" 
                              size="sm" 
                              onClick={() => handleCancelLeave(l.id)}
                            >
                              Cancel Leave
                            </Button>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontStyle: 'italic' }}>Cancelled</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Attendance Matrix Table */}
            <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem', fontWeight: 600 }}>
              📅 Daily Attendance Matrix
            </h3>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)' }}>
              Click any attendance cell to edit or correct attendance status (Ate, Did not eat, On leave).
            </p>

            <div style={{ overflowX: 'auto' }}>
              <table className="bills-table" style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-surface, #f3f4f6)' }}>
                    <th style={{ padding: '0.6rem 0.8rem', textAlign: 'left' }}>Date</th>
                    <th style={{ padding: '0.6rem 0.8rem', textAlign: 'left' }}>Day</th>
                    {attendanceData.members.map(m => (
                      <th key={m.id} style={{ padding: '0.6rem 0.8rem', textAlign: 'center' }}>
                        {m.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const dates = [];
                    let cur = new Date(`${attendanceRange.startDate}T00:00:00.000Z`);
                    const end = new Date(`${attendanceRange.endDate}T00:00:00.000Z`);
                    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

                    while (cur <= end) {
                      dates.push(cur.toISOString().split('T')[0]);
                      cur.setUTCDate(cur.getUTCDate() + 1);
                    }

                    if (dates.length === 0) {
                      return (
                        <tr>
                          <td colSpan={2 + attendanceData.members.length} style={{ textAlign: 'center', padding: '1rem', color: '#6b7280' }}>
                            Invalid date range.
                          </td>
                        </tr>
                      );
                    }

                    return dates.map(dStr => {
                      const dt = new Date(`${dStr}T12:00:00+05:30`);
                      const dayName = dayNames[dt.getDay()];
                      const isToday = dStr === todayStr;

                      return (
                        <tr key={dStr} style={{ backgroundColor: isToday ? '#f0fdf4' : 'inherit' }}>
                          <td style={{ padding: '0.5rem 0.8rem', fontWeight: isToday ? 700 : 500 }}>
                            {dStr} {isToday && <span style={{ color: '#059669', fontSize: '0.75rem' }}>(Today)</span>}
                          </td>
                          <td style={{ padding: '0.5rem 0.8rem', color: '#6b7280' }}>
                            {dayName}
                          </td>
                          {attendanceData.members.map(member => {
                            const record = attendanceData.records.find(r => r.user_id === member.id && r.date === dStr);
                            const unavail = attendanceData.messUnavailability.find(u => u.declaration_date === dStr);

                            let displayStatus = 'Ate';
                            let badgeVariant = 'success';
                            let internalStatus = 'FOOD_REQUIRED';

                            if (unavail) {
                              displayStatus = 'Mess Unavailable';
                              badgeVariant = 'warning';
                              internalStatus = 'MESS_UNAVAILABLE';
                            } else if (record) {
                              if (record.status === 'CANCELLED') {
                                displayStatus = 'Did not eat';
                                badgeVariant = 'danger';
                                internalStatus = 'CANCELLED';
                              } else if (record.status === 'ON_LEAVE') {
                                displayStatus = 'On Leave';
                                badgeVariant = 'primary';
                                internalStatus = 'ON_LEAVE';
                              }
                            }

                            return (
                              <td 
                                key={member.id} 
                                style={{ padding: '0.5rem 0.8rem', textAlign: 'center' }}
                              >
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
                                    padding: '0.2rem 0.5rem',
                                    borderRadius: '4px'
                                  }}
                                  title={`Click to edit ${member.name} on ${dStr}`}
                                >
                                  <Badge variant={badgeVariant}>
                                    {displayStatus}
                                  </Badge>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Confirmation Modal for Bulk Leave */}
      {confirmingBulkLeave && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Confirm Leave Period</h3>
            <div className="modal-body">
              <p>Please review the leave details before confirming:</p>
              <ul style={{ fontSize: '0.9rem', lineHeight: '1.6', margin: '0.5rem 0 1rem 1rem' }}>
                <li><strong>Target:</strong> {leaveForm.userId === 'ALL' ? 'All Four Members (Soundar, Sanjay, Mukesh, Raj Priyan)' : attendanceData.members.find(m => m.id === leaveForm.userId)?.name}</li>
                <li><strong>Period:</strong> {leaveForm.startDate} to {leaveForm.endDate} (Inclusive)</li>
                <li><strong>Reason:</strong> {leaveForm.reason || 'Not specified'}</li>
                <li><strong>Billing Impact:</strong> ₹0 will be charged for all leave dates. Existing finalized bills and recorded payments will not be modified.</li>
              </ul>
            </div>
            <div className="modal-footer">
              <Button variant="secondary" onClick={() => setConfirmingBulkLeave(false)} disabled={leaveSubmitting}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleCreateLeave} disabled={leaveSubmitting}>
                {leaveSubmitting ? 'Scheduling...' : 'Confirm & Schedule Leave'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Single Attendance Modal */}
      {editingAttendance && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Edit Member Attendance</h3>
            <form onSubmit={handleSaveAttendanceEdit}>
              <div className="modal-body">
                <p style={{ fontSize: '0.9rem' }}>
                  Member: <strong>{editingAttendance.member.name}</strong><br />
                  Date: <strong>{editingAttendance.date}</strong>
                </p>

                <div className="form-group mb-3">
                  <label className="form-label">Attendance Status:</label>
                  <select
                    className="form-input"
                    value={newAttendanceStatus}
                    onChange={(e) => setNewAttendanceStatus(e.target.value)}
                  >
                    <option value="FOOD_REQUIRED">🍽️ Ate (Food Required — Standard Charge)</option>
                    <option value="CANCELLED">❌ Did not eat (Cancelled — ₹0 Charge)</option>
                    <option value="ON_LEAVE">🏖️ On Leave (Official Leave — ₹0 Charge)</option>
                  </select>
                </div>
              </div>

              <div className="modal-footer">
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => setEditingAttendance(null)}
                  disabled={editAttendanceSubmitting}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="primary" 
                  disabled={editAttendanceSubmitting}
                >
                  {editAttendanceSubmitting ? 'Saving...' : 'Save Attendance'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Revocation Modal */}
      {revokingDate && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Revoke Mess Food Unavailability</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)' }}>
              Revoking for date: <strong>{revokingDate}</strong>. This restores normal daily billing charges for all household members and re-enables member cancellation choices.
            </p>

            <form onSubmit={handleRevokeUnavailable}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="revoke-reason-input" className="form-label">Revocation Reason:</label>
                  <input
                    id="revoke-reason-input"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Cook resumed duty, problem resolved"
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    required
                  />
                </div>
                {revokeError && <p className="error-text mt-2">{revokeError}</p>}
              </div>

              <div className="modal-footer">
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => setRevokingDate(null)}
                  disabled={revokeSubmitting}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="danger" 
                  disabled={revokeSubmitting}
                >
                  {revokeSubmitting ? 'Revoking...' : 'Confirm Revocation'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
