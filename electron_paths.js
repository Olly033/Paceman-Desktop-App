const { app } = require('electron');
console.log('userData:', app.getPath('userData'));
console.log('cache:', app.getPath('cache'));
console.log('temp:', app.getPath('temp'));
