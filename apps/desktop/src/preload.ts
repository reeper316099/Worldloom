import { contextBridge, ipcRenderer } from 'electron';

// The per-launch API token reaches the page only through this bridge; the renderer has no Node access.
const cfg = ipcRenderer.sendSync('wl:config') as { baseUrl: string; token: string } | null;
if (cfg) contextBridge.exposeInMainWorld('worldloom', cfg);
contextBridge.exposeInMainWorld('worldloomDesktop', {
  chooseDataDir: (): Promise<string | null> => ipcRenderer.invoke('wl:choose-data-dir'),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('wl:choose-folder'),
  revealDataDir: (): Promise<void> => ipcRenderer.invoke('wl:reveal-data-dir'),
  onMenu: (cb: (action: string) => void) => { const h = (_: unknown, a: string) => cb(a); ipcRenderer.on('menu', h); return () => ipcRenderer.removeListener('menu', h); },
});
