import { encode } from 'gpt-tokenizer';
import { TokenStats } from '../types';

export function countTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  try {
    return encode(text).length;
  } catch {
    // Fallback: estimate 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}

export function computeTokenStats(originalText: string, optimizedText: string): TokenStats {
  const rawChars = originalText.length;
  const rawTokens = countTokens(originalText);
  const optimizedChars = optimizedText.length;
  const optimizedTokens = countTokens(optimizedText);

  const tokensSaved = Math.max(0, rawTokens - optimizedTokens);
  const reductionPercentage = rawTokens > 0 
    ? parseFloat(((tokensSaved / rawTokens) * 100).toFixed(2)) 
    : 0;

  // Cost estimates per million input tokens:
  // Claude Opus: $15.00 / M tokens
  // GPT-4o: $5.00 / M tokens
  // Gemini 2.5 Pro: $3.50 / M tokens
  // Gemini 2.5 Flash: $0.15 / M tokens
  const costSavingsUSD = {
    claudeOpus: parseFloat(((tokensSaved / 1_000_000) * 15.0).toFixed(6)),
    gpt4o: parseFloat(((tokensSaved / 1_000_000) * 5.0).toFixed(6)),
    geminiPro: parseFloat(((tokensSaved / 1_000_000) * 3.5).toFixed(6)),
    geminiFlash: parseFloat(((tokensSaved / 1_000_000) * 0.15).toFixed(6))
  };

  return {
    rawChars,
    rawTokens,
    optimizedChars,
    optimizedTokens,
    tokensSaved,
    reductionPercentage,
    costSavingsUSD
  };
}
