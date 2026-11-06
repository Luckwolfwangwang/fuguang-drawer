'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const listener = (_event, payload) => {
    try { callback(payload); } catch (err) { console.error(err); }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('fuguang', {
  ready: () => ipcRenderer.send('renderer:ready'),
  getData: () => ipcRenderer.invoke('icons:get'),
  refresh: () => ipcRenderer.invoke('icons:refresh'),
  launch: (id) => ipcRenderer.invoke('icon:launch', id),
  toggleCategory: (id, kind) => ipcRenderer.invoke('icon:toggle-category', { id, kind }),
  rename: (id, name) => ipcRenderer.invoke('icon:rename', { id, name }),
  renameState: (value) => ipcRenderer.send('drawer:rename-state', !!value),
  contextMenu: (id) => ipcRenderer.send('icon:context', id),
  setExpanded: (value) => ipcRenderer.send('drawer:expanded', !!value),
  requestClose: () => ipcRenderer.send('drawer:request-close'),
  requestCollapse: () => ipcRenderer.send('drawer:request-collapse'),
  requestOpen: (expanded) => ipcRenderer.send('drawer:request-open', !!expanded),
  hoverEnter: () => ipcRenderer.send('drawer:hover-enter'),
  restore: () => ipcRenderer.invoke('drawer:restore'),
  hintSeen: () => ipcRenderer.send('app:hint-seen'),

  onData: (cb) => on('drawer:data', cb),
  onOpen: (cb) => on('drawer:open', cb),
  onClose: (cb) => on('drawer:close', cb),
  onState: (cb) => on('drawer:state', cb),
  onRename: (cb) => on('drawer:rename', cb),
  onRestoring: (cb) => on('app:restoring', cb),
  onError: (cb) => on('app:error', cb),
  onToast: (cb) => on('app:toast', cb),
  onLayout: (cb) => on('drawer:layout', cb),
  onBackdrop: (cb) => on('drawer:backdrop', cb),
});
