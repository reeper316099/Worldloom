import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, screen, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { startServer } from '@worldloom/server';
import { APP_NAME, DATA_DIR_ENV } from '@worldloom/shared';

// All state lives under one app-data folder (override: WORLDLOOM_DATA_DIR, or the folder chosen in Settings).
app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));
const metaFile = path.join(app.getPath('userData'), 'meta.json');
const readMeta = (): { dataDir?: string } => { try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { return {}; } };
const dataDir = process.env[DATA_DIR_ENV] ? path.resolve(process.env[DATA_DIR_ENV]!) : (readMeta().dataDir ?? app.getPath('userData'));

let win: BrowserWindow | undefined;
let origin = '';
let token = '';
let stop: (() => Promise<void>) | undefined;

const stateFile = path.join(app.getPath('userData'), 'window-state.json');
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { x?: number; y?: number; width: number; height: number; max?: boolean };
    // ignore saved positions that are no longer on any display
    const on = s.x !== undefined && s.y !== undefined && screen.getAllDisplays().some((d) => s.x! >= d.bounds.x - 50 && s.x! < d.bounds.x + d.bounds.width && s.y! >= d.bounds.y - 50 && s.y! < d.bounds.y + d.bounds.height);
    return { ...s, x: on ? s.x : undefined, y: on ? s.y : undefined };
  } catch { return { width: 1360, height: 880 } as { x?: number; y?: number; width: number; height: number; max?: boolean }; }
}
function saveState(w: BrowserWindow) {
  const b = w.isMaximized() || w.isFullScreen() ? undefined : w.getBounds();
  try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ ...(b ?? loadState()), max: w.isMaximized() })); } catch { /* non-fatal */ }
}

const send = (channel: string, ...a: unknown[]) => win?.webContents.send(channel, ...a);
function buildMenu() {
  const mac = process.platform === 'darwin';
  const act = (name: string) => () => send('menu', name);
  const tpl: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [
      { label: 'Worlds home', accelerator: 'CmdOrCtrl+Shift+H', click: act('home') },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: act('settings') },
      { label: 'Show data folder', click: () => void shell.openPath(dataDir) },
      { type: 'separator' }, mac ? { role: 'close' as const } : { role: 'quit' as const },
    ] },
    { role: 'editMenu' as const },
    { label: 'View', submenu: [
      { label: 'Command palette', accelerator: 'CmdOrCtrl+K', click: act('palette') },
      { label: 'Toggle author / reader mode', accelerator: 'CmdOrCtrl+Shift+S', click: act('toggle-spoiler') },
      { type: 'separator' }, { role: 'resetZoom' as const }, { role: 'zoomIn' as const }, { role: 'zoomOut' as const }, { role: 'togglefullscreen' as const },
      ...(app.isPackaged ? [] : [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }]),
    ] },
    { role: 'windowMenu' as const },
    { label: 'Help', submenu: [{ label: 'Keyboard shortcuts', accelerator: 'Shift+/', click: act('help') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function hardenSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  // v1 makes zero network calls: anything that is not the local API/UI is cancelled.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (d, cb) => {
    try { cb({ cancel: new URL(d.url).origin !== origin }); } catch { cb({ cancel: true }); }
  });
}

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width, height: st.height, minWidth: 720, minHeight: 520, show: false, backgroundColor: '#0d0e14', title: APP_NAME,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, preload: path.join(__dirname, 'preload.cjs'), spellcheck: false },
  });
  if (st.max) win.maximize();
  win.once('ready-to-show', () => win?.show());
  win.on('close', () => win && saveState(win));
  win.on('closed', () => { win = undefined; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== origin) e.preventDefault(); });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error(`load failed: ${code} ${desc} ${url}`));
  void win.loadURL(`${origin}/`).catch((e) => console.error('loadURL error', e));
}

/** Only our own window's main frame, served from our local origin, may use the IPC bridge. */
const trusted = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
  if (!win || e.sender !== win.webContents) return false;
  try { return new URL(e.senderFrame?.url || origin).origin === origin; } catch { return false; } // url is empty while the preload runs
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  void app.whenReady().then(async () => {
    const root = __dirname;
    const srv = await startServer({ dataDir, staticDir: path.join(root, 'renderer'), starterDir: path.join(root, 'starter-worlds'), watch: true });
    origin = `http://127.0.0.1:${srv.port}`;
    token = srv.token;
    stop = srv.close;
    ipcMain.on('wl:config', (e) => { e.returnValue = trusted(e) ? { baseUrl: origin, token } : null; }); // always answers: the preload blocks on this
    ipcMain.handle('wl:reveal-data-dir', (e) => { if (trusted(e)) return shell.openPath(dataDir).then(() => undefined); });
    ipcMain.handle('wl:choose-folder', async (e) => {
      if (!trusted(e) || !win) return null;
      const r = await dialog.showOpenDialog(win, { title: 'Choose a folder', properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    });
    ipcMain.handle('wl:choose-data-dir', async (e) => {
      if (!trusted(e) || !win) return null;
      const r = await dialog.showOpenDialog(win, { title: 'Choose data folder', properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      fs.mkdirSync(path.dirname(metaFile), { recursive: true });
      fs.writeFileSync(metaFile, JSON.stringify({ ...readMeta(), dataDir: r.filePaths[0] }, null, 2));
      app.relaunch();
      app.quit();
      return r.filePaths[0];
    });
    hardenSession();
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  }).catch((e) => { console.error("[worldloom] startup failed", e); dialog.showErrorBox('Worldloom failed to start', String(e instanceof Error ? e.message : e)); app.exit(1); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting || !stop) return;
    e.preventDefault();
    quitting = true;
    void stop().finally(() => app.quit());
  });
}
