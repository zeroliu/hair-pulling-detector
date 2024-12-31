const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  systemPreferences,
} = require('electron');
const path = require('path');

let mainWindow;

// Request notification permissions on macOS
async function checkNotificationPermission() {
  if (process.platform === 'darwin') {
    const permission = await systemPreferences.getMediaAccessStatus('camera');
    if (!systemPreferences.getNotificationSettings) {
      console.log('Notification settings API not available');
      return;
    }
    const notificationSettings = systemPreferences.getNotificationSettings();
    console.log('Notification settings:', notificationSettings);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      additionalArguments: ['--no-sandbox'],
      backgroundThrottling: false,
    },
    backgroundColor: '#000000',
  });

  // Prevent window from being garbage collected when hidden
  mainWindow.setBackgroundThrottling(false);

  // Handle window close event
  mainWindow.on('close', function (event) {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  // Set Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: https://cdn.jsdelivr.net https://*.tensorflow.org https://tfhub.dev https://*.tfhub.dev https://storage.googleapis.com https://*.kaggle.com; connect-src 'self' https://cdn.jsdelivr.net https://*.tensorflow.org https://tfhub.dev https://*.tfhub.dev https://storage.googleapis.com https://www.tensorflow.org https://*.kaggle.com https://www.kaggle.com",
          ],
        },
      });
    },
  );

  // Load the index.html file
  const startUrl = path.join(app.getAppPath(), 'index.html');
  mainWindow.loadFile(startUrl).catch((err) => {
    console.error('Error loading index.html:', err);
    console.log('Attempted to load:', startUrl);
    console.log('App path:', app.getAppPath());
  });

  // Create application menu
  const template = [
    {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          click: () => mainWindow.minimize(),
        },
        {
          label: 'Hide',
          click: () => mainWindow.hide(),
        },
        { type: 'separator' },
        {
          label: 'Toggle DevTools',
          accelerator:
            process.platform === 'darwin' ? 'Cmd+Option+I' : 'Ctrl+Shift+I',
          click: () => mainWindow.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            app.isQuitting = true;
            app.quit();
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Log any page errors
  mainWindow.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription) => {
      console.error('Page failed to load:', errorCode, errorDescription);
    },
  );
}

// Function to show notification
function showNotification(title, body) {
  if (!Notification.isSupported()) {
    console.error('System notifications not supported');
    return false;
  }

  try {
    // Create notification
    const notification = new Notification({
      title,
      body,
      silent: false,
      subtitle: 'Hair Pulling Detection',
      urgency: 'critical',
      timeoutType: 'never',
      sound: true,
      closeButtonText: 'Dismiss',
    });

    // Show notification
    notification.show();

    // Play system notification sound on macOS
    if (process.platform === 'darwin') {
      const { exec } = require('child_process');
      exec('afplay /System/Library/Sounds/Glass.aiff');
    }

    // Focus window when notification is clicked
    notification.on('click', () => {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    });

    console.log('System notification shown');
    return true;
  } catch (error) {
    console.error('Error showing notification:', error);
    console.error('Error details:', error.stack);
    return false;
  }
}

app.whenReady().then(async () => {
  // Check notification permissions
  await checkNotificationPermission();

  // Set notification app name
  if (process.platform === 'darwin') {
    app.setName('Hair Pulling Detector');
  }

  createWindow();

  // Enable IPC communication for notifications
  const { ipcMain } = require('electron');

  // Handle notification support check
  ipcMain.on('check-notification-support', (event) => {
    const isSupported = Notification.isSupported();
    console.log('Notification support check:', isSupported);
    event.reply('notification-support', isSupported);
  });

  // Handle notification requests
  ipcMain.on('show-notification', (event, { title, body }) => {
    console.log('Received notification request:', { title, body });
    const success = showNotification(title, body);
    event.reply('notification-sent', success);

    // If notification failed, try to show the window
    if (!success && mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
});

// Prevent app from quitting when all windows are closed on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle activation when the dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
