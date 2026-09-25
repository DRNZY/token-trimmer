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
          let source = args.code as string;
          const targetPath = (args.filePath as string) || 'index.ts';
          if (!source && args.filePath && fs.existsSync(args.filePath as string)) {
            source = fs.readFileSync(args.filePath as string, 'utf8');
          }
          if (!source) throw new Error('Either "code" or a valid "filePath" must be provided.');

          const skeleton = skeletonize(source, targetPath, {
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
          let text = args.text as string;
          if (!text && args.filePath && fs.existsSync(args.filePath as string)) {
            text = fs.readFileSync(args.filePath as string, 'utf8');
          }
          if (!text) text = '';

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
          const result = packDirectory(args.dirPath as string, {
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
