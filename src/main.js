'use strict';

const {
  app, BrowserWindow, ipcMain, screen, shell, Menu, Tray,
  nativeImage, clipboard, desktopCapturer,
} = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { resolveIconSource } = require('./icon-utils');
const { extractIcons } = require('./icon-extract');

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
app.setName('FuguangDrawer');
app.setPath('userData', path.join(app.getPath('appData'), 'FuguangDrawer'));
app.setAppUserModelId('com.fuguang.drawer');

const APP_TITLE = '浮光抽屉';
const IS_WIN = process.platform === 'win32';
const ROOT = path.join(__dirname, '..');
const ICON_PATH = path.join(ROOT, 'assets', 'icon.ico');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const RENDERER_PATH = path.join(__dirname, 'renderer', 'index.html');
const HELPER_PATH = path.join(ROOT, 'scripts', 'desktop-icons.ps1');
const ICON_HELPER_PATH = path.join(ROOT, 'scripts', 'extract-icons.ps1');
const ICON_DLL_PATH = path.join(ROOT, 'scripts', 'IconExtractor.dll');
const GUARD_VBS_PATH = path.join(ROOT, 'scripts', 'restore-at-login.vbs');
const REG_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
const RUNONCE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce';
const RUNONCE_NAME = 'FuguangRestoreIcons';

const CATEGORY_ORDER = ['app', 'folder', 'document', 'image', 'media', 'other', 'system'];
const CATEGORY_META = {
  favorite: { label: '常用', groupLabel: '常用栏目', color: '#ffcf8a', glyph: '\uE734' },
  ai: { label: 'AI 工具', groupLabel: 'AI 工具集合', color: '#b9a7ff', glyph: '\uE99A' },
  system: { label: '系统', groupLabel: '系统', color: '#9fe9ff', glyph: '\uE7F4' },
  app: { label: '应用', groupLabel: '应用', color: '#7fd4ff', glyph: '\uE8A5' },
  folder: { label: '文件夹', groupLabel: '文件夹', color: '#ffd08a', glyph: '\uE8B7' },
  document: { label: '文档', groupLabel: '文档', color: '#8fffc8', glyph: '\uE8A5' },
  image: { label: '图片', groupLabel: '图片', color: '#ffb3d9', glyph: '\uEB9F' },
  media: { label: '影音', groupLabel: '影音', color: '#c4b5ff', glyph: '\uE768' },
  other: { label: '其他', groupLabel: '其他', color: '#c8d2e4', glyph: '\uE7C3' },
};

const AI_PATTERNS = [
  /deepseek/i, /chatgpt/i, /openai/i, /claude/i, /gemini/i, /copilot/i,
  /豆包|doubao/i, /扣子|coze/i, /kimi|月之暗面/i, /通义|千问|qwen/i,
  /文心|一言|ernie/i, /讯飞星火|星火/i, /智谱|chatglm|\bglm\b/i,
  /腾讯元宝|元宝/i, /夸克|quark/i, /秘塔|metaso/i, /小绿鲸/i,
  /纳米\s*ai/i, /即梦|可灵|jimeng|kling/i, /midjourney/i,
  /stable\s*diffusion|comfyui/i, /ollama|lm\s*studio/i, /cursor|windsurf/i,
  /通义灵码|codeium/i, /perplexity/i, /huggingface|modelscope|魔搭/i,
  /(^|[\s._-])ai([\s._-]|$)/i,
];

const DEFAULT_FAVORITES = ['微信', 'Google Chrome', 'WPS Office', 'DeepSeek Harness', '豆包'];

const DOC_EXTS = new Set(['.doc', '.docx', '.pdf', '.txt', '.md', '.rtf', '.ppt', '.pptx',
  '.xls', '.xlsx', '.csv', '.epub', '.mobi', '.azw3', '.caj', '.ofd', '.wps', '.et', '.dps']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico',
  '.heic', '.heif', '.tif', '.tiff', '.psd', '.raw', '.cr2', '.nef']);
const MEDIA_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v',
  '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma', '.mid', '.midi']);
const APP_EXTS = new Set(['.lnk', '.url', '.exe', '.msi', '.appref-ms', '.bat', '.cmd',
  '.ps1', '.vbs', '.jar', '.msix', '.appx']);

const COLLATOR = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
let win = null;
let tray = null;
let quitting = false;
let allowQuit = false;
let restoring = false;
let restorePromise = null;
let weHidIcons = false;
let hideWarning = '';
let state = null;
let stateFile = '';
let logFile = '';

let dataset = null;
let scanPromise = null;
let lastScanAt = 0;
let iconCache = new Map();
let dataReady = false;

let collapsed = true;
let expanded = false;
let hoverEnabled = true;
let outsideSince = 0;
let pollTimer = null;
let lastBackdropAt = 0;
let backdropBusy = false;
let healTimers = [];
let rendererRecoveries = 0;
let contextMenuOpen = false;
let shellMenuOpen = false;
let renameOpen = false;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ')}`;
  try { console.log(line); } catch { /* no console in packaged app */ }
  if (logFile) {
    try {
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1.5 * 1024 * 1024) {
        fs.renameSync(logFile, `${logFile}.old`);
      }
      fs.appendFileSync(logFile, `${line}\r\n`, 'utf8');
    } catch { /* logging must never break the app */ }
  }
}

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------
function loadState() {
  const defaults = {
    sessionActive: false,
    originalHideIcons: 0,
    hasSeenHint: false,
    curatedSeeded: false,
    launchCounts: {},
    favorites: {},
    favoriteExcluded: {},
    aiTools: {},
    aiExcluded: {},
  };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
  } catch {
    return defaults;
  }
}

function saveState(patch = {}) {
  Object.assign(state, patch);
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    log('saveState failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Boot safety net
// ---------------------------------------------------------------------------
/**
 * Registers a RunOnce command that puts the desktop icons back at the next
 * logon. It is removed after a clean restore. This covers the nasty case where
 * Windows shuts down or kills the app before its asynchronous restore finishes:
 * otherwise the user boots to a desktop with no icons and no drawer.
 */
function setRestoreGuard(enabled) {
  if (!IS_WIN) return;
  if (enabled && !fs.existsSync(GUARD_VBS_PATH)) {
    log('restore guard missing:', GUARD_VBS_PATH);
    return;
  }
  const args = enabled
    ? [
      'add', RUNONCE_KEY, '/v', RUNONCE_NAME, '/t', 'REG_SZ',
      '/d', `wscript.exe "${GUARD_VBS_PATH}"`, '/f',
    ]
    : ['delete', RUNONCE_KEY, '/v', RUNONCE_NAME, '/f'];
  try {
    const child = spawn(REG_EXE, args, { windowsHide: true, stdio: 'ignore' });
    child.on('error', (err) => log('restore guard failed:', err.message));
    child.on('exit', (code) => log(`restore guard ${enabled ? 'armed' : 'cleared'} (${code})`));
  } catch (err) {
    log('restore guard spawn failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Window health
// ---------------------------------------------------------------------------
function nudgeWindow() {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getBounds();
    // A one-pixel resize forces Chromium/DWM to create and paint a fresh
    // surface. Without this, a window restored at login can stay topmost but
    // completely blank until the user resizes or moves it.
    win.setBounds({ ...bounds, width: bounds.width + 1 }, false);
    setTimeout(() => {
      if (win && !win.isDestroyed()) {
        try { win.setBounds(bounds, false); } catch { /* ignore */ }
      }
    }, 90);
  } catch (err) {
    log('window nudge failed:', err.message);
  }
}

function ensureWindowVisible(reason) {
  if (!win || win.isDestroyed() || quitting) return;
  try {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.showInactive();
    win.setOpacity(1);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
    win.webContents.invalidate();
    nudgeWindow();
    log('window health:', reason);
  } catch (err) {
    log('window health failed:', reason, err.message);
  }
}

function scheduleWindowHealth() {
  for (const delay of [300, 1200, 3500, 7000]) {
    const timer = setTimeout(() => ensureWindowVisible(`startup+${delay}ms`), delay);
    healTimers.push(timer);
  }
}

function repairWindow() {
  if (!win || win.isDestroyed()) return;
  log('window repair requested');
  ensureWindowVisible('repair');
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.reload();
      setTimeout(() => ensureWindowVisible('repair reload'), 1200);
    } catch (err) {
      log('window repair reload failed:', err.message);
    }
  }, 160);
}


function runIconAction(action) {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      resolve({ ok: false, action, error: 'only supported on Windows' });
      return;
    }
    if (!fs.existsSync(HELPER_PATH)) {
      resolve({ ok: false, action, error: `helper not found: ${HELPER_PATH}` });
      return;
    }
    const resultPath = path.join(os.tmpdir(), `fuguang-icons-${process.pid}-${Date.now()}.json`);
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    let done = false;
    let timer = null;

    const finish = async (fallback) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      let result = fallback;
      try {
        const raw = await fsp.readFile(resultPath, 'utf8');
        result = JSON.parse(raw);
      } catch { /* keep fallback */ }
      try { await fsp.unlink(resultPath); } catch { /* ignore */ }
      resolve(result);
    };

    let child;
    try {
      child = spawn(powershell, [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', HELPER_PATH, '-Action', action, '-ResultPath', resultPath,
      ], { windowsHide: true, stdio: 'ignore' });
    } catch (err) {
      resolve({ ok: false, action, error: err.message });
      return;
    }

    timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish({ ok: false, action, error: 'desktop helper timed out' });
    }, 9000);

    child.on('error', (err) => finish({ ok: false, action, error: err.message }));
    child.on('exit', (code) => {
      finish({ ok: code === 0, action, exitCode: code, error: code === 0 ? '' : `helper exit ${code}` });
    });
  });
}

// ---------------------------------------------------------------------------
// Desktop scanning
// ---------------------------------------------------------------------------
function classify(name, isDir) {
  if (isDir) return 'folder';
  const ext = path.extname(name).toLowerCase();
  if (APP_EXTS.has(ext)) return 'app';
  if (DOC_EXTS.has(ext)) return 'document';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (MEDIA_EXTS.has(ext)) return 'media';
  return 'other';
}

function iconCacheKey(fullPath, mtimeMs) {
  return `${fullPath}\u0000${Math.round(mtimeMs)}`;
}

function isSelfShortcut(fullPath) {
  try {
    const link = shell.readShortcutLink(fullPath);
    if (!link || !link.target) return false;
    const target = path.resolve(link.target).toLowerCase();
    const self = path.resolve(process.execPath).toLowerCase();
    return target === self || path.basename(target) === 'fuguangdrawer.exe';
  } catch {
    return false;
  }
}

async function getIconData(item) {
  const source = await resolveIconSource(item);
  if (!source) return null;
  const key = iconCacheKey(source, item.mtimeMs);
  if (iconCache.has(key)) return iconCache.get(key);
  try {
    let image = await app.getFileIcon(source, { size: 'large' });
    if ((!image || image.isEmpty()) && source !== item.path) {
      image = await app.getFileIcon(item.path, { size: 'large' });
    }
    if (!image || image.isEmpty()) return null;
    const scaled = image.resize({ width: 96, height: 96, quality: 'best' });
    const url = scaled.toDataURL();
    iconCache.set(key, url);
    if (iconCache.size > 500) {
      const first = iconCache.keys().next().value;
      iconCache.delete(first);
    }
    return url;
  } catch (err) {
    log('getFileIcon failed:', source, err.message);
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  if (!items.length) return [];
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

async function readDesktopDir(dir, source) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const items = [];
  for (const entry of entries) {
    const name = entry.name;
    const lower = name.toLowerCase();
    if (lower === 'desktop.ini' || lower === 'thumbs.db' || lower === '.ds_store') continue;
    if (name.startsWith('.')) continue;
    const fullPath = path.join(dir, name);
    let stat;
    try {
      stat = await fsp.stat(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile() && !stat.isDirectory()) continue;
    const isDir = stat.isDirectory();
    const ext = isDir ? '' : path.extname(name).toLowerCase();
    if (ext === '.lnk' && isSelfShortcut(fullPath)) continue;
    const category = classify(name, isDir);
    const displayName = path.parse(name).name || name;
    items.push({
      id: fullPath,
      path: fullPath,
      fullName: name,
      displayName,
      ext,
      isDir,
      category,
      source,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    });
  }
  return items;
}

function makeSpecialItems(existingNames) {
  const specials = [
    {
      id: 'special:thispc',
      path: '',
      fullName: '此电脑',
      displayName: '此电脑',
      ext: '',
      isDir: true,
      category: 'system',
      source: 'shell',
      special: 'thispc',
      glyph: '\uE7F4',
      target: 'shell:MyComputerFolder',
      accent: '#8fdcff',
    },
    {
      id: 'special:recycle',
      path: '',
      fullName: '回收站',
      displayName: '回收站',
      ext: '',
      isDir: true,
      category: 'system',
      source: 'shell',
      special: 'recycle',
      glyph: '\uE74D',
      target: 'shell:RecycleBinFolder',
      accent: '#8affd4',
    },
  ];
  return specials.filter((s) => !existingNames.has(s.displayName.toLowerCase()));
}

function isAiTool(item) {
  if (!item || item.special) return false;
  const text = `${item.displayName} ${item.fullName}`.toLowerCase();
  return AI_PATTERNS.some((pattern) => pattern.test(text));
}

function seedFavorites(items) {
  if (state.curatedSeeded) return;
  const favorites = state.favorites || {};
  if (!Object.keys(favorites).length) {
    for (const wanted of DEFAULT_FAVORITES) {
      const item = items.find((entry) => !entry.special
        && entry.displayName.toLowerCase() === wanted.toLowerCase());
      if (item) favorites[item.id] = true;
    }
  }
  state.favorites = favorites;
  state.curatedSeeded = true;
  saveState();
}

function decorateItems(items) {
  const favorites = state.favorites || {};
  const favoriteExcluded = state.favoriteExcluded || {};
  const aiTools = state.aiTools || {};
  const aiExcluded = state.aiExcluded || {};
  const launchCounts = state.launchCounts || {};

  const topUsed = items
    .filter((item) => !item.special
      && !favoriteExcluded[item.id]
      && (launchCounts[item.id] || 0) > 0)
    .sort((a, b) => (launchCounts[b.id] - launchCounts[a.id])
      || COLLATOR.compare(a.displayName, b.displayName))
    .slice(0, 8);
  const topIds = new Set(topUsed.map((item) => item.id));

  for (const item of items) {
    item.launchCount = launchCounts[item.id] || 0;
    item.favoritePinned = !!favorites[item.id];
    item.favorite = item.favoritePinned || topIds.has(item.id);
    item.aiAuto = isAiTool(item);
    item.ai = !item.special && (!!aiTools[item.id]
      || (item.aiAuto && !aiExcluded[item.id]));
  }
}

function buildView(items) {
  const counts = { all: items.length };
  counts.favorite = items.filter((item) => item.favorite).length;
  counts.ai = items.filter((item) => item.ai).length;
  for (const category of CATEGORY_ORDER) {
    const n = items.filter((item) => item.category === category).length;
    if (n) counts[category] = n;
  }

  const categories = [
    { id: 'favorite', ...CATEGORY_META.favorite, count: counts.favorite, curated: true },
    { id: 'ai', ...CATEGORY_META.ai, count: counts.ai, curated: true },
  ];
  for (const id of CATEGORY_ORDER) {
    if (counts[id]) categories.push({ id, ...CATEGORY_META[id], count: counts[id] });
  }
  return { counts, categories };
}

function rebuildDataset() {
  if (!dataset) return null;
  decorateItems(dataset.items);
  const view = buildView(dataset.items);
  dataset.counts = view.counts;
  dataset.categories = view.categories;
  return dataset;
}

function toggleCurated(item, kind) {
  if (!item) return null;
  if (kind === 'ai' && item.special) return { ok: false, error: '系统图标不能加入 AI 工具集合' };

  if (kind === 'favorite') {
    state.favorites = state.favorites || {};
    state.favoriteExcluded = state.favoriteExcluded || {};
    if (item.favorite) {
      delete state.favorites[item.id];
      state.favoriteExcluded[item.id] = true;
    } else {
      state.favorites[item.id] = true;
      delete state.favoriteExcluded[item.id];
    }
  } else if (kind === 'ai') {
    state.aiTools = state.aiTools || {};
    state.aiExcluded = state.aiExcluded || {};
    if (item.ai) {
      delete state.aiTools[item.id];
      state.aiExcluded[item.id] = true;
    } else {
      state.aiTools[item.id] = true;
      delete state.aiExcluded[item.id];
    }
  } else {
    return { ok: false, error: 'unknown category' };
  }

  saveState();
  rebuildDataset();
  sendData();
  return { ok: true, favorite: !!item.favorite, ai: !!item.ai };
}

async function scanDesktop() {
  if (scanPromise) return scanPromise;
  scanPromise = (async () => {
    const started = Date.now();
    const userDesktop = app.getPath('desktop');
    const publicDesktop = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop');

    const [userItems, publicItems] = await Promise.all([
      readDesktopDir(userDesktop, 'user'),
      readDesktopDir(publicDesktop, 'public'),
    ]);

    const byName = new Map();
    for (const item of userItems) byName.set(item.fullName.toLowerCase(), item);
    for (const item of publicItems) {
      const key = item.fullName.toLowerCase();
      if (!byName.has(key)) byName.set(key, item);
    }
    const items = [...byName.values()];

    const existing = new Set(items.map((i) => i.displayName.toLowerCase()));
    items.push(...makeSpecialItems(existing));

    const missed = items.filter((item) => !item.special
      && !iconCache.has(iconCacheKey(item.path, item.mtimeMs)));
    let extracted = new Map();
    if (missed.length) {
      extracted = await extractIcons(missed.map((item) => item.path), {
        helperPath: ICON_HELPER_PATH,
        dllPath: ICON_DLL_PATH,
      });
      log(`icon extractor: ${extracted.size}/${missed.length}`);
    }

    await mapLimit(items, 6, async (item) => {
      if (item.special) return;
      const key = iconCacheKey(item.path, item.mtimeMs);
      if (iconCache.has(key)) {
        item.icon = iconCache.get(key);
        return;
      }
      let icon = extracted.get(item.path);
      if (!icon) icon = await getIconData(item);
      if (icon) {
        iconCache.set(key, icon);
        item.icon = icon;
      }
    });

    items.sort((a, b) => {
      const ca = CATEGORY_ORDER.indexOf(a.category);
      const cb = CATEGORY_ORDER.indexOf(b.category);
      if (ca !== cb) return ca - cb;
      return COLLATOR.compare(a.displayName, b.displayName);
    });

    seedFavorites(items);
    decorateItems(items);
    const view = buildView(items);

    dataset = {
      items,
      counts: view.counts,
      categories: view.categories,
      scannedAt: Date.now(),
      warning: hideWarning,
      version: app.getVersion(),
      firstRun: !state.hasSeenHint,
    };
    lastScanAt = Date.now();
    dataReady = true;
    log(`scan done: ${items.length} items in ${Date.now() - started}ms`);
    return dataset;
  })();

  try {
    return await scanPromise;
  } finally {
    scanPromise = null;
  }
}

function sendData() {
  if (!win || win.isDestroyed() || !dataset) return;
  win.webContents.send('drawer:data', dataset);
}

async function refreshData() {
  await scanDesktop();
  sendData();
  return dataset;
}

// ---------------------------------------------------------------------------
// Frosted backdrop capture
// ---------------------------------------------------------------------------
/**
 * Captures just the slice of the desktop behind the drawer and hands it to the
 * renderer. A blurred snapshot reproduces the "frosted glass" look reliably,
 * even on systems where DWM acrylic is unavailable or disabled by the user.
 */
async function refreshBackdrop(force = false) {
  if (!IS_WIN || !win || win.isDestroyed() || backdropBusy) return;
  if (!force && Date.now() - lastBackdropAt < 9000) return;
  backdropBusy = true;
  try {
    const display = screen.getPrimaryDisplay();
    const b = win.getBounds();
    const thumbWidth = Math.max(800, Math.round(display.size.width * 0.9));
    const thumbHeight = Math.round(thumbWidth * display.size.height / display.size.width);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbWidth, height: thumbHeight },
      fetchWindowIcons: false,
    });
    if (!sources || !sources.length) return;
    const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    let image = source.thumbnail;
    if (!image || image.isEmpty()) return;

    const imageSize = image.getSize();
    if (!imageSize.width || !imageSize.height) return;
    const scaleX = imageSize.width / display.bounds.width;
    const scaleY = imageSize.height / display.bounds.height;
    const cropX = Math.max(0, Math.round((b.x - display.bounds.x) * scaleX));
    const cropY = Math.max(0, Math.round((b.y - display.bounds.y) * scaleY));
    const cropW = Math.max(1, Math.min(imageSize.width - cropX, Math.round(b.width * scaleX)));
    const cropH = Math.max(1, Math.min(imageSize.height - cropY, Math.round(b.height * scaleY)));
    image = image.crop({ x: cropX, y: cropY, width: cropW, height: cropH });
    if (cropW > 480) {
      image = image.resize({ width: 480, quality: 'good' });
    }
    const dataUrl = image.toDataURL();
    if (!dataUrl) return;
    lastBackdropAt = Date.now();
    if (win && !win.isDestroyed()) {
      win.webContents.send('drawer:backdrop', { dataUrl });
    }
  } catch (err) {
    log('backdrop capture failed:', err.message);
  } finally {
    backdropBusy = false;
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function getLayout() {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.max(420, Math.min(660, Math.round(area.width / 3)));
  return {
    x: area.x + area.width - width,
    y: area.y,
    width,
    height: area.height,
    area,
  };
}

function applyLayout() {
  if (!win || win.isDestroyed()) return;
  const b = getLayout();
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height }, false);
  win.webContents.send('drawer:layout', {
    width: b.width,
    height: b.height,
    workArea: b.area,
  });
}

function createWindow() {
  const bounds = getLayout();
  const options = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: APP_TITLE,
    icon: ICON_PATH,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  };
  if (IS_WIN) options.backgroundMaterial = 'none';

  win = new BrowserWindow(options);
  win.setMenu(null);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setSkipTaskbar(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(RENDERER_PATH);

  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return;
    win.showInactive();
    win.setIgnoreMouseEvents(true, { forward: true });
    scheduleWindowHealth();
    // Some Windows/GPU combinations restore the transparent window at login
    // with a valid DOM but no painted surface. One reload after the desktop is
    // ready gives Chromium a fresh frame; it is skipped if the user already
    // opened the drawer.
    setTimeout(() => {
      if (!win || win.isDestroyed() || quitting || !collapsed) return;
      try {
        win.webContents.reload();
        setTimeout(() => ensureWindowVisible('startup-reload'), 1200);
      } catch (err) {
        log('startup reload failed:', err.message);
      }
    }, 1600);
  });

  win.webContents.on('did-finish-load', () => {
    log('renderer loaded');
    rendererRecoveries = 0;
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    log('renderer gone:', details.reason, 'recoveries=', rendererRecoveries);
    if (quitting) return;
    rendererRecoveries += 1;
    if (rendererRecoveries > 3) {
      log('renderer repeatedly failed, restoring desktop icons and quitting');
      quitWithRestore();
      return;
    }
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      try { win.reload(); } catch { /* ignore */ }
    }, 600);
  });

  win.on('unresponsive', () => {
    log('window unresponsive, reloading');
    if (quitting) return;
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      try { win.webContents.reload(); } catch { /* ignore */ }
    }, 800);
  });

  win.webContents.on('did-fail-load', (_event, code, description) => {
    log('renderer load failed:', code, description);
    if (quitting) return;
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      try { win.reload(); } catch { /* ignore */ }
    }, 800);
  });

  win.on('blur', () => {
    if (!collapsed && !restoring) scheduleClose(220);
  });

  win.on('close', (event) => {
    if (allowQuit) return;
    event.preventDefault();
    quitWithRestore();
  });

  win.on('closed', () => {
    for (const timer of healTimers) clearTimeout(timer);
    healTimers = [];
    win = null;
  });
}

function openDrawer(withExpanded = false) {
  if (!win || win.isDestroyed() || quitting) return;
  if (win.isMinimized()) win.restore();
  if (Date.now() - lastBackdropAt > 9000) {
    refreshBackdrop().catch(() => {});
  }
  win.showInactive();
  win.setIgnoreMouseEvents(false);
  win.moveTop();
  collapsed = false;
  outsideSince = 0;
  if (withExpanded) expanded = true;
  win.webContents.send('drawer:open', { expanded, firstRun: !state.hasSeenHint });
  log('open drawer', { expanded });
}

let closeTimer = null;
function scheduleClose(delay = 650) {
  if (collapsed || restoring || contextMenuOpen || shellMenuOpen || renameOpen) return;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    closeDrawer();
  }, delay);
}

function cancelScheduledClose() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function closeDrawer() {
  if (collapsed || contextMenuOpen || shellMenuOpen || renameOpen || !win || win.isDestroyed()) return;
  collapsed = true;
  expanded = false;
  outsideSince = 0;
  win.webContents.send('drawer:close');
  setTimeout(() => {
    if (collapsed && win && !win.isDestroyed() && !restoring) {
      win.setIgnoreMouseEvents(true, { forward: true });
    }
  }, 520);
  log('close drawer');
}

function startHoverWatcher() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!win || win.isDestroyed() || quitting || restoring) return;
    if (contextMenuOpen || shellMenuOpen || renameOpen) return;
    if (!hoverEnabled) return;
    const pt = screen.getCursorScreenPoint();
    const b = win.getBounds();

    if (collapsed) {
      const inEdge = pt.x >= b.x + b.width - 24 && pt.x <= b.x + b.width + 2;
      const center = b.y + b.height / 2;
      const inY = Math.abs(pt.y - center) <= 145;
      if (inEdge && inY) {
        openDrawer(false);
      }
    } else if (!win.isFocused()) {
      const inside = pt.x >= b.x - 4 && pt.x <= b.x + b.width + 4
        && pt.y >= b.y - 4 && pt.y <= b.y + b.height + 4;
      if (inside) {
        outsideSince = 0;
      } else {
        if (!outsideSince) outsideSince = Date.now();
        if (Date.now() - outsideSince > 900) scheduleClose(0);
      }
    }
  }, 90);
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function setupTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(ICON_PATH));
    tray.setToolTip(`${APP_TITLE} · 桌面图标收纳`);
    const menu = Menu.buildFromTemplate([
      { label: '打开浮光抽屉', click: () => openDrawer(true) },
      { label: '修复显示（重建玻璃条）', click: () => repairWindow() },
      { label: '重新扫描桌面图标', click: () => { refreshData().catch(() => {}); } },
      {
        label: '鼠标悬停唤出',
        type: 'checkbox',
        checked: true,
        click: (item) => { hoverEnabled = item.checked; },
      },
      { type: 'separator' },
      { label: '归还桌面图标并退出', click: () => quitWithRestore() },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => openDrawer(true));
    tray.on('double-click', () => openDrawer(true));
  } catch (err) {
    log('tray setup failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Restore / quit
// ---------------------------------------------------------------------------
async function restoreIconsOnly() {
  if (restorePromise) return restorePromise;
  if (!weHidIcons) return { ok: true, skipped: true };
  restorePromise = (async () => {
    const result = await runIconAction('show');
    if (result.ok) {
      weHidIcons = false;
      setRestoreGuard(false);
      saveState({ sessionActive: false });
      log('desktop icons restored');
    } else {
      log('desktop icons restore failed:', result.error || result);
    }
    return result;
  })().finally(() => { restorePromise = null; });
  return restorePromise;
}

async function quitWithRestore() {
  if (quitting) return;
  quitting = true;
  restoring = true;
  if (win && !win.isDestroyed()) {
    win.webContents.send('app:restoring', { message: '正在把图标放回原位…' });
  }
  const result = await restoreIconsOnly();
  if (!result.ok) {
    restoring = false;
    quitting = false;
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:error', { message: `还原失败：${result.error || '未知错误'}` });
    }
    return;
  }
  allowQuit = true;
  setTimeout(() => app.quit(), 260);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function itemById(id) {
  if (!dataset) return null;
  return dataset.items.find((item) => item.id === id) || null;
}

async function launchItem(item) {
  if (!item) return { ok: false, error: 'item not found' };
  try {
    if (item.target) {
      try {
        await shell.openExternal(item.target);
      } catch {
        // shell: virtual folders are handled more reliably by Explorer itself.
        const child = spawn('explorer.exe', [item.target], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
      }
      return { ok: true };
    }
    const error = await shell.openPath(item.path);
    if (error) {
      // .url files occasionally need ShellExecute through openExternal.
      if (item.ext === '.url') {
        await shell.openExternal(item.path);
        return { ok: true };
      }
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function launchAndRecord(item) {
  const result = await launchItem(item);
  if (result.ok && item && !item.special) {
    const counts = state.launchCounts || {};
    counts[item.id] = (counts[item.id] || 0) + 1;
    saveState({ launchCounts: counts });
    rebuildDataset();
    sendData();
  }
  return result;
}

function showShellMenu(item) {
  if (!item || item.special || !item.path || !fs.existsSync(item.path)) return;
  if (shellMenuOpen || renameOpen) return;
  const helper = path.join(ROOT, 'scripts', 'shell-menu.ps1');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!fs.existsSync(helper)) {
    log('shell menu helper missing');
    return;
  }
  shellMenuOpen = true;
  let child;
  try {
    child = spawn(powershell, [
      '-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
      '-File', helper, '-Path', item.path,
    ], { windowsHide: true, stdio: 'ignore' });
  } catch (err) {
    shellMenuOpen = false;
    log('shell menu failed:', err.message);
    return;
  }
  const done = () => { shellMenuOpen = false; };
  child.on('exit', done);
  child.on('error', (err) => {
    done();
    log('shell menu error:', err.message);
  });
  log('shell menu opened for', item.fullName);
}

function setupIpc() {
  ipcMain.on('renderer:ready', async () => {
    try {
      if (!dataset) await scanDesktop();
      sendData();
      win.webContents.send('drawer:state', { open: !collapsed, expanded, firstRun: !state.hasSeenHint });
    } catch (err) {
      log('renderer ready scan failed:', err.message);
    }
  });

  ipcMain.handle('icons:get', async () => {
    if (!dataset) await scanDesktop();
    return dataset;
  });

  ipcMain.handle('icons:refresh', async () => {
    await refreshData();
    return dataset;
  });

  ipcMain.handle('icon:launch', async (_event, id) => {
    const item = itemById(id);
    const result = await launchAndRecord(item);
    if (result.ok) {
      scheduleClose(180);
    } else {
      win.webContents.send('app:error', { message: `打开失败：${result.error || '未知错误'}` });
    }
    return result;
  });

  ipcMain.handle('icon:toggle-category', async (_event, payload) => {
    const item = itemById(payload && payload.id);
    const kind = payload && payload.kind;
    if (!item) return { ok: false, error: 'item not found' };
    return toggleCurated(item, kind) || { ok: false, error: 'toggle failed' };
  });

  ipcMain.handle('icon:rename', async (_event, payload) => {
    const item = itemById(payload && payload.id);
    if (!item || item.special) return { ok: false, error: '这个图标不支持重命名' };
    const name = String((payload && payload.name) || '').trim();
    if (!name || name === '.' || name === '..') {
      return { ok: false, error: '名称不能为空' };
    }
    if (name.length > 255) return { ok: false, error: '名称过长' };
    if (/[\\/:*?"<>|]/.test(name) || /[\x00-\x1f]/.test(name)) {
      return { ok: false, error: '名称包含 Windows 不允许的字符' };
    }
    if (/[. ]$/.test(name)) {
      return { ok: false, error: '名称不能以空格或点结尾' };
    }
    const target = path.join(path.dirname(item.path), name);
    if (target === item.path) return { ok: true, name };
    if (target.toLowerCase() === item.path.toLowerCase()) {
      return { ok: true, name };
    }
    if (fs.existsSync(target)) {
      return { ok: false, error: '同一位置已经存在同名文件' };
    }
    try {
      await fsp.rename(item.path, target);
      await scanDesktop();
      sendData();
      return { ok: true, name };
    } catch (err) {
      log('rename failed:', err.message);
      return { ok: false, error: err.code === 'EACCES' ? '没有权限重命名这个文件' : err.message };
    }
  });

  ipcMain.on('drawer:rename-state', (_event, value) => {
    renameOpen = !!value;
    if (!renameOpen) cancelScheduledClose();
  });

  ipcMain.on('icon:context', (_event, id) => {
    const item = itemById(id);
    if (!item) return;
    const template = [
      {
        label: '打开',
        click: () => {
          contextMenuOpen = false;
          launchAndRecord(item).then((result) => {
            if (result.ok) scheduleClose(180);
          });
        },
      },
      {
        label: '重命名…',
        enabled: !item.special,
        click: () => {
          renameOpen = true;
          win.webContents.send('drawer:rename', { id: item.id, fullName: item.fullName });
        },
      },
      {
        label: '更多 Windows 功能…',
        enabled: !item.special,
        click: () => showShellMenu(item),
      },
      { type: 'separator' },
      {
        label: item.favorite ? '从常用中移除' : '加入常用',
        click: () => toggleCurated(item, 'favorite'),
      },
      {
        label: item.ai ? '从 AI 工具集合移除' : '加入 AI 工具集合',
        enabled: !item.special,
        click: () => toggleCurated(item, 'ai'),
      },
      { type: 'separator' },
      {
        label: '打开所在位置',
        enabled: !item.special,
        click: () => shell.showItemInFolder(item.path),
      },
      { type: 'separator' },
      {
        label: '复制完整路径',
        enabled: !item.special,
        click: () => clipboard.writeText(item.path),
      },
      {
        label: '复制名称',
        click: () => clipboard.writeText(item.fullName),
      },
    ];
    contextMenuOpen = true;
    Menu.buildFromTemplate(template).popup({
      window: win,
      callback: () => {
        contextMenuOpen = false;
      },
    });
  });

  ipcMain.on('drawer:expanded', (_event, value) => {
    expanded = !!value;
  });

  ipcMain.on('drawer:request-close', () => {
    cancelScheduledClose();
    scheduleClose(80);
  });

  ipcMain.on('drawer:hover-enter', () => {
    cancelScheduledClose();
  });

  ipcMain.on('drawer:request-open', (_event, withExpanded) => {
    openDrawer(!!withExpanded);
  });

  ipcMain.on('drawer:request-collapse', () => {
    expanded = false;
    scheduleClose(60);
  });

  ipcMain.on('app:hint-seen', () => {
    if (!state.hasSeenHint) saveState({ hasSeenHint: true });
    if (dataset) dataset.firstRun = false;
  });

  ipcMain.handle('drawer:restore', async () => {
    if (restoring) return { ok: true };
    restoring = true;
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:restoring', { message: '正在把图标放回原位…' });
    }
    const result = await restoreIconsOnly();
    if (!result.ok) {
      restoring = false;
      if (win && !win.isDestroyed()) {
        win.webContents.send('app:error', { message: `还原失败：${result.error || '未知错误'}` });
      }
      return result;
    }
    setTimeout(() => {
      allowQuit = true;
      app.quit();
    }, 520);
    return { ok: true };
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    stateFile,
  }));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
app.on('second-instance', () => {
  log('second instance');
  ensureWindowVisible('second-instance');
  openDrawer(true);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    stateFile = path.join(app.getPath('userData'), 'state.json');
    logFile = path.join(app.getPath('userData'), 'app.log');
    state = loadState();
    log('starting', { version: app.getVersion(), packaged: app.isPackaged, state });

    createWindow();
    setupIpc();
    setupTray();
    startHoverWatcher();
    screen.on('display-metrics-changed', () => applyLayout());
    screen.on('display-added', () => applyLayout());
    screen.on('display-removed', () => applyLayout());

    win.webContents.once('did-finish-load', async () => {
      try {
        if (process.env.FUGUANG_TEST_NO_HIDE === '1') {
          log('test mode: desktop icons are left untouched');
          await scanDesktop();
          sendData();
          return;
        }
        const result = await runIconAction('hide');
        if (result.ok && result.before === 0) {
          weHidIcons = true;
          saveState({ sessionActive: true, originalHideIcons: 0 });
          setRestoreGuard(true);
        } else if (result.ok && result.before === 1) {
          // Icons were already hidden. If our previous session crashed while
          // owning that hidden state, keep the ownership so we can restore.
          weHidIcons = !!state.sessionActive;
          if (weHidIcons) {
            saveState({ sessionActive: true });
            setRestoreGuard(true);
          }
        } else {
          weHidIcons = false;
          hideWarning = result.error || '无法收纳桌面图标';
          log('hide failed:', result);
        }
        await scanDesktop();
        sendData();
        if (hideWarning && dataset) {
          dataset.warning = hideWarning;
          sendData();
        }
        setTimeout(() => refreshBackdrop(true), 500);
      } catch (err) {
        hideWarning = err.message;
        log('boot error:', err);
      }
    });
  });
}

app.on('before-quit', (event) => {
  if (allowQuit) return;
  event.preventDefault();
  quitWithRestore();
});

app.on('window-all-closed', () => {
  if (allowQuit) return;
  quitWithRestore();
});

app.on('will-quit', () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  for (const timer of healTimers) clearTimeout(timer);
  healTimers = [];
  if (tray) {
    try { tray.destroy(); } catch { /* ignore */ }
    tray = null;
  }
});
