# token-trimmer (ARCHIVED)

> **NOTICE**: This repository is archived and superseded by **[ContextVM](https://github.com/DRNZY/contextvm)** (`cvm`).
> ContextVM includes all AST skeletonization features from token-trimmer along with SmartCrusher JSON reduction, log squashing, CCR vault caching, multi-agent session branching, and a transparent reverse proxy.

---

AST skeletonizer and context budget packer for LLM prompts.

## What it does

Strips function bodies, implementation details, and extraneous comments from source files while keeping type definitions and signatures intact. This lets coding agents read large codebases within fixed context windows.

## Setup

```bash
npm install
npm run build
```

## Migration

Please migrate to [ContextVM](https://github.com/DRNZY/contextvm):

```bash
npm install -g contextvm
# or
npx cvm --help
```

## License

MIT License. Copyright (c) 2026 Darnell Dijksteel.
