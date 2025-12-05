import React, { useState, useEffect, useRef } from 'react';
import { GamePhase, Player, PlayerStatus, Card, LogEntry } from './types';
import { createDeck, shuffleDeck, evaluateHand } from './utils/pokerLogic';
import { VisualCard } from './components/VisualCard';
import { PlayerAvatar } from './components/PlayerAvatar';
import { Chips } from './components/Chips';
import { getGeminiCommentary } from './services/geminiService';
import { MessageSquare, Trophy, Timer, Settings } from 'lucide-react';

// --- Configuration ---
const BIG_BLIND = 20;
const SMALL_BLIND = 10;

const App: React.FC = () => {
  // -- State --
  const [phase, setPhase] = useState<GamePhase>(GamePhase.Setup);
  const [players, setPlayers] = useState<Player[]>([]);
  const [deck, setDeck] = useState<Card[]>([]);
  const [communityCards, setCommunityCards] = useState<Card[]>([]);
  const [pot, setPot] = useState(0);
  const [currentBet, setCurrentBet] = useState(0);
  const [activePlayerIdx, setActivePlayerIdx] = useState(0);
  const [dealerIdx, setDealerIdx] = useState(0);
  const [winnerIdx, setWinnerIdx] = useState<number | null>(null);
  const [gameLogs, setGameLogs] = useState<LogEntry[]>([]);
  const [showCards, setShowCards] = useState(false); // Hotseat reveal toggle
  const [autoNextTimer, setAutoNextTimer] = useState<number | null>(null);

  // Setup inputs
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

  // --- Game Lifecycle Actions ---

  const addPlayer = () => {
    if (!newPlayerName.trim() || players.length >= 9) return;
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
    };
    setPlayers([...players, newPlayer]);
    setNewPlayerName('');
  };

  const startGame = () => {
    if (players.length < 2) return;
    // Apply buy-in to all current players just in case
    const readyPlayers = players.map(p => ({ ...p, chips: buyInAmount }));
    setPlayers(readyPlayers);
    setPhase(GamePhase.PreFlop);
    startNewHand(0, readyPlayers); // Start with first dealer
  };

  const startNewHand = (newDealerIdx: number, currentPlayers: Player[]) => {
    setAutoNextTimer(null);
    // Reset Deck
    const newDeck = shuffleDeck(createDeck());
    const resetPlayers = currentPlayers.map(p => ({
      ...p,
      hand: [],
      bet: 0,
      status: p.chips > 0 ? PlayerStatus.Active : PlayerStatus.Busted,
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: false,
    })).filter(p => p.status !== PlayerStatus.Busted);

    // Check game over
    if (resetPlayers.length < 2) {
      addLog(`Game Over! ${resetPlayers[0]?.name} wins everything!`, 'winner');
      setPhase(GamePhase.Setup); // Return to lobby
      setPlayers(resetPlayers);
      return;
    }

    // Set positions
    const dealer = resetPlayers[newDealerIdx % resetPlayers.length];
    const sbIdx = (newDealerIdx + 1) % resetPlayers.length;
    const bbIdx = (newDealerIdx + 2) % resetPlayers.length;
    
    dealer.isDealer = true;
    resetPlayers[sbIdx].isSmallBlind = true;
    resetPlayers[bbIdx].isBigBlind = true;

    // Deal Hands (2 cards each)
    resetPlayers.forEach(p => {
      p.hand = [newDeck.pop()!, newDeck.pop()!];
    });

    // Blinds
    let potStart = 0;
    // SB
    const sbPlayer = resetPlayers[sbIdx];
    const sbAmt = Math.min(sbPlayer.chips, SMALL_BLIND);
    sbPlayer.chips -= sbAmt;
    sbPlayer.bet = sbAmt;
    potStart += sbAmt;

    // BB
    const bbPlayer = resetPlayers[bbIdx];
    const bbAmt = Math.min(bbPlayer.chips, BIG_BLIND);
    bbPlayer.chips -= bbAmt;
    bbPlayer.bet = bbAmt;
    potStart += bbAmt;

    setPlayers(resetPlayers);
    setDeck(newDeck);
    setCommunityCards([]);
    setPot(potStart);
    setCurrentBet(BIG_BLIND);
    setDealerIdx(newDealerIdx);
    setWinnerIdx(null);
    setShowCards(false);
    
    // Action starts after BB
    setActivePlayerIdx((bbIdx + 1) % resetPlayers.length);
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
      setWinnerIdx(players.findIndex(p => p.id === w.id));
      const newPlayers = [...players];
      const winnerRef = newPlayers.find(p => p.id === w.id);
      if (winnerRef) {
        winnerRef.chips += pot;
      }
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
    
    // Check if only one player remains
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
      setPhase(GamePhase.Showdown); // Visually indicate end
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

    if (needed > pRef.chips) {
       // Ideally handle all-in raise, but for simple logic:
       return; 
    }

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
    
    // Check if we should move to next phase
    if (activePlayers.length === 0 || (activePlayers.length === 1 && allInPlayers.length > 0)) {
       setTimeout(nextPhase, 1000); // Auto run out
       return;
    }

    const betsMatch = activePlayers.every(p => p.bet === currentBet);
    
    // Simplistic phase transition logic:
    // If everyone active has matched the bet, AND we have at least acted once? 
    // In this simplified engine, if bets match and we aren't at the start of a street (where bets match at 0 but we need to check):
    // PreFlop: BB is currentBet, so others match BB. 
    // We need to ensure everyone had a turn. 
    // Hack: delay phase change slightly to allow 'Check'. 
    if (betsMatch && (phase !== GamePhase.PreFlop || currentBet > BIG_BLIND || activePlayers.every(p => p.bet > 0))) {
        // Only if the person we just moved FROM was the one completing the action?
        // Let's just assume yes for this demo.
        setTimeout(nextPhase, 500);
        return;
    }

    setActivePlayerIdx(nextIdx);
  };

  // --- Render ---

  if (phase === GamePhase.Setup) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600 mb-2 text-center poker-font">
            Gemini Poker Night
          </h1>
          <p className="text-slate-400 mb-6 text-center text-sm">
            Setup your table. Share this screen or play Hotseat.
          </p>
          
          <div className="space-y-6">
            {/* Buy In Settings */}
            <div className="bg-slate-900/50 p-4 rounded border border-white/5">
              <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2 mb-2">
                <Settings size={14} /> Table Buy-In
              </label>
              <div className="flex items-center gap-4">
                 <input 
                   type="range" 
                   min="500" 
                   max="10000" 
                   step="500" 
                   value={buyInAmount}
                   onChange={(e) => setBuyInAmount(Number(e.target.value))}
                   className="flex-1 accent-yellow-500"
                 />
                 <span className="text-yellow-400 font-mono font-bold w-20 text-right">${buyInAmount}</span>
              </div>
            </div>

            {/* Player Add */}
            <div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  placeholder="Enter player name"
                  className="flex-1 bg-slate-900 border border-slate-600 rounded px-4 py-3 text-white focus:outline-none focus:border-yellow-500"
                  onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
                />
                <button 
                  onClick={addPlayer}
                  disabled={players.length >= 9}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded font-bold transition-colors disabled:opacity-50"
                >
                  Join
                </button>
              </div>
            </div>
            
            {/* Lobby List */}
            <div className="bg-slate-900 rounded p-4 min-h-[120px]">
              <h3 className="text-xs font-bold text-slate-500 uppercase mb-3 flex justify-between">
                <span>Players ({players.length}/9)</span>
                {players.length >= 9 && <span className="text-red-400">Full Table</span>}
              </h3>
              <div className="flex flex-wrap gap-2">
                {players.map(p => (
                  <span key={p.id} className="bg-slate-700 text-white px-3 py-1 rounded-full text-sm flex items-center gap-2 animate-in fade-in zoom-in">
                    {p.name}
                    <button onClick={() => setPlayers(players.filter(x => x.id !== p.id))} className="text-red-400 hover:text-red-300 ml-1">×</button>
                  </span>
                ))}
                {players.length === 0 && <span className="text-slate-600 italic text-sm">Waiting for players...</span>}
              </div>
            </div>

            <button 
              onClick={startGame}
              disabled={players.length < 2}
              className="w-full bg-gradient-to-r from-yellow-500 to-orange-600 text-white font-bold py-4 rounded-xl text-xl shadow-lg hover:shadow-yellow-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02]"
            >
              Start Game
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Table Layout ---
  const getPlayerPosition = (index: number, total: number) => {
    // Distribute around an ellipse
    const angle = (index / total) * 2 * Math.PI + (Math.PI / 2);
    const xRadius = 42; 
    const yRadius = 38;
    const x = 50 + xRadius * Math.cos(angle);
    const y = 48 + yRadius * Math.sin(angle);
    return { left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' };
  };

  const currentPlayer = players[activePlayerIdx];
  const sortedPlayers = [...players].sort((a, b) => b.chips - a.chips);

  return (
    <div className="h-screen w-screen bg-[#0f172a] relative overflow-hidden flex flex-col">
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
           <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
           <span className="hidden sm:inline">Online (Local)</span>
        </div>
      </div>

      <div className="flex-1 relative flex items-center justify-center">
        
        {/* Leaderboard Overlay */}
        <div className="absolute left-4 top-4 z-20 hidden md:block w-48 bg-slate-900/50 backdrop-blur rounded-lg border border-white/5 p-2">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
             <Trophy size={10} /> Chip Leaders
          </h3>
          <div className="space-y-1">
             {sortedPlayers.map((p, i) => (
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
          
          {/* Pattern */}
          <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/felt.png')] rounded-[80px] md:rounded-[180px] pointer-events-none"></div>
          
          <div className="absolute top-1/4 opacity-10 pointer-events-none text-white poker-font text-6xl tracking-widest font-bold">
            GEMINI
          </div>

          {/* Community Cards */}
          <div className="flex gap-2 sm:gap-4 mb-8 z-10 h-20 sm:h-32 items-center">
             {communityCards.map(c => (
               <VisualCard key={c.id} card={c} size="lg" className="shadow-2xl animate-in fade-in slide-in-from-top-4" />
             ))}
             {Array.from({ length: 5 - communityCards.length }).map((_, i) => (
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

          {/* Players */}
          {players.map((p, idx) => (
            <PlayerAvatar
              key={p.id}
              player={p}
              isActive={idx === activePlayerIdx && phase !== GamePhase.Showdown}
              isWinner={idx === winnerIdx}
              revealCards={phase === GamePhase.Showdown || (idx === activePlayerIdx && showCards)}
              positionStyle={getPlayerPosition(idx, players.length)}
            />
          ))}

        </div>
      </div>

      {/* Control Panel */}
      <div className="bg-slate-900 border-t border-white/10 p-4 z-30 pb-8 sm:pb-4">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-4 items-center justify-between">
          
          {/* Player Info / Peek */}
          <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-start">
             {phase !== GamePhase.Showdown && currentPlayer && (
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
          </div>

          {/* Actions */}
          {phase !== GamePhase.Showdown && currentPlayer && (
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