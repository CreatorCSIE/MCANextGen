import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const hostVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

const define = { __HOST_VERSION__: JSON.stringify(hostVersion) }

export default defineConfig({
  main: {
    define,
    // The runtime and native-win32 packages ship TypeScript source so that a
    // future Tauri/CLI edition can consume the same files; bundling them keeps
    // `out/main` self-contained. koffi (a native addon) stays external and is
    // resolved from node_modules at runtime, never bundled.
    plugins: [
      externalizeDepsPlugin({ exclude: ['@mcanextgen/runtime', '@mcanextgen/native-win32'] })
    ],
    resolve: {
      alias: {
        '@main': fileURLToPath(new URL('./src/main', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
      }
    }
  },
  preload: {
    define,
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
      }
    }
  },
  renderer: {
    define,
    resolve: {
      alias: {
        '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
      }
    },
    plugins: [vue()]
  }
})
