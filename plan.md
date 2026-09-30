# MCANextGen Development Plan

## 1. Project Goal

MCANextGen is a modern desktop host for legacy Minecraft Java Applets.

The primary goal is **not to create another Minecraft launcher**.

Instead, MCANextGen aims to recreate the historical relationship between a browser and a Minecraft Applet in a modern desktop environment:

```text
Historical:

Browser
└── Applet Container
    └── MinecraftApplet
        └── LWJGL

MCANextGen:

MCANextGen Host
└── Native Window Container
    └── MinecraftApplet
        └── LWJGL
```

The Minecraft game should remain as close as possible to the original runtime.

---

# 2. Initial Technical Direction

The first implementation target is:

* Windows x86_64
* Electron Edition
* Java 8
* Original Minecraft Applet
* LWJGL 2
* Native Minecraft window embedding

The initial UI will be implemented with:

* Electron
* Chromium
* Vue 3
* TypeScript
* Vite

The Minecraft runtime will remain outside the renderer process.

---

# 3. Core Architecture

```text
┌─────────────────────────────────────────────┐
│                MCANextGen                   │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ Electron / Chromium                   │  │
│  │                                       │  │
│  │ Vue 3 UI                              │  │
│  │                                       │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ Minecraft Native Child Window         │  │
│  │                                       │  │
│  │ MinecraftApplet                       │  │
│  │      ↓                                │  │
│  │ LWJGL 2                              │  │
│  │      ↓                                │  │
│  │ OpenGL                               │  │
│  │                                       │  │
│  └───────────────────────────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

Electron must not render Minecraft itself.

Minecraft remains a native Java/LWJGL window.

The host controls the native window relationship.

---

# 4. Phase 0 — Repository Initialization

* [x] Create Git repository
* [x] Create pnpm workspace
* [x] Initialize Electron + Vue + TypeScript
* [x] Create basic project structure
* [x] Create `plan.md`
* [x] Create initial README
* [x] Confirm Electron application can start

No Minecraft integration is required in this phase.

---

# 5. Phase 1 — Minecraft Process Launch

Goal:

Start the existing Minecraft runtime from Electron.

Tasks:

* [x] Define Minecraft runtime location
* [x] Define Java 8 runtime selection
* [x] Start MinecraftHost / MinecraftApplet
* [ ] Wait for Minecraft native window
* [ ] Detect Minecraft window handle
* [ ] Record the native window handle
* [x] Allow manual closing of Minecraft

## Minecraft client location

The client `.jar` files live in the repository-level asset directory:

```text
assets/
└── minecraft/
    ├── classic/
    ├── indev/
    ├── infdev/
    ├── alpha/
    ├── beta/
    └── release/
```

This replaces the `bin/<channel>/` layout used by MCAHTML and MCAJNLP. The channel names
stay the same, so a `.jar` copied out of either reference project only needs a different
parent directory — with one deliberate exception: there is no `isom/` directory. The
Infinite Map Visualizer is not a channel but a second Applet entry class
(`net.minecraft.isom.IsomPreviewApplet`) bundled inside infdev 20100617 jars; the launch
panel discovers entry classes offline instead: the runtime parses the selected jar's class
files (super-class chain, access flags, constructors) without ever spawning a JVM.

MCANextGen does not distribute official Minecraft clients. A channel directory is empty on
a fresh clone, and the host must report which `.jar` path it expected when a selected
version is missing.

`assets/minecraft/` belongs to the runtime layer, not to the Electron Edition: a future
Tauri Edition reads the same directory.

## Launch implementation

Implemented in this phase:

* `runtime/minecraft-host` — the Java 8 bootstrap (`org.mcanextgen.host.MinecraftHost`): it
  realizes the container side of 18.6.1 / 18.6.2 with a `HostStub` (historical
  document/code base, parameter pass-through, `isActive` always true, no-op resize) and the
  call order `setStub → setSize → add → validate/setVisible → init → start`. Applet
  parameters travel as a flat JSON file (`-Dmcanextgen.params`), never on the command line.
  Build: `runtime/minecraft-host/build.ps1` →
  `runtime/minecraft-host/build/mcanextgen-host.jar`.
* `packages/runtime/src/minecraft` — version registry (first entry: `c0.0.21a_01`, applet
  class `com.mojang.minecraft.MinecraftApplet`), asset layout (`resolveMinecraftLayout`;
  missing files are reported with the full paths the host expected) and `launchMinecraft`,
  which spawns the selected Java 8 with the bundled LWJGL jars and natives directory.
* Electron — `minecraft:launch / minecraft:stop / minecraft:status` IPC, Launch/Stop panel;
  host shutdown never orphans the game process.

Verified on Windows: the game runs as a separate process with a top-level `Minecraft`
window and stops cleanly from the host. Window capture and embedding stay in Phase 2/3.

At the end of this phase:

```text
Electron
   │
   └── launches Minecraft
            │
            └── Minecraft native window
```

The Minecraft window may remain external at this stage.

---

# 6. Phase 2 — Native Window Capture

Goal:

Reliably identify the Minecraft native window.

Tasks:

* [x] Detect Minecraft window by process
* [x] Avoid relying only on window title
* [x] Verify process ownership
* [x] Store native window handle
* [x] Detect window creation/destruction
* [ ] Handle Minecraft restart

The result should be:

```text
Minecraft Process
        ↓
Minecraft Native Window
        ↓
HWND
```

This phase must work before attempting embedding.

## Implemented (Phase 2)

`@mcanextgen/native-win32` (koffi → user32, lazy-bound, non-Windows import-safe):

* `findGameWindow(pid)` — the owning-PID check (`GetWindowThreadProcessId`) narrows
  the field, and candidates must carry a game window class (`SunAwtFrame`/`LWJGL`).
  The class anchor replaced the pid-only rule after live measurement: the Sogou IME
  injects a visible `SoPY_Status` top-level into the java process, which pid-only
  matching adopted as the "game window" once the real frame went WS_CHILD (embedded)
  and left `EnumWindows`. Candidates are additionally visible + unowned; a titled
  class-match wins (the isom preview carries its own title). Foreign-window text
  is read only via `SendMessageTimeoutW(SMTO_ABORTIFHUNG)` — bare `GetWindowText`
  is a synchronous cross-process send and a deadlock against attached input queues
  (risk #2).
* `GameWindowTracker` — 500 ms poll emitting onFound/onLost (creation/destruction);
  while the tracked window is alive a new candidate never steals it (anti-hijack),
  and an embedded WS_CHILD frame "missing from EnumWindows" is verified with
  `IsWindow`+pid, not treated as lost.
  Polling instead of `SetWinEventHook` because a WinEvent hook needs a native
  message pump; Phase 3 introduces one anyway (the clip window) and can revisit.
* The detected window ships to the renderer inside `MinecraftStateView.window`
  (state `none|pending|found|lost` + hwnd/class/title) over the existing status poll.

Verified on Windows: live-desktop enumeration, and end-to-end against both a JDK 8
AWT probe frame and real game sessions — Classic 0.0.21a_01 (`SunAwtFrame`,
title `Minecraft`) and Infdev 20100617-1531 running `IsomPreviewApplet`
(title `Infinite Map Visualizer`) were each hit precisely by pid, with Stop
cleaning the tracker up. `Handle Minecraft restart` closes out in Phase 3/4 wiring.

---

# 7. Phase 3 — Windows Child Window Embedding PoC

This is the primary technical PoC.

Goal:

Convert the already-detected Minecraft top-level window into a child window of the MCANextGen host.

Tasks:

* [x] Obtain MCANextGen native HWND  (`BrowserWindow.getNativeWindowHandle()` → main/embedding.ts)
* [x] Obtain Minecraft HWND  (Phase 2 `GameWindowTracker`, by owning pid)
* [x] Save original Minecraft window styles  (`embedder.ts` GetWindowLongPtrW before reparent)
* [x] Modify required window styles  (decoration bits + WS_POPUP cleared, WS_CHILD set — see architecture)
* [x] Reparent Minecraft HWND  (`SetParent(game → clip)`)
* [x] Set Minecraft window position  (per-policy `gameRect`: fixed centred, resizable fills)
* [x] Set Minecraft window size  (fixed = native 854×480 never stretched; resizable = clip client)
* [x] Remove unwanted title/border decorations  (native strip only — the Java-side
  undecorated frame broke LWJGL2 parented mode, see risk #4 reversal)
* [x] Keep Minecraft inside the host client area  (clip `WS_CHILD` under the Electron HWND; slot rect from renderer)

Status: implemented end-to-end (runtime probe → launch `embedded` flag → main embedding
controller → `App.vue` slot + IPC bounds) and the pure-native SetParent/clip/unembed loop
passed the standalone PoC (p6). Typecheck + build green. Live run with Classic 0.0.21a_01
confirmed correct geometry and rendering inside the slot (617 fps). Three blockers surfaced
by the live run and fixed: Chromium's DirectComposition layer painting over every native
child window (needs the disable switch below — risk #7), a polling `WM_GETTEXT` deadlock
that froze both attached input queues on the first click into the game (risk #2 confirmed,
mitigated), and the Sogou-IME `SoPY_Status` window hijacking the pid-only tracker after
reparent hid the real frame from `EnumWindows` (class anchor + hijack guard, see Phase 2).
The top-left caption flash / residual □× frames are addressed by the off-screen parking
described in the architecture section (Java watchdog + native `bringWindowOnScreen` rescue
 as fallbacks). The "Back to game" / refocus freeze was reproduced and pinned to a
three-way AWT deadlock (game thread ↔ EDT ↔ AWT-Windows, identical jstack frames across
3 minutes) — fixed host-side by the applet-mouse guard (risk #3, CONFIRMED). The guard's
residual input gap (uncaptured mouse + keyboard dead after a focus round-trip) was closed
by host-side **focus forwarding** (native `focusNativeWindow`/`findFocusTargetWithin` +
`BrowserWindow 'focus'` hook + renderer chrome-click IPC) — live-confirmed: the problem
is fully solved, keyboard and mouse capture survive Alt+Tab round-trips and DOM clicks.
Input verified; teardown (Stop / window close) live-confirmed clean. The
detach flash (window jumping to the top-left as `SetParent(null)` reinterprets
child coords as screen coords) is fixed by parking the game window at
-32000,-32000 (parent-client-relative while still a child, outer size via
GetWindowRect, `bRepaint=false`) *before* the reparent — the embed-failure
path reverses it via `bringWindowOnScreen` as before.

Target:

```text
MCANextGen HWND
└── Minecraft HWND
```

Success criteria:

* Minecraft remains rendered normally
* OpenGL continues to work
* Minecraft receives keyboard input
* Minecraft receives mouse input
* Minecraft can be resized — scoped to `resizable` versions (see capability probe);
  `fixed` versions stay at native size and letterbox (a version that cannot resize
  internally cannot pass this criterion, so it applies per capability, not per host)
* Minecraft can be closed safely
* Host can be closed safely

## Embedding architecture (decided)

The game window is never parented directly into Chromium's top-level HWND — Chromium
owns that window, has its own child HWNDs, and would fight the game window over
z-order and hit-testing. Instead an intermediate clip window is created by the host:

```text
Electron top-level HWND  (Chromium-owned)
└── clip window          (WS_CHILD, registered class + DefWindowProc, koffi-made)
    └── Minecraft HWND   (reparented, decoration-stripped, converted to WS_CHILD)
```

The game window must be converted to **WS_CHILD** on embed (clear WS_POPUP, set
WS_CHILD): Win32 positions a WS_POPUP-with-parent in *screen* coordinates
without clipping it to the parent — so the game would "vanish" off in a corner
instead of docking into the slot. Only a WS_CHILD window is laid out against the
clip's client area and clipped by it.
The Electron path launches the frame **decorated** (an undecorated SunAwtFrame
breaks LWJGL2 parented mode — see risk #4 reversal) and strips the decorations
natively at embed time. To kill the top-left caption flash + residual □× frames
while docking, the Java host **parks the frame off-screen** (`setLocation(-32000,
-32000)` before `setVisible`) so the caption is only ever painted where nobody
can see it; after SetParent the child coords still fall outside the clip, and
MoveWindow docks it with decorations already gone. Two safety nets exist for an
embedding that never lands: a Java-side watchdog thread pulls the frame back
on-screen after 10s, and the native `bringWindowOnScreen` rescue runs in the
embedding failure path. A
side effect the tracker must absorb: once WS_CHILD, `EnumWindows` no longer
enumerates the game window, so "lost" is decided by `IsWindow`+pid, not by
re-enumeration.

Consequences accepted by design:

* Windowed overlay: native child windows are not composited by Chromium and always
  paint above the DOM. The renderer's placeholder container only positions the clip
  window; no DOM element may overlap the game area.
* **DirectComposition must be disabled host-wide** (measured): Chromium composites web
  content through an `Intermediate D3D Window` in a DComp visual tree, and that tree
  paints above *every* plain child HWND regardless of z-order — the embedded game is
  invisible even when its clip is topmost. `app.disableHardwareAcceleration()` alone
  does not remove the D3D window; `app.commandLine.appendSwitch('disable-direct-composition')`
  is the switch that makes native child embedding visible at all (risk #7).
* The clip window lives on the Electron main thread; its messages are pumped by
  Chromium's UI message loop (verify first — see PoC order).
* Teardown order is a hard rule: un-embed (or kill java) before the host window /
  clip window dies, otherwise java touches a destroyed handle and crashes.

## Container sizing and DPI semantics (decided)

* The placeholder container is 854×480 CSS px for `fixed` versions — sized so the
  game fills it exactly at the current DPR (CSS = physical ÷ devicePixelRatio);
  the DOM background behind it IS the letterbox.
* The game window is embedded at its native physical size and is never stretched:
  Windows cannot scale child-window content, and Java 8 AWT renders physical pixels.
* `resizable` versions: the container fills the available content area and the game
  window follows via MoveWindow; the game's own per-frame canvas-size poll is the
  synchronizer (see capability probe — Indev 20100223+ already polls).
* Physical rects travel renderer → main (`getBoundingClientRect()` × DPR, rAF-throttled);
  recompute on DPR change (per-monitor DPI), not just on resize.
* Host minimum window size is enforced so the clip window never crops the game.

## Capability probe (decided, offline — same jar parse as the Applet entry scan)

Embedding policy per entry class comes from bytecode, not from era guesswork. The
entry class is an unobfuscated anchor (`com.mojang.minecraft.MinecraftApplet`,
`net.minecraft.client.MinecraftApplet`); the game main class is reached one hop via
the field-type or super-class topology (both exist across versions — probe
`{entry} ∪ superchain(entry) ∪ field types`):

```text
supportsFullscreen = same class contains BOTH:
    ① an F11 key check: bipush 87 (LWJGL KEY_F11) / 119 (AWT VK_F11) whose very next
       bytecode is a compare/call (if_icmpeq 0x9F | if_icmpne 0xA0 | invokestatic 0xB8)
    ② a fullscreen API ref: Display.setFullscreen | Frame.setExtendedState | setUndecorated
resizable = game-loop class (declares run:()V) polls the AWT canvas each frame via the
    owner-qualified java/awt/Canvas.getWidth()I AND java/awt/Canvas.getHeight()I
    (scaling lives in the renderer class — drawImage to canvas size — the game class
     just polls; the literal method name "resize" is NOT the anchor)
```

Both anchors are owner/adjacency-qualified on purpose. An owner-blind `getWidth:()I`
matches three unrelated things: the real per-frame canvas poll (Indev), Classic-era
`org/lwjgl/opengl/DisplayMode.getWidth` (fullscreen display-mode enumeration — 21a/12a/15a
hit this in their `run` loop), and the isom previewer's own inherited `getWidth`. Likewise
a raw `0x10` byte sweep finds phantom `bipush 87/119` inside multi-byte operands (measured
on 0.0.12a); requiring the comparison/call successor byte is what makes the co-occurrence
rule trustworthy. The `run:()V` requirement drops the entry wrapper, whose `init()` reads
the canvas size exactly once to seed the framebuffer — one-shot, not resize adaptation.

Registry fields `supportsFullscreen` / `resizePolicy` override the probe where a
version misleads it; the probe fills the default.

Measured matrix (javap ground truth, 2026-09; the offline `capabilities.ts` probe now
reproduces this verdict for every registered entry class — verified against these rows):

| jar / entry | F11 check | fullscreen API | canvas poll | verdict |
| :-- | :-- | :-- | :-- | :-- |
| Classic 0.0.21a_01 | none | 1× `Display.setFullscreen` (dead branch, no main, jar bundles no LWJGL) | only `DisplayMode.getWidth` in run loop | fixed, no F11 |
| Classic 0.0.12a_03 | phantom `bipush 87` (raw-byte artifact; adjacency clears it) | `setFullscreen` in `c` (run) | `DisplayMode` only | fixed, no F11 |
| Classic 0.0.15a | none | `setFullscreen` in `c` (run) | `DisplayMode` only | fixed, no F11 |
| Indev 20100223 | `bipush 87` ×1 | 2× `Display.setFullscreen` + "Toggle fullscreen!" | `java/awt/Canvas.getWidth`× | resizable + F11 |
| Infdev 20100617-1531 | `bipush 87` ×1 | `Display.setFullscreen` + `Display.update` + "Toggle fullscreen!" | `java/awt/Canvas.getWidth`× | resizable + F11 |
| Infdev `isom.IsomPreviewApplet` | none in probe set | none in probe set | own inherited `getWidth` only | fixed, no F11 |

The Classic rows are why ①+② must co-occur: API refs alone false-positive on Notch's
early dead LWJGL experiments. Corollary kept as a sanity rule: a fullscreen toggle
implies resize logic must exist (a display-mode change has to be adapted to).
`isom` needs no special case — its probe set never contains the game class, so it
lands on fixed/no-F11 naturally.

## Risk register (predicted, to be retired or confirmed by the PoC)

1. koffi WndProc callbacks (GC-pinned) pumped by Chromium's UI loop — verify first
2. **CONFIRMED + mitigated**: cross-process SetParent implicitly attaches input queues —
   a wedged java EDT can freeze the Electron UI thread. Measured form: the first click
   into the embedded game deadlocked the *whole host* ("not responding", game still at
   617 fps) because the 500 ms window-tracker poll called `GetWindowText` on every
   desktop window — a synchronous cross-process `WM_GETTEXT` — and one of those sends
   met the Java thread's activation traffic head-on through the attached queues.
   Mitigation (both required): poll hot paths filter by pid with message-free reads
   *before* describing any window, and foreign-window text goes through
   `SendMessageTimeoutW(SMTO_ABORTIFHUNG)` only. Residual: `MoveWindow` on bounds change
   is still a synchronous send to the Java thread (rare, fixed-policy slots).
3. **CONFIRMED (as an AWT deadlock, not Electron focus theft)**: the applet-era
   "Back to game freezes the game" plague reproduces here and was caught red-handed
   by three jstack dumps 3 minutes apart — game thread, EDT and AWT-Windows all
   frozen in identical native frames. Mechanism: applet mouse mode (`g`) makes the
   game thread call `canvas.getLocationOnScreen` + `MouseInfo.getPointerInfo` +
   `Robot.mouseMove` **every frame while holding the AWTTreeLock** (AWT natives wait
   on the native AWT_LOCK); clicking the unfocused window makes LWJGL's Java-side
   wndproc call `grabFocus()` → EDT `requestWindowFocus`, which **holds AWT_LOCK**
   while Win32 `SetFocus` waits for the game thread to process WM_KILLFOCUS — which
   never happens because that thread is blocked on the lock the EDT holds. Cycle:
   game ↔ EDT ↔ AWT-Windows. Mitigation (host-side, no game jar edits):
   `Patches.protectAppletMouseMode` waits for `Display.setParent` to land
   (polls `WindowsDisplay.parent != null`), then flips the game's applet-mode flag
   to false — the run loop switches to the standalone mouse branch
   (`Mouse.setGrabbed` + LWJGL cursor clipping, pure Win32/jinput, zero AWT calls
   on the game thread), so the cycle can never form. Display stays parented; menu
   auto-open (`d()`) and grab-on-resume (`b()`) work through the native branch.
   Chromium-side click-to-focus never had to be touched. Live confirmation pending.
   **Live update 2** (0.0.21a_01): deadlock gone, but the native branch exposes an
   embedding-specific input gap — mouse never captures and keyboard dies after
   focus-loss + Back-to-game. 21a `MinecraftApplet` has **no `addKeyListener`**
   (javap-verified): the keyboard was *always* the LWJGL native route, so the gap
   is not caused by the flip itself — the LWJGL child HWND simply never receives
   *Win32* keyboard focus inside a frame that was SetParent-ed across processes
   into Electron (Java AWT focus ≠ native focus). Nothing to steal from Betacraft
   here: their wrappers own a plain top-level AWT Frame, so LWJGL's
   `update()`-side `setFocus(getHwnd())` auto-refocus always works; our embedding
   is what removed that guarantee.
   **Betacraft cross-check** (v1 branch, `org.betacraft`): three wrapper shapes —
   ① base `Wrapper` (early Classic incl. 21a): the wrapper *itself* is an
   `Applet`+`AppletStub` hosting the real `MinecraftApplet` in a self-made Frame;
   Windows keeps applet mode. ② `Classic12a`/`15aWrapper` ("pretends to be
   MinecraftApplet"): **bypass the applet entirely** — reflect `new Minecraft-
   gameClass(Canvas, w, h, fullscreen)` (21a `d` has this ctor: `d(Canvas,I,I,Z)`),
   stuff params fields, `new Thread(run).start()`. ③ `Wrapper.init()` contains
   `// Linux mouse fix, really ugly`: flips the public boolean applet-mode field
   to false right after `applet.init()` — *identical trick to ours*. Two facts it
   confirms: the setParent-vs-own-window decision in 21a `run()` is `B != null`
   (the Canvas ctor arg, offsets 108-121), **not** `g` — so flipping `g` cannot
   unparent the display and our poll-for-parent-landing is unnecessary; and
   `g=false` additionally switches on local `level.dat` persistence (offsets
   453+; benign when cwd is the instance dir). Their per-OS choice: Windows=true
   (Robot branch), Linux/fullscreen=false (native branch) — meaning the native
   input branch *is* considered the sane path for a game that owns its window
   focus; our remaining problem is purely host-side focus delivery.
   **RESOLVED (live-confirmed)**: host-side focus forwarding — native
   `findFocusTargetWithin` (EnumChildWindows + GetClassNameW, message-free)
   picks the `LWJGL` child HWND under the embedded frame (fallback
   `SunAwtCanvas` → frame) and `focusNativeWindow` delivers SetFocus across the
   thread boundary via AttachThreadInput. Triggers: `BrowserWindow 'focus'`
   (Alt+Tab round-trip — the exact dead-keyboard scenario) and renderer
   chrome-click IPC (`minecraft:focus-game`, non-interactive mousedown). After
   this, keyboard, mouse capture and Back-to-game all work — the deadlock fix
    (g-flip, risk #3) plus focus forwarding close the input loop entirely.
    Follow-up (live-observed): forwarding made focus *sticky* — the host
    window's deactivation never round-tripped into the attached Java queue, so
    the game kept `isFocused=true` on Alt+Tab away (no pause menu, cursor left
    clipped). Fixed symmetrically: `BrowserWindow 'blur'` →
    `clearNativeFocus` (AttachThreadInput + `SetFocus(NULL)`) delivers a
    genuine WM_KILLFOCUS, restoring browser-era blur semantics. Second-order
    finding (live): with Win32 focus living in the attached Java queue,
    Chromium's own `blur` event stopped firing reliably on Alt+Tab / Win key
    too — so blur detection cannot rely on Electron events. A
    `GetForegroundWindow` polling watcher was tried to close that gap and
    REVERTED: the handle comparison misfires on the embedded setup and its
    `SetFocus(NULL)` killed all game input — accepted residual (the game can
    transiently stay focused after Alt+Tab; input correctness wins).
4. **REVERSED**: AWT peer style-stripping is now the *primary* path, and creating the
   frame undecorated Java-side (`mcanextgen.embed`) is **off** — measured: an
   undecorated SunAwtFrame breaks LWJGL2 parented mode (the `LWJGL` child window inside
   the canvas never gets WS_VISIBLE → white game before any reparenting). A decorated
   frame stripped natively keeps the exact same style stable (p6), and the LWJGL window
   shows and renders.
5. teardown ordering (see architecture above)
6. `Display.setFullscreen` reachability: the game jars do not bundle LWJGL but the
   launcher classpath provides it, so F11 paths are loadable — pressing F11 inside an
   embedded Indev may crash or escape the embedding; Phase 4 remapping removes the
   call path entirely (probe decides whether to install it)
7. **CONFIRMED**: Chromium's DirectComposition visual tree (`Intermediate D3D Window`)
   paints above all plain child HWNDs regardless of z-order — embedded native windows
   are invisible unless the host runs with `--disable-direct-composition` (see
   architecture note; software rendering alone does not help)

## PoC order

1. Pure native: koffi clip window + JDK 8 AWT probe frame — create/register/embed/
   move/unembed/destroy loop without Electron in the picture
2. Electron: embed into the top-level HWND first (fastest way to surface overlay and
   focus behavior), then switch to the clip window
3. Real game: Classic 0.0.21a_01 (fixed) first, then Indev/Infdev (resizable + F11)

---

# 8. Phase 4 — Embedded Window Management

After the basic reparenting PoC succeeds:

* [x] Synchronize host resize → Minecraft resize (per `resizePolicy`; `fixed` versions
  never receive a size change — maximize only grows the surrounding chrome). The channel
  shipped with Phase 3 embedding (renderer bounds IPC → `gameRect` per policy →
  `moveClipContainer` + `resizeEmbeddedGame`, rAF-throttled physical rects); the
  resizable half still awaits an Indev/Infdev live measurement.
* [x] Handle focus changes (host `focus`/`blur` hooks drive `focusNativeWindow` /
  `clearNativeFocus` — risk #3 resolved chain)
* [x] Handle mouse capture (LWJGL native branch via the applet-mouse guard; capture and
  clipCursor round-trips live-verified)
* [x] Handle keyboard focus (focus forwarding to the `LWJGL` child HWND, live-verified)
* [ ] Handle minimize/restore (expected to come free with WS_CHILD semantics — the clip
  and its children hide/restore with the Electron top-level — but unmeasured)
* [x] Handle Minecraft process exit (Stop live-verified; tracker onLost + teardown)
* [x] Handle host process exit (window close live-verified; unembed-before-destroy order
  held, detach flash fixed by off-screen parking in `unembedGameWindow`)
* [ ] Handle Minecraft restart
* [ ] Handle DPI scaling (physical-px rect transport is in place; per-monitor DPI change
  recompute and the java DPI-unaware stretch remain to be measured)
* [x] Handle window destruction (the game window vanishing without process exit →
  `GameWindowTracker` onLost; for an embedded WS_CHILD frame "lost" is decided by
  `IsWindow`+pid, not by re-enumeration — Phase 2 design)
* [ ] F11 remapping: the game's own fullscreen must never run against an embedded
  window. AWT-route fullscreen (Frame API) is intercepted Java-side (host Frame
  subclass → stdout event → host enters `setFullScreen(true)` and grows the
  container; the game adapts via its canvas poll). LWJGL-route F11 is polled input
  the Frame cannot see, so either the same host-driven fullscreen is offered and the
  game's F11 is swallowed Java-side, or a Display shim shadows `setFullscreen` —
  decide by measurement (press F11 in embedded Indev/Infdev and record what happens).
  NOT implemented; the capability probe already decides where it would install
  (`supportsFullscreen` false for all Classic/isom entries, true for Indev/Infdev).
* [ ] Enforce host minimum window size from the embedded window's native size (a static
  `minWidth: 640` exists today)

The embedded Minecraft window should behave as part of the MCANextGen window.

---

# 9. Phase 5 — Applet-like UI

Once native embedding is stable, build the actual interface.

Possible layout:

```text
┌──────────────────────────────────────────────┐
│ MCANextGen                                   │
├──────────────────────────────────────────────┤
│ Version: Minecraft Indev 0.31    [Settings] │
├──────────────────────────────────────────────┤
│                                              │
│                                              │
│              Minecraft                      │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│ Status: Running                              │
└──────────────────────────────────────────────┘
```

The UI should emphasize that Minecraft is being hosted rather than launched as a separate application.

---

# 10. Phase 6 — Minecraft Runtime Abstraction

After the embedding PoC is stable, extract the Minecraft-specific runtime layer.

Potential structure:

```text
MinecraftHost
├── Java detection
├── Java 8 validation
├── Runtime configuration
├── MinecraftApplet lifecycle
├── AppletStub
├── Native window discovery
├── Native window embedding
└── Process lifecycle
```

The runtime must remain independent of Vue.

The `AppletStub` the `MinecraftApplet` lifecycle is driven with follows the contract and call
order captured in 18.6.1 / 18.6.2.

---

# 11. Phase 7 — Java 8 Detection

MCANextGen must not assume that the `java` command in PATH is Java 8.

Implemented in `packages/runtime/src/java` and exposed to the UI through the
`java:detect` IPC channel.

The runtime probe:

1. Discover candidate Java installations.
2. Execute the candidate Java executable.
3. Verify the version.
4. Verify architecture.
5. Prefer Java 8 x86_64.
6. Fall back to Java 8 x86 only when necessary.
7. Report a clear error when Java 8 is unavailable.

Discovery order: manual path → `JAVA_HOME` / Java 8 environment variables → Windows
registry (`JavaSoft`, `Eclipse Adoptium`, `Amazon Corretto`, `Azul Systems`, including
the `WOW6432Node` view for 32-bit installs) → `Program Files` vendor roots → `PATH`.
Every candidate is executed with `-XshowSettings:properties -version`, so the version,
`os.arch` and `java.home` come from the JVM itself rather than from a directory name.

Java is an external prerequisite.

MCANextGen does not bundle a JRE by default.

Status: implemented. The probe lives in `packages/runtime/src/java` (`discover` →
`probe` → `select`, orchestrated by `detectJavaRuntime`) and the host window shows the
selected JVM plus every installation that was found, with a manual re-probe button.

---

# 12. Phase 8 — LWJGL Runtime

LWJGL is controlled by the project and may be bundled.

The runtime should provide the required:

```text
lwjgl.jar
lwjgl_util.jar
jinput.jar
native libraries
```

Initial native target:

```text
Windows x86_64
```

Linux support will be added later.

The runtime must explicitly select the bundled LWJGL native directory.

Vendored since Phase 1 at `assets/lwjgl/2.9.3/` (lwjgl.jar, lwjgl_util.jar, jinput.jar,
`windows_natives.jar` plus its unpacked `natives/windows/` DLLs; the MCAHTML and MCAJNLP
copies are byte-identical). `launchMinecraft` passes
`-Dorg.lwjgl.librarypath` / `-Dnet.java.games.input.librarypath` pointing at that
directory instead of relying on classpath extraction.

---

# 13. Phase 9 — Linux Support

Linux support is a separate milestone.

Initial target:

```text
Linux x86_64
```

Linux work includes:

* [ ] Avalonia/Tauri/Electron platform validation
* [ ] Java 8 detection
* [ ] Minecraft process launch
* [ ] Native window detection
* [ ] X11 embedding investigation
* [ ] Wayland compatibility investigation
* [ ] LWJGL Linux natives
* [ ] Window lifecycle management

Linux must not be treated as identical to Windows.

The Windows embedding implementation should not be blindly reused on Linux.

---

# 14. Phase 10 — Tauri Edition

Tauri is a separate release product, not a second frontend inside the Electron application.

Target structure:

```text
Shared source/runtime
        │
        ├── Electron Edition
        │
        └── Tauri Edition
```

Both editions should use the same Minecraft runtime architecture where possible.

The Tauri edition will be implemented after the Electron architecture is proven.

---

# 15. Product Philosophy

MCANextGen should preserve the concept of the historical Minecraft Applet.

It should not become a conventional launcher whose only function is:

```text
Select Version
      ↓
Launch Minecraft
```

Instead:

```text
Modern Host
    ↓
Applet Container
    ↓
MinecraftApplet
```

The Minecraft game should visually and conceptually remain part of the host window.

---

# 16. Non-Goals

The initial project will NOT attempt to:

* Rewrite Minecraft source code
* Reimplement Minecraft rendering
* Convert LWJGL rendering into HTML Canvas
* Replace MinecraftApplet with a custom game client
* Bundle a JRE by default
* Support ARM64 LWJGL natives
* Support all Linux display systems in the first release
* Implement the Tauri edition before the Electron PoC is validated

---

# 17. First Milestone

The first major milestone is deliberately small:

```text
Electron Window
       ↓
Start Minecraft
       ↓
Detect Minecraft HWND
       ↓
Reparent Minecraft HWND
       ↓
Minecraft renders inside MCANextGen
```

If this milestone succeeds, the core MCANextGen concept is technically validated.

Everything else can then be built around the validated host architecture.

# 18. Reference Projects

MCANextGen should actively reference the existing MCAHTML and MCAJNLP implementations during development.

These projects are **technical references**, not codebases to be blindly copied or merged.

---

## 18.1 MCAHTML

Repository:

`CreatorCSIE/MCAHTML` is at `E:\4k\MCAHTML` locally.

MCAHTML is the primary reference for the modernized Minecraft Applet environment.

AI-assisted development should inspect MCAHTML to understand:

* Modified `lwjgl_util_applet.jar`
* Custom AppletStub behavior
* Minecraft Applet initialization
* `getDocumentBase()` / `getCodeBase()` behavior
* Minecraft.net compatibility behavior
* Betacraft integration
* Java 8 compatibility fixes
* Applet parameters
* Legacy Minecraft startup requirements
* Historical browser/Applet assumptions

Important:

MCAHTML is a browser-oriented project.

MCANextGen must NOT reproduce its browser hosting layer.

The relevant parts are the validated compatibility behavior around the Minecraft Applet.

Conceptually:

```text
MCAHTML
├── Browser Host             ← Do not copy
├── Web Host logic           ← Do not copy
├── AppletLoader             ← Reference
├── modified lwjgl_util      ← Reference
├── AppletStub               ← Reference
├── MinecraftApplet setup   ← Reference
└── compatibility fixes      ← Reference
```

---

## 18.2 MCAJNLP

Repository:

`CreatorCSIE/MCAJNLP` is at `E:\4k\MCAJNLP` locally.

MCAJNLP is the primary reference for desktop-side Minecraft Applet launching.

AI-assisted development should inspect MCAJNLP to understand:

* AppletLoader usage
* JNLP generation
* Minecraft Applet startup
* Java detection
* Java Web Start handling
* Runtime process management
* Java 8 requirements
* Windows-specific process launching
* Cross-platform migration work
* Minecraft runtime configuration

MCAJNLP is especially important for the runtime lifecycle.

Conceptually:

```text
MCAJNLP
├── Avalonia UI             ← Do not directly copy
├── JNLP UI                 ← Do not directly copy
├── Java probing            ← Reference
├── JNLP generation         ← Reference
├── AppletLoader            ← Reference
├── MinecraftApplet setup   ← Reference
└── process lifecycle       ← Reference
```

---

# 18.3 How AI Should Use These Projects

Before implementing MinecraftHost, AI should inspect both repositories and produce a short technical analysis.

The analysis should answer:

1. How MCAHTML starts MinecraftApplet.
2. How MCAJNLP starts MinecraftApplet.
3. Which AppletLoader parameters are required.
4. Which AppletStub behavior is required.
5. Which compatibility modifications are required.
6. Which parts depend on Betacraft.
7. Which parts depend on Java 8.
8. Which parts are browser-specific.
9. Which parts are JNLP-specific.
10. Which parts can be reused conceptually by MCANextGen.

The analysis should distinguish:

```text
Validated Minecraft compatibility behavior
        ↓
Reusable / reference-worthy

Browser-specific behavior
        ↓
MCAHTML only

JNLP-specific behavior
        ↓
MCAJNLP only

UI-specific behavior
        ↓
Do not copy
```

---

# 18.4 Do Not Blindly Merge MCAHTML and MCAJNLP

MCANextGen is a new runtime architecture.

Do not perform:

```text
MCAHTML + MCAJNLP = MCANextGen
```

Instead:

```text
                 MCAHTML
                    │
       Minecraft compatibility
                    │
                    ▼
              MCANextGen
                    ▲
                    │
          Desktop runtime behavior
                    │
                 MCAJNLP
```

The purpose of the reference projects is to preserve already-validated behavior while replacing their hosting mechanisms.

---

# 18.5 Priority of References

When investigating a specific problem:

### Minecraft/Applet compatibility

Prefer:

```text
MCAHTML
```

### Java / desktop launching

Prefer:

```text
MCAJNLP
```

### AppletLoader behavior

Compare both projects.

MCANextGen does not use AppletLoader (see 18.6). Only `lwjgl_util_applet-modified-for-minecraft`
matters here, and only for the Stub contract and the lifecycle call order in 18.6.1 / 18.6.2.

### MinecraftApplet behavior

Compare both projects and identify the common implementation.

For what the applet sees through `AppletStub` (bases, parameters, `isActive`), 18.6 is the
closest working implementation.

### Native window embedding

Neither project should be treated as the authoritative implementation.

This is a new MCANextGen subsystem.

---

# 18.6 lwjgl_util_applet-modified-for-minecraft

Location:

```text
M:\MCWebPort\lwjgl_util_applet-modified-for-minecraft
```

A LWJGL 2.9.3 `lwjgl_util_applet.jar` fork (BSD 3-Clause) with `AppletLoader` slimmed and
reworked for modern JREs and community servers: no LWJGL compile-time dependency, no natives
certificate chain check, deferred `-D` properties (`fix_arguments`), BetaCraft proxy injection,
Classic 0.0.15a server/zero-latency patch and a `dpi_fix` pass.

MCANextGen does not use AppletLoader at all: the jar downloading, verifying, extracting and
re-signing machinery is irrelevant here because the host already owns the process, the class
path and the file system. Only two things are worth referencing from this project.

## 18.6.1 MinecraftStub

`src/org/lwjgl/util/applet/MinecraftStub.java` is the complete contract a bare JVM needs to
present `MinecraftApplet` as "running inside a browser page". The game only ever sees this
`AppletStub` via `Applet.setStub(...)`; every behaviour below is what legacy clients actually
observe on real web pages, so MCANextGen's own Java-side container must reproduce it:

| Member | Reference behavior | Why it matters |
| :-- | :-- | :-- |
| `getDocumentBase()` / `getCodeBase()` | both hard-code `http://www.minecraft.net/game/` | classic/Indev/Alpha clients resolve skins, sounds, `/mp` server lists and `getResourceAsStream` paths against these bases; keeping the historical URL preserves the original code paths (a proxy such as BetaCraft can still redirect them) |
| `getParameter(name)` | delegates to the host parameters | this is the only channel through which `username`, `sessionid`, `server`, `port`, `ww`, `hh`, etc. reach the game |
| `getAppletContext()` | delegates to the host context | needed for `showDocument` style calls and audio APIs on some versions |
| `isActive()` | always `true` | the game polls it to decide whether to keep rendering / to pause on `stop()`; a desktop host window must not pretend the page went hidden |
| `appletResize(w, h)` | no-op | resizing is owned by the host layout / native window embedding, the applet must not try to resize a browser frame |

## 18.6.2 Applet lifecycle skeleton

`AppletLoader.run()` also shows the exact order in which the applet must be woken up, which is
the order MCANextGen's container should follow (see Phase 6):

```text
Thread.currentThread().setContextClassLoader(classLoader)   // the game reads LWJGL resources
                                                            // through the context loader
appletClass = classLoader.loadClass(getParameter("al_main")) // e.g. net.minecraft.client.MinecraftApplet
lwjglApplet = (Applet) appletClass.newInstance()
lwjglApplet.setStub(new MinecraftStub(...))                  // BEFORE any other call
lwjglApplet.setSize(getWidth(), getHeight())
container.setLayout(new BorderLayout())
container.add(lwjglApplet)
container.validate()                                         // realizes the Canvas, native peer appears
lwjglApplet.init()                                           // LWJGL Display/Canvas is grabbed here
lwjglApplet.start()                                          // game thread starts
```

`stop()` and `destroy()` are forwarded to the inner applet 1:1 when the host wants to pause or
close the game. The LWJGL native window of `MinecraftApplet` is created during `init()`/`start()`
from the awt Canvas peer — this is what Phase 2 later needs to locate and embed.

---

# 18.7 AI Development Rule

Before modifying Minecraft-related code, AI should first search the reference projects.

Do not invent a new implementation when MCAHTML or MCAJNLP already contains a known-working solution.

If the existing implementation cannot be reused directly, explain:

1. What the existing implementation does.
2. Why it cannot be reused directly.
3. What behavior must be preserved.
4. What the MCANextGen implementation changes.

This is especially important for:

* Applet initialization
* AppletStub
* Applet parameters
* Java 8 detection
* AppletLoader
* LWJGL loading
* Betacraft compatibility
* Minecraft runtime startup
