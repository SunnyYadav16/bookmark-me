const { app, BrowserWindow, Tray, Menu, globalShortcut, clipboard, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');
const natural = require('natural');
const similarity = require('similarity');
const axios = require('axios');
const { spawn } = require('child_process');

class PythonLLMService {
  constructor() {
    this.serviceUrl = 'http://127.0.0.1:5000';
    this.isAvailable = false;
    this.pythonProcess = null;
    this.initializationAttempts = 0;
    this.maxInitAttempts = 10;

    // Start Python service
    this.startPythonService();
  }

  startPythonService() {
    try {
      console.log('🚀 Starting Python LLM service...');

      // Determine Python executable path
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

      // Path to your Python LLM service script
      const servicePath = path.join(__dirname, '..', 'llm_service.py');

      // Start Python service with your preferred model
      this.pythonProcess = spawn(pythonCmd, [
        servicePath,
        '--model', 'deepseek_7b',  // or 'gemma-3_1b'
        '--processor', 'cpu',      // or 'npu' for Snapdragon
        '--port', '5000'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      });

      this.pythonProcess.stdout.on('data', (data) => {
        console.log(`Python LLM: ${data.toString().trim()}`);
      });

      this.pythonProcess.stderr.on('data', (data) => {
        console.error(`Python LLM Error: ${data.toString().trim()}`);
      });

      this.pythonProcess.on('close', (code) => {
        console.log(`Python LLM service exited with code ${code}`);
        this.isAvailable = false;
      });

      // Wait for service to start, then check connection
      setTimeout(() => {
        this.checkConnection();
      }, 3000);

    } catch (error) {
      console.error('Failed to start Python LLM service:', error);
      this.isAvailable = false;
    }
  }

  async checkConnection() {
    try {
      const response = await axios.get(`${this.serviceUrl}/status`, { timeout: 5000 });

      if (response.data.available) {
        this.isAvailable = true;
        console.log('✅ Python LLM service connected:', response.data.model);
        return true;
      } else {
        console.log('⏳ Python LLM service loading...');

        // Retry connection
        if (this.initializationAttempts < this.maxInitAttempts) {
          this.initializationAttempts++;
          setTimeout(() => this.checkConnection(), 2000);
        }
        return false;
      }
    } catch (error) {
      console.log('🔴 Python LLM service not available:', error.message);

      // Retry connection
      if (this.initializationAttempts < this.maxInitAttempts) {
        this.initializationAttempts++;
        setTimeout(() => this.checkConnection(), 2000);
      }

      this.isAvailable = false;
      return false;
    }
  }

  async analyzeCode(content) {
    if (!this.isAvailable) {
      await this.checkConnection();
      if (!this.isAvailable) return null;
    }

    try {
      const response = await axios.post(`${this.serviceUrl}/analyze`, {
        content: content
      }, { timeout: 30000 });

      return response.data;
    } catch (error) {
      console.error('LLM analysis error:', error);
      return null;
    }
  }

  async explainCode(content) {
    if (!this.isAvailable) return 'LLM service not available';

    try {
      const response = await axios.post(`${this.serviceUrl}/explain`, {
        content: content
      }, { timeout: 30000 });

      return response.data.explanation;
    } catch (error) {
      console.error('LLM explanation error:', error);
      return 'Error explaining code';
    }
  }

  async suggestOptimizations(content) {
    if (!this.isAvailable) return 'LLM service not available';

    try {
      const response = await axios.post(`${this.serviceUrl}/optimize`, {
        content: content
      }, { timeout: 30000 });

      return response.data.suggestions;
    } catch (error) {
      console.error('LLM optimization error:', error);
      return 'Error generating suggestions';
    }
  }

  async getRelatedQueries(content) {
    if (!this.isAvailable) return [];

    try {
      const response = await axios.post(`${this.serviceUrl}/related`, {
        content: content
      }, { timeout: 15000 });

      return response.data.queries;
    } catch (error) {
      console.error('LLM related queries error:', error);
      return [];
    }
  }

  async semanticSearch(query, bookmarks) {
    if (!this.isAvailable || bookmarks.length === 0) return bookmarks;

    try {
      const response = await axios.post(`${this.serviceUrl}/search`, {
        query: query,
        bookmarks: bookmarks
      }, { timeout: 30000 });

      return response.data.bookmarks;
    } catch (error) {
      console.error('Semantic search error:', error);
      return bookmarks;
    }
  }

  cleanup() {
    if (this.pythonProcess) {
      console.log('🔄 Shutting down Python LLM service...');
      this.pythonProcess.kill('SIGTERM');
      this.pythonProcess = null;
    }
  }

  // Fallback methods when LLM is unavailable
  fallbackAnalysis(content) {
    return {
      title: this.extractTitle(content),
      tags: this.generateTags(content),
      summary: this.generateSummary(content),
      language: this.detectLanguage(content)
    };
  }

  extractTitle(content) {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length === 0) return 'Untitled';
    const firstLine = lines[0].trim();
    return firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
  }

  generateTags(content) {
    const tags = new Set();
    const lowercased = content.toLowerCase();

    const languageKeywords = {
      'javascript': ['function', 'const', 'let', 'var', 'async', 'await'],
      'python': ['def', 'class', 'import', 'from', 'lambda'],
      'java': ['public', 'private', 'class', 'interface', 'static'],
      'cpp': ['#include', 'namespace', 'class', 'struct'],
      'sql': ['select', 'insert', 'update', 'delete', 'create']
    };

    for (const [lang, keywords] of Object.entries(languageKeywords)) {
      if (keywords.some(keyword => lowercased.includes(keyword))) {
        tags.add(lang);
      }
    }

    return Array.from(tags);
  }

  generateSummary(content) {
    const words = content.split(/\s+/);
    return words.length > 20 ? words.slice(0, 20).join(' ') + '...' : content;
  }

  detectLanguage(content) {
    const lowercased = content.toLowerCase();
    if (lowercased.includes('def ') || lowercased.includes('import ')) return 'python';
    if (lowercased.includes('function ') || lowercased.includes('const ')) return 'javascript';
    if (lowercased.includes('public class')) return 'java';
    if (lowercased.includes('#include')) return 'cpp';
    if (lowercased.includes('select ')) return 'sql';
    return 'text';
  }
}

// Try to import clipboard monitoring libraries
let clipboardy = null;
try {
  clipboardy = require('clipboardy');
} catch (e) {
  console.log('clipboardy not available, using fallback');
}

// Initialize persistent storage
const store = new Store({
  name: 'codebookmarks',
  defaults: {
    bookmarks: [],
    settings: {
      shortcut: 'CommandOrControl+Shift+B',
      autoTag: true,
      deduplicate: true,
      minSimilarity: 0.8,
      clipboardMonitoring: true
    }
  }
});

class CodeBookmarkApp {
  constructor() {
    this.mainWindow = null;
    this.tray = null;
    this.overlayWindow = null;
    this.bookmarks = store.get('bookmarks', []);
    this.settings = store.get('settings', {});
    this.lastClipboardContent = '';
    this.clipboardMonitorInterval = null;
    this.recentClipboardHistory = [];
    this.overlayTimeout = null;
    this.llmService = new PythonLLMService();
  }

  async createWindow() {
    console.log('Creating main window...');

    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      show: false, // Keep window hidden by default
      icon: this.createIcon()
    });

    try {
      const htmlPath = path.join(__dirname, 'renderer', 'index.html');
      console.log('Loading HTML file from:', htmlPath);

      await this.mainWindow.loadFile(htmlPath);
      console.log('Main window created and loaded (hidden)');
    } catch (error) {
      console.error('Error loading main window:', error);

      // Try alternative path
      try {
        await this.mainWindow.loadFile('src/renderer/index.html');
        console.log('Main window loaded with alternative path (hidden)');
      } catch (altError) {
        console.error('Alternative path also failed:', altError);
      }
    }

    // Hide window instead of closing
    this.mainWindow.on('close', (event) => {
      if (!app.isQuiting) {
        event.preventDefault();
        this.mainWindow.hide();

        // Hide dock icon when window is hidden (back to background mode)
        if (process.platform === 'darwin') {
          app.dock.hide();
        }

        console.log('Main window hidden');
      }
    });

    // Add window state logging
    this.mainWindow.on('show', () => {
      console.log('Main window shown');
    });

    this.mainWindow.on('hide', () => {
      console.log('Main window hidden');

      // Hide dock icon when window is hidden (back to background mode)
      if (process.platform === 'darwin') {
        app.dock.hide();
      }
    });

    // Add error logging
    this.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('Window failed to load:', errorCode, errorDescription);
    });
  }

  createOverlayWindow() {
    console.log('Creating overlay window...');

    this.overlayWindow = new BrowserWindow({
      width: 180,
      height: 60,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    // Create overlay HTML content
    const overlayHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: transparent;
            user-select: none;
            -webkit-user-select: none;
            -webkit-app-region: no-drag;
          }
          
          .overlay-container {
            background: rgba(74, 144, 226, 0.95);
            border-radius: 8px;
            padding: 8px 12px;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            animation: slideIn 0.2s ease-out;
          }
          
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          
          .bookmark-icon {
            font-size: 16px;
            color: white;
          }
          
          .bookmark-text {
            color: white;
            font-size: 12px;
            font-weight: 500;
            margin: 0;
          }
          
          .overlay-container:hover {
            background: rgba(74, 144, 226, 1);
            transform: scale(1.05);
            transition: all 0.2s ease;
            cursor: pointer;
          }
          
          .close-btn {
            background: none;
            border: none;
            color: white;
            font-size: 14px;
            cursor: pointer;
            padding: 0;
            margin-left: 4px;
            opacity: 0.7;
          }
          
          .close-btn:hover {
            opacity: 1;
          }
        </style>
      </head>
      <body>
        <div class="overlay-container" onclick="bookmarkSelected()">
          <span class="bookmark-icon">📚</span>
          <span class="bookmark-text">Bookmark</span>
          <button class="close-btn" onclick="event.stopPropagation(); closeOverlay()">×</button>
        </div>
        
        <script>
          const { ipcRenderer } = require('electron');
          
          function bookmarkSelected() {
            console.log('Bookmark button clicked');
            ipcRenderer.send('bookmark-from-overlay');
          }
          
          function closeOverlay() {
            console.log('Close button clicked');
            ipcRenderer.send('hide-overlay');
          }
          
          // Auto-hide after 4 seconds
          setTimeout(() => {
            ipcRenderer.send('hide-overlay');
          }, 4000);
        </script>
      </body>
      </html>
    `;

    this.overlayWindow.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(overlayHTML));

    this.overlayWindow.on('blur', () => {
      // Hide overlay when it loses focus
      this.hideOverlay();
    });

    console.log('Overlay window created');
  }

  showOverlay() {
    if (!this.overlayWindow) {
      this.createOverlayWindow();
    }

    // Get cursor position
    const cursor = screen.getCursorScreenPoint();

    // Position overlay near cursor, but avoid screen edges
    const display = screen.getDisplayNearestPoint(cursor);
    let x = cursor.x + 10;
    let y = cursor.y - 70;

    // Keep overlay within screen bounds
    if (x + 180 > display.bounds.x + display.bounds.width) {
      x = cursor.x - 190;
    }
    if (y < display.bounds.y) {
      y = cursor.y + 20;
    }

    this.overlayWindow.setPosition(x, y);
    this.overlayWindow.show();
    this.overlayWindow.focus();

    console.log('Overlay shown at position:', x, y);

    // Clear any existing timeout
    if (this.overlayTimeout) {
      clearTimeout(this.overlayTimeout);
    }

    // Auto-hide after 5 seconds
    this.overlayTimeout = setTimeout(() => {
      this.hideOverlay();
    }, 5000);
  }

  hideOverlay() {
    if (this.overlayWindow && this.overlayWindow.isVisible()) {
      this.overlayWindow.hide();
      console.log('Overlay hidden');
    }

    if (this.overlayTimeout) {
      clearTimeout(this.overlayTimeout);
      this.overlayTimeout = null;
    }
  }

  createTray() {
    try {
      console.log('Creating tray icon...');

      if (process.platform === 'darwin') {
        // Option 1: Try creating icon first
        try {
          const trayIcon = this.createIcon();
          this.tray = new Tray(trayIcon);
        } catch (iconError) {
          console.log('Icon creation failed, using text fallback');
          // Option 2: Use empty icon and set title (text in menu bar)
          this.tray = new Tray(nativeImage.createEmpty());
          this.tray.setTitle('CB'); // This will show "CB" in the menu bar
        }
      } else {
        // Windows/Linux
        const trayIcon = this.createIcon();
        this.tray = new Tray(trayIcon);
      }

      // Set tooltip
      this.tray.setToolTip('CodeBookmark - Click to open');

      // Initial tray menu
      this.updateTrayMenu();

      // Click handlers
      this.tray.on('click', (event) => {
        console.log('Tray clicked');

        // On macOS with right button, show menu
        if (process.platform === 'darwin' && event.altKey) {
          this.tray.popUpContextMenu();
        } else {
          this.showAppWithDebug();
        }
      });

      this.tray.on('right-click', () => {
        console.log('Tray right-clicked - showing menu');
        this.tray.popUpContextMenu();
      });

      console.log('System tray created successfully');

      // Verify tray is working
      setTimeout(() => {
        if (this.tray && !this.tray.isDestroyed()) {
          const bounds = this.tray.getBounds();
          console.log('Tray bounds:', bounds);

          // Show success notification
          this.showNotification('CodeBookmark is running! Look for the icon in your menu bar.');
        }
      }, 1000);

    } catch (error) {
      console.error('Error creating system tray:', error);
      console.error('Stack trace:', error.stack);

      // Don't show error dialog, just use fallback
      console.log('Tray creation failed, app will run without tray icon');

      // Ensure the app still works without tray
      this.showNotification('App is running! Use Cmd+Shift+B to bookmark.');

      // Show the window so user can access the app
      setTimeout(() => {
        this.showAppWithDebug();
      }, 1000);
    }
  }

  async createIconFile() {
    const fs = require('fs').promises;
    const path = require('path');

    try {
      // Create a simple 16x16 PNG file
      const size = 16;
      const PNG = require('pngjs').PNG;
      const png = new PNG({ width: size, height: size });

      // Draw a simple black "B" on transparent background
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = (size * y + x) << 2;

          // Default: transparent
          png.data[idx] = 0;
          png.data[idx + 1] = 0;
          png.data[idx + 2] = 0;
          png.data[idx + 3] = 0;

          // Draw "B" pattern
          if ((x === 4 && y >= 3 && y <= 12) || // Vertical line
              (y === 3 && x >= 4 && x <= 10) ||  // Top line
              (y === 7 && x >= 4 && x <= 9) ||   // Middle line
              (y === 12 && x >= 4 && x <= 10)) { // Bottom line
            png.data[idx] = 0;     // R
            png.data[idx + 1] = 0; // G
            png.data[idx + 2] = 0; // B
            png.data[idx + 3] = 255; // A
          }
        }
      }

      const buffer = PNG.sync.write(png);
      const iconPath = path.join(__dirname, 'tray-icon.png');
      await fs.writeFile(iconPath, buffer);

      console.log('Created icon file at:', iconPath);
      return iconPath;
    } catch (error) {
      console.error('Failed to create icon file:', error);
      return null;
    }
  }

  createIcon() {
    try {
      const size = 16;
      const scaleFactor = 1;

      // Create buffer for a 16x16 RGBA image
      const buffer = Buffer.alloc(size * size * 4);

      // Fill with transparent background
      buffer.fill(0);

      // Modern bookmark icon design
      // Create a sleek bookmark shape with better proportions
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = (y * size + x) * 4;

          // Bookmark outline (modern rectangular bookmark with notch at bottom)
          const isInBookmark = (
              // Main rectangle body
              (x >= 4 && x <= 11 && y >= 2 && y <= 13) ||
              // Bottom notch (V-shape)
              (x === 5 && y === 14) ||
              (x === 6 && y === 15) ||
              (x === 7 && y === 15) ||
              (x === 8 && y === 15) ||
              (x === 9 && y === 15) ||
              (x === 10 && y === 14)
          );

          // Inner area (slightly smaller for hollow effect)
          const isInner = (
              x >= 5 && x <= 10 && y >= 3 && y <= 12
          );

          if (isInBookmark && !isInner) {
            // Solid bookmark outline
            buffer[idx] = 0;       // R
            buffer[idx + 1] = 0;   // G
            buffer[idx + 2] = 0;   // B
            buffer[idx + 3] = 255; // A (opaque)
          } else if (isInner) {
            // Slightly transparent inner area for depth
            buffer[idx] = 0;       // R
            buffer[idx + 1] = 0;   // G
            buffer[idx + 2] = 0;   // B
            buffer[idx + 3] = 80;  // A (semi-transparent)
          }

          // Add small accent dots for visual interest
          if ((x === 6 && y === 5) || (x === 9 && y === 5) ||
              (x === 6 && y === 7) || (x === 9 && y === 7) ||
              (x === 6 && y === 9) || (x === 9 && y === 9)) {
            buffer[idx] = 0;       // R
            buffer[idx + 1] = 0;   // G
            buffer[idx + 2] = 0;   // B
            buffer[idx + 3] = 255; // A (opaque)
          }
        }
      }

      // Create the native image
      const icon = nativeImage.createFromBuffer(buffer, {
        width: size,
        height: size,
        scaleFactor
      });

      // IMPORTANT: Set as template image for macOS
      if (process.platform === 'darwin') {
        icon.setTemplateImage(true);
      }

      // Verify icon is not empty
      if (icon.isEmpty()) {
        throw new Error('Created icon is empty');
      }

      console.log('Better bookmark icon created successfully, size:', icon.getSize());
      return icon;

    } catch (error) {
      console.error('Error in createIcon:', error);
      return this.createFallbackIcon();
    }
  }

// Add this new method right after createIcon():
  createFallbackIcon() {
    try {
      // Fallback: Create a simple but clean dot icon
      const size = 16;
      const buffer = Buffer.alloc(size * size * 4);

      // Create a clean circular dot in the center
      const centerX = 8;
      const centerY = 8;
      const radius = 3;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
          if (distance <= radius) {
            const idx = (y * size + x) * 4;
            buffer[idx] = 0;       // R
            buffer[idx + 1] = 0;   // G
            buffer[idx + 2] = 0;   // B
            buffer[idx + 3] = 255; // A
          }
        }
      }

      const fallbackIcon = nativeImage.createFromBuffer(buffer, {
        width: size,
        height: size
      });

      if (process.platform === 'darwin') {
        fallbackIcon.setTemplateImage(true);
      }

      console.log('Fallback icon created successfully');
      return fallbackIcon;
    } catch (error) {
      console.error('Even fallback icon failed:', error);
      // Ultimate fallback - return empty icon
      return nativeImage.createEmpty();
    }
  }

  createTextIcon() {
    // For macOS, you can actually just use text in the menu bar
    if (process.platform === 'darwin') {
      return null; // Return null to use text instead
    }

    // For other platforms, use the regular icon
    return this.createIcon();
  }

  // Add this method to help debug and ensure the app shows:
  showAppWithDebug() {
    console.log('showAppWithDebug called');

    // Force create window if it doesn't exist
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      console.log('Window does not exist or is destroyed, creating new window...');
      this.createWindow().then(() => {
        setTimeout(() => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
            this.mainWindow.focus();

            // Show dock icon on macOS
            if (process.platform === 'darwin') {
              app.dock.show();
            }

            console.log('Window should now be visible');
          }
        }, 100);
      });
    } else {
      console.log('Window exists, showing it...');

      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }

      this.mainWindow.show();
      this.mainWindow.focus();

      // Bring window to front
      this.mainWindow.setAlwaysOnTop(true);
      setTimeout(() => {
        this.mainWindow.setAlwaysOnTop(false);
      }, 100);

      // Show dock icon on macOS
      if (process.platform === 'darwin') {
        app.dock.show();
      }
    }
  }

  setupClipboardMonitoring() {
    console.log('Setting up clipboard monitoring...');

    // Initialize with current clipboard content
    this.lastClipboardContent = clipboard.readText() || '';

    // Monitor clipboard changes every 300ms for better responsiveness
    this.clipboardMonitorInterval = setInterval(() => {
      try {
        const currentContent = clipboard.readText() || '';

        // Check if clipboard content changed
        if (currentContent !== this.lastClipboardContent && currentContent.trim().length > 0) {
          console.log('Clipboard changed, new content length:', currentContent.length);

          // Only show overlay for meaningful content (not single characters or very short text)
          if (currentContent.trim().length >= 5) {
            console.log('Showing overlay for new clipboard content');
            this.showOverlay();
          }

          // Add to recent history (keep last 10 items)
          this.recentClipboardHistory.unshift({
            content: currentContent,
            timestamp: Date.now(),
            bookmarked: false
          });

          // Keep only last 10 items
          if (this.recentClipboardHistory.length > 10) {
            this.recentClipboardHistory = this.recentClipboardHistory.slice(0, 10);
          }

          this.lastClipboardContent = currentContent;

          // Update tray menu with recent clipboard items
          this.updateTrayMenu();
        }
      } catch (error) {
        console.error('Error monitoring clipboard:', error);
      }
    }, 300);

    console.log('Clipboard monitoring started');
  }

  stopClipboardMonitoring() {
    if (this.clipboardMonitorInterval) {
      clearInterval(this.clipboardMonitorInterval);
      this.clipboardMonitorInterval = null;
      console.log('Clipboard monitoring stopped');
    }
  }

  updateTrayMenu() {
    if (!this.tray) return;

    const recentItems = this.recentClipboardHistory.slice(0, 5).map((item, index) => {
      const preview = item.content.substring(0, 50) + (item.content.length > 50 ? '...' : '');
      const isBookmarked = item.bookmarked ? ' ✓' : '';

      return {
        label: `${index + 1}. ${preview}${isBookmarked}`,
        click: () => this.bookmarkClipboardItem(item)
      };
    });

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Recent Clipboard Items',
        enabled: false
      },
      { type: 'separator' },
      ...recentItems,
      { type: 'separator' },
      {
        label: 'Bookmark Current Clipboard',
        click: () => this.quickBookmark()
      },
      {
        label: 'Show CodeBookmark',
        click: () => {
          console.log('Show CodeBookmark clicked');
          this.showWindow();
        }
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => this.showSettings()
      },
      {
        label: 'Quit',
        click: () => {
          app.isQuiting = true;
          app.quit();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  async bookmarkClipboardItem(clipboardItem) {
    console.log('Bookmarking clipboard item:', clipboardItem.content.substring(0, 50) + '...');

    try {
      const bookmark = await this.createBookmark(clipboardItem.content);

      if (bookmark) {
        // Add to beginning of array for latest first
        this.bookmarks.unshift(bookmark);
        this.saveBookmarks();

        // Mark as bookmarked
        clipboardItem.bookmarked = true;
        this.updateTrayMenu();

        // Show success notification
        this.showNotification(`✓ Bookmarked: ${bookmark.title}`);

        // Notify renderer process if window is open
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('bookmark-added', bookmark);
        }

        console.log('Clipboard item bookmarked successfully');
      } else {
        console.log('Bookmark not created (possibly duplicate)');
        this.showNotification('⚠ Bookmark already exists (duplicate detected)');
      }
    } catch (error) {
      console.error('Error bookmarking clipboard item:', error);
      this.showNotification('❌ Error creating bookmark');
    }
  }

  setupGlobalShortcuts() {
    // Register global shortcut for quick bookmark
    globalShortcut.register(this.settings.shortcut, () => {
      this.quickBookmark();
    });

    console.log('Global shortcuts registered');
  }

  async quickBookmark() {
    console.log('Quick bookmark triggered');

    // Store the current clipboard content to restore later
    const previousClipboard = clipboard.readText() || '';

    // Try to copy selected text automatically
    try {
      if (process.platform === 'darwin') {
        // On macOS, use AppleScript to simulate Cmd+C
        const { exec } = require('child_process');
        await new Promise((resolve, reject) => {
          exec(`osascript -e 'tell application "System Events" to keystroke "c" using command down'`, (error) => {
            if (error) {
              console.error('Error with AppleScript:', error);
              reject(error);
            } else {
              resolve();
            }
          });
        });
      } else if (process.platform === 'win32') {
        // On Windows, use PowerShell or native commands
        const { exec } = require('child_process');
        await new Promise((resolve, reject) => {
          exec('powershell -command "[System.Windows.Forms.SendKeys]::SendWait(\'^c\')"', (error) => {
            if (error) {
              console.error('Error with PowerShell:', error);
              reject(error);
            } else {
              resolve();
            }
          });
        });
      } else {
        // On Linux, use xdotool if available
        const { exec } = require('child_process');
        await new Promise((resolve, reject) => {
          exec('xdotool key ctrl+c', (error) => {
            if (error) {
              console.error('Error with xdotool:', error);
              reject(error);
            } else {
              resolve();
            }
          });
        });
      }

      // Longer delay to ensure clipboard is updated
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error('Error simulating copy:', error);
      // If auto-copy fails, check if user has already copied something
      const currentClipboard = clipboard.readText() || '';
      if (currentClipboard !== previousClipboard && currentClipboard.trim().length >= 3) {
        console.log('Using existing clipboard content instead');
        // Continue with existing clipboard content
      } else {
        // Show helpful error message
        this.showNotification('Auto-copy failed. Please copy text manually (Cmd+C) then press Cmd+Shift+B');
        return;
      }
    }

    // Get the newly copied content (selected text)
    const selectedContent = clipboard.readText() || '';
    console.log('Selected content length:', selectedContent.length);

    // Check if new content was copied (different from previous)
    if (selectedContent === previousClipboard || !selectedContent || selectedContent.trim().length === 0) {
      console.log('No text selected or copy failed');
      this.showNotification('Select text and try again, or copy manually with Cmd+C first');
      return;
    }

    // Check if content is too short
    if (selectedContent.trim().length < 3) {
      console.log('Selected text too short');
      this.showNotification('Selected text is too short to bookmark');
      return;
    }

    try {
      console.log('Creating bookmark for selected text...');
      const bookmark = await this.createBookmark(selectedContent);

      if (bookmark) {
        console.log('Bookmark created successfully:', bookmark.title);
        // Add to beginning of array for latest first
        this.bookmarks.unshift(bookmark);
        this.saveBookmarks();

        // Add to recent clipboard history
        this.recentClipboardHistory.unshift({
          content: selectedContent,
          timestamp: Date.now(),
          bookmarked: true
        });

        // Keep only last 10 items
        if (this.recentClipboardHistory.length > 10) {
          this.recentClipboardHistory = this.recentClipboardHistory.slice(0, 10);
        }

        // Update the last clipboard content
        this.lastClipboardContent = selectedContent;
        this.updateTrayMenu();

        // Show success notification
        this.showNotification(`✓ Bookmarked selected text: ${bookmark.title}`);

        // Notify renderer process if window is open
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('bookmark-added', bookmark);
        }

        console.log('Bookmark process completed successfully');
      } else {
        console.log('Bookmark was not created (possibly duplicate)');
        this.showNotification('⚠ Selected text already bookmarked');
      }

    } catch (error) {
      console.error('Error during quick bookmark:', error);
      this.showNotification('❌ Error creating bookmark');
    }
  }

  async bookmarkCurrentClipboard() {
    const currentContent = clipboard.readText() || '';
    console.log('Bookmarking current clipboard content, length:', currentContent.length);

    if (!currentContent || currentContent.trim().length < 3) {
      console.log('Clipboard content too short or empty');
      this.showNotification('No valid content to bookmark');
      return;
    }

    try {
      const bookmark = await this.createBookmark(currentContent);

      if (bookmark) {
        console.log('Bookmark created successfully:', bookmark.title);
        // Add to beginning of array for latest first
        this.bookmarks.unshift(bookmark);
        this.saveBookmarks();

        // Mark recent clipboard item as bookmarked
        const recentItem = this.recentClipboardHistory.find(item => item.content === currentContent);
        if (recentItem) {
          recentItem.bookmarked = true;
          this.updateTrayMenu();
        }

        // Show success notification
        this.showNotification(`✓ Bookmarked: ${bookmark.title}`);

        // Notify renderer process if window is open
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('bookmark-added', bookmark);
        }

        console.log('Bookmark process completed successfully');
      } else {
        console.log('Bookmark not created (possibly duplicate)');
        this.showNotification('⚠ Bookmark already exists');
      }
    } catch (error) {
      console.error('Error bookmarking clipboard content:', error);
      this.showNotification('❌ Error creating bookmark');
    }
  }

  // async createBookmark(content) {
  //   console.log('createBookmark called with content length:', content.length);
  //
  //   // Check for duplicates if enabled
  //   if (this.settings.deduplicate) {
  //     console.log('Checking for duplicates...');
  //     const duplicate = this.findSimilarBookmark(content);
  //     if (duplicate) {
  //       console.log('Duplicate found, skipping bookmark creation');
  //       return null; // Skip duplicate
  //     }
  //   }
  //
  //   console.log('Creating new bookmark...');
  //   const bookmark = {
  //     id: Date.now().toString(),
  //     content: content,
  //     title: this.extractTitle(content),
  //     tags: this.settings.autoTag ? this.generateTags(content) : [],
  //     summary: this.generateSummary(content),
  //     timestamp: new Date().toISOString(),
  //     language: this.detectLanguage(content)
  //   };
  //
  //   console.log('Bookmark created:', {
  //     id: bookmark.id,
  //     title: bookmark.title,
  //     contentLength: bookmark.content.length,
  //     tags: bookmark.tags,
  //     language: bookmark.language
  //   });
  //
  //   return bookmark;
  // }

  // Enhanced createBookmark with Python LLM analysis
  async createBookmark(content) {
    console.log('createBookmark called with Python LLM analysis...');

    // Check for duplicates if enabled
    if (this.settings.deduplicate) {
      const duplicate = this.findSimilarBookmark(content);
      if (duplicate) {
        console.log('Duplicate found, skipping bookmark creation');
        return null;
      }
    }

    let bookmark = {
      id: Date.now().toString(),
      content: content,
      timestamp: new Date().toISOString()
    };

    // Try Python LLM analysis first
    if (this.llmService.isAvailable) {
      try {
        console.log('🤖 Using Python LLM for analysis...');
        const analysis = await this.llmService.analyzeCode(content);

        if (analysis && analysis.title) {
          bookmark.title = analysis.title;
          bookmark.tags = analysis.tags || [];
          bookmark.summary = analysis.summary || content.substring(0, 100) + '...';
          bookmark.language = analysis.language || 'text';
          bookmark.aiGenerated = true;
          console.log('✅ Python LLM analysis successful');
        } else {
          throw new Error('Invalid LLM response');
        }
      } catch (error) {
        console.log('❌ Python LLM analysis failed, using fallback:', error.message);
        const fallback = this.llmService.fallbackAnalysis(content);
        bookmark.title = fallback.title;
        bookmark.tags = fallback.tags;
        bookmark.summary = fallback.summary;
        bookmark.language = fallback.language;
        bookmark.aiGenerated = false;
      }
    } else {
      // Fallback to existing methods
      console.log('📋 Using fallback analysis methods');
      const fallback = this.llmService.fallbackAnalysis(content);
      bookmark.title = fallback.title;
      bookmark.tags = fallback.tags;
      bookmark.summary = fallback.summary;
      bookmark.language = fallback.language;
      bookmark.aiGenerated = false;
    }

    console.log('Bookmark created with Python LLM features:', {
      id: bookmark.id,
      title: bookmark.title,
      language: bookmark.language,
      aiGenerated: bookmark.aiGenerated
    });

    return bookmark;
  }

  findSimilarBookmark(content) {
    return this.bookmarks.find(bookmark => {
      const sim = similarity(content.toLowerCase(), bookmark.content.toLowerCase());
      return sim > this.settings.minSimilarity;
    });
  }

  extractTitle(content) {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length === 0) return 'Untitled';

    const firstLine = lines[0].trim();

    // Check for comment patterns
    const commentPatterns = [
      /^\/\/\s*(.+)$/,  // // comment
      /^\/\*\s*(.+?)\s*\*\/$/,  // /* comment */
      /^#\s*(.+)$/,     // # comment
      /^--\s*(.+)$/,    // -- comment
      /^<!--\s*(.+?)\s*-->$/  // <!-- comment -->
    ];

    for (const pattern of commentPatterns) {
      const match = firstLine.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
  }

  generateTags(content) {
    const tags = new Set();
    const lowercased = content.toLowerCase();

    // Language-specific keywords
    const languageKeywords = {
      'javascript': ['function', 'const', 'let', 'var', 'async', 'await', 'promise'],
      'python': ['def', 'class', 'import', 'from', 'lambda', 'async', 'await'],
      'java': ['public', 'private', 'class', 'interface', 'static', 'final'],
      'cpp': ['#include', 'namespace', 'class', 'struct', 'template'],
      'sql': ['select', 'insert', 'update', 'delete', 'create', 'alter', 'drop'],
      'html': ['<html', '<div', '<span', '<script', '<style'],
      'css': ['selector', 'property', 'margin', 'padding', 'display']
    };

    // Algorithm and data structure keywords
    const algorithmKeywords = [
      'sort', 'search', 'binary', 'hash', 'tree', 'graph', 'dynamic',
      'recursive', 'iterative', 'breadth', 'depth', 'dijkstra', 'bellman'
    ];

    // Check for language
    for (const [lang, keywords] of Object.entries(languageKeywords)) {
      if (keywords.some(keyword => lowercased.includes(keyword))) {
        tags.add(lang);
      }
    }

    // Check for algorithms
    algorithmKeywords.forEach(keyword => {
      if (lowercased.includes(keyword)) {
        tags.add('algorithm');
        tags.add(keyword);
      }
    });

    // Check for common patterns
    if (lowercased.includes('api') || lowercased.includes('endpoint')) {
      tags.add('api');
    }

    if (lowercased.includes('database') || lowercased.includes('db')) {
      tags.add('database');
    }

    if (lowercased.includes('async') || lowercased.includes('promise')) {
      tags.add('async');
    }

    return Array.from(tags);
  }

  generateSummary(content) {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length <= 3) return content;

    // Simple extractive summarization
    const words = content.split(/\s+/);
    if (words.length <= 50) return content;

    return words.slice(0, 50).join(' ') + '...';
  }

  detectLanguage(content) {
    const lowercased = content.toLowerCase();

    // Simple language detection patterns
    if (lowercased.includes('def ') || lowercased.includes('import ')) return 'python';
    if (lowercased.includes('function ') || lowercased.includes('const ')) return 'javascript';
    if (lowercased.includes('public class') || lowercased.includes('static void')) return 'java';
    if (lowercased.includes('#include') || lowercased.includes('namespace')) return 'cpp';
    if (lowercased.includes('select ') || lowercased.includes('insert ')) return 'sql';
    if (lowercased.includes('<html') || lowercased.includes('<div')) return 'html';
    if (lowercased.includes('{') && lowercased.includes('margin:')) return 'css';

    return 'text';
  }

  saveBookmarks() {
    console.log('Saving bookmarks to store, total count:', this.bookmarks.length);
    // Sort bookmarks by timestamp (newest first) before saving
    this.bookmarks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    store.set('bookmarks', this.bookmarks);
    console.log('Bookmarks saved successfully');
  }

  showNotification(message) {
    console.log('Showing notification:', message);

    // Use Electron's built-in notification system (system notifications)
    const { Notification } = require('electron');

    if (Notification.isSupported()) {
      try {
        const notification = new Notification({
          title: 'CodeBookmark',
          body: message,
          icon: this.createIcon(),
          silent: false
        });

        notification.show();
        console.log('System notification shown');

        // Auto-close after 4 seconds
        setTimeout(() => {
          notification.close();
        }, 4000);
      } catch (error) {
        console.error('Error showing notification:', error);
        console.log('Fallback notification:', message);
      }
    } else {
      // Fallback for systems that don't support notifications
      console.log(`Notification: ${message}`);
    }
  }

  showWindow() {
    console.log('showWindow called - explicit user action');

    if (this.mainWindow) {
      console.log('Main window exists, showing...');

      if (this.mainWindow.isDestroyed()) {
        console.log('Main window was destroyed, creating new one...');
        this.createWindow().then(() => {
          this.mainWindow.show();
          this.mainWindow.focus();

          // Show dock icon when user explicitly opens window
          if (process.platform === 'darwin') {
            app.dock.show();
          }
        });
        return;
      }

      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }

      this.mainWindow.show();
      this.mainWindow.focus();

      // Show dock icon when user explicitly opens window
      if (process.platform === 'darwin') {
        app.dock.show();
      }

      console.log('Main window should now be visible');
    } else {
      console.log('Main window does not exist, creating new one...');
      this.createWindow().then(() => {
        this.mainWindow.show();
        this.mainWindow.focus();

        // Show dock icon when user explicitly opens window
        if (process.platform === 'darwin') {
          app.dock.show();
        }
      });
    }
  }

  showSettings() {
    // Implementation for settings window
    this.showWindow();
  }

  setupIPC() {
    console.log('Setting up IPC handlers...');

    // Existing IPC handlers
    ipcMain.handle('get-bookmarks', () => {
      console.log('get-bookmarks called, returning', this.bookmarks.length, 'bookmarks');
      return this.bookmarks;
    });

    ipcMain.handle('search-bookmarks', (event, query) => {
      console.log('search-bookmarks called with query:', query);
      return this.searchBookmarks(query);
    });

    ipcMain.handle('delete-bookmark', (event, id) => {
      console.log('delete-bookmark called with id:', id);
      this.bookmarks = this.bookmarks.filter(b => b.id !== id);
      this.saveBookmarks();
      return true;
    });

    ipcMain.handle('update-bookmark', (event, bookmark) => {
      console.log('update-bookmark called');
      const index = this.bookmarks.findIndex(b => b.id === bookmark.id);
      if (index !== -1) {
        this.bookmarks[index] = bookmark;
        this.saveBookmarks();
        return true;
      }
      return false;
    });

    ipcMain.handle('add-bookmark', async (event, content) => {
      console.log('add-bookmark called');
      const bookmark = await this.createBookmark(content);
      if (bookmark) {
        // Add to beginning of array for latest first
        this.bookmarks.unshift(bookmark);
        this.saveBookmarks();
        return bookmark;
      }
      return null;
    });

    // New overlay IPC handlers
    ipcMain.on('bookmark-from-overlay', async (event) => {
      console.log('Bookmark from overlay requested');
      this.hideOverlay();
      await this.bookmarkCurrentClipboard();
    });

    ipcMain.on('hide-overlay', (event) => {
      console.log('Hide overlay requested');
      this.hideOverlay();
    });

    // Python LLM-powered features
    ipcMain.handle('explain-code', async (event, content) => {
      console.log('🤖 Explaining code with Python LLM...');
      const explanation = await this.llmService.explainCode(content);
      return explanation;
    });

    ipcMain.handle('suggest-optimizations', async (event, content) => {
      console.log('⚡ Generating optimizations with Python LLM...');
      const suggestions = await this.llmService.suggestOptimizations(content);
      return suggestions;
    });

    ipcMain.handle('get-related-queries', async (event, content) => {
      console.log('🔗 Getting related queries with Python LLM...');
      const queries = await this.llmService.getRelatedQueries(content);
      return queries;
    });

    ipcMain.handle('llm-status', () => {
      return {
        available: this.llmService.isAvailable,
        type: 'python-service',
        service: 'DeepSeek/Gemma via Python'
      };
    });

    console.log('Python LLM IPC handlers set up successfully');

    console.log('IPC handlers set up successfully');
  }

  // searchBookmarks(query) {
  //   if (!query || query.trim() === '') {
  //     // Return bookmarks sorted by newest first
  //     return this.bookmarks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  //   }
  //
  //   const Fuse = require('fuse.js');
  //   const fuse = new Fuse(this.bookmarks, {
  //     keys: ['title', 'content', 'tags', 'summary'],
  //     threshold: 0.3,
  //     includeScore: true
  //   });
  //
  //   const results = fuse.search(query);
  //   // Sort results by newest first
  //   return results.map(result => result.item)
  //   .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  // }
  async searchBookmarks(query) {
    if (!query || query.trim() === '') {
      return this.bookmarks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    // Try semantic search first
    if (this.llmService.isAvailable) {
      try {
        console.log('🔍 Using semantic search...');
        const semanticResults = await this.llmService.semanticSearch(query, this.bookmarks);
        console.log('✅ Semantic search completed');
        return semanticResults;
      } catch (error) {
        console.log('❌ Semantic search failed, falling back to regular search');
      }
    }

    // Fallback to existing Fuse.js search
    const Fuse = require('fuse.js');
    const fuse = new Fuse(this.bookmarks, {
      keys: ['title', 'content', 'tags', 'summary'],
      threshold: 0.3,
      includeScore: true
    });

    const results = fuse.search(query);
    return results.map(result => result.item)
                 .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  // cleanup() {
  //   console.log('Cleaning up CodeBookmark app...');
  //
  //   this.stopClipboardMonitoring();
  //
  //   if (this.overlayTimeout) {
  //     clearTimeout(this.overlayTimeout);
  //     this.overlayTimeout = null;
  //   }
  //
  //   if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
  //     this.overlayWindow.destroy();
  //     this.overlayWindow = null;
  //     console.log('Overlay window destroyed');
  //   }
  //
  //   console.log('Cleanup completed');
  // }
  cleanup() {
    console.log('Cleaning up CodeBookmark app...');

    this.stopClipboardMonitoring();

    if (this.overlayTimeout) {
      clearTimeout(this.overlayTimeout);
      this.overlayTimeout = null;
    }

    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.destroy();
      this.overlayWindow = null;
      console.log('Overlay window destroyed');
    }

    // Cleanup Python LLM service
    if (this.llmService) {
      this.llmService.cleanup();
    }

    console.log('Cleanup completed');
  }

  async initialize() {
    console.log('Initializing CodeBookmark app...');

    // Set up IPC handlers first
    this.setupIPC();

    try {
      await this.createWindow();
      this.createOverlayWindow();
      this.createTray();
      this.setupGlobalShortcuts();

      // Start clipboard monitoring
      this.setupClipboardMonitoring();

      console.log('CodeBookmark app initialized successfully');

      // Show a welcome notification
      setTimeout(() => {
        this.showNotification('CodeBookmark is ready! Copy some text to see the magic ✨');
      }, 1000);

      // On first launch, show the window briefly so users know the app is running
      const isFirstLaunch = store.get('firstLaunch', true);
      if (isFirstLaunch) {
        console.log('First launch detected, showing window...');
        setTimeout(() => {
          this.showAppWithDebug();
          store.set('firstLaunch', false);

          // Hide after 5 seconds on first launch
          setTimeout(() => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.hide();

              // Hide dock icon on macOS after showing the app
              if (process.platform === 'darwin') {
                app.dock.hide();
              }

              this.showNotification('CodeBookmark is now running in the background. Look for the icon in your system tray!');
            }
          }, 5000);
        }, 500);
      } else {
        // Not first launch - hide dock icon on macOS
        if (process.platform === 'darwin') {
          app.dock.hide();
          console.log('Dock icon hidden on macOS');
        }
      }

    } catch (error) {
      console.error('Error during initialization:', error);

      // Show error dialog
      const { dialog } = require('electron');
      dialog.showErrorBox('Initialization Error', `Failed to initialize app: ${error.message}`);
    }
  }
}

// Global app instance
let codeBookmarkApp = null;

// App event handlers
app.whenReady().then(async () => {
  codeBookmarkApp = new CodeBookmarkApp();
  await codeBookmarkApp.initialize();
});

app.on('window-all-closed', () => {
  // Keep app running in background - don't quit
  console.log('All windows closed, keeping app running in background');
});

app.on('activate', () => {
  // On macOS, only show window if user explicitly clicks dock icon
  // Don't auto-show window just because app is activated
  console.log('App activated');
  if (BrowserWindow.getAllWindows().length === 0 && codeBookmarkApp) {
    // Only create window if none exist, but don't show it
    codeBookmarkApp.createWindow();
  }
});

app.on('will-quit', () => {
  console.log('App will quit, cleaning up...');
  globalShortcut.unregisterAll();

  // Clean up app resources
  if (codeBookmarkApp) {
    codeBookmarkApp.cleanup();
  }
});