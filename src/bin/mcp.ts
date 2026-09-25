#!/usr/bin/env node

import { runMcpServer } from '../lib/server';

runMcpServer().catch((err) => {
  console.error('Fatal error running token-trimmer MCP server:', err);
  process.exit(1);
});
