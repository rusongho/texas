import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GamePhase, Player, PlayerStatus, Card, LogEntry } from './types';
import { createDeck, shuffleDeck, evaluateHand } from './utils/pokerLogic';
import { VisualCard } from './components/VisualCard';
import { PlayerAvatar } from './components/PlayerAvatar';
import { Chips } from './components/Chips';
import { getGeminiCommentary } from './services/geminiService';
import { Users, Play, RotateCcw, MessageSquare } from 'lucide-react';

// --- Configuration ---
const STARTING_CHIPS = 1000;
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

  // Setup inputs
  const [newPlayerName, setNewPlayerName] = useState('');

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
      chips: STARTING_CHIPS,
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
    setPhase(GamePhase.PreFlop);
    startNewHand(0); // Start with first dealer
  };

  const startNewHand = (newDealerIdx: number) => {
    // Reset Deck
    const newDeck = shuffleDeck(createDeck());
    const resetPlayers = players.map(p => ({
      ...p,
      hand: [],
      bet: 0,
      status: p.chips > 0 ? PlayerStatus.Active : PlayerStatus.Busted,
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: false,
    })).filter(p => p.status !== PlayerStatus.Busted); // Ideally keep busted for view, but simplify logic

    // Check game over
    if (resetPlayers.length < 2) {
      addLog(`Game Over! ${resetPlayers[0].name} wins everything!`, 'winner');
      setPhase(GamePhase.Setup); // Simple restart
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
    addLog(`New Hand Started. Blinds ${SMALL_BLIND}/${BIG_BLIND}`, 'info');
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
    while(newPlayers[nextActive].status !== PlayerStatus.Active && newPlayers[nextActive].status !== PlayerStatus.AllIn) {
         nextActive = (nextActive + 1) % newPlayers.length;
    }
    setActivePlayerIdx(nextActive);

    // Deal community cards
    const currentDeck = [...deck];
    let newCommunity = [...communityCards];

    if (phase === GamePhase.PreFlop) {
      // Burn 1? Nah simplify.
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
    
    if (activePlayers.length === 0) return; // Should not happen

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
      const commentary = await getGeminiCommentary(communityCards, w, winDesc, pot);
      addLog(commentary, 'gemini');

      // Auto next hand after delay
      setTimeout(() => {
        startNewHand(dealerIdx + 1);
      }, 8000);
    }
  };

  const handleFold = () => {
    const newPlayers = [...players];
    newPlayers[activePlayerIdx].status = PlayerStatus.Folded;
    setPlayers(newPlayers);
    addLog(`${newPlayers[activePlayerIdx].name} folds.`, 'action');
    
    // Check if only one player remains
    const remaining = newPlayers.filter(p => p.status !== PlayerStatus.Folded && p.status !== PlayerStatus.Busted);
    if (remaining.length === 1) {
      // Immediate win
      const winner = remaining[0];
      const winIdx = newPlayers.findIndex(p => p.id === winner.id);
      setWinnerIdx(winIdx);
      newPlayers[winIdx].chips += pot + newPlayers.reduce((acc, p) => acc + p.bet, 0); // Add uncollected bets
      // Reset bets
      newPlayers.forEach(p => p.bet = 0);
      setPlayers(newPlayers);
      setPot(0);
      addLog(`${winner.name} wins by default!`, 'winner');
      setTimeout(() => {
        startNewHand(dealerIdx + 1);
      }, 4000);
      return;
    }
    
    moveToNextPlayer();
  };

  const handleCheckCall = () => {
    const player = players[activePlayerIdx];
    const amountToCall = currentBet - player.bet;
    const newPlayers = [...players];
    const pRef = newPlayers[activePlayerIdx];

    if (amountToCall > pRef.chips) {
      // All in
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
    const totalBet = currentBet + amount; // Raise ON TOP of current bet
    const needed = totalBet - pRef.bet;

    if (needed > pRef.chips) {
       // Treat as All in
       // Simplified logic for this demo
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
    setShowCards(false); // Hide cards for pass & play
    let nextIdx = (activePlayerIdx + 1) % players.length;
    let loopCount = 0;
    
    // Find next active player
    while (
      (players[nextIdx].status === PlayerStatus.Folded || players[nextIdx].status === PlayerStatus.Busted || players[nextIdx].status === PlayerStatus.AllIn) 
      && loopCount < players.length
    ) {
      nextIdx = (nextIdx + 1) % players.length;
      loopCount++;
    }

    // Check if round is over
    // Round is over if all active players have matched the current bet (or are all in)
    // AND we have circled back to the aggressor (simplified: check if bets match)
    
    const activePlayers = players.filter(p => p.status === PlayerStatus.Active);
    const allInPlayers = players.filter(p => p.status === PlayerStatus.AllIn);
    
    const allMatched = activePlayers.every(p => p.bet === currentBet);
    
    // A simplified heuristic: if we circled back to BB or Aggressor and everyone matched.
    // For this simplified engine, we check if everyone acted. 
    // We'll track "lastAggressor" in a real engine. Here, let's just check if bets equal.
    // If only 1 active player left (others all-in), just run out the cards.
    
    if (activePlayers.length === 0 || (activePlayers.length === 1 && allInPlayers.length > 0)) {
       // Everyone all in or 1 vs all in. Go to showdown mode.
       // Fast forward phases
       nextPhase();
       return;
    }

    // If everyone matched bets (and > 1 player), move phase?
    // This is tricky without a "lastAction" tracker.
    // Hack: If we pass the dealer and everyone matches, next phase.
    // Better: Counter of actions. 
    // Let's rely on manual "Check" if bet is 0.
    // If bet > 0, and player calls, if next player has also called equal amount...
    
    // Simplest logic for this demo: 
    // If the next person has ALREADY matched the bet this round, the round is likely over.
    // But they might have checked big blind.
    // Let's just create a button "Next Phase" if stuck? No, auto is better.
    // We will track "highestBet" and if everyone called it.
    
    // If the player we just moved to has `bet === currentBet` and is NOT the one who set it...
    // We need to track who raised last. 
    // Let's just implement: If all active players have `bet === currentBet` and we aren't opening the round...
    // This is complex. Let's assume standard flow:
    // If activePlayerIdx reaches the player who closed action.
    
    // Hack for Demo: If all active players have the same bet amount, Go Next Phase.
    // Exception: Preflop Big Blind option.
    const betsMatch = activePlayers.every(p => p.bet === currentBet);
    if (betsMatch && (phase !== GamePhase.PreFlop || currentBet > BIG_BLIND || activePlayers.every(p => p.bet > 0))) {
        // Delay slightly for UX
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
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600 mb-6 text-center poker-font">
            Gemini Poker Night
          </h1>
          <p className="text-slate-400 mb-8 text-center">
            Local Multiplayer &bull; No AI Required &bull; Gemini Commentary
          </p>
          
          <div className="space-y-4 mb-8">
            <div className="flex gap-2">
              <input
                type="text"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                placeholder="Enter player name"
                className="flex-1 bg-slate-900 border border-slate-600 rounded px-4 py-2 text-white focus:outline-none focus:border-yellow-500"
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
              />
              <button 
                onClick={addPlayer}
                disabled={players.length >= 9}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold transition-colors disabled:opacity-50"
              >
                Add
              </button>
            </div>
            
            <div className="bg-slate-900 rounded p-4 min-h-[100px]">
              <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">Lobby ({players.length}/9)</h3>
              <div className="flex flex-wrap gap-2">
                {players.map(p => (
                  <span key={p.id} className="bg-slate-700 text-white px-3 py-1 rounded-full text-sm flex items-center gap-2">
                    {p.name}
                    <button onClick={() => setPlayers(players.filter(x => x.id !== p.id))} className="text-red-400 hover:text-red-300">×</button>
                  </span>
                ))}
                {players.length === 0 && <span className="text-slate-600 italic text-sm">No players joined yet.</span>}
              </div>
            </div>
          </div>

          <button 
            onClick={startGame}
            disabled={players.length < 2}
            className="w-full bg-gradient-to-r from-yellow-500 to-orange-600 text-white font-bold py-4 rounded-xl text-xl shadow-lg hover:shadow-yellow-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Deal Cards
          </button>
        </div>
      </div>
    );
  }

  // --- Table Layout Calculations ---
  // Position 9 players in an ellipse
  const getPlayerPosition = (index: number, total: number) => {
    // We want the active player or "Me" to be bottom center usually, 
    // but in Hotseat, the "Current" player rotates. 
    // Let's just fix positions based on index.
    const angle = (index / total) * 2 * Math.PI + (Math.PI / 2); // Start bottom
    const xRadius = 40; // %
    const yRadius = 35; // %
    const x = 50 + xRadius * Math.cos(angle);
    const y = 45 + yRadius * Math.sin(angle);
    return { left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' };
  };

  const currentPlayer = players[activePlayerIdx];

  return (
    <div className="h-screen w-screen bg-[#0f172a] relative overflow-hidden flex flex-col">
      {/* Navbar / Stats */}
      <div className="h-14 bg-slate-900/90 border-b border-white/5 flex items-center justify-between px-6 z-20">
        <div className="flex items-center gap-4">
          <h2 className="poker-font text-xl text-yellow-500">Gemini Poker</h2>
          <div className="bg-slate-800 px-3 py-1 rounded-full text-xs text-slate-300 border border-slate-700">
             Blinds: {SMALL_BLIND}/{BIG_BLIND}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-300">
             <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
             Online (Local)
          </div>
        </div>
      </div>

      <div className="flex-1 relative flex items-center justify-center">
        {/* The Felt */}
        <div className="relative w-[90vw] h-[70vh] max-w-[1200px] bg-[#2e5c46] rounded-[200px] border-[16px] border-[#1a1a1a] shadow-[inset_0_0_100px_rgba(0,0,0,0.6)] flex flex-col items-center justify-center">
          
          {/* Felt Texture/Pattern */}
          <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/felt.png')] rounded-[180px] pointer-events-none"></div>
          
          {/* Logo on Table */}
          <div className="absolute top-1/4 opacity-10 pointer-events-none text-white poker-font text-6xl tracking-widest font-bold">
            GEMINI
          </div>

          {/* Community Cards */}
          <div className="flex gap-2 sm:gap-4 mb-8 z-10 h-24 sm:h-32">
             {communityCards.map(c => (
               <VisualCard key={c.id} card={c} size="lg" className="shadow-2xl" />
             ))}
             {Array.from({ length: 5 - communityCards.length }).map((_, i) => (
                <div key={i} className="w-16 h-24 sm:w-20 sm:h-32 border-2 border-white/10 rounded-md bg-black/10"></div>
             ))}
          </div>

          {/* Pot */}
          <div className="bg-black/40 backdrop-blur-md px-6 py-2 rounded-full border border-white/10 flex items-center gap-2 z-10">
             <span className="text-slate-300 text-xs uppercase tracking-wider">Total Pot</span>
             <Chips amount={pot} className="bg-transparent border-0 px-0" />
          </div>
          
          {/* Status Message */}
          {phase === GamePhase.Showdown && winnerIdx !== null && (
             <div className="absolute bottom-32 z-30 bg-black/80 text-yellow-400 px-6 py-3 rounded-xl border border-yellow-500/50 backdrop-blur font-bold text-xl animate-bounce">
                {players[winnerIdx].name} Wins!
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

      {/* Control Panel (Hotseat) */}
      <div className="h-auto bg-slate-900 border-t border-white/10 p-4 z-30">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-4 items-center justify-between">
          
          {/* Player Info / Toggle Reveal */}
          <div className="flex items-center gap-4">
             {phase !== GamePhase.Showdown && (
               <div className="flex flex-col">
                  <span className="text-slate-400 text-xs uppercase">Current Action</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-white">{currentPlayer.name}</span>
                    <button 
                      className={`text-xs px-2 py-1 rounded border ${showCards ? 'bg-red-500/20 border-red-500 text-red-300' : 'bg-slate-700 border-slate-600 text-slate-300'}`}
                      onMouseDown={() => setShowCards(true)}
                      onMouseUp={() => setShowCards(false)}
                      onMouseLeave={() => setShowCards(false)}
                      onTouchStart={() => setShowCards(true)}
                      onTouchEnd={() => setShowCards(false)}
                    >
                      Hold to Peek
                    </button>
                  </div>
               </div>
             )}
          </div>

          {/* Action Buttons */}
          {phase !== GamePhase.Showdown && (
            <div className="flex gap-2">
               <button 
                 onClick={handleFold}
                 className="bg-red-900/50 hover:bg-red-800 text-red-200 border border-red-800 px-6 py-3 rounded-lg font-bold uppercase tracking-wider transition-colors"
               >
                 Fold
               </button>
               
               <button 
                 onClick={handleCheckCall}
                 className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-lg font-bold uppercase tracking-wider transition-colors border border-slate-500"
               >
                 {currentPlayer.bet >= currentBet ? 'Check' : `Call ${currentBet - currentPlayer.bet}`}
               </button>

               <button 
                 onClick={() => handleRaise(BIG_BLIND)} // Simplified fixed raise
                 className="bg-yellow-600 hover:bg-yellow-500 text-white px-6 py-3 rounded-lg font-bold uppercase tracking-wider transition-colors border border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.3)]"
               >
                 Raise {BIG_BLIND}
               </button>
            </div>
          )}

          {/* Restart Button (Showdown only) */}
          {phase === GamePhase.Showdown && (
            <div className="flex gap-4">
               <div className="text-slate-400 text-sm animate-pulse">Next hand starting soon...</div>
            </div>
          )}
        </div>
      </div>

      {/* Game Log / Gemini Chat */}
      <div className="absolute top-16 right-4 w-72 h-48 sm:h-64 bg-slate-900/80 backdrop-blur border border-white/10 rounded-xl flex flex-col pointer-events-none sm:pointer-events-auto overflow-hidden">
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