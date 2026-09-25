# token-trimmer

High-performance AST code skeletonizer, comment stripper, and context packer for LLMs.

## Overview

Token Trimmer reduces token consumption in large codebases by stripping whitespace, removing non-critical comments, and skeletonizing AST structures (function signatures, type definitions) so agents can inspect massive repositories within tight context budgets.

## Features

- **AST Skeletonization**: Extracts structural signatures while stripping implementation bodies.
- **Prompt Budget Packaging**: Packs repository context into token-optimized payloads.
- **MCP Server & CLI**: Runs as a standalone tool or as a Model Context Protocol (MCP) server.

## Installation

```bash
npm install
npm run build
```

## License

MIT
