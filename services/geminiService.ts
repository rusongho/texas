import { GoogleGenAI } from "@google/genai";
import { Card, Player } from "../types";

// We initialize lazily to avoid top-level "process is not defined" errors in browser environments during initial load.
const getAIClient = () => {
  // @ts-ignore - Process env is replaced by build tools or handled by the environment
  const apiKey = process.env.API_KEY; 
  if (!apiKey) {
    console.warn("Gemini API Key is missing.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const getGeminiCommentary = async (
  communityCards: Card[],
  winner: Player,
  winDescription: string,
  potSize: number
): Promise<string> => {
  try {
    const ai = getAIClient();
    if (!ai) return `Congratulations ${winner.name} on the big win!`;

    const cardStr = communityCards.map(c => `${c.rank}${c.suit}`).join(' ');
    const winnerHandStr = winner.hand.map(c => `${c.rank}${c.suit}`).join(' ');
    
    const prompt = `
      You are a witty, charismatic, high-stakes poker commentator in a casino.
      The hand just ended. 
      Community Cards: [${cardStr}].
      Winner: ${winner.name} won a pot of ${potSize} chips with ${winDescription} (Hand: ${winnerHandStr}).
      
      Give a short, punchy, 1-2 sentence commentary on the win. 
      Be funny or impressed. Do not explain rules, just react.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "Unbelievable hand!";
  } catch (error) {
    console.error("Gemini commentary failed", error);
    return `Congratulations ${winner.name} on the big win!`;
  }
};