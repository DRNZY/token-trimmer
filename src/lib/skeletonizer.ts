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

export function skeletonize(source: string, filePath: string, options: SkeletonOptions = {}): string {
  if (filePath.endsWith('.py')) {
    return skeletonizePython(source);
  }
  return skeletonizeTypeScript(source, options);
}
