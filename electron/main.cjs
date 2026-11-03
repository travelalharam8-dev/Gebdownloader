const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let backendProcess = null;
const BACKEND_PORT = 3000;

function checkBackendHealth(retries = 20, delay = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const req = http.get(`http://127.0.0.1:${BACKEND_PORT}/api/health`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(interval);
          resolve(true);
        }
      });

      req.on('error', () => {
        if (attempts >= retries) {
          clearInterval(interval);
          reject(new Error('Backend server failed to start within timeout.'));
        }
      });
      req.end();
    }, delay);
  });
}

function startBackend() {
  const isDev = process.env.NODE_ENV !== 'production';
  const serverPath = isDev
    ? path.join(__dirname, '..', 'server.ts')
    : path.join(__dirname, '..', 'dist', 'server.js');

  console.log('[Electron] Starting local backend at:', serverPath);

  if (isDev) {
    backendProcess = spawn('npx', ['tsx', serverPath], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(BACKEND_PORT) },
      shell: true,
      stdio: 'inherit',
    });
  } else {
    backendProcess = spawn(process.execPath, [serverPath], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(BACKEND_PORT), NODE_ENV: 'production' },
      stdio: 'inherit',
    });
  }

  backendProcess.on('exit', (code, signal) => {
    console.log(`[Electron] Backend process exited with code ${code}, signal ${signal}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0b0f19',
    title: 'Video Downloader Pro',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    autoHideMenuBar: true,
  });

  const appUrl = `http://127.0.0.1:${BACKEND_PORT}`;
  mainWindow.loadURL(appUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('openExternal', async (event, url) => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    shell.openExternal(url);
  }
});

ipcMain.handle('selectDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.on('minimizeWindow', () => {
  mainWindow?.minimize();
});

ipcMain.on('maximizeWindow', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('closeWindow', () => {
  mainWindow?.close();
});

app.whenReady().then(async () => {
  startBackend();
  try {
    await checkBackendHealth();
  } catch (err) {
    console.warn('[Electron] Backend health check failed or still launching, proceeding with window creation...');
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  if (backendProcess) {
    console.log('[Electron] Terminating local backend process...');
    backendProcess.kill();
    backendProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
