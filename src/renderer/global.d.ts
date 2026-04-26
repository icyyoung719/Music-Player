import type { ElectronAPI } from './core/electronApi.js'

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
