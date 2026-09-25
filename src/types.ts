export interface TokenStats {
  rawChars: number;
  rawTokens: number;
  optimizedChars: number;
  optimizedTokens: number;
  tokensSaved: number;
  reductionPercentage: number;
  costSavingsUSD?: {
    claudeOpus: number;
    gpt4o: number;
    geminiPro: number;
    geminiFlash: number;
  };
}

export interface SkeletonOptions {
  preserveDocstrings?: boolean;
  preserveTypeAliases?: boolean;
  preserveInterfaces?: boolean;
  preserveClassMembers?: boolean;
  stripPrivateMembers?: boolean;
}

export interface StripOptions {
  stripComments?: boolean;
  stripBlankLines?: boolean;
  stripLogs?: boolean;
  normalizeWhitespace?: boolean;
}

export interface FileOptimizationResult {
  filePath: string;
  originalContent: string;
  optimizedContent: string;
  stats: TokenStats;
}

export interface PackOptions {
  maxTokens?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  mode?: 'skeleton' | 'stripped' | 'full';
  outputFormat?: 'markdown' | 'xml' | 'json';
}

export interface PackResult {
  files: { path: string; tokens: number; mode: string }[];
  totalFiles: number;
  totalTokens: number;
  budgetTokens: number;
  packedContent: string;
}
