import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { countTokens, computeTokenStats } from './tokenizer';
import { skeletonize } from './skeletonizer';
import { stripCodeNoise } from './stripper';
import { packDirectory } from './packager';

function resolveReadableFile(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    throw new Error(`File not readable: ${filePath}`);
  }
  return resolved;
}

export function createTokenTrimmerMcpServer(): Server {
  const server = new Server(
    {
      name: 'token-trimmer',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  const TOOLS: Tool[] = [
    {
      name: 'token_skeletonize',
      description: 'Extract AST signatures and interfaces from a code snippet or file, saving 70%-85% tokens',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Raw source code string' },
          filePath: { type: 'string', description: 'Optional relative or absolute file path to read from' },
          preserveDocstrings: { type: 'boolean', description: 'Whether to keep JSDoc/docstrings (default: true)' }
        }
      }
    },
    {
      name: 'token_strip',
      description: 'Strip redundant comments, trailing whitespace, and debugging logs from code',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Raw source code' },
          stripLogs: { type: 'boolean', description: 'Strip console.log / print statements (default: true)' }
        },
        required: ['code']
      }
    },
    {
      name: 'token_count',
      description: 'Compute exact BPE token counts and cost estimates for a text or file',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text content to tokenize' },
          filePath: { type: 'string', description: 'File path to measure' }
        }
      }
    },
    {
      name: 'token_pack_context',
      description: 'Pack a directory into an optimized context prompt adhering to a token budget',
      inputSchema: {
        type: 'object',
        properties: {
          dirPath: { type: 'string', description: 'Directory path to pack' },
          maxTokens: { type: 'number', description: 'Maximum token budget (default: 32000)' },
          mode: { type: 'string', enum: ['skeleton', 'stripped', 'full'], description: 'Compression mode' }
        },
        required: ['dirPath']
      }
    }
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case 'token_skeletonize': {
          let source = typeof args.code === 'string' ? args.code : undefined;
          const targetPath = typeof args.filePath === 'string' ? args.filePath : undefined;

          if (source === undefined && targetPath === undefined) {
            throw new Error('Either "code" or "filePath" must be provided.');
          }

          if (source === undefined) {
            const stat = resolveReadableFile(targetPath as string);
            source = fs.readFileSync(stat, 'utf8');
          }

          const effectivePath = targetPath ?? 'snippet.ts';
          const skeleton = skeletonize(source, effectivePath, {
            preserveDocstrings: args.preserveDocstrings !== false
          });
          const stats = computeTokenStats(source, skeleton);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  skeleton,
                  stats: {
                    rawTokens: stats.rawTokens,
                    optimizedTokens: stats.optimizedTokens,
                    tokensSaved: stats.tokensSaved,
                    reductionPercentage: `${stats.reductionPercentage}%`
                  }
                }, null, 2)
              }
            ]
          };
        }

        case 'token_strip': {
          const stripped = stripCodeNoise(args.code as string, {
            stripLogs: args.stripLogs !== false
          });
          const stats = computeTokenStats(args.code as string, stripped);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  stripped,
                  stats: {
                    rawTokens: stats.rawTokens,
                    optimizedTokens: stats.optimizedTokens,
                    tokensSaved: stats.tokensSaved,
                    reductionPercentage: `${stats.reductionPercentage}%`
                  }
                }, null, 2)
              }
            ]
          };
        }

        case 'token_count': {
          const hasText = typeof args.text === 'string' && args.text.length > 0;
          const hasPath = typeof args.filePath === 'string' && args.filePath.length > 0;

          if (!hasText && !hasPath) {
            throw new Error('Either "text" or "filePath" must be provided.');
          }

          let text: string;
          if (hasText) {
            text = args.text as string;
          } else {
            text = fs.readFileSync(resolveReadableFile(args.filePath as string), 'utf8');
          }

          const tokens = countTokens(text);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  tokens,
                  characterCount: text.length,
                  wordCount: text.split(/\s+/).filter(Boolean).length,
                  estimatedCostUSD: {
                    claudeOpus: parseFloat(((tokens / 1_000_000) * 15.0).toFixed(6)),
                    gpt4o: parseFloat(((tokens / 1_000_000) * 5.0).toFixed(6)),
                    geminiPro: parseFloat(((tokens / 1_000_000) * 3.5).toFixed(6)),
                    geminiFlash: parseFloat(((tokens / 1_000_000) * 0.15).toFixed(6))
                  }
                }, null, 2)
              }
            ]
          };
        }

        case 'token_pack_context': {
          if (typeof args.dirPath !== 'string' || args.dirPath.length === 0) {
            throw new Error('"dirPath" is required and must be a non-empty string.');
          }
          const result = packDirectory(args.dirPath, {
            maxTokens: args.maxTokens as number,
            mode: args.mode as any
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  totalFiles: result.totalFiles,
                  totalTokens: result.totalTokens,
                  budgetTokens: result.budgetTokens,
                  rawTokens: result.rawTokens,
                  tokensSaved: result.tokensSaved,
                  reductionPercentage: `${result.reductionPercentage}%`,
                  truncatedFiles: result.truncatedFiles,
                  skippedFiles: result.skippedFiles,
                  files: result.files,
                  packedContent: result.packedContent
                }, null, 2)
              }
            ]
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Error: ${err?.message || String(err)}` }],
        isError: true
      };
    }
  });

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createTokenTrimmerMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
