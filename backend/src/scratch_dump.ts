import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import fs from 'fs';
import prisma from './lib/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function dumpDom() {
  // Find the first active session
  const session = await prisma.instagramSession.findFirst({
    where: { isActive: true },
  });

  if (!session) {
    console.error('No active Instagram session found in database!');
    process.exit(1);
  }

  console.log('Using session profile:', session.browserProfilePath);
  console.log('Storage state:', session.storageStatePath);

  const options = {
    headless: false,
    viewport: { width: 1280, height: 800 },
    storageState: session.storageStatePath || undefined,
  };

  const context = await chromium.launchPersistentContext(session.browserProfilePath!, options);
  const page = await context.newPage();

  try {
    console.log('Navigating to Reel page...');
    await page.goto('https://www.instagram.com/reel/DYWgpJBtThP/', { waitUntil: 'domcontentloaded' });
    console.log('Waiting 8 seconds for page to render...');
    await new Promise(r => setTimeout(r, 8000));

    // Try clicking the comment bubble icon if the drawer isn't open
    console.log('Attempting to click comment icon to make sure drawer is open...');
    const expandSelectors = [
      'svg[aria-label*="Comment" i]',
      'svg[aria-label*="comment" i]',
      '[aria-label*="Comment" i]',
      'button[aria-label*="comment" i]',
    ];
    for (const sel of expandSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        await el.click().catch(() => {});
        console.log('Clicked expand icon:', sel);
        await new Promise(r => setTimeout(r, 4000));
        break;
      }
    }

    console.log('Dumping HTML of the entire page to help extract selectors...');
    const bodyHtml = await page.content();
    fs.writeFileSync(path.join(__dirname, '..', 'dom_dump.html'), bodyHtml);
    console.log('HTML successfully dumped to dom_dump.html in project root!');

  } catch (err) {
    console.error('Error during dump:', err);
  } finally {
    await context.close();
  }
}

dumpDom();
