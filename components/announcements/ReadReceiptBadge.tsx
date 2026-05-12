import React from 'react';

const ReadReceiptBadge: React.FC<{ readCount: number; totalCount: number }> = ({ readCount, totalCount }) => {
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-600">
      {readCount} / {Math.max(readCount, totalCount)} seen
    </span>
  );
};

export default ReadReceiptBadge;
