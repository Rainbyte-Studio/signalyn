/**
 * Signalyn Server-Side Gemini API Client
 * 
 * Provides centralized, server-only access to @google/genai.
 * NEVER exposed to the frontend / client bundle.
 */

import { GoogleGenAI } from '@google/genai';

export const isGeminiConfigured = (): boolean => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  return Boolean(apiKey && apiKey.trim().length > 5);
};

export const getGeminiClient = (): GoogleGenAI => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please ensure GEMINI_API_KEY is provided in the server environment.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// Primary: gemini-3.1-flash-lite (high throughput, instant response); Fallback: gemini-3.8-flash
export const GEMINI_ANALYSIS_MODEL = 'gemini-3.1-flash-lite';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.8-flash';
export const SIGNALYN_ANALYSIS_VERSION = 'signalyn-analysis-v1';
