import { SkeletonOptions } from '../types';

export function skeletonizeTypeScript(source: string, options: SkeletonOptions = {}): string {
  const lines = source.split('\n');
  const output: string[] = [];

  let inBlockComment = false;
  let inInterfaceOrType = false;
  let inClass = false;
  let classBraceDepth = 0;
  let typeBraceDepth = 0;
  let currentDocstring: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Handle block comments & docstrings
    if (trimmed.startsWith('/**') || trimmed.startsWith('/*')) {
      inBlockComment = true;
      if (options.preserveDocstrings !== false && trimmed.startsWith('/**')) {
        currentDocstring.push(line);
      }
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (inBlockComment) {
      if (options.preserveDocstrings !== false) {
        currentDocstring.push(line);
      }
      if (trimmed.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }

    // Skip single line comments
    if (trimmed.startsWith('//')) {
      continue;
    }

    // Handle imports & exports
    if (trimmed.startsWith('import ') || trimmed.startsWith('import type ') || trimmed.startsWith('export * from')) {
      output.push(line);
      continue;
    }

    // Handle interfaces, type aliases, enums
    if (/^export\s+(?:interface|type|enum)\s+/.test(trimmed) || /^(?:interface|type|enum)\s+/.test(trimmed)) {
      if (currentDocstring.length > 0) {
        output.push(...currentDocstring);
        currentDocstring = [];
      }
      output.push(line);
      if (line.includes('{')) {
        inInterfaceOrType = true;
        typeBraceDepth += (line.match(/\{/g) || []).length;
        typeBraceDepth -= (line.match(/\}/g) || []).length;
      }
      continue;
    }

    if (inInterfaceOrType) {
      output.push(line);
      typeBraceDepth += (line.match(/\{/g) || []).length;
      typeBraceDepth -= (line.match(/\}/g) || []).length;
      if (typeBraceDepth <= 0) {
        inInterfaceOrType = false;
        typeBraceDepth = 0;
      }
      continue;
    }

    // Handle class start
    if (/^(?:export\s+)?(?:abstract\s+)?class\s+/.test(trimmed)) {
      if (currentDocstring.length > 0) {
        output.push(...currentDocstring);
        currentDocstring = [];
      }
      output.push(line.replace(/\{.*$/, '{'));
      inClass = true;
      classBraceDepth = 1;
      continue;
    }

    if (inClass) {
      // Check if this line closes the class
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      
      // If we see a method signature at the class level
      const isMethod = /^\s*(?:public|private|protected|async|static|readonly|\*|\s)*(?:get|set\s+|constructor|[a-zA-Z0-9_$]+)\s*\(/.test(line);
      const isField = /^\s*(?:public|private|protected|readonly|static)\s+[a-zA-Z0-9_$]+(?::\s*[^=;]+)?\s*;?$/.test(trimmed);

      if (isMethod) {
        const fullSig = line.replace(/\{.*$/, '').trim();
        const indent = line.match(/^\s*/)?.[0] || '  ';
        output.push(`${indent}${fullSig} { /* ... */ }`);
      } else if (isField) {
        output.push(line);
      }

      classBraceDepth += opens - closes;
      if (classBraceDepth <= 0) {
        output.push('}');
        inClass = false;
        classBraceDepth = 0;
      }
      continue;
    }

    // Handle standalone functions
    if (/^(?:export\s+)?(?:async\s+)?function\s+/.test(trimmed)) {
      if (currentDocstring.length > 0) {
        output.push(...currentDocstring);
        currentDocstring = [];
      }
      const fullSig = line.replace(/\{.*$/, '').trim();
      output.push(`${fullSig} { /* ... */ }`);
      continue;
    }

    // Handle const arrow functions
    if (/^(?:export\s+)?const\s+[a-zA-Z0-9_$]+\s*(?::\s*[^=]+)?\s*=\s*(?:async\s*)?(?:\([^\)]*\)|[a-zA-Z0-9_$]+)\s*(?::\s*[^=]+)?\s*=>/.test(trimmed)) {
      if (currentDocstring.length > 0) {
        output.push(...currentDocstring);
        currentDocstring = [];
      }
      const fullSig = line.replace(/(?:=>\s*\{?.*|=.*)$/, '').trim();
      output.push(`${fullSig} = (/* ... */) => { /* ... */ };`);
      continue;
    }

    currentDocstring = [];
  }

  return output.filter((l, idx, arr) => {
    if (l.trim() === '' && arr[idx - 1]?.trim() === '') return false;
    return true;
  }).join('\n');
}

export function skeletonizePython(source: string): string {
  const lines = source.split('\n');
  const output: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
      output.push(line);
      continue;
    }

    if (trimmed.startsWith('class ') || /^(?:async\s+)?def\s+/.test(trimmed)) {
      output.push(line.replace(/:\s*$/, ': ...'));
      continue;
    }

    if (trimmed.startsWith('@')) {
      output.push(line);
      continue;
    }
  }

  return output.join('\n');
}

export function skeletonizeRust(source: string): string {
  const lines = source.split('\n');
  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('//!') || trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('#[') || trimmed.startsWith('#!')) {
      output.push(line);
      continue;
    }
    if (/^(?:pub(?:\([^)]*\))?\s+)?(?:use|mod|extern\s+crate)\b/.test(trimmed)) {
      output.push(line);
      continue;
    }
    if (/^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type|union|const\s+static)\b/.test(trimmed)) {
      output.push(line.replace(/\s*\{\s*$/, ' {'));
      continue;
    }
    const fnMatch = line.match(/^(\s*)(pub(?:\([^)]*\))?\s+)?(async\s+)?(?:unsafe\s+)?(extern\s+"[^"]*"\s+)?fn\s+([A-Za-z0-9_]+)/);
    if (fnMatch) {
      const indent = fnMatch[1];
      const sigEnd = line.indexOf('{');
      const sig = sigEnd >= 0 ? line.slice(0, sigEnd) : line;
      output.push(`${indent}${sig.trim()} { /* ... */ }`);
      const next = lines[i + 1]?.trim() ?? '';
      if (!next.startsWith('}')) i++;
      continue;
    }
    if (/^(?:impl|trait)\b/.test(trimmed) && line.includes('{')) {
      output.push(line.replace(/\s*\{\s*$/, ' {'));
      continue;
    }
  }

  return output.join('\n');
}

export function skeletonizeGo(source: string): string {
  const lines = source.split('\n');
  const output: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('//')) continue;
    if (/^package\s+\w+$/.test(trimmed)) {
      output.push(line);
      continue;
    }
    if (trimmed === 'import (') {
      output.push(line);
      continue;
    }
    if (trimmed === ')') {
      output.push(line);
      continue;
    }
    if (/^import\s+(?:[\w.]+\s+)?"[^"]+"$/.test(trimmed)) {
      output.push(line);
      continue;
    }
    if (trimmed.startsWith('type ') || trimmed.startsWith('const ') || trimmed.startsWith('var ')) {
      output.push(line);
      continue;
    }
    if (trimmed.startsWith('func ') || line.startsWith('func ')) {
      const braceIdx = line.indexOf('{');
      if (braceIdx >= 0) {
        const sig = line.slice(0, braceIdx).trimEnd();
        const hasBody = /\{\s*$/.test(line);
        output.push(hasBody ? `${sig} { /* ... */ }` : sig);
      } else {
        output.push(line);
      }
      continue;
    }
  }

  return output.join('\n');
}

export function skeletonizeSvelte(source: string, options: SkeletonOptions = {}): string {
  const lines = source.split('\n');
  const output: string[] = [];
  let skippingBlock: 'template' | 'style' | null = null;
  let blockDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (skippingBlock) {
      if (trimmed.includes(`</${skippingBlock}>`)) {
        output.push(`</${skippingBlock}>`);
        skippingBlock = null;
        blockDepth = 0;
      } else if (trimmed === `<${skippingBlock}>` || trimmed.startsWith(`<${skippingBlock} `)) {
        blockDepth++;
      }
      continue;
    }

    if (trimmed === '<template>' || trimmed.startsWith('<template>')) {
      output.push('<template>');
      output.push('  { /* ... */ }');
      skippingBlock = 'template';
      continue;
    }
    if (trimmed === '<style>' || trimmed.startsWith('<style')) {
      output.push(trimmed);
      skippingBlock = 'style';
      continue;
    }
    if (trimmed.startsWith('<script')) {
      output.push(line);
      continue;
    }
    if (trimmed === '</script>') {
      output.push(line);
      continue;
    }
    if (trimmed.startsWith('<!--')) continue;

    output.push(line);
  }

  if (options.preserveDocstrings === false) {
    return output.join('\n');
  }
  return output.join('\n');
}

export function skeletonizeMarkdown(source: string): string {
  const lines = source.split('\n');
  const output: string[] = [];
  let inFence = false;
  let fenceLang = '';
  let fenceStart = 0;

  const flushFence = (end: number) => {
    const elided = Math.max(0, end - fenceStart);
    output.push('```' + fenceLang);
    output.push(`/* ... ${elided} line${elided === 1 ? '' : 's'} elided ... */`);
    output.push('```');
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*(\S*)/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceLang = fence[2] || '';
        fenceStart = i;
      } else {
        inFence = false;
        flushFence(i);
        fenceLang = '';
      }
      continue;
    }
    if (!inFence) output.push(line);
  }

  if (inFence) flushFence(lines.length);

  return output.join('\n');
}

export function skeletonizeShell(source: string): string {
  const lines = source.split('\n');
  const output: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('#!')) {
      output.push(line);
      continue;
    }
    if (trimmed.startsWith('#')) continue;
    if (/^(?:set\s+-[euxoa]+|source\s|\.\s|export\s+[A-Z_]+=)/.test(trimmed)) {
      output.push(line);
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)\s*\{/.test(line)) {
      output.push(line.replace(/\s*\{\s*$/, ' {'));
      output.push('  # ...');
      continue;
    }
  }

  return output.join('\n');
}

export function skeletonizeData(source: string): string {
  const lines = source.split('\n');
  const output: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      if (trimmed.startsWith('#')) continue;
      output.push(line);
      continue;
    }

    const kv = line.match(/^(\s*(?:-\s*)?)("?[^:#]+"?\s*:\s*)(.*?)(,?)\s*$/);
    if (kv) {
      const value = kv[3];
      if (value.length > 80) {
        output.push(`${kv[1]}${kv[2]}"/* ... ${value.length} chars elided ... */"${kv[4]}`);
      } else {
        output.push(line);
      }
      continue;
    }
    output.push(line);
  }

  return output.join('\n');
}

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const PY_EXTENSIONS = ['.py', '.pyi'];
const RUST_EXTENSIONS = ['.rs'];
const GO_EXTENSIONS = ['.go'];
const SVELTE_EXTENSIONS = ['.svelte'];
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'];
const SHELL_EXTENSIONS = ['.sh', '.bash', '.zsh', '.ksh'];
const DATA_EXTENSIONS = ['.json', '.jsonc', '.yaml', '.yml', '.toml'];

function extensionOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function skeletonize(source: string, filePath: string, options: SkeletonOptions = {}): string {
  const ext = extensionOf(filePath);

  if (TS_EXTENSIONS.includes(ext)) return skeletonizeTypeScript(source, options);
  if (PY_EXTENSIONS.includes(ext)) return skeletonizePython(source);
  if (RUST_EXTENSIONS.includes(ext)) return skeletonizeRust(source);
  if (GO_EXTENSIONS.includes(ext)) return skeletonizeGo(source);
  if (SVELTE_EXTENSIONS.includes(ext)) return skeletonizeSvelte(source, options);
  if (MARKDOWN_EXTENSIONS.includes(ext)) return skeletonizeMarkdown(source);
  if (SHELL_EXTENSIONS.includes(ext)) return skeletonizeShell(source);
  if (DATA_EXTENSIONS.includes(ext)) return skeletonizeData(source);

  return source;
}
