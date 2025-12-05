import { Rank, Suit } from "./types";

export const RANKS: Rank[] = [
  Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven,
  Rank.Eight, Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen, Rank.King, Rank.Ace
];

export const SUITS: Suit[] = [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades];

export const SUIT_COLORS: Record<Suit, string> = {
  [Suit.Hearts]: 'text-red-500',
  [Suit.Diamonds]: 'text-blue-500', // Standard 4-color deck usually makes diamonds blue
  [Suit.Clubs]: 'text-green-500',   // and clubs green for visibility
  [Suit.Spades]: 'text-slate-900',
};

// Map rank to value for comparison
export const RANK_VALUE: Record<Rank, number> = {
  [Rank.Two]: 2, [Rank.Three]: 3, [Rank.Four]: 4, [Rank.Five]: 5,
  [Rank.Six]: 6, [Rank.Seven]: 7, [Rank.Eight]: 8, [Rank.Nine]: 9,
  [Rank.Ten]: 10, [Rank.Jack]: 11, [Rank.Queen]: 12, [Rank.King]: 13, [Rank.Ace]: 14,
};
