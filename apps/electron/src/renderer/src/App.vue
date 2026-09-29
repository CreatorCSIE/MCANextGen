<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type {
  HostInfo,
  JavaStatusView,
  MinecraftFixView,
  MinecraftStateView,
  MinecraftVersionOptionView
} from '@shared/ipc'

const info = ref<HostInfo | null>(null)
const java = ref<JavaStatusView | null>(null)
const javaBusy = ref(false)
const error = ref('')

async function detectJava(): Promise<void> {
  javaBusy.value = true
  error.value = ''
  try {
    java.value = await window.mcanextgen.detectJava()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    javaBusy.value = false
  }
}

const game = ref<MinecraftStateView | null>(null)
const gameBusy = ref(false)
const gameVersion = ref('c0.0.21a_01')
const gameVersions = ref<MinecraftVersionOptionView[]>([])
let gameTimer: number | null = null

/** Checkbox state for the selected version's optional features (registry defaults on switch). */
const fixToggles = ref<Array<MinecraftFixView & { enabled: boolean }>>([])
/** Classic server connection fields; only meaningful when the version supports them. */
const server = ref('')
const port = ref('')

/**
 * Applet 入口类（临时下拉方案，正式 UI 设计时再重做）：
 * 无差别启用——即使 jar 只有一个入口也显示，让用户始终能看到将要启动的
 * 真实入口类；扫描失败/未返回时回退为仅注册表默认入口一项。
 * 选项只显示简名（提交值仍是全限定类名），避免撑宽选项行。
 */
const appletChoices = ref<string[]>([])
const appletClass = ref('')
let appletScanSeq = 0

function appletSimpleName(className: string): string {
  return className.slice(className.lastIndexOf('.') + 1)
}

const selectedVersion = computed(
  () => gameVersions.value.find((option) => option.id === gameVersion.value) ?? null
)

async function refreshAppletChoices(versionId: string): Promise<void> {
  if (versionId === '') return
  const seq = ++appletScanSeq
  appletChoices.value = []
  appletClass.value = ''
  try {
    const scan = await window.mcanextgen.listMinecraftApplets(versionId)
    if (seq !== appletScanSeq) return
    appletClass.value = scan.defaultAppletClass
    appletChoices.value =
      scan.appletClasses.length > 0 ? scan.appletClasses : [scan.defaultAppletClass]
  } catch {
    // 枚举失败不阻塞启动：保持注册表默认入口
  }
}

watch(
  selectedVersion,
  (version) => {
    fixToggles.value = (version?.fixes ?? []).map((fix) => ({ ...fix, enabled: fix.defaultEnabled }))
    void refreshAppletChoices(version?.id ?? '')
  },
  { immediate: true }
)

function stopGamePolling(): void {
  if (gameTimer !== null) {
    window.clearInterval(gameTimer)
    gameTimer = null
  }
}

function pollGameStatus(): void {
  stopGamePolling()
  gameTimer = window.setInterval(async () => {
    game.value = await window.mcanextgen.getMinecraftStatus()
    if (!game.value.running) stopGamePolling()
  }, 1000)
}

async function launchGame(): Promise<void> {
  gameBusy.value = true
  try {
    const extraParameters: Record<string, string> = {}
    if (server.value.trim() !== '') extraParameters.server = server.value.trim()
    if (port.value.trim() !== '') extraParameters.port = port.value.trim()
    game.value = await window.mcanextgen.launchMinecraft(gameVersion.value, {
      fixesEnabled: fixToggles.value.filter((fix) => fix.enabled).map((fix) => fix.kind),
      extraParameters,
      appletClass: appletClass.value === '' ? undefined : appletClass.value
    })
    if (game.value.running) pollGameStatus()
  } catch (err) {
    game.value = {
      running: false,
      versionId: gameVersion.value,
      pid: null,
      exitCode: null,
      exitSignal: null,
      error: err instanceof Error ? err.message : String(err),
      window: {
        state: 'none',
        supported: false,
        hwnd: null,
        pid: null,
        className: null,
        title: null,
        embedded: false,
        embedError: null
      },
      embed: null
    }
  } finally {
    gameBusy.value = false
  }
}

async function stopGame(): Promise<void> {
  gameBusy.value = true
  try {
    game.value = await window.mcanextgen.stopMinecraft()
    pollGameStatus()
  } finally {
    gameBusy.value = false
  }
}

/** Phase 2: human-readable line about the native game window (null = nothing to show). */
function windowStatusText(): string | null {
  const view = game.value?.window
  if (!view || view.state === 'none') return null
  if (view.state === 'pending') return 'Native window: waiting for the game window to appear…'
  if (view.state === 'lost') return 'Native window: disappeared while the game process is still alive'
  if (view.embedError) return `Embedding failed — running windowed: ${view.embedError}`
  const title = view.title ? ` — "${view.title}"` : ''
  const verb = view.embedded ? 'embedded' : 'detected'
  return `Native window ${verb}: ${view.className} ${view.hwnd}${title}`
}

/* --- Embedding slot (Phase 3): the DOM reserves and positions this rect;
 * main creates the native clip container over it and docks the game window. --- */

const slotEl = ref<HTMLElement | null>(null)
let reportScheduled = false

/**
 * Slot geometry from the resolved embed policy:
 * - fixed: a physical gameWidth×gameHeight box (÷dpr → CSS px), centred by
 *   the flex viewport; the letterbox background stays DOM-drawn.
 * - resizable: the slot stretches to fill the viewport and every rect change
 *   is forwarded to main.
 */
const embedSlotStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {}
  const embed = game.value?.embed
  if (!embed) return style
  const dpr = window.devicePixelRatio || 1
  if (embed.policy === 'resizable') {
    style.position = 'absolute'
    style.inset = '0'
    return style
  }
  style.width = `${embed.gameWidth / dpr}px`
  style.height = `${embed.gameHeight / dpr}px`
  style.flex = '0 0 auto'
  return style
})

function scheduleBoundsReport(): void {
  if (reportScheduled) return
  reportScheduled = true
  requestAnimationFrame(() => {
    reportScheduled = false
    void reportEmbedBounds()
  })
}

/** Send the slot's physical-pixel, client-area rect to main. */
async function reportEmbedBounds(): Promise<void> {
  const el = slotEl.value
  const view = game.value
  if (!el || !view?.embed || view.window.state !== 'found') return
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const bounds = {
    x: Math.round(rect.left * dpr),
    y: Math.round(rect.top * dpr),
    width: Math.round(rect.width * dpr),
    height: Math.round(rect.height * dpr)
  }
  try {
    game.value = await window.mcanextgen.setMinecraftEmbedBounds(bounds)
  } catch {
    // A dropped IPC must not break polling; the next report retries.
  }
}

let resizeObserver: ResizeObserver | null = null

// flush: 'post' — slotEl must point at the rendered slot when this runs.
watch(
  () => [game.value?.embed?.policy, game.value?.window.state] as const,
  ([, state]) => {
    if (state === 'found') scheduleBoundsReport()
    if (state === 'found' && slotEl.value && !resizeObserver) {
      resizeObserver = new ResizeObserver(() => scheduleBoundsReport())
      resizeObserver.observe(slotEl.value)
    }
    if (state !== 'found' && resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
  },
  { flush: 'post' }
)

onMounted(async () => {
  try {
    info.value = await window.mcanextgen.getInfo()
    gameVersions.value = await window.mcanextgen.listMinecraftVersions()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
  await detectJava()
  // Focus forwarding (plan.md risk #3 live update 2): a click anywhere on the
  // chrome that is NOT an interactive DOM control means "I'm not typing here"
  // — hand Win32 keyboard focus back to the embedded game window. Clicks
  // inside the game area never reach the DOM (the native window eats them),
  // so this covers the DOM-adjacent focus losses; window re-activation is
  // covered main-side (BrowserWindow 'focus').
  document.addEventListener('mousedown', forwardFocusToGame, true)
})

function forwardFocusToGame(event: MouseEvent): void {
  if (!game.value?.window.embedded) return
  const target = event.target as Element | null
  if (target && target.closest('input, button, select, textarea, a, label')) return
  void window.mcanextgen.focusGame().catch(() => {})
}

onBeforeUnmount(() => {
  stopGamePolling()
  document.removeEventListener('mousedown', forwardFocusToGame, true)
})
</script>

<template>
  <div class="host">
    <header class="host__bar">
      <span class="host__title">MCANextGen</span>
      <span class="host__muted">v{{ info?.hostVersion ?? '0.0.0' }}</span>
      <span class="host__spacer" />
      <span class="host__muted">Electron Edition</span>
    </header>

    <main id="viewport" class="host__viewport">
      <div v-if="!game?.embed" class="viewport__placeholder">
        <p class="viewport__title">Native window container</p>
        <p class="viewport__hint">
          The Minecraft Applet will be embedded here as a native child window.
        </p>
      </div>
      <!--
        The slot reserves the embedding rect; main draws the native clip
        container over it and docks the game window. It is deliberately
        transparent — the game paints the pixels, the DOM only positions them.
      -->
      <div
        v-else
        ref="slotEl"
        class="viewport__slot"
        :class="`viewport__slot--${game.embed.policy}`"
        :style="embedSlotStyle"
      ></div>
    </main>

    <section class="runtime">
      <div class="runtime__head">
        <span class="runtime__label">Java runtime</span>
        <span
          v-if="java"
          class="runtime__verdict"
          :class="java.ok ? (java.usedFallback ? 'runtime__verdict--warn' : 'runtime__verdict--ok') : 'runtime__verdict--bad'"
        >
          {{ java.reason }}
        </span>
        <span v-else-if="error" class="runtime__verdict runtime__verdict--bad">{{ error }}</span>
        <span class="host__spacer" />
        <span v-if="java" class="host__muted">
          {{ java.installations.length }} installed · {{ java.durationMs }} ms
        </span>
        <button class="runtime__button" :disabled="javaBusy" @click="detectJava">
          {{ javaBusy ? 'Probing…' : 'Detect Java' }}
        </button>
      </div>

      <ul v-if="java && java.installations.length" class="runtime__list">
        <li v-for="entry in java.installations" :key="entry.executable" :class="{ 'is-selected': entry.selected }">
          <span class="runtime__version">{{ entry.version }}</span>
          <span class="runtime__arch">{{ entry.architecture }}</span>
          <span class="runtime__source">{{ entry.source }}</span>
          <span class="runtime__path">{{ entry.executable }}</span>
          <span v-if="entry.selected" class="runtime__tag">selected</span>
        </li>
      </ul>

      <p v-if="java && java.failures.length" class="runtime__note">
        {{ java.failures.length }} candidate(s) could not be executed:
        <span class="runtime__path">{{ java.failures[0].executable }}</span>
        ({{ java.failures[0].reason }})
      </p>
    </section>

    <section class="runtime">
      <div class="runtime__head">
        <span class="runtime__label">Minecraft</span>
        <span v-if="game?.running" class="runtime__verdict runtime__verdict--ok">
          Running (pid {{ game.pid }})
          <template v-if="game.window.embedError"> — windowed (embed failed)</template>
          <template v-else-if="game.window.embedded"> — embedded</template>
          <template v-else> — waiting for window</template>
        </span>
        <span v-else-if="game && game.exitCode !== null" class="runtime__verdict">
          Exited with code {{ game.exitCode }}
        </span>
        <span v-else-if="game?.error" class="runtime__verdict runtime__verdict--bad">
          {{ game.error }}
        </span>
        <span class="host__spacer" />
        <select v-model="gameVersion" class="runtime__button" :disabled="game?.running || gameBusy">
          <option v-for="option in gameVersions" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
        <button
          v-if="!game?.running"
          class="runtime__button"
          :disabled="gameBusy"
          @click="launchGame"
        >
          {{ gameBusy ? 'Launching…' : 'Launch' }}
        </button>
        <button
          v-else
          class="runtime__button"
          :disabled="gameBusy"
          @click="stopGame"
        >
          Stop
        </button>
      </div>

      <div class="runtime__options">
        <label
          v-for="fix in fixToggles"
          :key="fix.kind"
          class="runtime__check"
          :class="{ 'is-disabled': game?.running }"
        >
          <input v-model="fix.enabled" type="checkbox" :disabled="game?.running || gameBusy" />
          {{ fix.label }}
        </label>
        <!-- 临时入口下拉：无差别启用，单入口 jar 也展示将要启动的真实入口类 -->
        <label v-if="appletChoices.length > 0" class="runtime__check">
          Applet 入口
          <select
            v-model="appletClass"
            class="runtime__input runtime__input--applet"
            :disabled="game?.running || gameBusy"
          >
            <option v-for="entry in appletChoices" :key="entry" :value="entry">
              {{ appletSimpleName(entry) }}
            </option>
          </select>
        </label>
        <span class="host__spacer" />
        <input
          v-model="server"
          class="runtime__input"
          placeholder="server"
          :disabled="!selectedVersion?.supportsMultiplayer || game?.running || gameBusy"
          :title="
            selectedVersion?.supportsMultiplayer
              ? 'Leave empty for singleplayer'
              : 'This version does not read server/port applet parameters'
          "
        />
        <input
          v-model="port"
          class="runtime__input runtime__input--port"
          placeholder="port"
          :disabled="!selectedVersion?.supportsMultiplayer || game?.running || gameBusy"
        />
      </div>

      <!-- Phase 2: native window detection (by owning pid, not by title) -->
      <p v-if="windowStatusText()" class="runtime__note">{{ windowStatusText() }}</p>
    </section>

    <footer class="host__bar host__bar--footer">
      <span class="host__muted">
        Status: {{ game?.running ? `Game running (pid ${game.pid})` : 'Idle' }}
      </span>
      <span class="host__spacer" />
      <span v-if="info" class="host__muted">
        {{ info.platform }}/{{ info.arch }} · Electron {{ info.electronVersion }} · Node
        {{ info.nodeVersion }} · Chromium {{ info.chromeVersion }}
      </span>
    </footer>
  </div>
</template>

<style scoped>
.host {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.host__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--host-panel);
  border-bottom: 1px solid var(--host-border);
}

.host__bar--footer {
  border-bottom: none;
  border-top: 1px solid var(--host-border);
}

.host__title {
  font-weight: 600;
}

.host__muted {
  color: var(--host-muted);
}

.host__spacer {
  flex: 1;
}

.host__viewport {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  min-height: 120px;
}

.viewport__placeholder {
  flex: 1;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px dashed var(--host-border);
  border-radius: 6px;
  text-align: center;
}

/*
 * The embedding slot: physically exact (fixed: game size; resizable: inset 0),
 * visually inert — the native clip container and the game window paint over
 * it. The viewport's own background is the letterbox.
 */
.viewport__slot {
  pointer-events: none;
}

.viewport__slot--fixed {
  border: 1px dashed var(--host-border);
  border-radius: 4px;
}

.viewport__title {
  margin: 0;
  font-size: 15px;
}

.viewport__hint {
  margin: 0;
  color: var(--host-muted);
}

.runtime {
  padding: 8px 12px 10px;
  border-top: 1px solid var(--host-border);
  background: var(--host-bg);
}

.runtime__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.runtime__label {
  font-weight: 600;
}

.runtime__verdict {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 55%;
}

.runtime__verdict--ok {
  color: var(--host-accent);
}

.runtime__verdict--warn {
  color: #d8a657;
}

.runtime__verdict--bad {
  color: #e06c6c;
}

.runtime__button {
  padding: 4px 10px;
  border: 1px solid var(--host-border);
  border-radius: 4px;
  background: var(--host-panel);
  color: var(--host-text);
  font: inherit;
  cursor: pointer;
}

.runtime__button:disabled {
  opacity: 0.6;
  cursor: default;
}

.runtime__options {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 8px;
  font-size: 12px;
}

.runtime__check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--host-muted);
  cursor: pointer;
}

.runtime__check.is-disabled {
  cursor: default;
}

.runtime__input {
  padding: 3px 8px;
  border: 1px solid var(--host-border);
  border-radius: 4px;
  background: var(--host-panel);
  color: var(--host-text);
  font: inherit;
  width: 180px;
}

.runtime__input--port {
  width: 72px;
}

.runtime__input--applet {
  width: auto;
  max-width: 300px;
}

.runtime__input:disabled {
  opacity: 0.5;
}

.runtime__list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  max-height: 148px;
  overflow-y: auto;
  border: 1px solid var(--host-border);
  border-radius: 4px;
}

.runtime__list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  font-size: 12px;
  border-bottom: 1px solid var(--host-border);
}

.runtime__list li:last-child {
  border-bottom: none;
}

.runtime__list li.is-selected {
  background: rgba(79, 157, 91, 0.12);
}

.runtime__version {
  width: 92px;
  flex: none;
}

.runtime__arch,
.runtime__source {
  width: 72px;
  flex: none;
  color: var(--host-muted);
}

.runtime__path {
  color: var(--host-muted);
  font-family: 'Cascadia Mono', Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runtime__tag {
  margin-left: auto;
  color: var(--host-accent);
  flex: none;
}

.runtime__note {
  margin: 6px 0 0;
  color: var(--host-muted);
  font-size: 12px;
}
</style>
