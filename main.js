const { app, BrowserWindow, ipcMain, shell, Menu, session, dialog, Tray, webRequest } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');

const APP_VERSION = app.getVersion ? app.getVersion() : '3.0.0';
const REPO_OWNER = 'Olly033';
const REPO_NAME = 'Paceman-Desktop-App';
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const USER_AGENT = `Paceman-Desktop-App/${APP_VERSION}`;

let activeDownloads = new Map();

let win;
let pendingProtocolArgs = null;
let overlayHttpServer = null;
let overlayHttpPlayerName = '';
let overlayPngPath = null;
const OVERLAY_HTTP_PORT = 9876;

ipcMain.handle('update-overlay-player', async (event, playerName) => {
  overlayHttpPlayerName = playerName || '';
  if (!overlayHttpServer && overlayHttpPlayerName) {
    await startOverlayHttpServer();
  }
  return { success: true };
});

ipcMain.handle('update-overlay-png-path', async (event, pngPath) => {
  overlayPngPath = pngPath || null;
  return { success: true };
});

function startOverlayHttpServer() {
  if (overlayHttpServer) return;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${OVERLAY_HTTP_PORT}`);
    if (url.pathname === '/overlay.png') {
      const pngPath = overlayPngPath;
      if (!pngPath) {
        res.writeHead(404, { 'Content-Type': 'image/png' });
        res.end('');
        return;
      }
      try {
        const data = fs.readFileSync(pngPath);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(data);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'image/png' });
        res.end('');
      }
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Paceman Overlay</title>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
    img { width: 100%; height: 100%; object-fit: contain; display: block; }
  </style>
</head>
<body>
  <img id="overlayImg" src="/overlay.png">
  <script>
    setInterval(() => {
      const img = document.getElementById('overlayImg');
      if (img) img.src = '/overlay.png?t=' + Date.now();
    }, 1000);
  </script>
</body>
</html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });
  return new Promise((resolve) => {
    server.listen(OVERLAY_HTTP_PORT, '127.0.0.1', () => {
      overlayHttpServer = server;
      resolve('http://127.0.0.1:' + OVERLAY_HTTP_PORT);
    });
  });
}

function stopOverlayHttpServer() {
  if (overlayHttpServer) {
    overlayHttpServer.close();
    overlayHttpServer = null;
  }
}

function ensureProtocolRegistered() {
  if (process.platform !== 'win32') return Promise.resolve();
  const regPath = 'HKCU\\Software\\Classes\\paceman';
  return execAsync(`reg query "${regPath}" /ve 2>&1`).then(() => {
    return execAsync(`reg query "${regPath}\\shell\\open\\command" /ve 2>&1`);
  }).then(() => {
    return Promise.resolve();
  }).catch(() => {
    const exePath = process.execPath.replace(/\\/g, '\\\\');
    const command = `"${exePath}" "%1"`;
    const descPath = 'HKCU\\Software\\Classes\\paceman';
    const shellOpenPath = `${descPath}\\shell\\open\\command`;
    const iconPath = `${descPath}\\DefaultIcon`;
    return execAsync(`reg add "${descPath}" /v "" /t REG_SZ /d "URL:Paceman Protocol" /f`).then(() => {
      return execAsync(`reg add "${descPath}" /v "URL Protocol" /t REG_SZ /d "" /f`);
    }).then(() => {
      return execAsync(`reg add "${iconPath}" /ve /t REG_SZ /d "${exePath},0" /f`);
    }).then(() => {
      return execAsync(`reg add "${shellOpenPath}" /ve /t REG_SZ /d "${command}" /f`);
    }).then(() => {
      return Promise.resolve();
    }).catch((e) => {
      console.error('Failed to register paceman:// protocol:', e);
      return Promise.resolve();
    });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    frame: true,
    backgroundColor: '#0f0f23',
    title: 'Paceman v' + APP_VERSION,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: true
    }
  });

  if (pendingProtocolArgs) {
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('protocol-args', pendingProtocolArgs);
      pendingProtocolArgs = null;
    });
  }

  win.loadFile('renderer/index.html');
  win.webContents.setBackgroundThrottling(false);

  win.webContents.on('did-fail-load', () => {
    console.warn('Page load failed, retrying...');
    setTimeout(safeReloadWindow, 1000);
  });

  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

let shouldWarnAlreadyRunning = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  shouldWarnAlreadyRunning = true;
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    const protocolArg = commandLine.find((arg) => typeof arg === 'string' && arg.startsWith('paceman://'));
    if (protocolArg) {
      try {
        const parsed = new URL(protocolArg);
        pendingProtocolArgs = {
          protocol: parsed.protocol,
          host: parsed.hostname,
          path: parsed.pathname,
          query: Object.fromEntries(parsed.searchParams.entries()),
        };
      } catch (e) {
        console.error('Failed to parse paceman:// protocol arg:', e);
      }
    }
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (pendingProtocolArgs) {
        win.webContents.send('protocol-args', pendingProtocolArgs);
        pendingProtocolArgs = null;
      }
    }
  });

  if (process.platform === 'darwin') {
    app.on('open-url', (event, url) => {
      event.preventDefault();
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'paceman:') {
          pendingProtocolArgs = {
            protocol: parsed.protocol,
            host: parsed.hostname,
            path: parsed.pathname,
            query: Object.fromEntries(parsed.searchParams.entries()),
          };
          if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
            win.webContents.send('protocol-args', pendingProtocolArgs);
            pendingProtocolArgs = null;
          }
        }
      } catch (e) {
        console.error('Failed to parse paceman:// URL:', e);
      }
    });
  }
}

app.whenReady().then(async () => {
  if (shouldWarnAlreadyRunning) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Paceman already running',
      message: 'Paceman is already open.',
      detail: 'The app will now close. Use the existing window or the tray icon to interact with it.',
      buttons: ['OK']
    });
    app.quit();
    return;
  }
  try {
    await session.defaultSession.clearCache();
  } catch (e) {
    console.warn('Cache clear failed:', e);
  }
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Headers': ['*'],
        'Access-Control-Allow-Methods': ['*'],
        'Access-Control-Allow-Credentials': ['true'],
      },
    });
  });
  Menu.setApplicationMenu(null);
  createWindow();
  ensureProtocolRegistered();
  ensureYtDlp().catch((e) => console.warn('yt-dlp pre-download failed:', e.message));
  ensureFfmpeg().catch((e) => console.warn('ffmpeg pre-download failed:', e.message));
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function safeReloadWindow() {
  if (!win || app.isQuitting) return;
  try {
    if (!win.isDestroyed()) {
      win.webContents.reloadIgnoringCache();
    }
  } catch (e) {
    createWindow();
  }
}

app.on('renderer-process-crashed', () => {
  console.warn('Renderer process crashed, reloading...');
  safeReloadWindow();
});

app.on('gpu-process-crashed', () => {
  console.warn('GPU process crashed, reloading...');
  safeReloadWindow();
});

let tray = null;
function createTray() {
  const iconPath = path.join(__dirname, 'icon.ico');
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => { if (win) { win.show(); win.focus(); } } },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Paceman');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { if (win) { win.show(); win.focus(); } });
  tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
}

app.on('ready', () => {
  createTray();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopOverlayHttpServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && app.isQuitting) app.quit();
});

async function checkGithubLatest() {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
  const data = await httpGetJson(url);
  if (!data || !data.tag_name) throw new Error('No release data');
  const latestVersion = data.tag_name.replace(/^v/, '');
  const downloadUrl = data.html_url || '';
  const releaseName = data.name || data.tag_name || '';
  return { latestVersion, downloadUrl, releaseName };
}

function parseVersion(v) {
  const parts = String(v).split('.').map(Number);
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
}

function isNewerVersion(latest, current) {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  return l.patch > c.patch;
}

ipcMain.handle('check-for-updates', async () => {
  try {
    const info = await checkGithubLatest();
    const current = APP_VERSION;
    const newer = isNewerVersion(info.latestVersion, current);
    return { success: true, current, latest: info.latestVersion, isNewer: newer, downloadUrl: info.downloadUrl, releaseName: info.releaseName };
  } catch (e) {
    return { success: false, error: e.message || 'Failed to check for updates' };
  }
});

async function httpGetJson(url) {
  const mod = url.startsWith('https') ? https : http;
  const resp = await new Promise((resolve, reject) => {
    const req = mod.request(url, { method: 'GET', headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const chunks = [];
        res.on('data', () => {});
        res.on('end', () => resolve({ redirect: res.headers.location, baseUrl: url }));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
  if (resp.redirect) {
    const loc = resp.redirect;
    const next = loc.startsWith('http') ? loc : new URL(loc, resp.baseUrl).toString();
    return httpGetJson(next);
  }
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error('GitHub API returned HTTP ' + resp.status);
  }
  return JSON.parse(resp.data);
}

ipcMain.handle('fetch-json', async (event, url) => {
  try {
    const data = await httpGetJson(url);
    return data;
  } catch (e) {
    throw new Error('Failed to fetch ' + url + ': ' + e.message);
  }
});

ipcMain.handle('open-external', (event, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url);
    }
  } catch (e) {
    console.error('Blocked invalid external URL:', url);
  }
});

function httpGetText(url, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': '*/*', 'Accept-Encoding': 'identity', ...(headers || {}) } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGetText(res.headers.location, headers));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.on('data', () => {});
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode} for ${url}`)));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

async function httpGetBuffer(url, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': '*/*', 'Accept-Encoding': 'identity', ...(headers || {}) } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGetBuffer(res.headers.location, headers));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.on('data', () => {});
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode} for ${url}`)));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function getYtDlpPath() {
  return path.join(app.getPath('userData'), 'yt-dlp.exe');
}

function getFfmpegDir() {
  return path.join(app.getPath('userData'), 'ffmpeg');
}

function getFfmpegExe() {
  return path.join(getFfmpegDir(), 'bin', 'ffmpeg.exe');
}

async function ensureYtDlp() {
  const ytDlpPath = getYtDlpPath();
  if (fs.existsSync(ytDlpPath)) {
    return ytDlpPath;
  }
  
  try {
    const buffer = await httpGetBuffer(YTDLP_URL);
    fs.writeFileSync(ytDlpPath, buffer);
    return ytDlpPath;
  } catch (e) {
    throw new Error('Failed to download yt-dlp: ' + e.message);
  }
}

async function ensureFfmpeg() {
  const ffmpegExe = getFfmpegExe();
  if (fs.existsSync(ffmpegExe)) {
    return ffmpegExe;
  }
  
  const zipPath = path.join(app.getPath('userData'), 'ffmpeg.zip');
  
  try {
    const buffer = await httpGetBuffer(FFMPEG_URL);
    fs.writeFileSync(zipPath, buffer);
    
    const ffmpegDir = getFfmpegDir();
    if (!fs.existsSync(ffmpegDir)) {
      fs.mkdirSync(ffmpegDir, { recursive: true });
    }
    
    await execAsync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${ffmpegDir}' -Force"`, { timeout: 120000 });
    
    const entries = fs.readdirSync(ffmpegDir);
    for (const entry of entries) {
      const entryPath = path.join(ffmpegDir, entry);
      const stat = fs.statSync(entryPath);
      if (stat.isDirectory() && entry.startsWith('ffmpeg-')) {
        const binDir = path.join(entryPath, 'bin');
        if (fs.existsSync(binDir) && fs.existsSync(path.join(binDir, 'ffmpeg.exe'))) {
          const finalDir = path.join(ffmpegDir, 'bin');
          if (!fs.existsSync(finalDir)) {
            fs.mkdirSync(finalDir, { recursive: true });
          }
          const finalExe = path.join(finalDir, 'ffmpeg.exe');
          fs.copyFileSync(path.join(binDir, 'ffmpeg.exe'), finalExe);
          if (fs.existsSync(path.join(binDir, 'ffprobe.exe'))) {
            fs.copyFileSync(path.join(binDir, 'ffprobe.exe'), path.join(finalDir, 'ffprobe.exe'));
          }
          fs.rmSync(entryPath, { recursive: true, force: true });
          break;
        }
      }
    }
    
    fs.unlinkSync(zipPath);
    
    if (!fs.existsSync(ffmpegExe)) {
      throw new Error('ffmpeg.exe not found after extraction');
    }
    
    return ffmpegExe;
  } catch (e) {
    throw new Error('Failed to download ffmpeg: ' + e.message);
  }
}

ipcMain.handle('download-vod', async (event, { downloadId, vodId, startTime, endTime }) => {
  const downloadsDir = app.getPath('downloads');
  const outputPath = path.join(downloadsDir, `run-vod-${vodId}-${Date.now()}.mp4`);
  const effectiveDownloadId = downloadId || `${vodId}-${Date.now()}`;

  try {
    const ytDlpPath = await ensureYtDlp();
    const ffmpegPath = await ensureFfmpeg();
    const section = `${startTime.toFixed(2)}-${endTime.toFixed(2)}`;
    const args = [
      '--ffmpeg-location', path.dirname(ffmpegPath),
      '--download-sections', `*${section}`,
      '--newline',
      '--no-color',
      '-o', outputPath,
      `https://www.twitch.tv/videos/${vodId}`
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(ytDlpPath, args, { cwd: app.getPath('userData') });
      activeDownloads.set(effectiveDownloadId, child);

      let stderr = '';
      let finished = false;

      child.on('error', (err) => {
        activeDownloads.delete(effectiveDownloadId);
        if (finished) return;
        finished = true;
        resolve({ success: false, error: 'Failed to start yt-dlp: ' + err.message });
      });

      const parseProgress = (text) => {
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const progressMatch = trimmed.match(/\[download\]\s+([\d.]+)%\s+of\s+([\d.]+(\w+)?)\s+at\s+([\d.]+(\w+\/s)?)\s+ETA\s+([\d:]+)/);
          if (progressMatch) {
            const percent = parseFloat(progressMatch[1]);
            const total = progressMatch[2] + (progressMatch[3] || '');
            const speed = progressMatch[4] + (progressMatch[5] || '');
            const eta = progressMatch[6];
            event.sender.send('download-vod-progress', {
              downloadId: effectiveDownloadId,
              percent: Math.min(100, Math.max(0, percent)),
              total,
              speed,
              eta,
            });
          }
        }
      };

      child.stdout.on('data', (data) => {
        const text = data.toString();
        parseProgress(text);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        parseProgress(text);
      });

      child.on('close', async (code) => {
        activeDownloads.delete(effectiveDownloadId);
        if (finished) return;
        finished = true;

        if (code === 0 && fs.existsSync(outputPath)) {
          resolve({ success: true, path: outputPath, downloadId: effectiveDownloadId });
        } else {
          const errorDetail = stderr.slice(-2000);
          resolve({ success: false, error: `Download failed with code ${code}: ${errorDetail || 'Unknown error'}`, downloadId: effectiveDownloadId });
        }
      });

      setTimeout(() => {
        if (!finished) {
          child.kill('SIGTERM');
          activeDownloads.delete(effectiveDownloadId);
          finished = true;
          resolve({ success: false, error: 'Download timed out after 5 minutes', downloadId: effectiveDownloadId });
        }
      }, 300000);
    });
  } catch (e) {
    return { success: false, error: 'Download failed: ' + (e.message || 'Unknown error'), downloadId: effectiveDownloadId };
  }
});

ipcMain.handle('cancel-download-vod', (event, downloadId) => {
  const child = activeDownloads.get(downloadId);
  if (child) {
    child.kill('SIGTERM');
    activeDownloads.delete(downloadId);
    return { success: true };
  }
  return { success: false, error: 'Download not found' };
});

ipcMain.handle('get-protocol-args', async () => {
  const args = pendingProtocolArgs;
  pendingProtocolArgs = null;
  return args ? { ...args, consumed: true } : null;
});

ipcMain.handle('show-save-dialog', async (event, opts) => {
  const result = await dialog.showSaveDialog(win, opts || {});
  return result;
});

ipcMain.handle('show-open-dialog', async (event, opts) => {
  const result = await dialog.showOpenDialog(win, opts || {});
  return result;
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('write-file', async (event, filePath, data) => {
  try {
    if (Buffer.isBuffer(data)) {
      fs.writeFileSync(filePath, data);
    } else if (ArrayBuffer.isView(data) || data instanceof ArrayBuffer) {
      fs.writeFileSync(filePath, Buffer.from(data));
    } else {
      fs.writeFileSync(filePath, String(data), 'utf8');
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('clear-cache', async () => {
  try {
    await session.defaultSession.clearCache();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-user-data-path', async () => {
  try {
    return { success: true, path: app.getPath('userData') };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('start-overlay-server', async () => {
  try {
    if (overlayHttpServer) return { success: true, url: 'http://127.0.0.1:' + OVERLAY_HTTP_PORT };
    const url = await startOverlayHttpServer();
    return { success: true, url };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('stop-overlay-server', async () => {
  stopOverlayHttpServer();
  return { success: true };
});
