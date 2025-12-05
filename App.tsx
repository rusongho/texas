import React, { useState, useEffect, useRef } from 'react';
import { GamePhase, Player, PlayerStatus, Card, LogEntry, NetworkMessage, SyncedState, MessageType } from './types';
import { createDeck, shuffleDeck, evaluateHand } from './utils/pokerLogic';
import { VisualCard } from './components/VisualCard';
import { PlayerAvatar } from './components/PlayerAvatar';
import { Chips } from './components/Chips';
import { getGeminiCommentary } from './services/geminiService';
import { MessageSquare, Trophy, Timer, Plus, Play, UserPlus, Wifi, Copy, Share2, LogOut } from 'lucide-react';
import Peer, { DataConnection } from 'peerjs';

// --- Configuration ---
const BIG_BLIND = 20;
const SMALL_BLIND = 10;
const MAX_SEATS = 9;

const App: React.FC = () => {
  // --- Network State ---
  const [view, setView] = useState<'LOBBY' | 'GAME'>('LOBBY');
  const [isHost, setIsHost] = useState(false);
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [hostPeerId, setHostPeerId] = useState<string>('');
  const [joinInputId, setJoinInputId] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'>('DISCONNECTED');
  const [copyFeedback, setCopyFeedback] = useState(false);

  // PeerJS Refs
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<DataConnection[]>([]); // For Host: list of clients
  const hostConnectionRef = useRef<DataConnection | null>(null); // For Client: connection to host

  // --- Game State (Synced) ---
  const [phase, setPhase] = useState<GamePhase>(GamePhase.Setup);
  const [players, setPlayers] = useState<Player[]>([]);
  const [deck, setDeck] = useState<Card[]>([]); // Host only (not synced fully, only community)
  const [communityCards, setCommunityCards] = useState<Card[]>([]);
  const [pot, setPot] = useState(0);
  const [currentBet, setCurrentBet] = useState(0);
  const [activePlayerIdx, setActivePlayerIdx] = useState(0); 
  const [dealerIdx, setDealerIdx] = useState(0); 
  const [winnerIdx, setWinnerIdx] = useState<number | null>(null); 
  const [gameLogs, setGameLogs] = useState<LogEntry[]>([]);
  const [autoNextTimer, setAutoNextTimer] = useState<number | null>(null);
  
  // --- Local UI State ---
  const [showCards, setShowCards] = useState(false);
  const [isSitModalOpen, setIsSitModalOpen] = useState(false);
  const [selectedSeatIdx, setSelectedSeatIdx] = useState<number | null>(null);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [buyInAmount, setBuyInAmount] = useState(1000);

  const logContainerRef = useRef<HTMLDivElement>(null);

  // Prevent accidental refresh
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // --- Networking: Initialization ---

  const initPeer = (id: string | null = null) => {
    const peer = new Peer(id || undefined);
    
    peer.on('open', (id) => {
      setMyPeerId(id);
      setConnectionStatus(isHost ? 'CONNECTED' : 'CONNECTING'); // Host is connected to themselves essentially
      if (!isHost && hostPeerId) {
        connectToHost(peer, hostPeerId);
      }
    });

    peer.on('connection', (conn) => {
      // HOST LOGIC: Receive connection from client
      if (isHost) {
        connectionsRef.current.push(conn);
        conn.on('data', (data: any) => handleHostReceiveData(data, conn.peer));
        conn.on('close', () => {
           // Handle disconnect? For now just log
           addLog(`Player disconnected: ${conn.peer}`, 'info');
           connectionsRef.current = connectionsRef.current.filter(c => c.peer !== conn.peer);
        });
        // Send initial state immediately
        sendStateToClient(conn);
      }
    });

    peer.on('error', (err) => {
      console.error(err);
      alert("Network error: " + err.type);
      setConnectionStatus('DISCONNECTED');
    });

    peerRef.current = peer;
  };

  const createGame = () => {
    setIsHost(true);
    setView('GAME');
    initPeer();
  };

  const joinGame = () => {
    if (!joinInputId) return;
    setIsHost(false);
    setHostPeerId(joinInputId);
    setView('GAME');
    initPeer(); 
  };

  const connectToHost = (peer: Peer, hostId: string) => {
    const conn = peer.connect(hostId);
    hostConnectionRef.current = conn;

    conn.on('open', () => {
      setConnectionStatus('CONNECTED');
      // Request state?
    });

    conn.on('data', (data: any) => handleClientReceiveData(data));
    conn.on('close', () => {
      setConnectionStatus('DISCONNECTED');
      alert("Disconnected from host.");
      setView('LOBBY');
    });
  };

  // --- Networking: Data Handling ---

  const broadcastState = (overrideState?: Partial<SyncedState>) => {
    if (!isHost) return;

    // We strip sensitive data (deck) and only send what's needed.
    // Ideally, for active game, we shouldn't send opponents' hole cards.
    // BUT for simplicity in this "friends" app, we send everything and just hide it in UI.
    // A more secure app would sanitize `hand` for other players.
    
    // Let's implement basic sanitization: Mask hands of others?
    // Actually, `Player` type has `hand`. If we mask it, the UI logic needs to handle `undefined` cards.
    // For this version, we will TRUST the client (it's a friendly app) and send full state,
    // but the UI only reveals what it should.
    
    const currentState: SyncedState = {
      players,
      communityCards,
      pot,
      currentBet,
      dealerIdx,
      activePlayerIdx,
      phase,
      gameLogs,
      winnerIdx,
      autoNextTimer,
      lastUpdate: Date.now(),
      ...overrideState
    };

    connectionsRef.current.forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'SYNC_STATE', payload: currentState });
      }
    });
  };

  // Trigger broadcast whenever critical state changes (Debouncing could be good but we'll try direct)
  useEffect(() => {
    if (isHost && view === 'GAME') {
      broadcastState();
    }
  }, [players, communityCards, pot, currentBet, phase, winnerIdx, activePlayerIdx, gameLogs, autoNextTimer]);


  const handleClientReceiveData = (data: NetworkMessage) => {
    if (data.type === 'SYNC_STATE') {
      const state: SyncedState = data.payload;
      setPlayers(state.players);
      setCommunityCards(state.communityCards);
      setPot(state.pot);
      setCurrentBet(state.currentBet);
      setDealerIdx(state.dealerIdx);
      setActivePlayerIdx(state.activePlayerIdx);
      setPhase(state.phase);
      setGameLogs(state.gameLogs);
      setWinnerIdx(state.winnerIdx);
      setAutoNextTimer(state.autoNextTimer);
    }
  };

  const handleHostReceiveData = (data: NetworkMessage, senderPeerId: string) => {
    if (data.type === 'ACTION_SIT') {
      const { seat, name, buyIn } = data.payload;
      performSitDown(seat, name, buyIn, senderPeerId);
    } else if (data.type === 'ACTION_GAME') {
      const { action, amount } = data.payload;
      // Validate turn
      const actingPlayer = players[activePlayerIdx];
      if (actingPlayer && actingPlayer.id === senderPeerId) {
         if (action === 'FOLD') handleFold();
         if (action === 'CHECK_CALL') handleCheckCall();
         if (action === 'RAISE') handleRaise(amount);
      }
    } else if (data.type === 'ACTION_STAND') {
       standUp(senderPeerId);
    }
  };

  const sendClientAction = (type: MessageType, payload: any) => {
    if (hostConnectionRef.current?.open) {
      hostConnectionRef.current.send({ type, payload });
    }
  };

  const sendStateToClient = (conn: DataConnection) => {
     // Explicit send for new connections
     const currentState: SyncedState = {
      players,
      communityCards,
      pot,
      currentBet,
      dealerIdx,
      activePlayerIdx,
      phase,
      gameLogs,
      winnerIdx,
      autoNextTimer,
      lastUpdate: Date.now()
    };
    conn.send({ type: 'SYNC_STATE', payload: currentState });
  };


  // --- Game Logic (HOST ONLY) ---

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setGameLogs(prev => [...prev, { id: Date.now().toString() + Math.random(), message, type, timestamp: Date.now() }]);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [gameLogs]);

  // --- Action Handlers (Routing) ---

  const handleSeatClick = (seatIdx: number) => {
    if (phase !== GamePhase.Setup) return;
    // Check if seat taken
    if (players.some(p => p.seatIndex === seatIdx)) return;

    // Check if I am already seated
    const mySeat = players.find(p => p.id === myPeerId);
    if (mySeat) {
        // Maybe allow moving seats later, for now block
        alert("You are already seated!");
        return;
    }

    setSelectedSeatIdx(seatIdx);
    setNewPlayerName(`Player ${seatIdx + 1}`);
    setBuyInAmount(1000);
    setIsSitModalOpen(true);
  };

  const submitSitDown = () => {
    if (!newPlayerName.trim() || selectedSeatIdx === null) return;
    
    if (isHost) {
      performSitDown(selectedSeatIdx, newPlayerName, buyInAmount, myPeerId);
    } else {
      sendClientAction('ACTION_SIT', { seat: selectedSeatIdx, name: newPlayerName, buyIn: buyInAmount });
    }
    setIsSitModalOpen(false);
  };

  const performSitDown = (seatIdx: number, name: string, buyIn: number, playerId: string) => {
    if (players.some(p => p.seatIndex === seatIdx)) return; // Race condition check

    const newPlayer: Player = {
      id: playerId,
      name: name,
      chips: buyIn,
      bet: 0,
      hand: [],
      status: PlayerStatus.Active,
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: false,
      seatIndex: seatIdx,
    };
    
    const updatedPlayers = [...players, newPlayer].sort((a, b) => a.seatIndex - b.seatIndex);
    setPlayers(updatedPlayers);
    addLog(`${newPlayer.name} sat down.`, 'info');
  };

  const standUp = (playerId: string) => {
    if (phase !== GamePhase.Setup) return;
    
    if (isHost) {
        setPlayers(prev => prev.filter(p => p.id !== playerId));
    } else {
        if (playerId === myPeerId) {
            sendClientAction('ACTION_STAND', {});
        }
    }
  };

  const triggerGameAction = (action: 'FOLD' | 'CHECK_CALL' | 'RAISE', amount?: number) => {
    if (isHost) {
        if (action === 'FOLD') handleFold();
        if (action === 'CHECK_CALL') handleCheckCall();
        if (action === 'RAISE') handleRaise(amount || 0);
    } else {
        sendClientAction('ACTION_GAME', { action, amount });
    }
  };

  // --- Core Game Engine (Host Only - Copied from previous logic but refined) ---

  const startGame = () => {
    if (!isHost) return;
    if (players.length < 2) return;
    setPhase(GamePhase.PreFlop);
    startNewHand(0, players);
  };

  const startNewHand = (newDealerIdx: number, currentPlayers: Player[]) => {
    setAutoNextTimer(null);
    const newDeck = shuffleDeck(createDeck());
    
    const resetPlayers = currentPlayers.map(p => ({
      ...p,
      hand: [],
      bet: 0,
      status: p.chips > 0 ? PlayerStatus.Active : PlayerStatus.Busted,
      isDealer: false,
      isSmallBlind: false,
      isBigBlind: false,
    }));

    const activeCount = resetPlayers.filter(p => p.status !== PlayerStatus.Busted).length;
    if (activeCount < 2) {
      const winner = resetPlayers.find(p => p.status !== PlayerStatus.Busted);
      addLog(`Game Over! ${winner?.name || 'Everyone'} wins!`, 'winner');
      setPhase(GamePhase.Setup);
      setPlayers(resetPlayers);
      return;
    }

    let actualDealerIdx = newDealerIdx % resetPlayers.length;
    while(resetPlayers[actualDealerIdx].status === PlayerStatus.Busted) {
        actualDealerIdx = (actualDealerIdx + 1) % resetPlayers.length;
    }

    resetPlayers.forEach(p => { p.isDealer = false; p.isSmallBlind = false; p.isBigBlind = false; });
    resetPlayers[actualDealerIdx].isDealer = true;

    let sbIdx = (actualDealerIdx + 1) % resetPlayers.length;
    while(resetPlayers[sbIdx].status === PlayerStatus.Busted) sbIdx = (sbIdx + 1) % resetPlayers.length;
    
    let bbIdx = (sbIdx + 1) % resetPlayers.length;
    while(resetPlayers[bbIdx].status === PlayerStatus.Busted) bbIdx = (bbIdx + 1) % resetPlayers.length;
    
    if (activeCount === 2) {
       resetPlayers[actualDealerIdx].isSmallBlind = true;
       resetPlayers[sbIdx].isBigBlind = true;
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
    setShowCards(false); // Host resets local view

    let firstActionIdx = (resetPlayers.findIndex(p => p.isBigBlind) + 1) % resetPlayers.length;
    while(resetPlayers[firstActionIdx].status === PlayerStatus.Busted) {
        firstActionIdx = (firstActionIdx + 1) % resetPlayers.length;
    }
    
    setActivePlayerIdx(firstActionIdx);
    setPhase(GamePhase.PreFlop);
    addLog(`New Hand. Blinds ${SMALL_BLIND}/${BIG_BLIND}`, 'info');
  };

  const nextPhase = () => {
    const newPlayers = [...players];
    newPlayers.forEach(p => { p.bet = 0; });
    setPlayers(newPlayers);
    setCurrentBet(0);
    
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
          // Need to be careful with closure here in interval, relying on state might be stale
          // But since we are Host and component re-renders, we should trigger startNewHand via effect or ref
          // Ideally use a useEffect to watch timer reaching 0.
        }
      }, 1000);
    }
  };

  // Watch for timer (Host only logic helper)
  useEffect(() => {
     if (isHost && autoNextTimer === 0) {
        startNewHand(dealerIdx + 1, players);
     }
  }, [autoNextTimer, isHost]);

  const handleFold = () => {
    const newPlayers = [...players];
    const folderName = newPlayers[activePlayerIdx].name;
    newPlayers[activePlayerIdx].status = PlayerStatus.Folded;
    setPlayers(newPlayers);
    addLog(`${folderName} folds.`, 'action');
    
    const remaining = newPlayers.filter(p => p.status !== PlayerStatus.Folded && p.status !== PlayerStatus.Busted);
    if (remaining.length === 1) {
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
        if (countdown <= 0) clearInterval(timer);
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

  // --- Render Helpers ---

  const getSeatPosition = (seatIndex: number) => {
    const totalSeats = MAX_SEATS;
    const angle = (seatIndex / totalSeats) * 2 * Math.PI + (Math.PI / 2);
    const xRadius = 44; 
    const yRadius = 40;
    const x = 50 + xRadius * Math.cos(angle);
    const y = 48 + yRadius * Math.sin(angle);
    return { left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' };
  };

  // Identify "My" player
  const myPlayer = players.find(p => p.id === myPeerId);
  const currentPlayer = players[activePlayerIdx];
  const isMyTurn = currentPlayer?.id === myPeerId;
  const sortedPlayers = [...players].sort((a, b) => b.chips - a.chips);


  // --- LOBBY VIEW ---
  if (view === 'LOBBY') {
    return (
      <div className="h-screen w-screen bg-[#0f172a] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800 rounded-2xl shadow-2xl p-8 border border-white/10 space-y-8">
          <div className="text-center">
            <h1 className="poker-font text-4xl text-yellow-500 mb-2">Gemini Poker</h1>
            <p className="text-slate-400">Play Texas Hold'em with friends online.</p>
          </div>

          <div className="space-y-4">
            <button 
              onClick={createGame}
              className="w-full bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all transform hover:scale-105"
            >
              <Plus size={24} /> Create New Room
            </button>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-600"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-slate-800 text-slate-500">Or Join Existing</span>
              </div>
            </div>

            <div className="flex gap-2">
               <input 
                 value={joinInputId}
                 onChange={(e) => setJoinInputId(e.target.value)}
                 placeholder="Enter Room Code"
                 className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 text-white focus:border-yellow-500 outline-none font-mono"
               />
               <button 
                 onClick={joinGame}
                 disabled={!joinInputId}
                 className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-6 rounded-lg font-bold"
               >
                 Join
               </button>
            </div>
          </div>
          
          <div className="text-center text-xs text-slate-500">
             Powered by Gemini AI • P2P Multiplayer
          </div>
        </div>
      </div>
    );
  }

  // --- GAME VIEW ---

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
                      onKeyDown={(e) => e.key === 'Enter' && submitSitDown()}
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
                   <button onClick={submitSitDown} className="flex-1 py-2 rounded bg-yellow-600 hover:bg-yellow-500 text-white font-bold">Join Table</button>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* Navbar & Room Info */}
      <div className="h-14 bg-slate-900/90 border-b border-white/5 flex items-center justify-between px-4 sm:px-6 z-20 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="poker-font text-xl text-yellow-500 hidden sm:block">Gemini Poker</h2>
          
          {/* Room Code Display */}
          <div className="flex items-center gap-2 bg-black/30 px-3 py-1.5 rounded-full border border-white/10">
             <div className={`w-2 h-2 rounded-full ${connectionStatus === 'CONNECTED' ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></div>
             <span className="text-xs text-slate-400 hidden sm:inline">Room:</span>
             <code className="font-mono font-bold text-white text-sm">{isHost ? myPeerId : hostPeerId}</code>
             <button 
                onClick={() => {
                   navigator.clipboard.writeText(isHost ? myPeerId : hostPeerId);
                   setCopyFeedback(true);
                   setTimeout(() => setCopyFeedback(false), 2000);
                }}
                className="text-slate-400 hover:text-white ml-1 transition-colors"
                title="Copy Room Code"
             >
                {copyFeedback ? <span className="text-green-500 text-xs">Copied</span> : <Copy size={14} />}
             </button>
          </div>
        </div>
        
        {autoNextTimer !== null && (
          <div className="flex items-center gap-2 text-yellow-400 font-bold animate-pulse text-sm">
            <Timer size={16} />
            Next hand in {autoNextTimer}s
          </div>
        )}

        <div className="flex items-center gap-3">
             <button onClick={() => { if(confirm("Leave game?")) window.location.reload() }} className="text-slate-400 hover:text-red-400">
                <LogOut size={18} />
             </button>
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

          {/* Start Button (Host Only) */}
          {isHost && phase === GamePhase.Setup && players.length >= 2 && (
             <div className="absolute z-50">
               <button 
                 onClick={startGame}
                 className="flex items-center gap-2 bg-gradient-to-r from-yellow-500 to-orange-600 text-white text-lg font-bold px-8 py-3 rounded-full shadow-lg hover:scale-105 transition-transform animate-pulse"
               >
                 <Play fill="currentColor" size={20} /> Deal Cards
               </button>
             </div>
          )}
          
          {phase === GamePhase.Setup && players.length < 2 && (
             <div className="absolute top-1/3 text-white/50 text-sm font-bold bg-black/20 px-4 py-1 rounded-full backdrop-blur text-center">
                Waiting for {2 - players.length} more players...<br/>
                <span className="text-xs font-normal">Share Room Code to invite</span>
             </div>
          )}

          {/* Community Cards */}
          <div className="flex gap-2 sm:gap-4 mb-8 z-10 h-20 sm:h-32 items-center">
             {communityCards.map(c => (
               <VisualCard key={c.id} card={c} size="lg" className="shadow-2xl animate-in fade-in slide-in-from-top-4" />
             ))}
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
          {phase === GamePhase.Showdown && winnerIdx !== null && players[winnerIdx] && (
             <div className="absolute bottom-24 sm:bottom-32 z-40 bg-black/90 text-yellow-400 px-8 py-4 rounded-xl border border-yellow-500/50 backdrop-blur font-bold text-2xl animate-bounce shadow-[0_0_50px_rgba(234,179,8,0.3)] text-center">
                {players[winnerIdx].name} Wins!
             </div>
          )}

          {/* Seats */}
          {Array.from({ length: MAX_SEATS }).map((_, i) => {
             const seatedPlayer = players.find(p => p.seatIndex === i);
             const style = getSeatPosition(i);
             const playerArrayIndex = players.findIndex(p => p.seatIndex === i);
             
             // Logic to determine if we show cards
             // 1. Showdown? Yes.
             // 2. Is it ME? Yes.
             // 3. Is it Winner? Yes.
             const isMe = seatedPlayer?.id === myPeerId;
             const shouldReveal = phase === GamePhase.Showdown || (isMe && showCards);

             return (
               <React.Fragment key={i}>
                 {seatedPlayer ? (
                   <PlayerAvatar
                      player={seatedPlayer}
                      isActive={playerArrayIndex === activePlayerIdx && phase !== GamePhase.Setup && phase !== GamePhase.Showdown}
                      isWinner={playerArrayIndex === winnerIdx}
                      revealCards={shouldReveal}
                      positionStyle={style}
                      canStandUp={phase === GamePhase.Setup && (isHost || isMe)} // Host can kick, player can leave
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
                    {myPlayer && (
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
                    )}
                  </div>
               </div>
             )}
          </div>

          {/* Actions - Only visible if it is MY TURN */}
          {phase !== GamePhase.Setup && phase !== GamePhase.Showdown && isMyTurn && (
            <div className="flex gap-2 w-full md:w-auto animate-in slide-in-from-bottom-5">
               <button 
                 onClick={() => triggerGameAction('FOLD')}
                 className="flex-1 md:flex-none bg-red-900/50 hover:bg-red-800 text-red-200 border border-red-800 px-4 sm:px-6 py-3 rounded-lg font-bold uppercase tracking-wider transition-colors text-sm sm:text-base"
               >
                 Fold
               </button>
               
               <button 
                 onClick={() => triggerGameAction('CHECK_CALL')}
                 className="flex-1 md:flex-none bg-slate-700 hover:bg-slate-600 text-white px-4 sm:px-6 py-3 rounded-lg font-bold uppercase tracking-wider transition-colors border border-slate-500 text-sm sm:text-base"
               >
                 {currentPlayer.bet >= currentBet ? 'Check' : 'Call'}
               </button>

               <button 
                 onClick={() => triggerGameAction('RAISE', BIG_BLIND)}
                 className="flex-1 md:flex-none bg-yellow-600 hover:bg-yellow-500 text-white px-4 sm:px-6 py-3 rounded-lg font-bold uppercase tracking-wider transition-colors border border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.3)] text-sm sm:text-base"
               >
                 Raise
               </button>
            </div>
          )}
          {phase !== GamePhase.Setup && phase !== GamePhase.Showdown && !isMyTurn && (
              <div className="text-slate-500 italic text-sm">Waiting for {currentPlayer?.name}...</div>
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