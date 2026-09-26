import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { countTokens, computeTokenStats } from '../src/lib/tokenizer';
import { skeletonizeTypeScript, skeletonizePython, skeletonize } from '../src/lib/skeletonizer';
import { stripCodeNoise } from '../src/lib/stripper';
import { packDirectory } from '../src/lib/packager';
import { createTokenTrimmerMcpServer } from '../src/lib/server';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-trimmer-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('Token Trimmer Engine', () => {
  it('counts BPE tokens accurately', () => {
    const text = 'export function calculateTotal(price: number, taxRate: number): number';
    const tokens = countTokens(text);
    assert.ok(tokens > 5 && tokens < 25);
  });

  it('skeletonizes TypeScript interfaces, classes and functions omitting inner bodies', () => {
    const rawTs = `
import { User } from './types';

/**
 * User Profile Service
 */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  private cache: Map<string, User> = new Map();

  constructor(private db: any) {
    this.db = db;
  }

  public async getUser(id: string): Promise<UserProfile> {
    const raw = await this.db.query("SELECT * FROM users WHERE id = ?", id);
    if (!raw) throw new Error("User not found");
    // Some complex 50 lines of business logic
    const sanitized = { id: raw.id, name: raw.name, email: raw.email };
    return sanitized;
  }
}

export function formatGreeting(name: string): string {
  console.log("Formatting greeting for " + name);
  return \`Hello, \${name}!\`;
}
`;

    const skeleton = skeletonizeTypeScript(rawTs);
    assert.ok(skeleton.includes('export interface UserProfile'));
    assert.ok(skeleton.includes('export class UserService'));
    assert.ok(skeleton.includes('getUser(id: string): Promise<UserProfile> { /* ... */ }'));
    assert.ok(skeleton.includes('function formatGreeting(name: string): string { /* ... */ }'));
    assert.ok(!skeleton.includes('SELECT * FROM users')); // stripped body
    assert.ok(!skeleton.includes('Formatting greeting for')); // stripped body

    const stats = computeTokenStats(rawTs, skeleton);
    assert.ok(stats.reductionPercentage > 40);
  });

  it('skeletonizes Python functions and classes', () => {
    const rawPy = `
import os
import sys

class AudioEngine:
    def __init__(self, sample_rate: int = 44100):
        self.sample_rate = sample_rate
        self.buffer = []

    def process_frame(self, frame: bytes) -> bytes:
        # Complex DSP filter
        return frame
`;

    const skeleton = skeletonizePython(rawPy);
    assert.ok(skeleton.includes('class AudioEngine: ...'));
    assert.ok(skeleton.includes('def process_frame(self, frame: bytes) -> bytes: ...'));
    assert.ok(!skeleton.includes('Complex DSP filter'));
  });

  it('strips comments, debugging logs, and blank lines', () => {
    const raw = `
// Internal developer memo: fix this later
export function run() {
  console.log("Starting run...");
  const x = 1;


  console.debug("x is", x);
  return x;
}
`;

    const stripped = stripCodeNoise(raw, { stripLogs: true });
    assert.ok(!stripped.includes('Internal developer memo'));
    assert.ok(!stripped.includes('console.log'));
    assert.ok(!stripped.includes('console.debug'));
    assert.ok(stripped.includes('export function run()'));
  });
});

describe('Skeletonize per-extension dispatch', () => {
  it('preserves Go func declarations instead of mangling them as TypeScript', () => {
    const go = [
      'package main',
      '',
      'import "fmt"',
      '',
      '// Entry point does very important things',
      'func main() {',
      '\tfmt.Println("hello from go")',
      '}',
      '',
      'func helper(a int) int {',
      '\treturn a * 2',
      '}',
      ''
    ].join('\n');

    const out = skeletonize(go, 'main.go');
    assert.ok(out.includes('package main'), 'package clause preserved');
    assert.ok(out.includes('func main()'), 'func main preserved');
    assert.ok(out.includes('func helper(a int) int'), 'helper signature preserved');
    assert.ok(!out.includes('hello from go'), 'function body elided');
  });

  it('preserves Rust fn declarations', () => {
    const rs = [
      'use std::collections::HashMap;',
      '',
      'pub struct Engine {',
      '    rate: u32,',
      '}',
      '',
      'pub fn process(&self, frame: Vec<u8>) -> Vec<u8> {',
      '    let mut out = vec![0u8; frame.len()];',
      '    out',
      '}',
      ''
    ].join('\n');

    const out = skeletonize(rs, 'lib.rs');
    assert.ok(out.includes('use std::collections::HashMap;'));
    assert.ok(out.includes('pub struct Engine {'));
    assert.ok(out.includes('fn process'), 'rust fn signature preserved');
    assert.ok(!out.includes('let mut out'), 'body elided');
  });

  it('preserves markdown prose and elides fenced code bodies', () => {
    const md = [
      '# Project Title',
      '',
      'This project does a real thing that matters.',
      '',
      '```ts',
      'const secret = 1;',
      'const other = 2;',
      '```',
      '',
      '## Usage',
      '',
      'Run it like so.',
      ''
    ].join('\n');

    const out = skeletonize(md, 'README.md');
    assert.ok(out.includes('# Project Title'), 'heading preserved');
    assert.ok(out.includes('This project does a real thing'), 'prose preserved');
    assert.ok(out.includes('## Usage'), 'subheading preserved');
    assert.ok(!out.includes('const secret'), 'fenced body elided');
    assert.ok(out.includes('elided'));
  });

  it('preserves JSON keys and Svelte script blocks', () => {
    const json = JSON.stringify({ name: 'pkg', version: '1.0.0', longBlob: 'x'.repeat(500) }, null, 2);
    const out = skeletonize(json, 'package.json');
    assert.ok(out.includes('"name"'), 'json key preserved');
    assert.ok(out.includes('"version"'), 'json key preserved');
    assert.ok(out.includes('elided'), 'long value elided');

    const svelte = [
      '<script lang="ts">',
      '  export let items: string[] = [];',
      '  function add() { items = [...items, "x"]; }',
      '</script>',
      '',
      '<template>',
      '  <ul><li>lots of markup</li></ul>',
      '</template>',
      '',
      '<style>',
      '  .big { color: red; }',
      '</style>',
      ''
    ].join('\n');
    const svelteOut = skeletonize(svelte, 'Widget.svelte');
    assert.ok(svelteOut.includes('<script lang="ts">'), 'script tag preserved');
    assert.ok(svelteOut.includes('export let items'), 'script body preserved');
    assert.ok(!svelteOut.includes('lots of markup'), 'template body elided');
    assert.ok(!svelteOut.includes('color: red'), 'style body elided');
  });

  it('preserves shell function signatures', () => {
    const sh = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '# a comment that should go',
      'build() {',
      '  echo compiling a very long line of output here',
      '}',
      ''
    ].join('\n');
    const out = skeletonize(sh, 'build.sh');
    assert.ok(out.startsWith('#!/usr/bin/env bash'), 'shebang preserved');
    assert.ok(out.includes('set -euo pipefail'), 'set flags preserved');
    assert.ok(out.includes('build()'), 'function signature preserved');
    assert.ok(!out.includes('a comment that should go'), 'comment stripped');
    assert.ok(!out.includes('compiling a very long line'), 'body elided');
  });
});

describe('packDirectory', () => {
  const seed = (dir: string) => {
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export const x: number = 1;\nexport function main(): void { console.log("body"); }\n');
    fs.writeFileSync(path.join(dir, 'types.ts'), 'export interface User { id: string; name: string; }\n');
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }, null, 2));
    fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\nReal prose that must survive packing.\n');
    fs.writeFileSync(path.join(dir, 'main.go'), 'package main\n\nfunc main() {\n\tprintln("x")\n}\n');
    fs.writeFileSync(path.join(dir, 'build.sh'), '#!/usr/bin/env bash\nset -e\nbuild() {\n  echo hi\n}\n');
    fs.writeFileSync(path.join(dir, 'ignored.png'), 'not a text file');
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'junk.ts'), 'export const junk = 1;');
  };

  it('packs admitted files, skips ignored dirs and binary extensions, and reports reduction', () => {
    withTempDir((dir) => {
      seed(dir);
      const result = packDirectory(dir);

      const paths = result.files.map((f) => f.path);
      assert.ok(paths.includes('index.ts'));
      assert.ok(paths.includes('notes.md'));
      assert.ok(paths.includes('main.go'));
      assert.ok(paths.includes('build.sh'));
      assert.ok(!paths.some((p) => p.includes('node_modules')), 'node_modules excluded');
      assert.ok(!paths.some((p) => p.endsWith('.png')), 'non-admitted extension excluded');

      assert.ok(result.totalFiles === result.files.length);
      assert.ok(result.totalTokens > 0);
      assert.ok(result.totalTokens <= result.budgetTokens, 'stays within budget');
      assert.ok(result.contentTokens <= result.rawTokens, 'content-level reduction must not be negative');
      assert.ok(typeof result.reductionPercentage === 'number');
      assert.ok(Array.isArray(result.skippedFiles));
      assert.ok(Array.isArray(result.truncatedFiles));

      assert.ok(result.packedContent.includes('Real prose that must survive packing'), 'markdown prose survives');
      assert.ok(result.packedContent.includes('func main()'), 'go func survives packing');
    });
  });

  it('orders index/types files ahead of other sources', () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'zzz_impl.ts'), 'export function z(): void {}\n');
      fs.writeFileSync(path.join(dir, 'aaa_util.ts'), 'export function a(): void {}\n');
      fs.writeFileSync(path.join(dir, 'index.ts'), 'export const i = 1;\n');
      fs.writeFileSync(path.join(dir, 'types.ts'), 'export type T = string;\n');

      const result = packDirectory(dir);
      const head = result.files.slice(0, 2).map((f) => f.path).sort();
      assert.deepStrictEqual(head, ['index.ts', 'types.ts'], 'priority files packed first');
    });
  });

  it('truncates an oversized file to the per-file cap and keeps packing the rest instead of aborting', () => {
    withTempDir((dir) => {
      const hugeBody = Array.from({ length: 4000 }, (_, i) => `export const v${i} = "padding padding padding padding padding";`).join('\n');
      fs.writeFileSync(path.join(dir, 'huge.ts'), hugeBody);
      fs.writeFileSync(path.join(dir, 'small_a.ts'), 'export const a = 1;\n');
      fs.writeFileSync(path.join(dir, 'small_b.ts'), 'export const b = 2;\n');

      const result = packDirectory(dir, { maxTokens: 4000, mode: 'full' });

      assert.ok(result.truncatedFiles.includes('huge.ts'), 'oversized file marked truncated');
      const huge = result.files.find((f) => f.path === 'huge.ts');
      assert.ok(huge, 'oversized file is still packed, not dropped');
      assert.ok(huge!.truncated === true);
      assert.ok(huge!.tokens <= Math.max(1500, Math.floor(4000 * 0.25)), 'respects per-file cap');
      assert.ok(result.packedContent.includes('truncated at per-file cap'), 'truncation is disclosed in output');

      const packedPaths = result.files.map((f) => f.path);
      assert.ok(packedPaths.includes('small_a.ts') || packedPaths.includes('small_b.ts'),
        'packing continued past the oversized file rather than breaking out of the loop');
    });
  });

  it('truncates in skeleton mode when the skeleton itself is still oversized', () => {
    withTempDir((dir) => {
      const members = Array.from({ length: 3000 }, (_, i) => `  field${i}: string;`).join('\n');
      fs.writeFileSync(path.join(dir, 'wide.ts'), `export interface Wide {\n${members}\n}\n`);
      fs.writeFileSync(path.join(dir, 'after.ts'), 'export const after = 1;\n');

      const result = packDirectory(dir, { maxTokens: 4000, mode: 'skeleton' });
      assert.ok(result.truncatedFiles.includes('wide.ts'), 'wide interface truncated');
      const packedPaths = result.files.map((f) => f.path);
      assert.ok(packedPaths.includes('after.ts'), 'packing continued after the truncated file');
    });
  });

  it('records skippedFiles with reasons when the budget is exhausted', () => {
    withTempDir((dir) => {
      for (let i = 0; i < 12; i++) {
        fs.writeFileSync(
          path.join(dir, `mod_${String(i).padStart(2, '0')}.ts`),
          Array.from({ length: 200 }, (_, j) => `export const pad${j} = "aaaa bbbb cccc dddd";`).join('\n')
        );
      }
      const result = packDirectory(dir, { maxTokens: 3000, mode: 'full' });
      assert.ok(result.skippedFiles.length > 0, 'some files skipped');
      assert.ok(result.totalTokens <= 3000, 'never exceeds budget');
      for (const s of result.skippedFiles) {
        assert.ok(s.path && s.reason, 'each skip records a path and a reason');
      }
    });
  });

  it('throws a real error for a nonexistent directory', () => {
    assert.throws(
      () => packDirectory('/definitely/not/a/real/dir/xyz'),
      /Directory not found/
    );
  });
});

describe('MCP tool error handling', () => {
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const server = createTokenTrimmerMcpServer();
    const captured: any[] = [];
    const originalEmit = (server as any)._requestHandlers?.get?.('tools/call');
    assert.ok(originalEmit, 'tools/call handler registered');
    const handler = originalEmit;
    const response = await handler({
      method: 'tools/call',
      params: { name, arguments: args }
    }, { signal: new AbortController().signal, sendNotification: async () => {}, sendRequest: async () => ({}) });
    captured.push(response);
    return captured[0];
  };

  it('token_skeletonize returns a real error for a nonexistent filePath instead of defaulting to index.ts', async () => {
    const res = await callTool('token_skeletonize', { filePath: '/no/such/file/does-not-exist.ts' });
    assert.ok(res.isError === true, 'response is flagged as an error');
    const text = res.content.map((c: any) => c.text).join('\n');
    assert.match(text, /File not found/);
    assert.match(text, /does-not-exist\.ts/);
  });

  it('token_skeletonize errors when neither code nor filePath is given', async () => {
    const res = await callTool('token_skeletonize', {});
    assert.ok(res.isError === true);
    assert.match(res.content.map((c: any) => c.text).join('\n'), /must be provided/);
  });

  it('token_count returns a real error instead of silently reporting 0 tokens', async () => {
    const res = await callTool('token_count', { filePath: '/no/such/file/missing.md' });
    assert.ok(res.isError === true);
    assert.match(res.content.map((c: any) => c.text).join('\n'), /File not found/);

    const empty = await callTool('token_count', {});
    assert.ok(empty.isError === true);
    assert.match(empty.content.map((c: any) => c.text).join('\n'), /must be provided/);
  });

  it('token_pack_context errors on a nonexistent dirPath', async () => {
    const res = await callTool('token_pack_context', { dirPath: '/no/such/dir/here' });
    assert.ok(res.isError === true);
    assert.match(res.content.map((c: any) => c.text).join('\n'), /Directory not found/);
  });
});
