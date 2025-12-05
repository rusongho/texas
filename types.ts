export enum Suit {
  Hearts = '♥',
  Diamonds = '♦',
  Clubs = '♣',
  Spades = '♠',
}

export enum Rank {
  Two = '2', Three = '3', Four = '4', Five = '5',
  Six = '6', Seven = '7', Eight = '8', Nine = '9',
  Ten = '10', Jack = 'J', Queen = 'Q', King = 'K', Ace = 'A',
}

export interface Card {
  suit: Suit;
  rank: Rank;
  id: string; // Unique ID for React keys
}

export enum GamePhase {
  Setup = 'SETUP',
  PreFlop = 'PREFLOP',
  Flop = 'FLOP',
  Turn = 'TURN',
  River = 'RIVER',
  Showdown = 'SHOWDOWN',
}

export enum PlayerStatus {
  Active = 'ACTIVE',
  Folded = 'FOLDED',
  AllIn = 'ALL_IN',
  Busted = 'BUSTED',
}

export interface Player {
  id: string;
  name: string;
  chips: number;
  bet: number; // Current round bet
  hand: Card[];
  status: PlayerStatus;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  seatIndex: number; // 0-8 fixed position at the table
}

export interface HandEvaluation {
  score: number;
  rankName: string; // "Full House", "High Card"
  bestFive: Card[];
}

export interface LogEntry {
  id: string;
  message: string;
  type: 'info' | 'action' | 'winner' | 'gemini';
  timestamp: number;
}