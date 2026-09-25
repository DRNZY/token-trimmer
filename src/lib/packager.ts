import fs from 'fs';
import path from 'path';
import { countTokens } from './tokenizer';
import { skeletonize } from './skeletonizer';
import { stripCodeNoise } from './stripper';
import { PackOptions, PackResult } from '../types';

const DEFAULT_MAX_TOKENS = 32000;
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.turbo', '.next', '.venv', 'venv', '.cache', 'coverage', '.expo'
]);

export function packDirectory(dirPath: string, options: PackOptions = {}): PackResult {
  const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
  const mode = options.mode || 'skeleton';
  const format = options.outputFormat || 'markdown';

  const files: { path: string; fullPath: string; content: string }[] = [];

  function walk(current: string) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.json', '.md'].includes(ext)) {
          if (entry.name === 'package-lock.json') continue; // skip bulky locks
          try {
            const content = fs.readFileSync(full, 'utf8');
            files.push({
              path: path.relative(dirPath, full),
              fullPath: full,
              content
            });
          } catch {
            // ignore
          }
        }
      }
    }
  }

  walk(dirPath);

  // Prioritize index/types/config files first
  files.sort((a, b) => {
    const aPri = a.path.includes('types') || a.path.includes('index') ? 1 : 0;
    const bPri = b.path.includes('types') || b.path.includes('index') ? 1 : 0;
    return bPri - aPri;
  });

  const packedFiles: { path: string; tokens: number; mode: string }[] = [];
  const outputSections: string[] = [];
  let currentTokenCount = 0;

  for (const f of files) {
    let processedContent = f.content;

    if (mode === 'skeleton') {
      processedContent = skeletonize(f.content, f.path);
    } else if (mode === 'stripped') {
      processedContent = stripCodeNoise(f.content);
    }

    const fileTokens = countTokens(processedContent);
    if (currentTokenCount + fileTokens > maxTokens) {
      break;
    }

    packedFiles.push({
      path: f.path,
      tokens: fileTokens,
      mode
    });
    currentTokenCount += fileTokens;

    if (format === 'markdown') {
      const ext = path.extname(f.path).slice(1) || 'text';
      outputSections.push(`### File: \`${f.path}\` (${fileTokens} tokens)\n\`\`\`${ext}\n${processedContent}\n\`\`\``);
    } else if (format === 'xml') {
      outputSections.push(`<file path="${f.path}">\n${processedContent}\n</file>`);
    } else {
      outputSections.push(JSON.stringify({ path: f.path, content: processedContent }));
    }
  }

  const packedContent = format === 'json' 
    ? `[${outputSections.join(',')}]` 
    : outputSections.join('\n\n');

  return {
    files: packedFiles,
    totalFiles: packedFiles.length,
    totalTokens: countTokens(packedContent),
    budgetTokens: maxTokens,
    packedContent
  };
}
