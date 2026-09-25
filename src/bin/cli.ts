#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { countTokens, computeTokenStats } from '../lib/tokenizer';
import { skeletonize } from '../lib/skeletonizer';
import { stripCodeNoise } from '../lib/stripper';
import { packDirectory } from '../lib/packager';

const program = new Command();

program
  .name('token-trimmer')
  .description('⚡ High-Performance Token Optimizer, AST Skeletonizer & Prompt Compressor for Coding Agents')
  .version('1.0.0');

program
  .command('skeleton <target>')
  .description('Extract AST signatures & interfaces from a file or code string (70-85% token reduction)')
  .option('-o, --out <path>', 'Write output to file instead of stdout')
  .option('--no-docstrings', 'Strip JSDoc / docstrings as well')
  .action((target, options) => {
    let content = target;
    let filePath = 'snippet.ts';

    if (fs.existsSync(target)) {
      content = fs.readFileSync(target, 'utf8');
      filePath = target;
    }

    const skeleton = skeletonize(content, filePath, {
      preserveDocstrings: options.docstrings
    });
    const stats = computeTokenStats(content, skeleton);

    if (options.out) {
      fs.writeFileSync(options.out, skeleton, 'utf8');
      console.log(chalk.green(`✔ Wrote skeletonized code to: ${options.out}`));
    } else {
      console.log(skeleton);
    }

    console.error(chalk.bold.cyan(`\n📊 Token Savings:`));
    console.error(`  • Original Tokens:  ${chalk.red(stats.rawTokens.toLocaleString())}`);
    console.error(`  • Skeleton Tokens:  ${chalk.green(stats.optimizedTokens.toLocaleString())}`);
    console.error(`  • Tokens Saved:     ${chalk.bold.green(stats.tokensSaved.toLocaleString())} (${chalk.bold.green(`${stats.reductionPercentage}%`)} reduction)`);
    console.error(`  • Cost Savings/Req: ${chalk.dim(`$${stats.costSavingsUSD?.claudeOpus} (Claude Opus) | $${stats.costSavingsUSD?.geminiPro} (Gemini Pro)`)}\n`);
  });

program
  .command('strip <target>')
  .description('Strip noise, comments, logs, and redundant whitespace from code')
  .option('-o, --out <path>', 'Write output to file instead of stdout')
  .option('--no-logs', 'Do not strip console.log / print statements')
  .action((target, options) => {
    let content = target;
    if (fs.existsSync(target)) {
      content = fs.readFileSync(target, 'utf8');
    }

    const stripped = stripCodeNoise(content, {
      stripLogs: options.logs !== false
    });
    const stats = computeTokenStats(content, stripped);

    if (options.out) {
      fs.writeFileSync(options.out, stripped, 'utf8');
      console.log(chalk.green(`✔ Wrote stripped code to: ${options.out}`));
    } else {
      console.log(stripped);
    }

    console.error(chalk.bold.cyan(`\n📊 Token Savings:`));
    console.error(`  • Original Tokens:  ${chalk.red(stats.rawTokens.toLocaleString())}`);
    console.error(`  • Stripped Tokens:  ${chalk.green(stats.optimizedTokens.toLocaleString())}`);
    console.error(`  • Tokens Saved:     ${chalk.bold.green(stats.tokensSaved.toLocaleString())} (${chalk.bold.green(`${stats.reductionPercentage}%`)} reduction)\n`);
  });

program
  .command('count <target>')
  .description('Compute exact BPE tokens, character count, and LLM pricing estimates')
  .action((target) => {
    let content = target;
    let name = 'Raw Input Text';

    if (fs.existsSync(target)) {
      content = fs.readFileSync(target, 'utf8');
      name = target;
    }

    const tokens = countTokens(content);
    console.log(chalk.bold.cyan(`\n📊 Token Analysis for [${name}]:`));
    console.log(`  • BPE Token Count:   ${chalk.bold.green(tokens.toLocaleString())} tokens`);
    console.log(`  • Character Count:   ${chalk.white(content.length.toLocaleString())} characters`);
    console.log(`  • Estimated Cost (1k reqs):`);
    console.log(`      - Gemini 2.5 Flash:  ${chalk.green(`$${((tokens / 1_000_000) * 0.15 * 1000).toFixed(4)}`)}`);
    console.log(`      - Gemini 2.5 Pro:    ${chalk.green(`$${((tokens / 1_000_000) * 3.50 * 1000).toFixed(4)}`)}`);
    console.log(`      - Claude 3.5 Sonnet: ${chalk.green(`$${((tokens / 1_000_000) * 3.00 * 1000).toFixed(4)}`)}`);
    console.log(`      - Claude 3 Opus:     ${chalk.green(`$${((tokens / 1_000_000) * 15.00 * 1000).toFixed(4)}`)}\n`);
  });

program
  .command('pack <dir>')
  .description('Pack an entire directory into a token-budgeted prompt context file')
  .option('-m, --mode <mode>', 'Compression mode (skeleton, stripped, full)', 'skeleton')
  .option('-b, --budget <tokens>', 'Max token budget', '32000')
  .option('-o, --out <path>', 'Output file path', 'packed-context.md')
  .action((dir, options) => {
    const budget = parseInt(options.budget, 10);
    const result = packDirectory(dir, {
      maxTokens: budget,
      mode: options.mode as any,
      outputFormat: 'markdown'
    });

    fs.writeFileSync(options.out, result.packedContent, 'utf8');
    console.log(chalk.bold.green(`\n✔ Packed ${result.totalFiles} files into '${options.out}'`));
    console.log(`  • Total Tokens:   ${chalk.bold.cyan(result.totalTokens.toLocaleString())} / ${budget.toLocaleString()} budget`);
    console.log(`  • Compression:    ${chalk.yellow(options.mode.toUpperCase())}\n`);
  });

program.parse(process.argv);
