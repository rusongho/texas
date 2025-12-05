import React from 'react';

export const Chips: React.FC<{ amount: number; className?: string }> = ({ amount, className }) => {
  return (
    <div className={`flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded-full border border-white/10 ${className}`}>
      <div className="w-4 h-4 rounded-full bg-yellow-500 border-2 border-yellow-300 shadow-[0_0_5px_rgba(234,179,8,0.5)]"></div>
      <span className="text-xs font-mono text-yellow-100 font-bold">${amount}</span>
    </div>
  );
};
