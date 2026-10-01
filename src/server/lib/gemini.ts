import { GoogleGenAI } from '@google/genai';

export type GeminiClient = GoogleGenAI;

/** A Gemini client, or null when no real API key is configured. Read per call so a late-loaded .env is honoured. */
export function createGeminiClient(env: NodeJS.ProcessEnv = process.env): GeminiClient | null {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 50_000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}
