import React from 'react';
import './Badge.css';

const statusToVariant = {
  'Food Required': 'warning',
  'Cancelled': 'danger',
  'Paid': 'success',
  'Pending': 'warning',
  'Completed': 'success',
  'Missed': 'danger',
};

export default function Badge({ children, variant, status, className = '', ...props }) {
  const badgeVariant = variant || (status ? statusToVariant[status] : 'default') || 'default';
  
  return (
    <span className={`badge badge-${badgeVariant} ${className}`} {...props}>
      {children}
    </span>
  );
}
