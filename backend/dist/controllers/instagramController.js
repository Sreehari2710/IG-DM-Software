import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import prisma from '../lib/prisma.js';
import { encryptString } from '../lib/crypto.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Persistent and fully writable location for user profile folders (prevents read-only Program Files errors)
const USER_DATA_PATH = process.env.USER_DATA_PATH || path.join(__dirname, '..', '..');
const PROFILES_DIR = path.join(USER_DATA_PATH, 'profiles');
// Apply stealth once at module level
chromium.use(StealthPlugin());
// Ensure profiles directory exists
if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
}
// Spawns Electron's internal Node environment to download chromium browser binaries locally if missing
async function runSelfHealingInstaller() {
    return new Promise((resolve) => {
        let cliPath = '';
        try {
            cliPath = require.resolve('playwright-core/cli.js');
        }
        catch {
            try {
                cliPath = require.resolve('playwright/cli.js');
            }
            catch {
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
            }
            else {
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
// ─── Connect Instagram (opens browser, user logs in) ────────────────────────
export const connectInstagram = async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
    }
    try {
        // Ensure the user actually exists in the database to prevent foreign key constraint violations (e.g. after migration)
        const userExists = await prisma.user.findUnique({ where: { id: userId } });
        if (!userExists) {
            res.status(400).json({ error: 'User session has expired. Please sign out and sign back in.' });
            return;
        }
        const profileDir = path.join(PROFILES_DIR, userId);
        if (!fs.existsSync(profileDir))
            fs.mkdirSync(profileDir, { recursive: true });
        const launchOptions = {
            headless: false,
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
        };
        if (process.env.NODE_ENV === 'production') {
            launchOptions.channel = 'chrome';
        }
        let context;
        try {
            context = await chromium.launchPersistentContext(profileDir, launchOptions);
        }
        catch (err) {
            console.log('[Playwright] Failed to launch with Chrome channel, trying default Chromium...', err);
            if (launchOptions && 'channel' in launchOptions) {
                delete launchOptions.channel;
            }
            try {
                context = await chromium.launchPersistentContext(profileDir, launchOptions);
            }
            catch (innerErr) {
                console.error('[Playwright] Playwright Chromium is missing. Running self-healing installer...', innerErr);
                const isInstalled = await runSelfHealingInstaller();
                if (isInstalled) {
                    context = await chromium.launchPersistentContext(profileDir, launchOptions);
                }
                else {
                    throw new Error('Chromium browser could not be launched or installed. Please ensure Google Chrome is installed on your machine.');
                }
            }
        }
        let isClosed = false;
        context.on('close', () => {
            isClosed = true;
        });
        const page = await context.newPage();
        await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });
        // Poll every 1.5 seconds up to 3 minutes for a successful login
        let loggedIn = false;
        const startTime = Date.now();
        while (Date.now() - startTime < 180_000) {
            if (isClosed || context.pages().length === 0) {
                break;
            }
            try {
                const cookies = await context.cookies();
                const hasSession = cookies.some((c) => c.name === 'sessionid');
                const currentUrl = page.url();
                if (hasSession && !currentUrl.includes('/accounts/login') && !currentUrl.includes('/onetap')) {
                    loggedIn = true;
                    break;
                }
            }
            catch (err) {
                // If Playwright indicates that context or page is already closed, break the loop
                const msg = err.message || '';
                if (msg.includes('closed') || msg.includes('Target') || msg.includes('context')) {
                    break;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
        if (!loggedIn) {
            await context.close().catch(() => { });
            res.status(400).json({ error: 'Login was not completed within the time limit' });
            return;
        }
        // Give a brief moment for the page to settle
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Extract username from Instagram
        let instagramUsername = 'unknown';
        try {
            await page.goto('https://www.instagram.com/accounts/edit/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
            const handle = await page.$eval('input[name="username"]', (el) => el.value).catch(() => '');
            if (handle) {
                instagramUsername = handle;
            }
            else {
                const cookies = await context.cookies();
                const dsUser = cookies.find((c) => c.name === 'ds_user_id');
                if (dsUser)
                    instagramUsername = `user_${dsUser.value}`;
            }
        }
        catch {
            const cookies = await context.cookies();
            const dsUser = cookies.find((c) => c.name === 'ds_user_id');
            if (dsUser)
                instagramUsername = `user_${dsUser.value}`;
        }
        // Save encrypted storage state
        const statePath = path.join(profileDir, 'state.json.enc');
        const rawState = await context.storageState();
        const encryptedState = encryptString(JSON.stringify(rawState));
        await fs.promises.writeFile(statePath, encryptedState, 'utf8');
        await context.close();
        // Deactivate any existing sessions for this user
        await prisma.instagramSession.updateMany({
            where: { userId },
            data: { isActive: false },
        });
        // Create/update session record
        const session = await prisma.instagramSession.create({
            data: {
                userId,
                instagramUsername,
                isActive: true,
                storageStatePath: statePath,
                browserProfilePath: profileDir,
            },
        });
        res.json({ success: true, session: { id: session.id, username: instagramUsername } });
    }
    catch (err) {
        console.error('[Instagram] Connect error:', err);
        res.status(500).json({ error: 'Failed to connect Instagram account' });
    }
};
// ─── Get Instagram session status ───────────────────────────────────────────
export const getInstagramStatus = async (req, res) => {
    const { userId } = req.params;
    try {
        const session = await prisma.instagramSession.findFirst({
            where: { userId, isActive: true },
            orderBy: { createdAt: 'desc' },
        });
        if (!session) {
            res.json({ connected: false });
            return;
        }
        res.json({
            connected: true,
            session: {
                id: session.id,
                username: session.instagramUsername,
                proxyUrl: session.proxyUrl,
            },
        });
    }
    catch (err) {
        console.error('[Instagram] Status error:', err);
        res.status(500).json({ error: 'Failed to get status' });
    }
};
// ─── Update proxy for a session ─────────────────────────────────────────────
export const updateSessionProxy = async (req, res) => {
    const id = req.params.id;
    const { proxyUrl } = req.body;
    try {
        const session = await prisma.instagramSession.update({
            where: { id },
            data: { proxyUrl: proxyUrl || null },
        });
        res.json({ success: true, proxyUrl: session.proxyUrl });
    }
    catch (err) {
        console.error('[Instagram] Proxy update error:', err);
        res.status(500).json({ error: 'Failed to update proxy' });
    }
};
// ─── Disconnect Instagram session ────────────────────────────────────────────
export const disconnectInstagram = async (req, res) => {
    const { userId } = req.body;
    try {
        await prisma.instagramSession.updateMany({
            where: { userId },
            data: { isActive: false },
        });
        res.json({ success: true });
    }
    catch (err) {
        console.error('[Instagram] Disconnect error:', err);
        res.status(500).json({ error: 'Failed to disconnect' });
    }
};
//# sourceMappingURL=instagramController.js.map