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

* [ ] Define Minecraft runtime location
* [x] Define Java 8 runtime selection
* [ ] Start MinecraftHost / MinecraftApplet
* [ ] Wait for Minecraft native window
* [ ] Detect Minecraft window handle
* [ ] Record the native window handle
* [ ] Allow manual closing of Minecraft

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
    ├── release/
    └── isom/
```

This replaces the `bin/<channel>/` layout used by MCAHTML and MCAJNLP. The channel names
stay the same, so a `.jar` copied out of either reference project only needs a different
parent directory.

MCANextGen does not distribute official Minecraft clients. A channel directory is empty on
a fresh clone, and the host must report which `.jar` path it expected when a selected
version is missing.

`assets/minecraft/` belongs to the runtime layer, not to the Electron Edition: a future
Tauri Edition reads the same directory.

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

* [ ] Detect Minecraft window by process
* [ ] Avoid relying only on window title
* [ ] Verify process ownership
* [ ] Store native window handle
* [ ] Detect window creation/destruction
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

---

# 7. Phase 3 — Windows Child Window Embedding PoC

This is the primary technical PoC.

Goal:

Convert the already-detected Minecraft top-level window into a child window of the MCANextGen host.

Tasks:

* [ ] Obtain MCANextGen native HWND
* [ ] Obtain Minecraft HWND
* [ ] Save original Minecraft window styles
* [ ] Modify required window styles
* [ ] Reparent Minecraft HWND
* [ ] Set Minecraft window position
* [ ] Set Minecraft window size
* [ ] Remove unwanted title/border decorations
* [ ] Keep Minecraft inside the host client area

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
* Minecraft can be resized
* Minecraft can be closed safely
* Host can be closed safely

---

# 8. Phase 4 — Embedded Window Management

After the basic reparenting PoC succeeds:

* [ ] Synchronize host resize → Minecraft resize
* [ ] Handle focus changes
* [ ] Handle mouse capture
* [ ] Handle keyboard focus
* [ ] Handle minimize/restore
* [ ] Handle Minecraft process exit
* [ ] Handle host process exit
* [ ] Handle Minecraft restart
* [ ] Handle DPI scaling
* [ ] Handle window destruction

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
