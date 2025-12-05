import { Card, Rank, Suit, HandEvaluation } from "../types";
import { RANKS, SUITS, RANK_VALUE } from "../constants";

// --- Deck Management ---
export const createDeck = (): Card[] => {
  const deck: Card[] = [];
  SUITS.forEach(suit => {
    RANKS.forEach(rank => {
      deck.push({ suit, rank, id: `${rank}-${suit}-${Math.random()}` });
    });
  });
  return deck;
};

export const shuffleDeck = (deck: Card[]): Card[] => {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
};

// --- Hand Evaluation (Simplified for Robustness) ---
// Returns a numerical score. Higher is better.
// 800+ Straight Flush, 700+ Quads, 600+ Full House, 500+ Flush, 
// 400+ Straight, 300+ Trips, 200+ Two Pair, 100+ Pair, 0+ High Card

export const evaluateHand = (holeCards: Card[], communityCards: Card[]): HandEvaluation => {
  const allCards = [...holeCards, ...communityCards];
  
  // Sort by Rank Value Descending
  allCards.sort((a, b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]);

  const flushSuit = getFlushSuit(allCards);
  const straightHigh = getStraightHigh(allCards);
  
  // 1. Straight Flush
  if (flushSuit && straightHigh) {
    // Check if the straight is in the flush suit
    const flushCards = allCards.filter(c => c.suit === flushSuit);
    const sfHigh = getStraightHigh(flushCards);
    if (sfHigh) return { score: 800 + sfHigh, rankName: "Straight Flush", bestFive: flushCards.slice(0, 5) }; // Approx
  }

  // 2. Four of a Kind
  const quads = getNOfAKind(allCards, 4);
  if (quads) return { score: 700 + RANK_VALUE[quads[0].rank], rankName: "Four of a Kind", bestFive: quads };

  // 3. Full House
  const trips = getNOfAKind(allCards, 3);
  if (trips) {
    const remaining = allCards.filter(c => c.rank !== trips[0].rank);
    const pair = getNOfAKind(remaining, 2);
    if (pair) return { score: 600 + RANK_VALUE[trips[0].rank], rankName: "Full House", bestFive: [...trips, ...pair] };
  }

  // 4. Flush
  if (flushSuit) {
    const flushCards = allCards.filter(c => c.suit === flushSuit);
    return { score: 500 + RANK_VALUE[flushCards[0].rank], rankName: "Flush", bestFive: flushCards.slice(0, 5) };
  }

  // 5. Straight
  if (straightHigh) {
    // Reconstruct straight cards (simplified)
    return { score: 400 + straightHigh, rankName: "Straight", bestFive: allCards.slice(0, 5) };
  }

  // 6. Three of a Kind
  if (trips) {
    const kickers = allCards.filter(c => c.rank !== trips[0].rank).slice(0, 2);
    return { score: 300 + RANK_VALUE[trips[0].rank], rankName: "Three of a Kind", bestFive: [...trips, ...kickers] };
  }

  // 7. Two Pair
  const pair1 = getNOfAKind(allCards, 2);
  if (pair1) {
    const remaining = allCards.filter(c => c.rank !== pair1[0].rank);
    const pair2 = getNOfAKind(remaining, 2);
    if (pair2) {
      const kicker = allCards.filter(c => c.rank !== pair1[0].rank && c.rank !== pair2[0].rank)[0];
      return { score: 200 + RANK_VALUE[pair1[0].rank], rankName: "Two Pair", bestFive: [...pair1, ...pair2, kicker] };
    }
    // 8. One Pair (Fallthrough from finding just one pair)
    const kickers = remaining.slice(0, 3);
    return { score: 100 + RANK_VALUE[pair1[0].rank], rankName: "Pair", bestFive: [...pair1, ...kickers] };
  }

  // 9. High Card
  return { score: RANK_VALUE[allCards[0].rank], rankName: "High Card", bestFive: allCards.slice(0, 5) };
};

// --- Helpers ---

function getFlushSuit(cards: Card[]): Suit | null {
  const counts: Record<string, number> = {};
  for (const c of cards) {
    counts[c.suit] = (counts[c.suit] || 0) + 1;
    if (counts[c.suit] >= 5) return c.suit;
  }
  return null;
}

function getStraightHigh(cards: Card[]): number | null {
  const uniqueValues = Array.from(new Set(cards.map(c => RANK_VALUE[c.rank]))).sort((a, b) => b - a);
  // Handle Ace low (A, 5, 4, 3, 2) -> 14, 5, 4, 3, 2
  if (uniqueValues.includes(14)) uniqueValues.push(1); // Treat Ace as 1 too

  let streak = 0;
  for (let i = 0; i < uniqueValues.length - 1; i++) {
    if (uniqueValues[i] - uniqueValues[i+1] === 1) {
      streak++;
      if (streak >= 4) return uniqueValues[i - 3]; // Return high card of straight
    } else {
      streak = 0;
    }
  }
  return null;
}

function getNOfAKind(cards: Card[], n: number): Card[] | null {
  const counts: Record<string, Card[]> = {};
  for (const c of cards) {
    if (!counts[c.rank]) counts[c.rank] = [];
    counts[c.rank].push(c);
  }
  for (const rank in counts) {
    if (counts[rank].length >= n) return counts[rank].slice(0, n);
  }
  return null;
}
