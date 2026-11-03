const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  version: '2.0.0',
  send: (channel, data) => {
    const validChannels = ['toMain', 'minimizeWindow', 'maximizeWindow', 'closeWindow', 'openFolder'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, func) => {
    const validChannels = ['fromMain', 'backendStatus'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
  selectDirectory: () => ipcRenderer.invoke('selectDirectory'),
});
