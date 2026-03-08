import React from 'react';

const DurationChip: React.FC<{ value: string | number; className?: string }> = ({ value, className = '' }) => {
  return <span className={`duration-chip ${className}`.trim()}>{value}</span>;
};

export default DurationChip;
