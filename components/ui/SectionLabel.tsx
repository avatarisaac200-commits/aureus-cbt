import React from 'react';

const SectionLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => {
  return <span className={`section-label ${className}`.trim()}>{children}</span>;
};

export default SectionLabel;
