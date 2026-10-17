import React from 'react';
import './PageHeader.css';

export default function PageHeader({ title, description, action, className = '' }) {
  return (
    <div className={`page-header ${className}`}>
      <div className="page-header-content">
        <h1 className="page-header-title">{title}</h1>
        {description && <p className="page-header-description">{description}</p>}
      </div>
      {action && (
        <div className="page-header-action">
          {action}
        </div>
      )}
    </div>
  );
}
