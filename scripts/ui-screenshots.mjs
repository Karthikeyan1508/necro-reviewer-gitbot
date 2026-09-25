/**
 * Demo harness: drives the real NecroReview UI (localhost:4000) in headless
 * Chrome and captures every screen for the README.
 *
 *   node --import tsx scripts/ui-screenshots.mjs   (or: node scripts/ui-screenshots.mjs)
 *
 * Requirements: bridge (:4001) and UI (:4000) running; Chrome or Edge installed.
 * Override the browser with CHROME_PATH.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { launch } from 'puppeteer-core';

const CHROME =
  process.env.CHROME_PATH ||
  (existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
const OUT = existsSync('docs/screenshots') ? 'docs/screenshots' : 'docs\\screenshots';
const BASE = process.env.UI_BASE || 'http://localhost:4000';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1400, height: 900 },
  args: ['--no-sandbox', '--disable-gpu'],
});

async function shot(page, name) {
  await sleep(800);
  const path = `${OUT}/${name}`;
  await page.screenshot({ path, fullPage: true });
  console.log(`[shot] ${name} -> ${statSync(path).size} bytes`);
}

function waitBody(page, pattern, timeoutMs = 120000) {
  // RegExp objects are not JSON-serializable through waitForFunction args,
  // so we pass the pattern as a string and build the regex inside the page.
  const source = pattern instanceof RegExp ? pattern.source : String(pattern).replace(/^\//, '').replace(/\/[a-z]*$/, '');
  const flags = pattern instanceof RegExp ? pattern.flags.replace('g', '') : 'i';
  return page.waitForFunction(
    (src, fl) => new RegExp(src, fl).test(document.body.innerText),
    { timeout: timeoutMs },
    source,
    flags,
  );
}

async function clickButton(page, text, timeoutMs = 20000) {
  await page.waitForFunction(
    (t) => [...document.querySelectorAll('button')].some((el) => el.textContent.includes(t)),
    { timeout: timeoutMs },
    text,
  );
  await page.evaluate((t) => {
    const hit = [...document.querySelectorAll('button')].find((el) => el.textContent.includes(t));
    if (hit && !hit.disabled) hit.click();
  }, text);
}

async function clickSidebar(page, title) {
  await page.waitForFunction(
    (t) => [...document.querySelectorAll('a,button,span')].some((el) => el.textContent.trim() === t),
    { timeout: 20000 },
    title,
  );
  await page.evaluate((t) => {
    const hit = [...document.querySelectorAll('a,button,span')].find((el) => el.textContent.trim() === t);
    if (hit) hit.click();
  }, title);
}

try {
  const page = await browser.newPage();

  // ---- 01: summon screen (Overview command center, ready state) ----
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await waitBody(page, 'Bridge connected', 60000);
  await waitBody(page, 'Summon the council', 30000);
  await shot(page, '01-summon.png');

  // Start a REAL council review.
  await clickButton(page, 'Summon the council');
  await waitBody(page, 'In progress', 30000);
  await shot(page, '02-review-room.png');

  // ---- 03: findings stream in over Socket.IO ----
  await waitBody(page, 'confidence', 180000);
  await sleep(4000);
  await shot(page, '03-findings.png');

  // ---- 04: council verdict ----
  await waitBody(page, /REQUEST CHANGES|APPROVED|BLOCKED|Review complete/, 240000);
  await sleep(4000);
  await shot(page, '04-verdict.png');

  // ---- 05: séance ----
  await clickSidebar(page, 'Séance');
  await waitBody(page, 'Channel open', 30000);
  await clickButton(page, 'Ask the séance', 30000);
  try {
    await waitBody(page, /\u201c|PR #/, 180000);
  } catch {
    console.log('[warn] séance answer wait timed out — capturing the form state');
  }
  await sleep(2000);
  await shot(page, '05-seance.png');

  // ---- 06: hall of fame ----
  await clickSidebar(page, 'Hall of fame');
  await waitBody(page, 'Leaderboard', 30000);
  await sleep(2000);
  await shot(page, '06-hall-of-fame.png');

  console.log('ALL SCREENSHOTS COMPLETE');
} catch (err) {
  console.error('SCRIPT ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}