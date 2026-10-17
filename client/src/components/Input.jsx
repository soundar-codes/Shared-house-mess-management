import React from 'react';
import './Input.css';

export default function Input({ label, error, className = '', id, ...props }) {
  return (
    <div className={`input-group ${className}`}>
      {label && <label htmlFor={id} className="input-label">{label}</label>}
      <input id={id} className={`input-field ${error ? 'input-error' : ''}`} {...props} />
      {error && <span className="input-error-text">{error}</span>}
    </div>
  );
}
