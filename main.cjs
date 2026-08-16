const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (app.isPackaged) {
    // In production, spawn the bundled server using Electron's Node environment
    serverProcess = fork(path.join(__dirname, 'dist', 'server.cjs'), [], {
      env: { 
        ...process.env, 
        ELECTRON_RUN_AS_NODE: '1', 
        NODE_ENV: 'production', 
        PORT: '3000' 
      }
    });

    // Wait for the local server to be ready before loading the URL
    const checkServer = setInterval(() => {
      http.get('http://localhost:3000', (res) => {
        if (res.statusCode === 200 || res.statusCode === 304 || res.statusCode === 404) {
          clearInterval(checkServer);
          mainWindow.loadURL('http://localhost:3000');
        }
      }).on('error', () => { /* ignore connection refused until ready */ });
    }, 500);
  } else {
    // In development mode, wait-on ensures the server is running before electron starts
    mainWindow.loadURL('http://localhost:3000');
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
