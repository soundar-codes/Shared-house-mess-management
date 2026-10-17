import React, { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Badge from '../components/Badge';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../services/apiClient';
import './Chores.css';

function getStatusBadgeVariant(status) {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'MISSED':
      return 'danger';
    case 'EXCUSED':
      return 'default';
    default:
      return 'default';
  }
}

export default function Chores() {
  const { user, checkAuth } = useAuth();
  const [schedule, setSchedule] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [dustbinCycle, setDustbinCycle] = useState(null);
  const [dustbinHistory, setDustbinHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [takeoverPrompt, setTakeoverPrompt] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [schedRes, assignRes, dustbinRes, historyRes] = await Promise.all([
        apiFetch('/api/v1/chores/vessel-schedule'),
        apiFetch('/api/v1/chores/assignments'),
        apiFetch('/api/v1/chores/dustbin/current'),
        apiFetch('/api/v1/chores/dustbin/history?limit=5')
      ]);

      if (schedRes.status === 401 || assignRes.status === 401 || dustbinRes.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!schedRes.ok || !assignRes.ok || !dustbinRes.ok) {
        throw new Error('Failed to load chores data');
      }

      const schedData = await schedRes.json();
      const assignData = await assignRes.json();
      const dustbinData = await dustbinRes.json();
      const historyData = historyRes.ok ? await historyRes.json() : { history: [] };

      setSchedule(schedData.schedule || []);
      setAssignments(assignData.assignments || []);
      setDustbinCycle(dustbinData.cycle || null);
      setDustbinHistory(historyData.history || []);
    } catch (err) {
      setError(err.message || 'Error connecting to server');
    } finally {
      setIsLoading(false);
    }
  }, [checkAuth]);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user, fetchData]);

  const handleStatusChange = async (assignmentId, newStatus) => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/chores/assignments/${assignmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to update assignment status');
      }

      const updated = await res.json();
      setAssignments(prev =>
        prev.map(a => (a.id === assignmentId ? { ...a, status: updated.assignment.status } : a))
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleClaimDustbin = async (allowTakeover = false) => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/chores/dustbin/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowTakeover })
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (res.status === 409) {
        setTakeoverPrompt(true);
        const data = await res.json();
        throw new Error(data.error?.message || 'Conflict: Cycle already claimed');
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to claim dustbin cycle');
      }

      const data = await res.json();
      setDustbinCycle(data.cycle);
      setTakeoverPrompt(false);
      // Refresh history
      fetchData();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCompleteDustbin = async () => {
    if (!dustbinCycle) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/chores/dustbin/${dustbinCycle.id}/complete`, {
        method: 'POST'
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to complete dustbin cycle');
      }

      setDustbinCycle(null);
      fetchData();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const canModifyAssignment = (assigneeId) => {
    if (!user) return false;
    return user.role === 'ADMIN' || user.id === assigneeId;
  };

  const isCurrentUserClaimant = dustbinCycle?.claimantUserId === user?.id;
  const canCompleteDustbin = user?.role === 'ADMIN' || isCurrentUserClaimant;

  return (
    <div className="chores-container">
      <PageHeader 
        title="Chores" 
        description="Household chore assignments, weekly vessel washing rotation, and dustbin duty handoffs." 
      />

      {error && (
        <div className="chores-error-banner" data-testid="error-banner">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={fetchData}>
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <Card><p className="empty-state-text">Loading household chores...</p></Card>
      ) : (
        <div className="chores-grid">
          {/* 1. Vessel Washing Weekly Schedule */}
          <Card>
            <h3 className="chores-section-title">🍽️ Vessel Washing Schedule</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)', marginBottom: '1rem' }}>
              Standard weekly rotation. Sunday is shared collectively by all household members.
            </p>
            <div className="vessel-table-wrapper">
              <table className="vessel-table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Time</th>
                    <th>Assigned Person</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map(item => (
                    <tr key={item.id} className={item.isGroupDuty ? 'group-duty' : ''}>
                      <td><strong>{item.dayOfWeek}</strong></td>
                      <td>
                        <span className={`time-badge ${item.timePeriod.toLowerCase()}`}>
                          {item.timePeriod.replace('_', ' ')}
                        </span>
                      </td>
                      <td>
                        {item.isGroupDuty ? (
                          <Badge variant="primary">👥 {item.assignedUserName}</Badge>
                        ) : (
                          <span>{item.assignedUserName}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* 2. Dustbin Cyclic Handoff */}
          <Card>
            <h3 className="chores-section-title">🗑️ Dustbin Cyclic Duty</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #6b7280)', marginBottom: '1rem' }}>
              Voluntary rotating duty. Once claimed, complete the cycle after disposal.
            </p>

            <div className="dustbin-status-box">
              <div className="dustbin-header">
                <div>
                  <div className="dustbin-date">Current Status</div>
                  <div className="dustbin-claimant">
                    {dustbinCycle ? (
                      <span>👤 {dustbinCycle.claimantName}</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted, #6b7280)' }}>No active volunteer</span>
                    )}
                  </div>
                </div>
                <Badge variant={dustbinCycle ? 'warning' : 'default'}>
                  {dustbinCycle ? 'DUTY ACTIVE' : 'OPEN TO VOLUNTEER'}
                </Badge>
              </div>

              {dustbinCycle && (
                <div className="dustbin-date">
                  Started on: <strong>{dustbinCycle.cycleStartDate}</strong>
                </div>
              )}

              <div className="dustbin-actions">
                {!dustbinCycle ? (
                  <Button 
                    variant="primary" 
                    size="sm" 
                    onClick={() => handleClaimDustbin(false)}
                    disabled={actionLoading}
                  >
                    🙋 Volunteer for Dustbin Duty
                  </Button>
                ) : (
                  <>
                    {canCompleteDustbin && (
                      <Button 
                        variant="primary" 
                        size="sm" 
                        onClick={handleCompleteDustbin}
                        disabled={actionLoading}
                      >
                        ✓ Mark Duty Completed
                      </Button>
                    )}
                    {!isCurrentUserClaimant && (
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        onClick={() => handleClaimDustbin(true)}
                        disabled={actionLoading}
                      >
                        🔄 Take Over Duty
                      </Button>
                    )}
                  </>
                )}
              </div>

              {takeoverPrompt && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--danger, #ef4444)' }}>
                  Another housemate currently holds this duty. Click "Take Over Duty" above if you wish to confirm taking over.
                </div>
              )}
            </div>

            {dustbinHistory.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--text-muted, #6b7280)' }}>Recent Duty History</h4>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.85rem' }}>
                  {dustbinHistory.map(h => (
                    <li key={h.id} style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--border-color, #e5e7eb)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{h.claimantName}</span>
                      <span style={{ color: 'var(--text-muted, #6b7280)' }}>{h.cycleStartDate} ({h.status})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* 3. General Chore Tracking */}
      <Card>
        <h3 className="chores-section-title">🧹 Household Task Assignments</h3>
        {assignments.length === 0 ? (
          <p className="empty-state-text">No active task assignments.</p>
        ) : (
          <div className="assignments-list">
            {assignments.map(assignment => {
              const editable = canModifyAssignment(assignment.userId);
              return (
                <div key={assignment.id} className="assignment-item">
                  <div className="assignment-info">
                    <span className="assignment-title">{assignment.choreName}</span>
                    <span className="assignment-meta">
                      <span>👤 {assignment.userName}</span>
                      {assignment.dueDate && <span>📅 Due: {assignment.dueDate}</span>}
                    </span>
                  </div>
                  <div className="assignment-actions">
                    <Badge variant={getStatusBadgeVariant(assignment.status)}>
                      {assignment.status}
                    </Badge>
                    {editable && (
                      <select
                        className="status-select"
                        value={assignment.status}
                        disabled={actionLoading}
                        aria-label={`Update status for ${assignment.choreName}`}
                        onChange={(e) => handleStatusChange(assignment.id, e.target.value)}
                      >
                        <option value="PENDING">PENDING</option>
                        <option value="COMPLETED">COMPLETED</option>
                        <option value="MISSED">MISSED</option>
                        <option value="EXCUSED">EXCUSED</option>
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
