import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

/**
 * Hex Payroll desktop shell.
 *
 * PHASE 0 SCOPE: window, preload, single-instance guard, and loading apps/web.
 *
 * NOT YET IMPLEMENTED (later phases):
 *   - spawning the private PostgreSQL cluster (Phase 4)
 *   - spawning the local Express API as a child process with an ephemeral
 *     loopback port and a per-launch bearer token (Phase 1/4)
 */

/** Where apps/web's dev server listens (see apps/web/vite.config.ts). */
const DEV_WEB_URL = process.env.HEX_WEB_DEV_URL ?? 'http://127.0.0.1:5273';

const DEV_SERVER_MAX_ATTEMPTS = 20;
const DEV_SERVER_RETRY_MS = 500;

let mainWindow: BrowserWindow | null = null;

/**
 * Loads the UI, tolerating the fact that in development the Vite dev server may
 * not have finished starting. Without this, launching the desktop a moment too
 * early shows a blank window instead of waiting for the UI.
 */
async function loadDevServer(window: BrowserWindow, attempt = 1): Promise<void> {
  try {
    await window.loadURL(DEV_WEB_URL);
  } catch (error) {
    if (attempt >= DEV_SERVER_MAX_ATTEMPTS) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, DEV_SERVER_RETRY_MS));
    await loadDevServer(window, attempt + 1);
  }
}

async function loadUi(window: BrowserWindow): Promise<void> {
  if (app.isPackaged) {
    // electron-builder ships apps/web/dist as an extra resource named "web".
    await window.loadFile(join(process.resourcesPath, 'web', 'index.html'));
    return;
  }

  await loadDevServer(window);
  console.log(`[desktop] UI loaded from ${DEV_WEB_URL}`);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'Hex Payroll',
    backgroundColor: '#020617',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Show only once the first paint is ready — avoids a white flash on launch.
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Never let the renderer spawn arbitrary Electron windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void loadUi(mainWindow).catch((error: unknown) => {
    console.error('[desktop] failed to load the UI:', error);
  });
}

/*
 * Single-instance guard.
 *
 * Mandatory, and not merely for tidiness: once the shell owns a private
 * PostgreSQL data directory, two concurrent instances against one pgdata will
 * corrupt it. Establishing the guard now means that safety property exists
 * before the thing it protects.
 */
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app
    .whenReady()
    .then(() => {
      app.setAppUserModelId('ph.hexpayroll.desktop');
      createWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    })
    .catch((error: unknown) => {
      console.error('[desktop] failed to start:', error);
      app.quit();
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
