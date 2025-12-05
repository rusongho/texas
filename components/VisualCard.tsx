import React from 'react';
import { Card } from '../types';
import { SUIT_COLORS } from '../constants';

interface VisualCardProps {
  card?: Card;
  hidden?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const VisualCard: React.FC<VisualCardProps> = ({ card, hidden, className = '', size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-8 h-12 text-xs rounded-sm',
    md: 'w-12 h-16 text-sm rounded',
    lg: 'w-16 h-24 text-lg rounded-md',
  };

  if (hidden || !card) {
    return (
      <div className={`bg-blue-900 border-2 border-white/20 shadow-lg flex items-center justify-center ${sizeClasses[size]} ${className}`}>
        <div className="w-full h-full bg-opacity-20 bg-[url('https://www.transparenttextures.com/patterns/diagmonds-light.png')]"></div>
      </div>
    );
  }

  return (
    <div className={`bg-white shadow-lg flex flex-col items-center justify-center relative select-none ${sizeClasses[size]} ${SUIT_COLORS[card.suit]} ${className}`}>
      <span className="font-bold leading-none">{card.rank}</span>
      <span className="text-xl leading-none">{card.suit}</span>
    </div>
  );
};
