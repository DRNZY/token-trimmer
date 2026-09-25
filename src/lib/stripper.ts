import { StripOptions } from '../types';

export function stripCodeNoise(source: string, options: StripOptions = {}): string {
  let cleaned = source;

  // Strip license comment blocks at the top (e.g. /* Copyright ... */ or // Copyright ...)
  cleaned = cleaned.replace(/^\/\*[\s\S]*?(?:copyright|license|mit|apache)[\s\S]*?\*\/\s*/i, '');
  cleaned = cleaned.replace(/^(?:\/\/.*?(?:copyright|license|mit|apache).*\n)+/i, '');

  if (options.stripComments !== false) {
    // Strip single line comments that are purely internal notes
    cleaned = cleaned.replace(/^\s*\/\/(?!\s*@ts-|\s*eslint-|\s*prettier-).*$/gm, '');
  }

  if (options.stripLogs) {
    // Strip console.log / print statements
    cleaned = cleaned.replace(/^\s*console\.(?:log|debug|info|trace)\(.*?\);?\s*$/gm, '');
    cleaned = cleaned.replace(/^\s*print\(.*?\)\s*$/gm, '');
  }

  // Strip multiple consecutive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Strip trailing whitespace
  cleaned = cleaned.split('\n').map(l => l.trimEnd()).join('\n');

  return cleaned.trim();
}
