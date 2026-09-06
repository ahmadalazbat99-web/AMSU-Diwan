const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  init:()=>ipcRenderer.invoke('init'), getState:()=>ipcRenderer.invoke('getState'), saveState:s=>ipcRenderer.invoke('saveState',s),
  login:(username,password)=>ipcRenderer.invoke('login',{username,password}), saveAttachment:a=>ipcRenderer.invoke('saveAttachment',a),
  readAttachment:p=>ipcRenderer.invoke('readAttachment',p), saveLogo:o=>ipcRenderer.invoke('saveLogo',o), getLogo:()=>ipcRenderer.invoke('getLogo'),
  removeLogo:()=>ipcRenderer.invoke('removeLogo'), backup:()=>ipcRenderer.invoke('backup'), setUserPassword:(id,pw)=>ipcRenderer.invoke('setUserPassword',{id,pw}), toggleFullscreen:()=>ipcRenderer.invoke('toggleFullscreen'),
  getLicenseStatus:()=>ipcRenderer.invoke('getLicenseStatus'), activateLicense:key=>ipcRenderer.invoke('activateLicense',key), checkLicense:()=>ipcRenderer.invoke('checkLicense'),
  onLicenseStatusChanged:callback=>{ const fn=(event,data)=>callback(data); ipcRenderer.on('license-status-changed',fn); return ()=>ipcRenderer.removeListener('license-status-changed',fn); },
  onUpdateStatus:callback=>{ const fn=(event,data)=>callback(data); ipcRenderer.on('update-status',fn); return ()=>ipcRenderer.removeListener('update-status',fn); }
});
