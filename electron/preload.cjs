const { contextBridge } = require('electron')

const apiBaseArg = process.argv.find((arg) => arg.startsWith('--api-base-url='))
const apiBaseUrl = apiBaseArg ? apiBaseArg.slice('--api-base-url='.length) : ''

contextBridge.exposeInMainWorld('questionWorkbench', {
  apiBaseUrl,
})
