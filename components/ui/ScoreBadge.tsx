import React from 'react';

const getBand = (value: number) => {
  if (value >= 70) return 'score-high';
  if (value >= 40) return 'score-mid';
  return 'score-low';
};

const ScoreBadge: React.FC<{ value: number; className?: string }> = ({ value, className = '' }) => {
  return <span className={`score-badge ${getBand(value)} ${className}`.trim()}>{Math.round(value)}%</span>;
};

export default ScoreBadge;
