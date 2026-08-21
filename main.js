const { app, BrowserWindow, ipcMain, shell, Menu, session } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');

const APP_VERSION = app.getVersion ? app.getVersion() : '2.1.1';
const REPO_OWNER = 'Olly033';
const REPO_NAME = 'Paceman-Desktop-App';
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

let activeDownloads = new Map();

let win;
let pendingProtocolArgs = null;

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
}

app.whenReady().then(async () => {
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

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'Paceman-Desktop-App/2.1.1' } }, (res) => {
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
      const req = https.request(url, { method: 'GET', headers: { 'User-Agent': 'Paceman-Desktop-App/2.1.1' } }, (res) => {
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
    const req = mod.get(url, { headers: { 'User-Agent': 'Paceman-Desktop-App/2.1.1', 'Accept': '*/*', 'Accept-Encoding': 'identity', ...(headers || {}) } }, (res) => {
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
    const req = mod.get(url, { headers: { 'User-Agent': 'Paceman-Desktop-App/2.1.1', 'Accept': '*/*', 'Accept-Encoding': 'identity', ...(headers || {}) } }, (res) => {
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
      const child = spawn(ytDlpPath, args, { cwd: app.getPath('userData') });
      activeDownloads.set(downloadId, child);
      
      let stderr = '';
      let finished = false;
      
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
        console.log('yt-dlp stdout:', text.slice(0, 500));
        parseProgress(text);
      });
      
      child.stderr.on('data', (data) => {
        const text = data.toString();
        console.log('yt-dlp stderr:', text.slice(0, 500));
        stderr += text;
        parseProgress(text);
      });
      
      child.on('close', async (code) => {
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
      
      child.on('error', (err) => {
        activeDownloads.delete(downloadId);
        if (finished) return;
        finished = true;
        resolve({ success: false, error: 'Failed to start yt-dlp: ' + err.message });
      });
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
