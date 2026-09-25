# token-trimmer

AST skeletonizer and context budget packer for LLM prompts.

## What it does

Strips function bodies, implementation details, and extraneous comments from source files while keeping type definitions and signatures intact. This lets coding agents read large codebases within fixed context windows.

## Setup

```bash
npm install
npm run build
```

## License

MIT License. Copyright (c) 2026 Darnell Dijksteel.
