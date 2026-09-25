import { describe, it } from 'node:test';
import assert from 'node:assert';
import { countTokens, computeTokenStats } from '../src/lib/tokenizer';
import { skeletonizeTypeScript, skeletonizePython } from '../src/lib/skeletonizer';
import { stripCodeNoise } from '../src/lib/stripper';

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
