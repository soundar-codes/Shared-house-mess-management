import React, { useState, useEffect } from 'react';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Badge from '../components/Badge';
import { useAuth } from '../contexts/AuthContext';
import './HouseInfo.css';

export default function HouseInfo() {
  const { user, checkAuth } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [info, setInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Edit Modal state (Admin only)
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    address: '',
    landmark: '',
    pincode: '',
    googleMapsUrl: '',
    wifiSsid: '',
    wifiPassword: '',
    houseRules: '',
    notes: '',
    emergencyContacts: []
  });
  const [saving, setSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);

  const fetchHouseInfo = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/household/info', { credentials: 'include' });
      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }
      if (!res.ok) {
        throw new Error('Failed to load household information');
      }
      const data = await res.json();
      setInfo(data.info);
      if (data.info) {
        setFormData({
          address: data.info.address || '',
          landmark: data.info.landmark || '',
          pincode: data.info.pincode || '',
          googleMapsUrl: data.info.googleMapsUrl || '',
          wifiSsid: data.info.wifiSsid || '',
          wifiPassword: data.info.wifiPassword || '',
          houseRules: data.info.houseRules || '',
          notes: data.info.notes || '',
          emergencyContacts: Array.isArray(data.info.emergencyContacts) ? data.info.emergencyContacts : []
        });
      }
    } catch (err) {
      setError(err.message || 'Error connecting to server');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHouseInfo();
  }, []);

  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleAddContact = () => {
    setFormData(prev => ({
      ...prev,
      emergencyContacts: [
        ...prev.emergencyContacts,
        { role: '', name: '', phone: '' }
      ]
    }));
  };

  const handleRemoveContact = (index) => {
    setFormData(prev => ({
      ...prev,
      emergencyContacts: prev.emergencyContacts.filter((_, i) => i !== index)
    }));
  };

  const handleContactChange = (index, field, value) => {
    setFormData(prev => {
      const updated = [...prev.emergencyContacts];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, emergencyContacts: updated };
    });
  };

  const handleSaveInfo = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch('/api/v1/household/info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData)
      });

      if (res.status === 401) {
        if (checkAuth) checkAuth();
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to update household information');
      }

      const data = await res.json();
      setInfo(data.info);
      setIsEditing(false);
      setSuccessMessage('Household information updated successfully!');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="house-info-container animate-fade-in">
      <div className="house-info-header">
        <PageHeader 
          title="🏡 House Information & Emergency Contacts" 
          description="Shared household address, emergency numbers, WiFi credentials, and house guidelines."
        />
        {isAdmin && (
          <div className="admin-actions">
            <Button 
              variant="primary" 
              onClick={() => setIsEditing(true)}
              className="pulse-button"
            >
              ✏️ Edit House Details
            </Button>
          </div>
        )}
      </div>

      {successMessage && (
        <div className="alert-banner alert-success animate-scale-in">
          ✓ {successMessage}
        </div>
      )}

      {error && (
        <div className="alert-banner alert-error animate-scale-in">
          ⚠️ {error}
        </div>
      )}

      {isLoading ? (
        <div className="loading-state">
          <div className="pulse-indicator"></div> Loading household information...
        </div>
      ) : (
        <div className="house-info-grid">
          {/* 1. Address & Location Card */}
          <Card className="info-card card-interactive stagger-1">
            <div className="card-header-row">
              <h3 className="info-section-title">📍 House Address & Location</h3>
              {info?.pincode && <Badge variant="primary">{info.pincode}</Badge>}
            </div>
            
            <div className="info-content-block">
              <p className="main-address">
                {info?.address || 'No address specified yet.'}
              </p>
              {info?.landmark && (
                <div className="detail-item">
                  <span className="detail-label">Landmark:</span>
                  <span className="detail-value">{info.landmark}</span>
                </div>
              )}
              {info?.address && (
                <div className="copy-action-row">
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={() => handleCopy(`${info.address}, Landmark: ${info.landmark || ''}, Pincode: ${info.pincode || ''}`, 'addr')}
                  >
                    {copiedKey === 'addr' ? '✓ Copied Address!' : '📋 Copy Full Address'}
                  </Button>
                  {info?.googleMapsUrl && (
                    <a 
                      href={info.googleMapsUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="maps-link-btn"
                    >
                      🗺️ Open in Google Maps
                    </a>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* 2. WiFi & Connectivity Card */}
          <Card className="info-card card-interactive stagger-2">
            <div className="card-header-row">
              <h3 className="info-section-title">📶 WiFi Credentials</h3>
              <Badge variant="success">High Speed</Badge>
            </div>
            
            <div className="wifi-grid">
              <div className="wifi-field">
                <span className="detail-label">Network (SSID):</span>
                <div className="wifi-value-row">
                  <strong className="wifi-value">{info?.wifiSsid || 'Not configured'}</strong>
                  {info?.wifiSsid && (
                    <button 
                      className="copy-mini-btn"
                      onClick={() => handleCopy(info.wifiSsid, 'ssid')}
                      title="Copy WiFi Name"
                    >
                      {copiedKey === 'ssid' ? '✓' : '📋'}
                    </button>
                  )}
                </div>
              </div>

              <div className="wifi-field">
                <span className="detail-label">WiFi Password:</span>
                <div className="wifi-value-row">
                  <code className="wifi-password-badge">{info?.wifiPassword || 'Not configured'}</code>
                  {info?.wifiPassword && (
                    <button 
                      className="copy-mini-btn"
                      onClick={() => handleCopy(info.wifiPassword, 'pass')}
                      title="Copy WiFi Password"
                    >
                      {copiedKey === 'pass' ? '✓' : '📋'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* 3. Emergency Contacts Card */}
          <Card className="info-card card-interactive stagger-3 full-width-card">
            <div className="card-header-row">
              <h3 className="info-section-title">🚨 Emergency & Services Contacts</h3>
              <span className="pulse-indicator"></span>
            </div>
            
            {(!info?.emergencyContacts || info.emergencyContacts.length === 0) ? (
              <p className="empty-subtext">No emergency contacts listed yet. Admin can add them via "Edit House Details".</p>
            ) : (
              <div className="contacts-table-wrapper">
                <table className="contacts-table">
                  <thead>
                    <tr>
                      <th>Service / Role</th>
                      <th>Contact Name</th>
                      <th>Phone Number</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.emergencyContacts.map((contact, index) => (
                      <tr key={index} className="contact-row">
                        <td>
                          <Badge variant="secondary">
                            {contact.role || 'Service'}
                          </Badge>
                        </td>
                        <td><strong>{contact.name || '—'}</strong></td>
                        <td>
                          <a href={`tel:${contact.phone}`} className="phone-link">
                            📞 {contact.phone}
                          </a>
                        </td>
                        <td>
                          <Button 
                            variant="secondary" 
                            size="sm"
                            onClick={() => handleCopy(contact.phone, `contact_${index}`)}
                          >
                            {copiedKey === `contact_${index}` ? '✓ Copied' : 'Copy'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* 4. House Rules & Guidelines */}
          <Card className="info-card card-interactive stagger-4">
            <h3 className="info-section-title">📜 Shared House Rules & Mess Timings</h3>
            <div className="rules-content">
              {info?.houseRules ? (
                <div className="markdown-like-text">
                  {info.houseRules.split('\n').map((line, idx) => (
                    <p key={idx} style={{ margin: '0.35rem 0' }}>{line}</p>
                  ))}
                </div>
              ) : (
                <p className="empty-subtext">No house rules added yet.</p>
              )}
            </div>
          </Card>

          {/* 5. Important Notes / Bulletin */}
          <Card className="info-card card-interactive stagger-5">
            <h3 className="info-section-title">📌 Important Notes & Notice Board</h3>
            <div className="notes-content">
              {info?.notes ? (
                <div className="markdown-like-text">
                  {info.notes.split('\n').map((line, idx) => (
                    <p key={idx} style={{ margin: '0.35rem 0' }}>{line}</p>
                  ))}
                </div>
              ) : (
                <p className="empty-subtext">No additional notes.</p>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Admin Edit Modal */}
      {isEditing && (
        <div className="modal-overlay animate-fade-in">
          <div className="modal-content modal-large animate-scale-in">
            <h3 className="modal-title">🛠️ Edit Household Information (Admin)</h3>
            <p className="modal-subtitle">
              Update house address, emergency contacts, WiFi credentials, and house guidelines. Changes will be instantly visible to all members.
            </p>

            <form onSubmit={handleSaveInfo}>
              <div className="modal-body">
                {/* Address Section */}
                <h4 className="form-subheading">📍 Location & Address</h4>
                <div className="form-grid">
                  <div className="form-group full-span">
                    <label className="form-label">Full Address:</label>
                    <textarea 
                      className="form-input"
                      rows="2"
                      value={formData.address}
                      onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                      placeholder="e.g. Flat 402, Green Valley Enclave, 4th Cross Road"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Landmark:</label>
                    <input 
                      type="text" 
                      className="form-input"
                      value={formData.landmark}
                      onChange={(e) => setFormData(prev => ({ ...prev, landmark: e.target.value }))}
                      placeholder="e.g. Near Metro Station"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Pincode:</label>
                    <input 
                      type="text" 
                      className="form-input"
                      value={formData.pincode}
                      onChange={(e) => setFormData(prev => ({ ...prev, pincode: e.target.value }))}
                      placeholder="e.g. 560037"
                    />
                  </div>
                  <div className="form-group full-span">
                    <label className="form-label">Google Maps Link (optional):</label>
                    <input 
                      type="url" 
                      className="form-input"
                      value={formData.googleMapsUrl}
                      onChange={(e) => setFormData(prev => ({ ...prev, googleMapsUrl: e.target.value }))}
                      placeholder="https://maps.google.com/..."
                    />
                  </div>
                </div>

                {/* WiFi Section */}
                <h4 className="form-subheading mt-4">📶 WiFi Connectivity</h4>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">WiFi SSID (Network Name):</label>
                    <input 
                      type="text" 
                      className="form-input"
                      value={formData.wifiSsid}
                      onChange={(e) => setFormData(prev => ({ ...prev, wifiSsid: e.target.value }))}
                      placeholder="e.g. SharedHouse_5G"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">WiFi Password:</label>
                    <input 
                      type="text" 
                      className="form-input"
                      value={formData.wifiPassword}
                      onChange={(e) => setFormData(prev => ({ ...prev, wifiPassword: e.target.value }))}
                      placeholder="e.g. HousePeace@2026"
                    />
                  </div>
                </div>

                {/* Emergency Contacts Section */}
                <div className="contacts-section-header mt-4">
                  <h4 className="form-subheading" style={{ margin: 0 }}>🚨 Emergency Contacts</h4>
                  <Button type="button" variant="secondary" size="sm" onClick={handleAddContact}>
                    ➕ Add Contact
                  </Button>
                </div>
                
                {formData.emergencyContacts.map((contact, index) => (
                  <div key={index} className="contact-input-row animate-slide-up">
                    <input 
                      type="text" 
                      className="form-input"
                      placeholder="Role (e.g. Electrician, Landlord)"
                      value={contact.role}
                      onChange={(e) => handleContactChange(index, 'role', e.target.value)}
                      required
                    />
                    <input 
                      type="text" 
                      className="form-input"
                      placeholder="Name (e.g. Suresh Kumar)"
                      value={contact.name}
                      onChange={(e) => handleContactChange(index, 'name', e.target.value)}
                      required
                    />
                    <input 
                      type="text" 
                      className="form-input"
                      placeholder="Phone (+91 98765 43210)"
                      value={contact.phone}
                      onChange={(e) => handleContactChange(index, 'phone', e.target.value)}
                      required
                    />
                    <button 
                      type="button" 
                      className="remove-btn" 
                      onClick={() => handleRemoveContact(index)}
                      title="Remove contact"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {/* House Rules & Notes */}
                <h4 className="form-subheading mt-4">📜 Rules & Notice Board</h4>
                <div className="form-group">
                  <label className="form-label">House Rules & Mess Guidelines:</label>
                  <textarea 
                    className="form-input"
                    rows="3"
                    value={formData.houseRules}
                    onChange={(e) => setFormData(prev => ({ ...prev, houseRules: e.target.value }))}
                    placeholder="Enter guidelines, one per line..."
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Notice Board / Notes:</label>
                  <textarea 
                    className="form-input"
                    rows="2"
                    value={formData.notes}
                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Important announcements, dustbin timings, etc."
                  />
                </div>
              </div>

              <div className="modal-footer">
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => setIsEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="primary" 
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save House Information'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
