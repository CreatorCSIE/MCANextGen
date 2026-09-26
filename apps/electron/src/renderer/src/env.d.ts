/// <reference types="vite/client" />

import type { HostApi } from '@shared/ipc'

declare global {
  interface Window {
    /** MCANextGen host bridge exposed by the preload script. */
    mcanextgen: HostApi
  }
}

export {}
