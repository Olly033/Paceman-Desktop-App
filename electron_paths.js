const { app } = require('electron');
app.whenReady().then(() => {
  console.log('userData:', app.getPath('userData'));
  console.log('cache:', app.getPath('cache'));
  console.log('temp:', app.getPath('temp'));
}).catch((e) => {
  console.error('Failed to get paths:', e);
});
