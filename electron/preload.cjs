const { contextBridge, ipcRenderer } = require('electron')

const apiBaseArg = process.argv.find((arg) => arg.startsWith('--api-base-url='))
const apiBaseUrl = apiBaseArg ? apiBaseArg.slice('--api-base-url='.length) : ''

contextBridge.exposeInMainWorld('questionWorkbench', {
  apiBaseUrl,
  updates: {
    check: (options) => ipcRenderer.invoke('updates:check', options),
    download: () => ipcRenderer.invoke('updates:download'),
    openDownloaded: () => ipcRenderer.invoke('updates:open-downloaded'),
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('updates:progress', listener)
      return () => ipcRenderer.removeListener('updates:progress', listener)
    },
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('updates:status', listener)
      return () => ipcRenderer.removeListener('updates:status', listener)
    },
  },
})
