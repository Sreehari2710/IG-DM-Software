/**
 * Automation Engine — Playwright + Stealth
 * Handles both Comment Bot and DM Bot with human-like simulation.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import prisma from '../lib/prisma.js';
import { decryptString } from '../lib/crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Persistent and fully writable location for user profile folders (prevents read-only Program Files errors)
const USER_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const PROFILES_DIR = path.join(USER_DATA_PATH, 'profiles');

// Apply stealth once at module level
chromium.use(StealthPlugin());

// Spawns Electron's internal Node environment to download chromium browser binaries locally if missing
async function runSelfHealingInstaller(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let cliPath = '';
    try {
      cliPath = require.resolve('playwright-core/cli.js');
    } catch {
      try {
        cliPath = require.resolve('playwright/cli.js');
      } catch {
        cliPath = path.join(USER_DATA_PATH, 'node_modules', 'playwright-core', 'cli.js');
      }
    }

    console.log(`[Playwright Installer] Spawning installer from: ${cliPath}`);
    const child = spawn(process.execPath, [cliPath, 'install', 'chromium'], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1'
      }
    });

    child.stdout.on('data', (data) => console.log(`[Playwright Installer STDOUT]: ${data}`));
    child.stderr.on('data', (data) => console.error(`[Playwright Installer STDERR]: ${data}`));

    child.on('close', (code) => {
      if (code === 0) {
        console.log('[Playwright Installer] Success!');
        resolve(true);
      } else {
        console.error(`[Playwright Installer] Failed with code ${code}`);
        resolve(false);
      }
    });

    child.on('error', (spawnErr) => {
      console.error('[Playwright Installer] Spawn error:', spawnErr);
      resolve(false);
    });
  });
}

// ─── Human-like helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Type text character by character with variable speed
async function humanType(page: import('playwright').Page, selector: string, text: string): Promise<void> {
  await page.focus(selector);
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomBetween(60, 180) });
    // Random micro-pause every ~5 chars
    if (Math.random() < 0.2) await sleep(randomBetween(150, 400));
  }
}

// Simulate human scroll
async function humanScroll(page: import('playwright').Page): Promise<void> {
  const scrollAmount = randomBetween(200, 600);
  await page.mouse.wheel(0, scrollAmount);
  await sleep(randomBetween(500, 1200));
  await page.mouse.wheel(0, -randomBetween(50, 150));
  await sleep(randomBetween(300, 700));
}

// Random mouse wiggle before clicking
async function humanClick(page: import('playwright').Page, selector: string): Promise<void> {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (box) {
    const x = box.x + box.width / 2 + randomBetween(-5, 5);
    const y = box.y + box.height / 2 + randomBetween(-5, 5);
    await page.mouse.move(x + randomBetween(-20, 20), y + randomBetween(-20, 20));
    await sleep(randomBetween(100, 300));
    await page.mouse.move(x, y);
    await sleep(randomBetween(80, 200));
    await page.mouse.click(x, y);
  } else {
    await el.click();
  }
}

// Detect CAPTCHA / login wall
async function detectChallenge(page: import('playwright').Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('/challenge/') || url.includes('/accounts/login/') || url.includes('/checkpoint/')) {
    return true;
  }
  const challengeText = await page.$('text=suspicious').catch(() => null);
  const loginForm = await page.$('input[name="username"]').catch(() => null);
  return !!(challengeText || loginForm);
}

async function launchContext(
  session: {
    browserProfilePath: string | null;
    storageStatePath: string | null;
    proxyUrl: string | null;
  },
  headless: boolean
) {
  const profileDir = session.browserProfilePath ?? path.join(PROFILES_DIR, 'default');

  // Load and decrypt storage state if it exists
  let storageStateObj: Record<string, unknown> | undefined = undefined;
  if (session.storageStatePath && fs.existsSync(session.storageStatePath)) {
    try {
      const fileContent = fs.readFileSync(session.storageStatePath, 'utf8');
      if (session.storageStatePath.endsWith('.enc')) {
        const decrypted = decryptString(fileContent);
        storageStateObj = JSON.parse(decrypted);
      } else {
        // Fallback for legacy plain text json files
        storageStateObj = JSON.parse(fileContent);
      }
    } catch (err) {
      console.error('[Engine] Failed to load or decrypt storage state:', err);
    }
  }

  const options: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless,
    viewport: { width: 1280, height: 800 },
    storageState: storageStateObj,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  };

  // In production packaged environment, use the user's local Google Chrome installation 
  // to avoid missing browser binary crashes and keep installer lightweight.
  if (process.env.NODE_ENV === 'production') {
    (options as Record<string, unknown>).channel = 'chrome';
  }

  if (session.proxyUrl) {
    (options as Record<string, unknown>).proxy = { server: session.proxyUrl };
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, options);
  } catch (err: any) {
    console.log('[Engine] Failed to launch with Chrome channel, trying default Chromium...', err);
    if (options && 'channel' in (options as any)) {
      delete (options as any).channel;
    }
    try {
      context = await chromium.launchPersistentContext(profileDir, options);
    } catch (innerErr: any) {
      console.error('[Engine] Playwright Chromium is missing. Running self-healing installer...', innerErr);
      const isInstalled = await runSelfHealingInstaller();
      if (isInstalled) {
        context = await chromium.launchPersistentContext(profileDir, options);
      } else {
        throw new Error('Chromium browser could not be launched or installed. Please ensure Google Chrome is installed on your machine.');
      }
    }
  }
  return context;
}

// ─── Comment Bot ─────────────────────────────────────────────────────────────
async function runCommentBot(
  page: import('playwright').Page,
  postUrl: string,
  comment: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Clean URL (remove any accidental concatenation)
    const cleanUrl = postUrl.trim();

    // Validate target URL to prevent browser hijacking or local file disclosure vulnerabilities
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(cleanUrl);
    } catch {
      return { success: false, error: `Invalid URL format: "${cleanUrl}"` };
    }

    const isSecureProtocol = parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    const isInstagramDomain = parsedUrl.hostname === 'instagram.com' || parsedUrl.hostname.endsWith('.instagram.com');

    if (!isSecureProtocol || !isInstagramDomain) {
      return { success: false, error: `Security Block: Navigation to unauthorized host "${parsedUrl.hostname}" is blocked.` };
    }

    await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(randomBetween(2000, 3000));

    // Check for CAPTCHA / login wall directly on target page load
    const challenged = await detectChallenge(page);
    if (challenged) {
      return { success: false, error: 'Login wall or CAPTCHA detected — campaign paused' };
    }

    // Scroll to load comments
    await humanScroll(page);
    await sleep(randomBetween(1500, 2500));

    // Selectors that can match either the real input box OR the placeholder fake box
    const initialSelectors = [
      'input[placeholder*="comment" i]',
      'input[placeholder*="Comment" i]',
      'input[placeholder*="Add a comment" i]',
      'input[placeholder*="Add a comment…" i]',
      'input[aria-label*="comment" i]',
      'textarea[placeholder*="comment" i]',
      'textarea[placeholder*="Comment" i]',
      'textarea[aria-label*="comment" i]',
      '[contenteditable="true"][aria-label*="comment" i]',
      '[contenteditable="true"][placeholder*="comment" i]',
      '[contenteditable="true"][placeholder*="Comment" i]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      '[role="textbox"][aria-label*="comment" i]',
      'text="Add a comment..."',
      'text="Add a comment…"',
      'text="Add a comment"',
      'div[role="button"]:has-text("Add a comment")',
      'div:has-text("Add a comment")',
      'span:has-text("Add a comment")'
    ];

    // Helper function to find the first TRULY visible element using Playwright Locators
    const findVisibleElement = async (selectors: string[]) => {
      for (const selector of selectors) {
        try {
          const loc = page.locator(selector);
          const count = await loc.count().catch(() => 0);
          for (let i = 0; i < count; i++) {
            const el = loc.nth(i);
            if (await el.isVisible()) {
              return el;
            }
          }
        } catch {
          // ignore
        }
      }
      return null;
    };

    // First try: Find the comment box or placeholder initially
    let activeBox = await findVisibleElement(initialSelectors);
    
    // Second try: Click the speech bubble / comment icon to expand comment section on Reels if not visible
    if (!activeBox) {
      const expandSelectors = [
        'svg[aria-label*="Comment" i]',
        'svg[aria-label*="comment" i]',
        '[aria-label*="Comment" i]',
        'button[aria-label*="comment" i]',
        'span[aria-label*="comment" i]',
        '[role="button"]:has-text("Comment")',
      ];
      for (const sel of expandSelectors) {
        try {
          const loc = page.locator(sel);
          const count = await loc.count().catch(() => 0);
          let clicked = false;
          for (let i = 0; i < count; i++) {
            const el = loc.nth(i);
            if (await el.isVisible()) {
              await el.scrollIntoViewIfNeeded().catch(() => {});
              await sleep(300);
              await el.click({ timeout: 3000 });
              clicked = true;
              break;
            }
          }
          if (clicked) {
            await sleep(randomBetween(3000, 4500)); // wait for drawer animation to slide out
            break;
          }
        } catch {
          // ignore
        }
      }
      
      // Wait up to 10 seconds for the comment box or placeholder to become visible in the drawer
      const startTime = Date.now();
      while (Date.now() - startTime < 10000) {
        activeBox = await findVisibleElement(initialSelectors);
        if (activeBox) break;
        await sleep(1000);
      }
    }

    if (!activeBox) {
      return { success: false, error: `Comment box or placeholder not found on page (timed out waiting for drawer): ${page.url()}` };
    }

    // Scroll element into view if needed
    await activeBox.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(500);

    // Click the active box or placeholder to focus it or trigger mounting of the real input
    const box = await activeBox.boundingBox().catch(() => null);
    if (box) {
      const x = box.x + box.width / 2 + randomBetween(-5, 5);
      const y = box.y + box.height / 2 + randomBetween(-5, 5);
      await page.mouse.move(x + randomBetween(-10, 10), y + randomBetween(-10, 10));
      await sleep(randomBetween(100, 300));
      await page.mouse.move(x, y);
      await sleep(randomBetween(100, 200));
      await page.mouse.click(x, y);
    } else {
      await activeBox.click().catch(() => {});
    }

    // Wait a brief moment for React to mount/transition the real text editor input
    await sleep(randomBetween(1000, 1500));

    // Resolve the real, interactable textbox that was mounted after clicking
    const realInputSelectors = [
      'input[placeholder*="comment" i]',
      'input[placeholder*="Comment" i]',
      'input[placeholder*="Add a comment" i]',
      'input[placeholder*="Add a comment…" i]',
      'textarea[aria-label*="comment" i]',
      'textarea[placeholder*="comment" i]',
      'textarea[placeholder*="Comment" i]',
      '[contenteditable="true"][aria-label*="comment" i]',
      '[contenteditable="true"][placeholder*="comment" i]',
      '[contenteditable="true"][placeholder*="Comment" i]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      '[role="textbox"]',
      'form textarea',
      'form [contenteditable="true"]',
      'form input'
    ];

    let realInput = await findVisibleElement(realInputSelectors);
    if (!realInput) {
      // Fallback: if dynamic editor resolution fails, use the activeBox we clicked
      realInput = activeBox;
    }

    // Type the comment character-by-character into the active, focused editor input
    await realInput.focus().catch(() => {});
    await sleep(200);

    const commentText = comment;
    for (const char of commentText) {
      await page.keyboard.type(char, { delay: randomBetween(65, 155) });
      if (Math.random() < 0.15) await sleep(randomBetween(150, 400));
    }

    await sleep(randomBetween(1000, 2000));

    // Click the dynamic "Post" button using our exact-text filter (guaranteed unique)
    let submitted = false;
    try {
      const exactPostBtn = page.locator('div[role="button"]').filter({ hasText: /^Post$/ }).first();
      if (await exactPostBtn.isVisible()) {
        await exactPostBtn.scrollIntoViewIfNeeded().catch(() => {});
        await sleep(300);
        
        const box = await exactPostBtn.boundingBox().catch(() => null);
        let clicked = false;
        try {
          await exactPostBtn.hover({ timeout: 1500 }).catch(() => {});
          await sleep(200);
          await exactPostBtn.click({ timeout: 2000 });
          clicked = true;
        } catch {
          if (box) {
            const x = box.x + box.width / 2 + randomBetween(-3, 3);
            const y = box.y + box.height / 2 + randomBetween(-3, 3);
            await page.mouse.move(x, y);
            await sleep(100);
            await page.mouse.click(x, y);
            clicked = true;
          }
        }
        if (!clicked) {
          await exactPostBtn.click({ force: true }).catch(() => {});
        }
        submitted = true;
      }
    } catch (err) {
      // ignore and proceed to fallback
    }

    if (!submitted) {
      // Fallback loop if exact match failed or wasn't visible
      const postBtnSels = [
        'div[role="button"]:has-text("Post")',
        '[role="button"]:has-text("Post")',
        'button:has-text("Post")',
        'button[type="submit"]',
      ];
      for (const sel of postBtnSels) {
        try {
          const loc = page.locator(sel);
          const count = await loc.count().catch(() => 0);
          for (let i = 0; i < count; i++) {
            const el = loc.nth(i);
            if (await el.isVisible()) {
              await el.scrollIntoViewIfNeeded().catch(() => {});
              await sleep(300);

              const box = await el.boundingBox().catch(() => null);
              let clicked = false;
              try {
                await el.hover({ timeout: 1500 }).catch(() => {});
                await sleep(200);
                await el.click({ timeout: 2000 });
                clicked = true;
              } catch {
                if (box) {
                  const x = box.x + box.width / 2 + randomBetween(-3, 3);
                  const y = box.y + box.height / 2 + randomBetween(-3, 3);
                  await page.mouse.move(x, y);
                  await sleep(100);
                  await page.mouse.click(x, y);
                  clicked = true;
                }
              }

              if (!clicked) {
                await el.click({ force: true }).catch(() => {});
              }
              
              submitted = true;
              break;
            }
          }
          if (submitted) break;
        } catch {
          // ignore
        }
      }
    }

    if (!submitted) {
      await page.keyboard.press('Enter');
    }

    // Wait for Instagram network request to finish and DOM update
    await sleep(randomBetween(5000, 7000));

    // Enforce verification: check if the comment is visible on the page
    const commentSelector = `span:has-text("${commentText}")`;
    const commentLoc = page.locator(commentSelector);
    let isCommentVisible = false;
    try {
      isCommentVisible = await commentLoc.first().isVisible();
    } catch {
      // ignore
    }

    if (isCommentVisible) {
      return { success: true };
    } else {
      // Capture a screenshot of the failure for diagnostic purposes so user can see exactly why it failed
      const errorScreenshotPath = path.join(__dirname, '..', 'comment_error.png');
      await page.screenshot({ path: errorScreenshotPath }).catch(() => {});
      return { success: false, error: `Verification failed: Comment was typed but "Post" button click did not publish it. A screenshot has been saved to "backend/comment_error.png".` };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── DM Bot ──────────────────────────────────────────────────────────────────
async function runDMBot(
  page: import('playwright').Page,
  username: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Navigate to new DM page
    await page.goto('https://www.instagram.com/direct/new/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await sleep(randomBetween(2000, 3500));

    // Check for CAPTCHA / login wall directly on target page load
    const challenged = await detectChallenge(page);
    if (challenged) {
      return { success: false, error: 'Login wall or CAPTCHA detected — campaign paused' };
    }


    // Search for the user
    const searchSelectors = [
      'input[placeholder*="Search" i]',
      'input[name="queryBox"]',
      'input[aria-label*="Search" i]',
    ];
    let searchFound = false;
    for (const sel of searchSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        await humanClick(page, sel);
        await sleep(randomBetween(500, 1000));
        await humanType(page, sel, username);
        await sleep(randomBetween(1500, 2500));
        searchFound = true;
        break;
      }
    }

    if (!searchFound) {
      return { success: false, error: 'Search box not found on DM page' };
    }

    // Click the matching result
    const resultSelectors = [
      `span:has-text("${username}")`,
      `div:has-text("${username}")`,
      `[role="option"]:has-text("${username}")`,
      `button:has-text("${username}")`,
      `[role="button"]:has-text("${username}")`,
    ];

    let resultClicked = false;
    for (const sel of resultSelectors) {
      try {
        const loc = page.locator(sel);
        const count = await loc.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const el = loc.nth(i);
          if (await el.isVisible()) {
            await el.scrollIntoViewIfNeeded().catch(() => {});
            await sleep(300);
            await el.click({ timeout: 3000 });
            resultClicked = true;
            console.log(`[Engine] Clicked search result row for: ${username}`);
            break;
          }
        }
        if (resultClicked) break;
      } catch (err) {
        // ignore
      }
    }

    if (!resultClicked) {
      return { success: false, error: `User "${username}" not found in search results` };
    }

    await sleep(randomBetween(1000, 1800));

    // Click Next / Chat button
    const nextSelectors = [
      'button:has-text("Next")',
      'button:has-text("Chat")',
      'div[role="button"]:has-text("Next")',
      'div:has-text("Next")',
      'div:has-text("Chat")',
    ];
    let nextClicked = false;
    for (const sel of nextSelectors) {
      try {
        const loc = page.locator(sel);
        const count = await loc.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const el = loc.nth(i);
          if (await el.isVisible()) {
            await el.scrollIntoViewIfNeeded().catch(() => {});
            await sleep(300);
            await el.click({ timeout: 3000 });
            nextClicked = true;
            console.log('[Engine] Clicked Next/Chat button!');
            break;
          }
        }
        if (nextClicked) break;
      } catch {
        // ignore
      }
    }

    await sleep(randomBetween(1500, 3000));

    // Type and send the message
    const msgSelectors = [
      'textarea[placeholder*="Message" i]',
      '[contenteditable="true"][aria-label*="Message" i]',
      '[role="textbox"]',
    ];

    let messageSent = false;
    for (const sel of msgSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        await humanClick(page, sel);
        await sleep(randomBetween(500, 1000));
        for (const char of message) {
          await page.keyboard.type(char, { delay: randomBetween(70, 170) });
          if (Math.random() < 0.15) await sleep(randomBetween(200, 500));
        }
        await sleep(randomBetween(800, 1500));
        await page.keyboard.press('Enter');
        await sleep(randomBetween(2000, 3000));
        messageSent = true;
        break;
      }
    }

    if (!messageSent) {
      return { success: false, error: 'Message input not found' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Public: Run a single job ─────────────────────────────────────────────────
export async function runInteraction(jobId: string): Promise<void> {
  const job = await prisma.jobQueue.findUnique({
    where: { id: jobId },
    include: {
      campaign: {
        include: {
          session: true,
        },
      },
    },
  });

  if (!job) return;

  const { campaign } = job;
  const { session } = campaign;

  let context: Awaited<ReturnType<typeof launchContext>> | null = null;

  try {
    const isHeadless = true;
    context = await launchContext(session, isHeadless);
    const page = await context.newPage();

    let result: { success: boolean; error?: string };

    if (campaign.type === 'COMMENT') {
      result = await runCommentBot(page, job.interactionId, job.message);
    } else if (campaign.type === 'DM') {
      result = await runDMBot(page, job.interactionId, job.message);
    } else {
      result = { success: false, error: `Unknown campaign type: ${campaign.type}` };
    }

    const isChallenge = result.error?.includes('Login wall or CAPTCHA detected') ?? false;
    if (isChallenge) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'PAUSED' } }).catch(() => {});
    }

    await prisma.jobQueue.update({
      where: { id: jobId },
      data: {
        status: result.success ? 'DONE' : 'FAILED',
        errorMsg: result.error ?? null,
        executedAt: new Date(),
        retries: { increment: result.success ? 0 : 1 },
      },
    });

    console.log(`[Engine] Job ${jobId} — ${result.success ? '✅ DONE' : `❌ FAILED: ${result.error}`}`);
  } catch (err) {
    console.error(`[Engine] Job ${jobId} threw an exception:`, err);
    await prisma.jobQueue.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        errorMsg: String(err),
        executedAt: new Date(),
        retries: { increment: 1 },
      },
    });
  } finally {
    if (context) {
      // Prevent context.close() from hanging the worker thread indefinitely on Windows
      await Promise.race([
        context.close(),
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]).catch(() => {});
    }
  }
}
