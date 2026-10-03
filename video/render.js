#!/usr/bin/env node
/**
 * Deterministic Frame-Accurate Renderer for Token Trimmer Launch Video.
 * Uses Howseen & Lottie Motion Design principles with Playwright/Puppeteer and ffmpeg.
 */

import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Load Puppeteer from Ecosystem-Video node_modules
import puppeteer from '/home/darnell/Projects/Ecosystem-Video/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME_PATH = '/home/darnell/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const HTML_PATH = path.join(HERE, 'index.html');
const OUT_DIR = path.join(HERE, 'out');
const OUT_MP4 = path.join(OUT_DIR, 'token_trimmer_launch.mp4');

const DURATION_S = 12.0;
const FPS = 60;
const TOTAL_FRAMES = Math.round(DURATION_S * FPS);
const WIDTH = 1920;
const HEIGHT = 1080;

async function main() {
  console.log(`[Token Trimmer Video] Starting render: ${DURATION_S}s @ ${FPS}fps (${TOTAL_FRAMES} frames)...`);
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(HTML_PATH).href, { waitUntil: 'load' });
  await page.waitForFunction('window.ready === true', { timeout: 30000 });

  // Spawn ffmpeg child process to stream raw frames directly into MP4
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-r', String(FPS),
    '-i', '-',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '16',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    OUT_MP4,
  ]);

  ffmpeg.stderr.on('data', (d) => {
    // console.log(d.toString());
  });

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const t = i / FPS;
    await page.evaluate((currT) => window.seek(currT), t);
    const screenshotBuffer = await page.screenshot({ type: 'png', omitBackground: false });
    
    ffmpeg.stdin.write(screenshotBuffer);

    if (i % 60 === 0 || i === TOTAL_FRAMES - 1) {
      console.log(`Rendered frame ${i + 1}/${TOTAL_FRAMES} (${((i + 1) / TOTAL_FRAMES * 100).toFixed(1)}%)`);
    }
  }

  ffmpeg.stdin.end();

  await new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });

  await browser.close();
  console.log(`[Token Trimmer Video] Render complete -> ${OUT_MP4}`);
}

main().catch((err) => {
  console.error('Render error:', err);
  process.exit(1);
});
