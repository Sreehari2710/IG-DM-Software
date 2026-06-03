const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn, fork } = require('child_process');
const net = require('net');
const fs = require('fs');

// Disable hardware acceleration on Windows only to prevent GPU rendering black screen bugs
if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
}

// Enforce single instance lock to prevent duplicate database and port collisions
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', () => {
  // Focus the existing window if a second instance is launched
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

let backendProcess = null;
let mainWindow = null;
let backendPort = 5000;

// ─── Find a free port starting from a given port ────────────────────────────
function findFreePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.on('error', () => resolve(findFreePort(startPort + 1)));
    server.listen(startPort, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

// On macOS, packaged extraResources files may lose their executable permissions.
// This function recursively finds any query-engine binaries and ensures they are executable (755).
function ensurePrismaBinariesExecutable(dir) {
  if (process.platform !== 'darwin') return;
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      ensurePrismaBinariesExecutable(filePath);
    } else if (file.includes('query-engine') || file.includes('schema-engine') || file.includes('migration-engine')) {
      try {
        const mode = stat.mode & 0o777;
        if ((mode & 0o111) !== 0o111) { // if not executable
          fs.chmodSync(filePath, 0o755);
          console.log(`[Electron] Set executable permission (755) for Prisma engine: ${filePath}`);
        }
      } catch (err) {
        console.error(`[Electron] Failed to set permissions for ${filePath}:`, err);
      }
    }
  }
}

// ─── Start the Express backend ───────────────────────────────────────────────
async function startBackend() {
  const isDev = !app.isPackaged;

  if (isDev) {
    // In development mode, the Express backend is already started by concurrently on Port 5000.
    // Bypassing spawning a duplicate process avoids port conflicts and saves memory.
    backendPort = 5000;
    console.log(`[Electron] Dev mode active: connecting to existing backend on Port ${backendPort}`);
    return;
  }

  backendPort = await findFreePort(5000);

  const backendDir = isDev
    ? path.join(__dirname, 'backend')
    : path.join(process.resourcesPath, 'backend');
  const envPath = path.join(backendDir, '.env');

  if (!isDev) {
    ensurePrismaBinariesExecutable(backendDir);
  }

  // Auto-detect if a cloud PostgreSQL database (Neon) is configured
  let dbUrl = process.env.DATABASE_URL || '';

  // If running in packaged production, parse the bundled backend/.env file manually
  if (!dbUrl && fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const match = envContent.match(/DATABASE_URL=["']?([^\s"']+)["']?/);
      if (match) {
        dbUrl = match[1].trim();
        console.log('[Electron] Loaded cloud DATABASE_URL from packaged .env file.');
      }
    } catch (err) {
      console.error('[Electron] Failed to read packaged .env file:', err);
    }
  }

  const isCloudDb = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');

  if (!isCloudDb) {
    // In production, locate the database in the app's persistent user-data folder
    const userDataPath = app.getPath('userData');
    const prodDbPath = path.join(userDataPath, 'vudu_prod.db');

    // Copy template dev.db from read-only package directory to userData directory if not exists
    const templateDbPath = path.join(backendDir, 'prisma', 'dev.db');
    if (!fs.existsSync(prodDbPath)) {
      try {
        if (!fs.existsSync(userDataPath)) {
          fs.mkdirSync(userDataPath, { recursive: true });
        }
        if (fs.existsSync(templateDbPath)) {
          fs.copyFileSync(templateDbPath, prodDbPath);
          console.log('[Electron] Initialized production SQLite database in userData folder.');
        } else {
          console.error('[Electron] Database seed template not found at:', templateDbPath);
        }
      } catch (err) {
        console.error('[Electron] Failed to copy database template:', err);
      }
    }

    // Format the SQLite connection URL to be absolute and percent-encoded for paths containing spaces (e.g. macOS "Application Support")
    const formattedDbPath = prodDbPath.replace(/\\/g, '/');
    dbUrl = 'file:' + encodeURI(formattedDbPath);
  }

  // In production, run compiled JS files using Node fork which references Electron's helper processes
  const backendJs = path.join(backendDir, 'dist', 'index.js');
  backendProcess = fork(backendJs, [], {
    cwd: backendDir,
    env: { 
      ...process.env, 
      PORT: String(backendPort), 
      NODE_ENV: 'production', 
      DATABASE_URL: dbUrl,
      USER_DATA_PATH: app.getPath('userData')
    },
    silent: true, // Route stdio streams to process.stdout/stderr instead of spawning console window
    windowsHide: true, // Hide command prompt shell on Windows systems
  });

  // Capture backend log outputs and redirect them cleanly to Electron's log pipeline
  if (backendProcess.stdout) {
    backendProcess.stdout.on('data', (data) => {
      console.log(`[Backend STDOUT]: ${data.toString().trim()}`);
    });
  }
  if (backendProcess.stderr) {
    backendProcess.stderr.on('data', (data) => {
      console.error(`[Backend STDERR]: ${data.toString().trim()}`);
    });
  }

  return new Promise((resolve) => {
    let isResolved = false;

    backendProcess.on('message', (msg) => {
      if (msg && msg.status === 'ready' && !isResolved) {
        isResolved = true;
        console.log(`[Electron] Backend online and listening on Port ${backendPort}`);
        resolve();
      }
    });

    backendProcess.on('error', (err) => {
      console.error('[Backend] Failed to start:', err);
      if (!isResolved) {
        isResolved = true;
        resolve();
      }
    });

    // Fallback: Resolve after 2.5 seconds if no IPC message is sent
    setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        console.log(`[Electron] Timeout waiting for backend ready, launching window on port ${backendPort}`);
        resolve();
      }
    }, 2500);
  });
}

// ─── Create the Electron window ──────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0f0f13',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('did-fail-load', (event, code, desc, url) => {
    console.error('[Electron] PAGE LOAD FAILED:', code, desc, url);
    mainWindow.webContents.loadURL(`data:text/html,
      <body style="font-family: system-ui, sans-serif; background: #0f0f13; color: #f3f4f6; padding: 32px; display: flex; align-items: center; justify-content: center; min-height: 80vh;">
        <div style="background: #18181f; border: 1px solid #272730; border-radius: 12px; padding: 32px; max-width: 560px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <h2 style="color: #f43f5e; margin-top: 0; display: flex; align-items: center; gap: 8px;">
            ⚠️ Connection Load Failure
          </h2>
          <p style="color: #d1d5db; line-height: 1.6;">The local Express server failed to respond or encountered a startup error.</p>
          <div style="background: #0b0b0d; border-radius: 6px; padding: 16px; margin: 20px 0; font-family: monospace; font-size: 13px; color: #ef4444; overflow-x: auto;">
            <div><b>Error Code:</b> ${code}</div>
            <div><b>Description:</b> ${desc}</div>
            <div><b>URL:</b> ${url}</div>
          </div>
          <p style="color: #9ca3af; font-size: 14px; margin-bottom: 0;">Please restart the application. If this issue persists, check your local firewall or port permissions.</p>
        </div>
      </body>
    `);
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:3010');
  } else {
    // In production, the Express backend serves the statically exported Next.js 'out' directory
    mainWindow.loadURL(`http://127.0.0.1:${backendPort}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC: expose backend port to renderer ───────────────────────────────────
ipcMain.handle('get-backend-port', () => backendPort);

// ─── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await startBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});
