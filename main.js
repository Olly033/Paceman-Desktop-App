const { app, BrowserWindow, ipcMain, shell, Menu, session } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');

const APP_VERSION = app.getVersion ? app.getVersion() : '2.1.1';
const REPO_OWNER = 'Olly033';
const REPO_NAME = 'Paceman-Desktop-App';

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
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

async function getVodAccessToken(vodId) {
  const url = `https://api.twitch.tv/api/vods/${vodId}/access_token?client_id=kimne78kx3ncx6brgo4mv6wki5h1ko`;
  const text = await httpGetText(url);
  const data = JSON.parse(text);
  if (!data || !data.token) throw new Error('Failed to get VOD access token');
  return data;
}

async function getM3U8(vodId, token, sig) {
  const params = new URLSearchParams({
    allow_source: 'true',
    allow_audio_only: 'true',
    allow_spectre: 'false',
    player: 'twitchweb',
    p: String(Math.floor(Math.random() * 999999)),
    type: 'any',
    nauth: token,
    nauthsig: sig,
  });
  const url = `https://usher.twitch.tv/api/channel/hls/${vodId}.m3u8?${params.toString()}`;
  return await httpGetText(url);
}

function parseM3U8(content, baseUrl) {
  const lines = content.split(/\r?\n/);
  const segments = [];
  let currentDuration = 0;
  let currentTime = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:([\d.]+)/);
      if (match) {
        currentDuration = parseFloat(match[1]);
      }
    } else if (line && !line.startsWith('#')) {
      let segmentUrl = line;
      if (!segmentUrl.startsWith('http')) {
        const base = baseUrl || `https://usher.twitch.tv/api/channel/hls/${Date.now()}`;
        segmentUrl = new URL(segmentUrl, base).toString();
      }
      segments.push({
        url: segmentUrl,
        duration: currentDuration,
        startTime: currentTime,
        endTime: currentTime + currentDuration,
      });
      currentTime += currentDuration;
      currentDuration = 0;
    }
  }
  
  return segments;
}

async function downloadVodSegment(url) {
  return await httpGetBuffer(url);
}

ipcMain.handle('download-vod', async (event, { vodId, startTime, endTime }) => {
  const downloadsDir = app.getPath('downloads');
  const outputPath = path.join(downloadsDir, `run-vod-${vodId}-${Date.now()}.ts`);
  
  try {
    const { token, sig } = await getVodAccessToken(vodId);
    const m3u8Content = await getM3U8(vodId, token, sig);
    const baseM3U8 = `https://usher.twitch.tv/api/channel/hls/${vodId}.m3u8`;
    const segments = parseM3U8(m3u8Content, baseM3U8);
    
    if (segments.length === 0) {
      return { success: false, error: 'No VOD segments found. The VOD may be unavailable or expired.' };
    }
    
    const relevantSegments = segments.filter(s => s.endTime > startTime && s.startTime < endTime);
    if (relevantSegments.length === 0) {
      return { success: false, error: 'No segments found in the requested time range.' };
    }
    
    const buffers = [];
    for (const segment of relevantSegments) {
      try {
        const buffer = await downloadVodSegment(segment.url);
        buffers.push(buffer);
      } catch (e) {
        console.error('Failed to download segment:', segment.url, e);
      }
    }
    
    if (buffers.length === 0) {
      return { success: false, error: 'Failed to download any VOD segments.' };
    }
    
    const combined = Buffer.concat(buffers);
    fs.writeFileSync(outputPath, combined);
    
    return { success: true, path: outputPath };
  } catch (e) {
    return { success: false, error: 'Download failed: ' + e.message };
  }
});

ipcMain.handle('get-protocol-args', async () => {
  const args = pendingProtocolArgs;
  pendingProtocolArgs = null;
  return args ? { ...args, consumed: true } : null;
});
