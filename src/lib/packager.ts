import fs from 'fs';
import path from 'path';
import { countTokens } from './tokenizer';
import { skeletonize } from './skeletonizer';
import { stripCodeNoise } from './stripper';
import { PackOptions, PackResult } from '../types';

const DEFAULT_MAX_TOKENS = 32000;
const PER_FILE_CAP_RATIO = 0.25;
const MIN_PER_FILE_CAP = 1500;
const CHARS_PER_TOKEN = 4;
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.turbo', '.next', '.venv', 'venv', '.cache', 'coverage', '.expo'
]);

const ADMITTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi',
  '.rs', '.go',
  '.svelte',
  '.sh', '.bash', '.zsh', '.ksh',
  '.json', '.jsonc', '.yaml', '.yml', '.toml',
  '.md', '.markdown'
]);

const SKIP_FILENAMES = new Set(['package-lock.json', 'bun.lockb', 'uv.lock', 'Cargo.lock']);

interface CandidateFile {
  path: string;
  fullPath: string;
  content: string;
  priority: number;
  size: number;
}

function priorityOf(relPath: string): number {
  const base = relPath.split(/[\\/]/).pop() || relPath;
  const name = base.toLowerCase();
  if (name === 'index.ts' || name === 'index.tsx' || name === 'index.js' || name === 'index.jsx') return 0;
  if (name.endsWith('.d.ts') || base.includes('types')) return 0;
  if (/^(?:tsconfig|jsconfig|package|config|schema|settings)\./.test(name)) return 1;
  if (base.includes('config') || base.includes('schema')) return 1;
  if (/\.(?:test|spec)\.[jt]sx?$/.test(name)) return 3;
  return 2;
}

function truncateToTokenLimit(content: string, capTokens: number): { text: string; tokens: number; truncated: boolean } {
  const full = countTokens(content);
  if (full <= capTokens) return { text: content, tokens: full, truncated: false };

  let charLimit = Math.max(1, Math.floor(capTokens * CHARS_PER_TOKEN));
  let sliced = content.slice(0, charLimit);
  let tokens = countTokens(sliced);
  let guard = 0;

  while (tokens > capTokens && charLimit > 0 && guard < 64) {
    charLimit = Math.floor(charLimit * 0.9);
    sliced = content.slice(0, charLimit);
    tokens = countTokens(sliced);
    guard++;
  }

  return { text: `${sliced}\n/* ... truncated at per-file cap of ${capTokens} tokens ... */`, tokens, truncated: true };
}

export function packDirectory(dirPath: string, options: PackOptions = {}): PackResult {
  const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
  const mode = options.mode || 'skeleton';
  const format = options.outputFormat || 'markdown';
  const perFileCap = Math.max(MIN_PER_FILE_CAP, Math.floor(maxTokens * PER_FILE_CAP_RATIO));

  const resolvedRoot = path.resolve(dirPath);
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }
  if (!fs.statSync(resolvedRoot).isDirectory()) {
    throw new Error(`Not a directory: ${dirPath}`);
  }

  const files: CandidateFile[] = [];
  const seen = new Set<string>();

  function matchesAny(rel: string, patterns?: string[]): boolean {
    if (!patterns || patterns.length === 0) return false;
    const normalized = rel.split(path.sep).join('/');
    return patterns.some((p) => {
      const rx = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$');
      return rx.test(normalized);
    });
  }

  function walk(current: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!ADMITTED_EXTENSIONS.has(ext)) continue;
        if (SKIP_FILENAMES.has(entry.name)) continue;

        const rel = path.relative(resolvedRoot, full);
        if (options.excludePatterns?.length && matchesAny(rel, options.excludePatterns)) continue;
        if (options.includePatterns?.length && !matchesAny(rel, options.includePatterns)) continue;
        if (seen.has(full)) continue;
        seen.add(full);

        try {
          const content = fs.readFileSync(full, 'utf8');
          files.push({
            path: rel,
            fullPath: full,
            content,
            priority: priorityOf(rel),
            size: content.length
          });
        } catch {
          continue;
        }
      }
    }
  }

  walk(resolvedRoot);

  files.sort((a, b) => (a.priority - b.priority) || (a.size - b.size) || a.path.localeCompare(b.path));

  const packedFiles: { path: string; tokens: number; mode: string; truncated: boolean }[] = [];
  const skippedFiles: { path: string; reason: string; tokens?: number }[] = [];
  const truncatedFiles: string[] = [];
  const outputSections: string[] = [];
  let currentTokenCount = 0;
  let rawTokens = 0;
  let contentTokens = 0;

  for (const f of files) {
    let processedContent = f.content;

    if (mode === 'skeleton') {
      processedContent = skeletonize(f.content, f.path);
    } else if (mode === 'stripped') {
      processedContent = stripCodeNoise(f.content);
    }

    const rawFileTokens = countTokens(f.content);
    const { text, tokens: fileTokens, truncated } = truncateToTokenLimit(processedContent, perFileCap);

    if (currentTokenCount + fileTokens > maxTokens) {
      skippedFiles.push({
        path: f.path,
        reason: truncated
          ? `exceeds remaining token budget (needs ${fileTokens}, ${Math.max(0, maxTokens - currentTokenCount)} left)`
          : 'would exceed total token budget',
        tokens: fileTokens
      });
      continue;
    }

    packedFiles.push({ path: f.path, tokens: fileTokens, mode, truncated });
    if (truncated) truncatedFiles.push(f.path);
    currentTokenCount += fileTokens;
    rawTokens += rawFileTokens;
    contentTokens += countTokens(processedContent);

    if (format === 'markdown') {
      const ext = path.extname(f.path).slice(1) || 'text';
      const note = truncated ? ` (truncated to per-file cap ${perFileCap})` : '';
      outputSections.push(`### File: \`${f.path}\` (${fileTokens} tokens)${note}\n\`\`\`${ext}\n${text}\n\`\`\``);
    } else if (format === 'xml') {
      outputSections.push(`<file path="${f.path}">\n${text}\n</file>`);
    } else {
      outputSections.push(JSON.stringify({ path: f.path, content: text }));
    }
  }

  const packedContent = format === 'json'
    ? `[${outputSections.join(',')}]`
    : outputSections.join('\n\n');

  const totalTokens = countTokens(packedContent);
  const tokensSaved = Math.max(0, rawTokens - contentTokens);
  const reductionPercentage = rawTokens > 0 ? Number(((tokensSaved / rawTokens) * 100).toFixed(2)) : 0;

  return {
    files: packedFiles,
    totalFiles: packedFiles.length,
    totalTokens,
    budgetTokens: maxTokens,
    packedContent,
    skippedFiles,
    truncatedFiles,
    rawTokens,
    contentTokens,
    tokensSaved,
    reductionPercentage
  };
}
