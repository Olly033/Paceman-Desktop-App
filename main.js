const { app, BrowserWindow, ipcMain, shell, Menu, session } = require('electron');
const path = require('path');
const https = require('https');

const APP_VERSION = app.getVersion ? app.getVersion() : '2.1.0';
const REPO_OWNER = 'Olly033';
const REPO_NAME = 'Paceman-Desktop-App';

let win;

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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
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

ipcMain.handle('check-for-updates', async () => {
  try {
    const info = await checkGithubLatest();
    const current = APP_VERSION;
    const isNewer = info.latestVersion !== current;
    return { success: true, current, latest: info.latestVersion, isNewer, downloadUrl: info.downloadUrl, releaseName: info.releaseName };
  } catch (e) {
    return { success: false, error: e.message || 'Failed to check for updates' };
  }
});

ipcMain.handle('fetch-json', async (event, url) => {
  try {
    const resp = await new Promise((resolve, reject) => {
      const req = https.request(url, { method: 'GET' }, (res) => {
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
