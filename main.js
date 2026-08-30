const { app, BrowserWindow, ipcMain, shell, Menu, session, dialog, Tray } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');

const APP_VERSION = app.getVersion ? app.getVersion() : '2.1.3';
const REPO_OWNER = 'Olly033';
const REPO_NAME = 'Paceman-Desktop-App';
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

let activeDownloads = new Map();

let win;
let pendingProtocolArgs = null;
let overlayHttpServer = null;
const OVERLAY_HTTP_PORT = 9876;

function startOverlayHttpServer() {
  if (overlayHttpServer) return;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${OVERLAY_HTTP_PORT}`);
    const playerName = url.searchParams.get('player') || '';
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Paceman Overlay</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
    canvas { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <canvas id="c" width="600" height="140"></canvas>
  <script>
    const API = 'https://paceman.gg/stats/api';
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const player = decodeURIComponent('${playerName}');

    function fmt(ms) {
      const totalSec = Math.floor(ms / 1000);
      const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const s = String(totalSec % 60).padStart(2, '0');
      return h + ':' + m + ':' + s;
    }

    async function getJSON(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }

    function draw(overlay) {
      const bgOpacity = (overlay.settings && overlay.settings.bgOpacity != null ? overlay.settings.bgOpacity : 60) / 100;
      const bgColor = (overlay.settings && overlay.settings.bgColor) || '#000000';
      const faceLeft = !!(overlay.settings && overlay.settings.faceLeft);
      const paddingLeft = 24;
      const paddingRight = faceLeft ? 24 : 48;
      const avatarSize = 64;
      const frameHeight = 120;
      const frameTop = (H - frameHeight) / 2;
      const avatarX = faceLeft ? paddingLeft : W - avatarSize - paddingRight;
      const avatarY = frameTop + (frameHeight - avatarSize) / 2;
      const contentLeft = faceLeft ? paddingLeft + avatarSize + 12 : paddingLeft;
      const contentRight = faceLeft ? W - paddingRight : avatarX - 16;

      const run = overlay.run;
      const name = overlay.playerName || player || 'Player';
      const liveEvent = run ? run.furthestEvent : null;
      const liveKey = liveEvent ? liveEvent.key : null;
      const liveTime = liveEvent ? liveEvent.igt : null;
      const splitTimesFromRun = run ? run.splitTimes : {};
      const sessionEventKey = Object.keys(splitTimesFromRun).pop() || null;
      const currentKey = liveKey || sessionEventKey;
      const currentTime = liveTime != null ? liveTime : (sessionEventKey ? splitTimesFromRun[sessionEventKey] : null);

      const lines = [];
      lines.push({ text: name, font: 'bold 28px Inter, sans-serif', offset: 18 });
      if (currentKey) {
        lines.push({ text: currentKey, font: '22px Inter, sans-serif', offset: 14 });
        lines.push({ text: currentTime != null ? fmt(currentTime) : 'XX:XX', font: 'bold 28px Inter, sans-serif', offset: 18 });
      } else if (overlay.sessionRuns && overlay.sessionRuns.length > 0) {
        const nethers = overlay.sessionRuns.filter(r => r.nether != null).length;
        const avg = overlay.sessionRuns.filter(r => r.nether != null).reduce((a, b) => a + b, 0) / nethers;
        const nph = overlay.sessionNph && overlay.sessionNph.rnph != null ? overlay.sessionNph.rnph.toFixed(2) : '0.00';
        lines.push({ text: nethers + ' nethers · avg ' + fmt(Math.round(avg)) + ' · NPH ' + nph, font: '22px Inter, sans-serif', offset: 14 });
      }

      const lineHeight = 34;
      const totalLines = lines.length;
      const contentHeight = totalLines * lineHeight;
      const blockTop = frameTop + (frameHeight - contentHeight) / 2;
      let y = blockTop;

      const r = parseInt(bgColor.slice(1, 3), 16);
      const g = parseInt(bgColor.slice(3, 5), 16);
      const b = parseInt(bgColor.slice(5, 7), 16);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + bgOpacity + ')';
      const bgX = Math.min(contentLeft - 12, avatarX - 12);
      const bgY = frameTop;
      const bgW = Math.max(contentRight + 12, avatarX + avatarSize + 8) - bgX;
      ctx.beginPath();
      ctx.moveTo(bgX + 16, bgY);
      ctx.lineTo(bgX + bgW - 16, bgY);
      ctx.quadraticCurveTo(bgX + bgW, bgY, bgX + bgW, bgY + 16);
      ctx.lineTo(bgX + bgW, bgY + frameHeight - 16);
      ctx.quadraticCurveTo(bgX + bgW, bgY + frameHeight, bgX + bgW - 16, bgY + frameHeight);
      ctx.lineTo(bgX + 16, bgY + frameHeight);
      ctx.quadraticCurveTo(bgX, bgY + frameHeight, bgX, bgY + frameHeight - 16);
      ctx.lineTo(bgX, bgY + 16);
      ctx.quadraticCurveTo(bgX, bgY, bgX + 16, bgY);
      ctx.closePath();
      ctx.fill();

      lines.forEach((line) => {
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = line.font;
        ctx.fillText(line.text, contentLeft, y + line.offset);
        y += lineHeight;
      });

      if (player) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        ctx.clip();
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = 'https://crafatar.com/avatars/' + player + '?size=128';
        ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
        ctx.restore();
      }
    }

    async function update() {
      try {
        const [runData, sessionData, nphData] = await Promise.all([
          getJSON(API + '/getRecentRuns?name=' + encodeURIComponent(player) + '&hours=1&limit=10'),
          getJSON(API + '/getRecentRuns?name=' + encodeURIComponent(player) + '&hours=999999&hoursBetween=24&limit=5000'),
          getJSON(API + '/getNPH?name=' + encodeURIComponent(player) + '&hours=24&hoursBetween=1')
        ]);
        const runs = Array.isArray(runData) ? runData : [];
        const sessions = Array.isArray(sessionData) ? sessionData : [];
        const latest = runs.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0))[0] || null;
        const withTime = sessions.map(r => ({ ...r, _ts: r.lastUpdated || 0 })).filter(r => r._ts > 0).sort((a, b) => b._ts - a._ts);
        const anchor = withTime[0];
        const sessionRuns = anchor ? withTime.filter(r => anchor._ts - r._ts <= 2 * 60 * 60) : [];
        draw({
          playerName: player,
          run: latest,
          sessionRuns: sessionRuns,
          sessionNph: nphData,
          settings: { bgOpacity: 60, bgColor: '#000000', faceLeft: false }
        });
      } catch (e) {
        console.error('Overlay update failed:', e);
      }
    }
    setInterval(update, 1000);
    update();
  </script>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
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
      console.log('paceman:// protocol registered');
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
    webSecurity: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  if (pendingProtocolArgs) {
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('protocol-args', pendingProtocolArgs);
      pendingProtocolArgs = null;
    });
  }

  win.loadFile('renderer/index.html');

  win.on('minimize', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
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
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
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
  Menu.setApplicationMenu(null);
  createWindow();
  ensureProtocolRegistered();
  ensureYtDlp().catch((e) => console.warn('yt-dlp pre-download failed:', e.message));
  ensureFfmpeg().catch((e) => console.warn('ffmpeg pre-download failed:', e.message));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
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

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'Paceman-Desktop-App/2.1.3' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('GitHub API returned HTTP ' + res.statusCode));
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          resolve(data);
        } catch (e) {
          reject(new Error('Invalid JSON from GitHub releases'));
        }
      });
    }).on('error', reject);
  });
}

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

ipcMain.handle('fetch-json', async (event, url) => {
  try {
    const resp = await new Promise((resolve, reject) => {
      const req = https.request(url, { method: 'GET', headers: { 'User-Agent': 'Paceman-Desktop-App/2.1.3' } }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end();
    });
    if (resp.status < 200 || resp.status >= 300) throw new Error('HTTP ' + resp.status);
    return JSON.parse(resp.data);
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
    const req = mod.get(url, { headers: { 'User-Agent': 'Paceman-Desktop-App/2.1.3', 'Accept': '*/*', 'Accept-Encoding': 'identity', ...(headers || {}) } }, (res) => {
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
    const req = mod.get(url, { headers: { 'User-Agent': 'Paceman-Desktop-App/2.1.3', 'Accept': '*/*', 'Accept-Encoding': 'identity', ...(headers || {}) } }, (res) => {
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
  console.log('download-vod called:', { downloadId, vodId, startTime, endTime });
  console.log('Event sender:', event.sender);
  console.log('Event sender id:', event.sender.id);
  const downloadsDir = app.getPath('downloads');
  const outputPath = path.join(downloadsDir, `run-vod-${vodId}-${Date.now()}.mp4`);
  const effectiveDownloadId = downloadId || `${vodId}-${Date.now()}`;
  
  try {
    console.log('Ensuring yt-dlp...');
    const ytDlpPath = await ensureYtDlp();
    console.log('yt-dlp path:', ytDlpPath);
    console.log('Ensuring ffmpeg...');
    const ffmpegPath = await ensureFfmpeg();
    console.log('ffmpeg path:', ffmpegPath);
    const section = `${startTime.toFixed(2)}-${endTime.toFixed(2)}`;
    const args = [
      '--ffmpeg-location', path.dirname(ffmpegPath),
      '--download-sections', `*${section}`,
      '--newline',
      '--no-color',
      '-o', outputPath,
      `https://www.twitch.tv/videos/${vodId}`
    ];
    console.log('Spawning yt-dlp with args:', args);
    
    return new Promise((resolve, reject) => {
      console.log('Spawning yt-dlp...');
      const child = spawn(ytDlpPath, args, { cwd: app.getPath('userData') });
      console.log('yt-dlp spawned, pid:', child.pid);
      activeDownloads.set(downloadId, child);
      
      let stderr = '';
      let finished = false;
      
      child.on('error', (err) => {
        console.log('yt-dlp error:', err);
        activeDownloads.delete(downloadId);
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
            console.log('Progress parsed:', percent, total, speed, eta);
            event.sender.send('download-vod-progress', {
              downloadId,
              percent: Math.min(100, Math.max(0, percent)),
              total,
              speed,
              eta,
            });
          } else if (trimmed.includes('[download]')) {
            console.log('Download line (no match):', trimmed);
          }
        }
      };
      
      child.stdout.on('data', (data) => {
        const text = data.toString();
        console.log('yt-dlp stdout:', text.slice(0, 200));
        parseProgress(text);
      });
      
      child.stderr.on('data', (data) => {
        const text = data.toString();
        console.log('yt-dlp stderr:', text.slice(0, 200));
        stderr += text;
        parseProgress(text);
      });
      
      child.on('close', async (code) => {
        console.log('yt-dlp closed with code:', code);
        activeDownloads.delete(downloadId);
        if (finished) return;
        finished = true;
        
        if (code === 0 && fs.existsSync(outputPath)) {
          resolve({ success: true, path: outputPath });
        } else {
          const errorDetail = stderr.slice(-2000);
          resolve({ success: false, error: `Download failed with code ${code}: ${errorDetail || 'Unknown error'}` });
        }
      });
      
      console.log('Waiting for yt-dlp to finish...');
      
      setTimeout(() => {
        if (!finished) {
          console.log('Download timeout - killing yt-dlp');
          child.kill('SIGTERM');
          activeDownloads.delete(downloadId);
          finished = true;
          resolve({ success: false, error: 'Download timed out after 5 minutes' });
        }
      }, 300000);
    });
  } catch (e) {
    return { success: false, error: 'Download failed: ' + (e.message || 'Unknown error') };
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
