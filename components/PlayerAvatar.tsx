import React from 'react';
import { Player, PlayerStatus } from '../types';
import { VisualCard } from './VisualCard';
import { Chips } from './Chips';
import { Crown, AlertCircle } from 'lucide-react';

interface PlayerAvatarProps {
  player: Player;
  isActive: boolean;
  isWinner: boolean;
  revealCards: boolean;
  positionStyle: React.CSSProperties;
}

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({ player, isActive, isWinner, revealCards, positionStyle }) => {
  const isFolded = player.status === PlayerStatus.Folded;
  const isBusted = player.status === PlayerStatus.Busted;

  return (
    <div 
      className={`absolute flex flex-col items-center transition-all duration-500 ${isFolded || isBusted ? 'opacity-50 grayscale' : 'opacity-100'}`}
      style={positionStyle}
    >
      {/* Bet Bubble */}
      {player.bet > 0 && (
        <div className="absolute -top-8 animate-bounce">
           <Chips amount={player.bet} className="bg-blue-900/80 border-blue-400/30" />
        </div>
      )}

      {/* Cards */}
      <div className="flex gap-1 mb-1 relative z-10">
        {player.hand.map((card, idx) => (
          <div key={idx} className={`transition-transform duration-300 ${isActive ? '-translate-y-2' : ''}`}>
             <VisualCard 
                card={card} 
                hidden={!revealCards && !isWinner && !isActive && !isFolded} // Show only if reveal, winner, or active (hotseat)
                size="sm" 
             />
          </div>
        ))}
      </div>

      {/* Avatar Circle */}
      <div className={`
        relative w-16 h-16 rounded-full border-4 flex items-center justify-center bg-slate-800 shadow-xl
        ${isActive ? 'border-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.5)] scale-110' : 'border-slate-600'}
        ${isWinner ? 'border-green-500 shadow-[0_0_30px_rgba(34,197,94,0.6)]' : ''}
        transition-all duration-300
      `}>
        {player.isDealer && (
          <div className="absolute -right-2 -top-1 w-6 h-6 bg-white text-black font-bold rounded-full flex items-center justify-center text-xs border border-slate-400 z-20">D</div>
        )}
        
        {isWinner && <Crown className="absolute -top-6 text-yellow-400 w-8 h-8 animate-bounce" />}
        
        <div className="text-center overflow-hidden w-full px-1">
           <div className="text-[10px] font-bold truncate text-white uppercase tracking-wider">{player.name}</div>
        </div>

        {/* Status Indicator */}
        {player.status === PlayerStatus.AllIn && (
          <div className="absolute bottom-0 bg-red-600 text-[8px] px-2 rounded-full font-bold uppercase text-white">ALL IN</div>
        )}
      </div>

      {/* Chips */}
      <div className="mt-1">
        <Chips amount={player.chips} />
      </div>
    </div>
  );
};
