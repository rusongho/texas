import React, { useState, useEffect, useRef } from 'react';
import { GamePhase, Player, PlayerStatus, Card, LogEntry } from './types';
import { createDeck, shuffleDeck, evaluateHand } from './utils/pokerLogic';
import { VisualCard } from './components/VisualCard';
import { PlayerAvatar } from './components/PlayerAvatar';
import { Chips } from './components/Chips';
import { getGeminiCommentary } from './services/geminiService';
import { MessageSquare, Trophy, Timer, Plus, Play, UserPlus } from 'lucide-react';

// --- Configuration ---
const BIG_BLIND = 20;
const SMALL_BLIND = 10;
const MAX_SEATS = 9;

const App: React.FC = () => {
  // -- State --
  const [phase, setPhase] = useState<GamePhase>(GamePhase.Setup);
  const [players, setPlayers] = useState<Player[]>([]);
  const [deck, setDeck] = useState<Card[]>([]);
  const [communityCards, setCommunityCards] = useState<Card[]>([]);
  const [pot, setPot] = useState(0);
  const [currentBet, setCurrentBet] = useState(0);
  const [activePlayerIdx, setActivePlayerIdx] = useState(0); // Index in the `players` array, NOT seat index
  const [dealerIdx, setDealerIdx] = useState(0); // Index in the `players` array
  const [winnerIdx, setWinnerIdx] = useState<number | null>(null); // Index in the `players` array
  const [gameLogs, setGameLogs] = useState<LogEntry[]>([]);
  const [showCards, setShowCards] = useState(false);
  const [autoNextTimer, setAutoNextTimer] = useState<number | null>(null);

  // Setup / Sit Down Logic
  const [isSitModalOpen, setIsSitModalOpen] = useState(false);
  const [selectedSeatIdx, setSelectedSeatIdx] = useState<number | null>(null);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [buyInAmount, setBuyInAmount] = useState(1000);

  // Scroll ref for logs
  const logContainerRef = useRef<HTMLDivElement>(null);

  // --- Helpers ---
  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setGameLogs(prev => [...prev, { id: Date.now().toString() + Math.random(), message, type, timestamp: Date.now() }]);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [gameLogs]);

  // --- Seating Actions ---

  const handleSeatClick = (seatIdx: number) => {
    if (phase !== GamePhase.Setup) return;
    setSelectedSeatIdx(seatIdx);
    setNewPlayerName(`Player ${seatIdx + 1}`);
    setBuyInAmount(1000);
    setIsSitModalOpen(true);
  };

  const confirmSitDown = () => {
    if (!newPlayerName.trim() || selectedSeatIdx === null) return;
    
    const newPlayer: Player = {
      id: Math.random().toString(36).substr(2, 9),
      name: newPlayerName,
      chips: buyInAmount,
      bet: 0,
      hand: [],
      status: PlayerStatus.Active,
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: false,
      seatIndex: selectedSeatIdx,
    };
    
    // Insert player into the array while keeping it sorted by seat index ideally, 
    // or just append and we sort later. For the game logic, the `players` array 
    // represents the "Action Order". We usually sort them by seat index for consistency.
    const updatedPlayers = [...players, newPlayer].sort((a, b) => a.seatIndex - b.seatIndex);
    
    setPlayers(updatedPlayers);
    setIsSitModalOpen(false);
    setSelectedSeatIdx(null);
    setNewPlayerName('');
    addLog(`${newPlayer.name} sat down at Seat ${selectedSeatIdx + 1}.`, 'info');
  };

  const standUp = (playerId: string) => {
    if (phase !== GamePhase.Setup) return;
    setPlayers(players.filter(p => p.id !== playerId));
  };

  // --- Game Lifecycle Actions ---

  const startGame = () => {
    if (players.length < 2) return;
    setPhase(GamePhase.PreFlop);
    startNewHand(0, players); // Start with first dealer in list
  };

  const startNewHand = (newDealerIdx: number, currentPlayers: Player[]) => {
    setAutoNextTimer(null);
    // Reset Deck
    const newDeck = shuffleDeck(createDeck());
    
    // Filter out busted players or reset active ones
    const resetPlayers = currentPlayers.map(p => ({
      ...p,
      hand: [],
      bet: 0,
      status: p.chips > 0 ? PlayerStatus.Active : PlayerStatus.Busted,
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: false,
    }));

    // Check if enough active players
    const activeCount = resetPlayers.filter(p => p.status !== PlayerStatus.Busted).length;
    if (activeCount < 2) {
      const winner = resetPlayers.find(p => p.status !== PlayerStatus.Busted);
      addLog(`Game Over! ${winner?.name || 'Everyone'} wins/left!`, 'winner');
      setPhase(GamePhase.Setup); // Return to lobby/setup
      setPlayers(resetPlayers);
      return;
    }

    // Determine positions relative to the players array (compact list)
    // Note: dealerIdx is index in the PLAYERS ARRAY, not seat index.
    const activeIndices = resetPlayers.map((p, i) => i).filter(i => resetPlayers[i].status !== PlayerStatus.Busted);
    
    // Move dealer button to next ACTIVE player
    // If we just blindly increment, we might hit a busted player.
    // Let's simplify: dealerIdx passed in is the index in the FULL player array.
    // If that player is busted, we need to find the next active one? 
    // Standard poker: Button moves. If player busts, button might skip or move.
    // For simplicity: Button moves to next person in array (mod length). If they are busted, they can't be dealer? 
    // Actually, dealer button CAN be on a busted player technically in some rules, but let's assume Dealer is always Active.
    
    let actualDealerIdx = newDealerIdx % resetPlayers.length;
    while(resetPlayers[actualDealerIdx].status === PlayerStatus.Busted) {
        actualDealerIdx = (actualDealerIdx + 1) % resetPlayers.length;
    }

    // Set roles
    resetPlayers.forEach(p => { p.isDealer = false; p.isSmallBlind = false; p.isBigBlind = false; });
    
    const dealerPlayer = resetPlayers[actualDealerIdx];
    dealerPlayer.isDealer = true;

    // Find SB (Next active after Dealer)
    let sbIdx = (actualDealerIdx + 1) % resetPlayers.length;
    while(resetPlayers[sbIdx].status === PlayerStatus.Busted) sbIdx = (sbIdx + 1) % resetPlayers.length;
    
    // Find BB (Next active after SB)
    let bbIdx = (sbIdx + 1) % resetPlayers.length;
    while(resetPlayers[bbIdx].status === PlayerStatus.Busted) bbIdx = (bbIdx + 1) % resetPlayers.length;
    
    // Heads up exception: Dealer is SB, Other is BB.
    if (activeCount === 2) {
       // In Heads Up, Dealer is SB. 
       // Current logic: D=0. SB=1. BB=0. -> SB=BB ??
       // Correct Heads up: Dealer posts SB. Non-Dealer posts BB.
       // My simple logic: Dealer=0. SB=Next(1). BB=Next(0). 
       // So Dealer is BB? That's wrong.
       // Let's swap for Heads up:
       resetPlayers[actualDealerIdx].isSmallBlind = true;
       resetPlayers[sbIdx].isBigBlind = true;
       // We keep dealer button on actualDealerIdx.
    } else {
       resetPlayers[sbIdx].isSmallBlind = true;
       resetPlayers[bbIdx].isBigBlind = true;
    }

    // Deal Hands
    resetPlayers.forEach(p => {
       if(p.status !== PlayerStatus.Busted) {
         p.hand = [newDeck.pop()!, newDeck.pop()!];
       }
    });

    // Post Blinds
    const sbPlayer = resetPlayers.find(p => p.isSmallBlind)!;
    const bbPlayer = resetPlayers.find(p => p.isBigBlind)!;
    
    let potStart = 0;
    
    const sbAmt = Math.min(sbPlayer.chips, SMALL_BLIND);
    sbPlayer.chips -= sbAmt;
    sbPlayer.bet = sbAmt;
    potStart += sbAmt;

    const bbAmt = Math.min(bbPlayer.chips, BIG_BLIND);
    bbPlayer.chips -= bbAmt;
    bbPlayer.bet = bbAmt;
    potStart += bbAmt;

    setPlayers(resetPlayers);
    setDeck(newDeck);
    setCommunityCards([]);
    setPot(potStart);
    setCurrentBet(BIG_BLIND);
    setDealerIdx(actualDealerIdx);
    setWinnerIdx(null);
    setShowCards(false);

    // Action starts after BB
    // If Heads up: Dealer(SB) -> Non-Dealer(BB) -> Action is Dealer(SB)? No, Preflop action starts Left of BB.
    // Heads Up: Dealer is SB. BB is other. Action starts with Button (SB).
    // 3+ players: SB, BB, UTG (Left of BB).
    
    let firstActionIdx = (resetPlayers.findIndex(p => p.isBigBlind) + 1) % resetPlayers.length;
    while(resetPlayers[firstActionIdx].status === PlayerStatus.Busted) {
        firstActionIdx = (firstActionIdx + 1) % resetPlayers.length;
    }
    
    setActivePlayerIdx(firstActionIdx);
    setPhase(GamePhase.PreFlop);
    addLog(`New Hand. Blinds ${SMALL_BLIND}/${BIG_BLIND}`, 'info');
  };

  const nextPhase = () => {
    // Collect bets into pot
    const newPlayers = [...players];
    newPlayers.forEach(p => {
      p.bet = 0; // Reset bets for next street
    });
    setPlayers(newPlayers);
    setCurrentBet(0);
    
    // Reset action to Small Blind (or first active after dealer)
    let nextActive = (dealerIdx + 1) % newPlayers.length;
    let attempts = 0;
    while(
      (newPlayers[nextActive].status !== PlayerStatus.Active && newPlayers[nextActive].status !== PlayerStatus.AllIn) 
      && attempts < newPlayers.length
    ) {
         nextActive = (nextActive + 1) % newPlayers.length;
         attempts++;
    }
    setActivePlayerIdx(nextActive);

    // Deal community cards
    const currentDeck = [...deck];
    let newCommunity = [...communityCards];

    if (phase === GamePhase.PreFlop) {
      newCommunity.push(currentDeck.pop()!, currentDeck.pop()!, currentDeck.pop()!);
      setPhase(GamePhase.Flop);
      addLog("The Flop", 'info');
    } else if (phase === GamePhase.Flop) {
      newCommunity.push(currentDeck.pop()!);
      setPhase(GamePhase.Turn);
      addLog("The Turn", 'info');
    } else if (phase === GamePhase.Turn) {
      newCommunity.push(currentDeck.pop()!);
      setPhase(GamePhase.River);
      addLog("The River", 'info');
    } else {
      handleShowdown();
      return;
    }

    setCommunityCards(newCommunity);
    setDeck(currentDeck);
  };

  const handleShowdown = async () => {
    setPhase(GamePhase.Showdown);
    const activePlayers = players.filter(p => p.status !== PlayerStatus.Folded && p.status !== PlayerStatus.Busted);
    
    if (activePlayers.length === 0) return;

    let bestScore = -1;
    let winner: Player | null = null;
    let winDesc = "";

    activePlayers.forEach(p => {
      const evalResult = evaluateHand(p.hand, communityCards);
      if (evalResult.score > bestScore) {
        bestScore = evalResult.score;
        winner = p;
        winDesc = evalResult.rankName;
      }
    });

    if (winner) {
      const w = winner as Player;
      const wIdx = players.findIndex(p => p.id === w.id);
      setWinnerIdx(wIdx);
      
      const newPlayers = [...players];
      newPlayers[wIdx].chips += pot;
      
      setPlayers(newPlayers);
      addLog(`${w.name} wins ${pot} chips with ${winDesc}!`, 'winner');

      // AI Commentary
      addLog("Gemini is analyzing...", 'info');
      getGeminiCommentary(communityCards, w, winDesc, pot).then(commentary => {
        addLog(commentary, 'gemini');
      });

      // Auto next hand
      let countdown = 8;
      setAutoNextTimer(countdown);
      const timer = setInterval(() => {
        countdown--;
        setAutoNextTimer(countdown);
        if (countdown <= 0) {
          clearInterval(timer);
          startNewHand(dealerIdx + 1, newPlayers);
        }
      }, 1000);
    }
  };

  const handleFold = () => {
    const newPlayers = [...players];
    const folderName = newPlayers[activePlayerIdx].name;
    newPlayers[activePlayerIdx].status = PlayerStatus.Folded;
    setPlayers(newPlayers);
    addLog(`${folderName} folds.`, 'action');
    
    const remaining = newPlayers.filter(p => p.status !== PlayerStatus.Folded && p.status !== PlayerStatus.Busted);
    if (remaining.length === 1) {
      // Immediate win
      const winner = remaining[0];
      const winIdx = newPlayers.findIndex(p => p.id === winner.id);
      setWinnerIdx(winIdx);
      newPlayers[winIdx].chips += pot + newPlayers.reduce((acc, p) => acc + p.bet, 0); 
      newPlayers.forEach(p => p.bet = 0);
      setPlayers(newPlayers);
      setPot(0);
      setPhase(GamePhase.Showdown);
      addLog(`${winner.name} wins by default!`, 'winner');
      
      let countdown = 4;
      setAutoNextTimer(countdown);
      const timer = setInterval(() => {
        countdown--;
        setAutoNextTimer(countdown);
        if (countdown <= 0) {
          clearInterval(timer);
          startNewHand(dealerIdx + 1, newPlayers);
        }
      }, 1000);
      return;
    }
    moveToNextPlayer();
  };

  const handleCheckCall = () => {
    const player = players[activePlayerIdx];
    const amountToCall = currentBet - player.bet;
    const newPlayers = [...players];
    const pRef = newPlayers[activePlayerIdx];

    if (amountToCall >= pRef.chips) {
      setPot(pot + pRef.chips);
      pRef.bet += pRef.chips;
      pRef.chips = 0;
      pRef.status = PlayerStatus.AllIn;
      addLog(`${pRef.name} goes ALL IN!`, 'action');
    } else {
      pRef.chips -= amountToCall;
      pRef.bet += amountToCall;
      setPot(pot + amountToCall);
      addLog(`${pRef.name} ${amountToCall === 0 ? 'checks' : 'calls'}.`, 'action');
    }
    setPlayers(newPlayers);
    moveToNextPlayer();
  };

  const handleRaise = (amount: number) => {
    const newPlayers = [...players];
    const pRef = newPlayers[activePlayerIdx];
    const totalBet = currentBet + amount; 
    const needed = totalBet - pRef.bet;

    if (needed > pRef.chips) return;

    pRef.chips -= needed;
    pRef.bet = totalBet;
    setPot(pot + needed);
    setCurrentBet(totalBet);
    setPlayers(newPlayers);
    addLog(`${pRef.name} raises to ${totalBet}.`, 'action');
    moveToNextPlayer();
  };

  const moveToNextPlayer = () => {
    setShowCards(false);
    let nextIdx = (activePlayerIdx + 1) % players.length;
    let loopCount = 0;
    
    while (
      (players[nextIdx].status === PlayerStatus.Folded || players[nextIdx].status === PlayerStatus.Busted || players[nextIdx].status === PlayerStatus.AllIn) 
      && loopCount < players.length
    ) {
      nextIdx = (nextIdx + 1) % players.length;
      loopCount++;
    }

    const activePlayers = players.filter(p => p.status === PlayerStatus.Active);
    const allInPlayers = players.filter(p => p.status === PlayerStatus.AllIn);
    
    if (activePlayers.length === 0 || (activePlayers.length === 1 && allInPlayers.length > 0)) {
       setTimeout(nextPhase, 1000);
       return;
    }

    const betsMatch = activePlayers.every(p => p.bet === currentBet);
    
    if (betsMatch && (phase !== GamePhase.PreFlop || currentBet > BIG_BLIND || activePlayers.every(p => p.bet > 0))) {
        setTimeout(nextPhase, 500);
        return;
    }

    setActivePlayerIdx(nextIdx);
  };

  // --- Layout Helper ---
  // Returns radial position based on FIXED seat index (0-8)
  const getSeatPosition = (seatIndex: number) => {
    const totalSeats = MAX_SEATS;
    // Offset so seat 0 is at bottom center (or customized).
    // Let's put Seat 0 at bottom center (6 o'clock).
    // In standard math 0 rad is 3 o'clock. 
    // Seat 0: PI/2 (90 deg) -> Bottom.
    const angle = (seatIndex / totalSeats) * 2 * Math.PI + (Math.PI / 2);
    
    // Adjust x/y radius to fit screen aspect ratio
    const xRadius = 44; 
    const yRadius = 40;
    const x = 50 + xRadius * Math.cos(angle);
    const y = 48 + yRadius * Math.sin(angle);
    return { left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' };
  };

  const currentPlayer = players[activePlayerIdx];
  const sortedPlayers = [...players].sort((a, b) => b.chips - a.chips);

  return (
    <div className="h-screen w-screen bg-[#0f172a] relative overflow-hidden flex flex-col font-sans select-none">
      {/* Sit Down Modal */}
      {isSitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-800 p-6 rounded-2xl border border-slate-600 shadow-2xl w-80 animate-in fade-in zoom-in-95">
             <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
               <UserPlus size={20} className="text-yellow-500"/> Sit Down
             </h3>
             <div className="space-y-4">
                <div>
                   <label className="text-xs text-slate-400 uppercase font-bold">Player Name</label>
                   <input 
                      autoFocus
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white mt-1 focus:border-yellow-500 outline-none"
                      value={newPlayerName}
                      onChange={(e) => setNewPlayerName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && confirmSitDown()}
                   />
                </div>
                <div>
                   <label className="text-xs text-slate-400 uppercase font-bold">Buy In</label>
                   <div className="flex items-center gap-2 mt-1">
                      <input 
                        type="range" min="500" max="5000" step="100" 
                        value={buyInAmount}
                        onChange={(e) => setBuyInAmount(Number(e.target.value))}
                        className="flex-1 accent-yellow-500"
                      />
                      <span className="text-yellow-400 font-mono font-bold">${buyInAmount}</span>
                   </div>
                </div>
                <div className="flex gap-2 pt-2">
                   <button onClick={() => setIsSitModalOpen(false)} className="flex-1 py-2 rounded text-slate-400 hover:bg-slate-700">Cancel</button>
                   <button onClick={confirmSitDown} className="flex-1 py-2 rounded bg-yellow-600 hover:bg-yellow-500 text-white font-bold">Join Table</button>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <div className="h-14 bg-slate-900/90 border-b border-white/5 flex items-center justify-between px-6 z-20 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="poker-font text-xl text-yellow-500">Gemini Poker</h2>
          <div className="hidden sm:block bg-slate-800 px-3 py-1 rounded-full text-xs text-slate-300 border border-slate-700">
             Blinds: {SMALL_BLIND}/{BIG_BLIND}
          </div>
        </div>
        
        {autoNextTimer !== null && (
          <div className="flex items-center gap-2 text-yellow-400 font-bold animate-pulse">
            <Timer size={18} />
            Next hand in {autoNextTimer}s
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-slate-300">
           <div className={`w-2 h-2 rounded-full animate-pulse ${phase === GamePhase.Setup ? 'bg-yellow-500' : 'bg-green-500'}`}></div>
           <span className="hidden sm:inline">{phase === GamePhase.Setup ? 'Table Open' : 'Game In Progress'}</span>
        </div>
      </div>

      <div className="flex-1 relative flex items-center justify-center">
        
        {/* Leaderboard Overlay */}
        <div className="absolute left-4 top-4 z-20 hidden md:block w-48 bg-slate-900/50 backdrop-blur rounded-lg border border-white/5 p-2">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
             <Trophy size={10} /> Chip Leaders
          </h3>
          <div className="space-y-1">
             {sortedPlayers.length === 0 ? <div className="text-xs text-slate-600 italic">No players seated</div> : 
             sortedPlayers.map((p, i) => (
               <div key={p.id} className="flex justify-between items-center text-xs">
                 <span className={`truncate max-w-[80px] ${i===0 ? 'text-yellow-400' : 'text-slate-300'}`}>
                   {i+1}. {p.name}
                 </span>
                 <span className="font-mono text-slate-400">${p.chips}</span>
               </div>
             ))}
          </div>
        </div>

        {/* The Felt */}
        <div className="relative w-[95vw] h-[65vh] max-w-[1200px] bg-[#2e5c46] rounded-[100px] md:rounded-[200px] border-[12px] md:border-[16px] border-[#1a1a1a] shadow-[inset_0_0_100px_rgba(0,0,0,0.6)] flex flex-col items-center justify-center scale-95 md:scale-100 transition-transform">
          
          <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/felt.png')] rounded-[80px] md:rounded-[180px] pointer-events-none"></div>
          
          <div className="absolute top-1/4 opacity-10 pointer-events-none text-white poker-font text-6xl tracking-widest font-bold">
            GEMINI
          </div>

          {/* Start Button (Setup Phase) */}
          {phase === GamePhase.Setup && players.length >= 2 && (
             <div className="absolute z-50">
               <button 
                 onClick={startGame}
                 className="flex items-center gap-2 bg-gradient-to-r from-yellow-500 to-orange-600 text-white text-lg font-bold px-8 py-3 rounded-full shadow-lg hover:scale-105 transition-transform animate-pulse"
               >
                 <Play fill="currentColor" size={20} /> Deal Cards
               </button>
             </div>
          )}
          
          {phase === GamePhase.Setup && players.length < 2 && players.length > 0 && (
             <div className="absolute top-1/3 text-white/50 text-sm font-bold bg-black/20 px-4 py-1 rounded-full backdrop-blur">
                Waiting for {2 - players.length} more player(s)...
             </div>
          )}

          {/* Community Cards */}
          <div className="flex gap-2 sm:gap-4 mb-8 z-10 h-20 sm:h-32 items-center">
             {communityCards.map(c => (
               <VisualCard key={c.id} card={c} size="lg" className="shadow-2xl animate-in fade-in slide-in-from-top-4" />
             ))}
             {/* Placeholders for visual balance only during play */}
             {phase !== GamePhase.Setup && Array.from({ length: 5 - communityCards.length }).map((_, i) => (
                <div key={i} className="w-16 h-24 sm:w-20 sm:h-32 border-2 border-white/5 rounded-md bg-black/10"></div>
             ))}
          </div>

          {/* Pot */}
          <div className="bg-black/40 backdrop-blur-md px-6 py-2 rounded-full border border-white/10 flex items-center gap-2 z-10 shadow-xl">
             <span className="text-slate-300 text-xs uppercase tracking-wider">Pot</span>
             <Chips amount={pot} className="bg-transparent border-0 px-0 text-lg" />
          </div>
          
          {/* Winner Banner */}
          {phase === GamePhase.Showdown && winnerIdx !== null && (
             <div className="absolute bottom-24 sm:bottom-32 z-40 bg-black/90 text-yellow-400 px-8 py-4 rounded-xl border border-yellow-500/50 backdrop-blur font-bold text-2xl animate-bounce shadow-[0_0_50px_rgba(234,179,8,0.3)] text-center">
                {players[winnerIdx].name} Wins!
                <div className="text-xs text-white font-normal mt-1 opacity-70">
                   Check log for commentary
                </div>
             </div>
          )}

          {/* Seats (Render all 9 positions) */}
          {Array.from({ length: MAX_SEATS }).map((_, i) => {
             const seatedPlayer = players.find(p => p.seatIndex === i);
             const style = getSeatPosition(i);
             
             // Is this seat index represented in the active player list?
             // We need to find the index IN THE PLAYER ARRAY that matches this seat
             const playerArrayIndex = players.findIndex(p => p.seatIndex === i);
             
             return (
               <React.Fragment key={i}>
                 {seatedPlayer ? (
                   <PlayerAvatar
                      player={seatedPlayer}
                      isActive={playerArrayIndex === activePlayerIdx && phase !== GamePhase.Setup && phase !== GamePhase.Showdown}
                      isWinner={playerArrayIndex === winnerIdx}
                      revealCards={phase === GamePhase.Showdown || (playerArrayIndex === activePlayerIdx && showCards)}
                      positionStyle={style}
                      canStandUp={phase === GamePhase.Setup}
                      onStandUp={() => standUp(seatedPlayer.id)}
                   />
                 ) : (
                   phase === GamePhase.Setup && (
                     <button
                        onClick={() => handleSeatClick(i)}
                        style={style}
                        className="absolute w-14 h-14 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center text-white/30 hover:text-yellow-400 hover:border-yellow-400 hover:bg-white/5 transition-all group"
                     >
                        <Plus className="group-hover:scale-110 transition-transform" />
                     </button>
                   )
                 )}
               </React.Fragment>
             );
          })}

        </div>
      </div>

      {/* Control Panel */}
      <div className="bg-slate-900 border-t border-white/10 p-4 z-30 pb-8 sm:pb-4">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-4 items-center justify-between">
          
          {/* Player Info / Peek */}
          <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-start">
             {phase !== GamePhase.Setup && phase !== GamePhase.Showdown && currentPlayer && (
               <div className="flex flex-col">
                  <span className="text-slate-400 text-xs uppercase">Action</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xl font-bold text-white">{currentPlayer.name}</span>
                    <button 
                      className={`text-xs px-3 py-1.5 rounded-full font-bold border transition-all ${showCards ? 'bg-red-500/20 border-red-500 text-red-300' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}
                      onMouseDown={() => setShowCards(true)}
                      onMouseUp={() => setShowCards(false)}
                      onMouseLeave={() => setShowCards(false)}
                      onTouchStart={() => setShowCards(true)}
                      onTouchEnd={() => setShowCards(false)}
                    >
                      {showCards ? 'Revealing...' : 'Hold to Peek'}
                    </button>
                  </div>
               </div>
             )}
             {phase === GamePhase.Setup && (
                <div className="text-slate-400 text-sm italic">
                  Take a seat to begin...
                </div>
             )}
          </div>

          {/* Actions */}
          {phase !== GamePhase.Setup && phase !== GamePhase.Showdown && currentPlayer && (
            <div className="flex gap-2 w-full md:w-auto">
               <button 
                 onClick={handleFold}
                 className="flex-1 md:flex-none bg-red-900/50 hover:bg-red-800 text-red-200 border border-red-800 px-4 sm:px-6 py-3 rounded-lg font-bold uppercase tracking-wider transition-colors text-sm sm:text-base"
               >
                 Fold
               </button>
               
               <button 
                 onClick={handleCheckCall}
                 className="flex-1 md:flex-none bg-slate-700 hover:bg-slate-600 text-white px-4 sm:px-6 py-3 rounded-lg font-bold uppercase tracking-wider transition-colors border border-slate-500 text-sm sm:text-base"
               >
                 {currentPlayer.bet >= currentBet ? 'Check' : 'Call'}
               </button>

               <button 
                 onClick={() => handleRaise(BIG_BLIND)}
                 className="flex-1 md:flex-none bg-yellow-600 hover:bg-yellow-500 text-white px-4 sm:px-6 py-3 rounded-lg font-bold uppercase tracking-wider transition-colors border border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.3)] text-sm sm:text-base"
               >
                 Raise
               </button>
            </div>
          )}
        </div>
      </div>

      {/* Logs Overlay */}
      <div className="absolute top-16 right-2 sm:right-4 w-64 sm:w-72 h-40 sm:h-64 bg-slate-900/80 backdrop-blur border border-white/10 rounded-xl flex flex-col pointer-events-none sm:pointer-events-auto overflow-hidden shadow-2xl z-20">
        <div className="bg-slate-800/80 px-3 py-2 text-xs font-bold text-slate-400 uppercase border-b border-white/5 flex items-center gap-2">
           <MessageSquare size={12} /> Table Talk
        </div>
        <div ref={logContainerRef} className="flex-1 overflow-y-auto p-2 space-y-2 pointer-events-auto">
           {gameLogs.length === 0 && <div className="text-slate-600 text-xs italic text-center mt-4">Game hasn't started yet</div>}
           {gameLogs.map((log) => (
             <div key={log.id} className={`text-xs p-2 rounded ${
               log.type === 'gemini' ? 'bg-indigo-900/50 border border-indigo-500/30 text-indigo-200' : 
               log.type === 'winner' ? 'bg-yellow-900/30 text-yellow-200' :
               log.type === 'action' ? 'text-slate-300' : 'text-slate-500'
             }`}>
                {log.type === 'gemini' && <span className="text-indigo-400 font-bold block mb-1">Gemini Dealer:</span>}
                {log.message}
             </div>
           ))}
        </div>
      </div>

    </div>
  );
};

export default App;