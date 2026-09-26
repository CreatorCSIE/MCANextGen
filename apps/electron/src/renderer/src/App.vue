<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { HostInfo, JavaStatusView } from '@shared/ipc'

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

onMounted(async () => {
  try {
    info.value = await window.mcanextgen.getInfo()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
  await detectJava()
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
      <div class="viewport__placeholder">
        <p class="viewport__title">Native window container</p>
        <p class="viewport__hint">
          The Minecraft Applet will be embedded here as a native child window.
        </p>
      </div>
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

    <footer class="host__bar host__bar--footer">
      <span class="host__muted">Status: Idle</span>
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
  display: flex;
  padding: 12px;
  min-height: 120px;
}

.viewport__placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px dashed var(--host-border);
  border-radius: 6px;
  text-align: center;
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
