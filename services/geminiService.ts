import { GoogleGenAI } from "@google/genai";
import { Card, Player } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getGeminiCommentary = async (
  communityCards: Card[],
  winner: Player,
  winDescription: string,
  potSize: number
): Promise<string> => {
  try {
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
