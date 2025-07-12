const { app, BrowserWindow, Tray, Menu, globalShortcut, clipboard, ipcMain, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const natural = require('natural');
const similarity = require('similarity');

// Initialize persistent storage
const store = new Store({
  name: 'codebookmarks',
  defaults: {
    bookmarks: [],
    settings: {
      shortcut: 'CommandOrControl+Shift+B',
      autoTag: true,
      deduplicate: true,
      minSimilarity: 0.8
    }
  }
});

class CodeBookmarkApp {
  constructor() {
    this.mainWindow = null;
    this.tray = null;
    this.bookmarks = store.get('bookmarks', []);
    this.settings = store.get('settings', {});
  }

  async createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      show: false,
      icon: this.createIcon()
    });

    await this.mainWindow.loadFile('src/renderer/index.html');

    // Hide window instead of closing
    this.mainWindow.on('close', (event) => {
      if (!app.isQuiting) {
        event.preventDefault();
        this.mainWindow.hide();
      }
    });
  }

  createTray() {
    const trayIcon = this.createIcon();
    this.tray = new Tray(trayIcon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Quick Bookmark',
        click: () => this.quickBookmark()
      },
      {
        label: 'Show CodeBookmark',
        click: () => this.showWindow()
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

    this.tray.setToolTip('CodeBookmark - Your Personal Code Library');
    this.tray.setContextMenu(contextMenu);

    this.tray.on('double-click', () => {
      this.showWindow();
    });
  }

  createIcon() {
    // Create a simple icon programmatically
    const canvas = require('canvas');
    const canvasElement = canvas.createCanvas(16, 16);
    const ctx = canvasElement.getContext('2d');

    ctx.fillStyle = '#4A90E2';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '12px Arial';
    ctx.fillText('B', 4, 12);

    return nativeImage.createFromDataURL(canvasElement.toDataURL());
  }

  setupGlobalShortcuts() {
    // Register global shortcut for quick bookmark
    globalShortcut.register(this.settings.shortcut, () => {
      this.quickBookmark();
    });
  }

  async quickBookmark() {
    const clipboardText = clipboard.readText();

    if (!clipboardText || clipboardText.trim().length === 0) {
      return;
    }

    const bookmark = await this.createBookmark(clipboardText);

    if (bookmark) {
      this.bookmarks.push(bookmark);
      this.saveBookmarks();
      this.notifyBookmarkSaved(bookmark);
    }
  }

  async createBookmark(content) {
    // Check for duplicates if enabled
    if (this.settings.deduplicate) {
      const duplicate = this.findSimilarBookmark(content);
      if (duplicate) {
        return null; // Skip duplicate
      }
    }

    const bookmark = {
      id: Date.now().toString(),
      content: content,
      title: this.extractTitle(content),
      tags: this.settings.autoTag ? this.generateTags(content) : [],
      summary: this.generateSummary(content),
      timestamp: new Date().toISOString(),
      language: this.detectLanguage(content)
    };

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
    store.set('bookmarks', this.bookmarks);
  }

  notifyBookmarkSaved(bookmark) {
    // Simple notification - in production, you'd use electron notifications
    console.log(`Bookmark saved: ${bookmark.title}`);
  }

  showWindow() {
    if (this.mainWindow) {
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  showSettings() {
    // Implementation for settings window
    this.showWindow();
  }

  setupIPC() {
    // Get all bookmarks
    ipcMain.handle('get-bookmarks', () => {
      return this.bookmarks;
    });

    // Search bookmarks
    ipcMain.handle('search-bookmarks', (event, query) => {
      return this.searchBookmarks(query);
    });

    // Delete bookmark
    ipcMain.handle('delete-bookmark', (event, id) => {
      this.bookmarks = this.bookmarks.filter(b => b.id !== id);
      this.saveBookmarks();
      return true;
    });

    // Update bookmark
    ipcMain.handle('update-bookmark', (event, bookmark) => {
      const index = this.bookmarks.findIndex(b => b.id === bookmark.id);
      if (index !== -1) {
        this.bookmarks[index] = bookmark;
        this.saveBookmarks();
        return true;
      }
      return false;
    });

    // Add bookmark manually
    ipcMain.handle('add-bookmark', async (event, content) => {
      const bookmark = await this.createBookmark(content);
      if (bookmark) {
        this.bookmarks.push(bookmark);
        this.saveBookmarks();
        return bookmark;
      }
      return null;
    });
  }

  searchBookmarks(query) {
    if (!query || query.trim() === '') {
      return this.bookmarks;
    }

    const Fuse = require('fuse.js');
    const fuse = new Fuse(this.bookmarks, {
      keys: ['title', 'content', 'tags', 'summary'],
      threshold: 0.3,
      includeScore: true
    });

    const results = fuse.search(query);
    return results.map(result => result.item);
  }

  async initialize() {
    await this.createWindow();
    this.createTray();
    this.setupGlobalShortcuts();
    this.setupIPC();
  }
}

// App event handlers
app.whenReady().then(async () => {
  const codeBookmark = new CodeBookmarkApp();
  await codeBookmark.initialize();
});

app.on('window-all-closed', () => {
  // Keep app running in background
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});