> [!IMPORTANT]
> **项目状态提示**：本项目处于**早期开发阶段**。已完成：工程脚手架（Phase 0）、**Java 运行时自动探测**、**Classic 核心启动**（Phase 1）、**原生窗口句柄捕获**（Phase 2）与 **Windows 子窗口嵌入（Phase 3）**——游戏窗口现已作为原生子窗口嵌入宿主窗口内的固定槽位，Classic 0.0.21a_01 的渲染、键盘/鼠标输入、焦点转发与 Stop/关窗拆卸均已实机验证；另有 `dpi_fix` / `15a_server_patch` 两项补丁（实测生效）、离线的 Applet 入口枚举与**能力探测**（纯字节码解析、不起 JVM）。Phase 4（嵌入窗口管理）已大半落地：**宿主缩放同步通道**（bounds IPC → 按 resizePolicy 布局）、焦点/捕获/键盘焦点处置、进程与窗口拆卸均已完成——尚待实测或实现的是：resizable 版本（Indev/Infdev）的动态缩放实测、**F11 重映射**（未实现，能力探测已划定安装范围）、minimize/restore 与 DPI 细节实测、重启与按原生尺寸推导最小窗。当前 fixed 版本以原生分辨率在槽位居中显示、不做拉伸。
> *Status Notice: the scaffolding, the Java runtime probe, the core launch path (Phase 1), native window-handle capture (Phase 2) and Windows child-window embedding (Phase 3) are done — the game's native window is now reparented into a slot inside the host window, with rendering, keyboard/mouse input, focus forwarding and clean teardown live-verified on Classic 0.0.21a_01; the ported `dpi_fix` / `15a_server_patch` fixes, offline JVM-free Applet entry enumeration and the capability probe are all in place. Most of Phase 4 (embedded window management) has landed with the embedding: the host-resize synchronization channel, focus/capture/keyboard handling and process/window teardown are implemented; what remains is the resizable-build (Indev/Infdev) live measurement, **F11 remapping** (not yet implemented; the capability probe already scopes where it installs), minimize/restore and DPI details to be measured, and restart handling.*

# MCANextGen - 旧版 Minecraft Applet 桌面宿主 (Legacy Minecraft Applet Desktop Host)

`MCANextGen` 是一个**面向 Minecraft 早期历史版本（Classic、Indev、Infdev、Alpha、Beta 与 Release，其中 Infdev/Alpha jar 内置 Infinite Map Visualizer 预览入口）Java Applet 的现代桌面宿主**。

它的目标**不是再做一款 Minecraft 启动器**，而是在桌面环境里重建当年「浏览器 + Applet」的运行时关系：游戏仍然以原始的 Java / LWJGL 进程运行，而宿主进程拥有它被嵌入的那块原生窗口。

```text
当年（历史形态）                    MCANextGen
Browser                            MCANextGen Host
└── Applet Container               └── Native Window Container
    └── MinecraftApplet                └── MinecraftApplet
        └── LWJGL                          └── LWJGL
```

完整开发计划与架构见 [plan.md](./plan.md)。

---

## 🌟 核心功能特性

- **双层架构：Edition + Runtime**：Electron Edition（Chromium + Vue 3 + TypeScript + Vite）负责界面与宿主窗口；`@mcanextgen/runtime` 为独立的 Minecraft 运行时层，不依赖 Vue / Electron，未来的 Tauri Edition 可直接复用同一层与同一份资源目录。
- **Java 运行时自动探测（已可用）**：按 **注册表 → 常见安装目录 → `JAVA_HOME` / `JDK_HOME` → `PATH`** 的优先级收集候选，再对每个候选**实测执行** `java -XshowSettings:properties -version` 读取真实的 `java.version`、`os.arch`、`java.home`，自动合并 JDK 与其自带 JRE 的重复项，**优先选择 64 位 Java 8**，仅在没有任何 64 位可用时回退 32 位。
- **探测结果可视化**：宿主窗口内直接展示候选列表（版本、架构、发现来源、是否被选中）与被拒绝原因、探测耗时，避免「点了没反应」式黑盒失败。
- **安全的渲染层边界**：主进程 / preload / 渲染进程之间只有单一 IPC 契约文件（`apps/electron/src/shared/ipc.ts`），渲染进程通过 `contextBridge` 调用，完全不接触 Node API。
- **旧版客户端核心启动（已可用，Phase 1）**：`runtime/minecraft-host` 以自制的 `AppletStub` 容器直接驱动原始 `com.mojang.minecraft.MinecraftApplet`（不含 AppletLoader 的下载/签名机制），配合随仓库分发的 LWJGL 2.9.3 与 natives，把 Classic 0.0.21a_01 拉起为独立 Java 8 进程（该进程的游戏窗口随后由宿主嵌入，见 Phase 2/3 条目）；游戏窗口客户区精确等于设定分辨率（`setPreferredSize + pack()`）。缺 jar 时宿主报告期望的完整路径，Stop / 退出宿主都会收掉游戏进程。
- **移植参考项目的 JVM 参数组（已可用）**：`java_arguments` + `fix_arguments`（MCAHTML 与 MCAJNLP 共用同一套）已接入 `packages/runtime/src/minecraft/arguments.ts`——含 Betacraft 兼容代理（历史客户端硬编码的 `www.minecraft.net` HTTP 流量重定向）、渲染修复五连（`noddraw` / `noerasebackground` / `d3d` / `opengl` / `pmoffscreen`）、`useLegacyMergeSort`（经典版比较器不满足 TimSort 契约）与内存上限，调用方可整体覆写。
- **AppletLoader 补丁作为按版本声明的可选功能（已可用）**：LWJGL fork 的两项修复移植到 `runtime/minecraft-host`（`Patches.java`，纯反射实现、与游戏类零编译期耦合）——`dpi_fix` 破除 pre-0.0.12a_03 硬编码的 640x480（视口与 framebuffer 的尺寸来源收敛在游戏 `a`/`b` 字段，`run()` 再据此 `setDisplayMode`；实测 640x480 → 854x480，右侧黑边消失）；`15a_server_patch` 跳过 0.0.15a 对已死硬编码地址的数秒连接探测黑屏（反射组装替代原生 `init()`，给出 server/port 则直连）。按 MCAHTML/MCAJNLP 的栏位规则在版本注册表中声明：`classicpre12a` 仅出 dpi_fix 复选框、`classic15a` 仅出 15a 补丁复选框、`classicmp`（原生 server/port 时代）不显示任何复选框；启动面板按注册表动态生成勾选框，支持逐次启动开关。
- **Applet 入口枚举与 isom 预览入口（已可用）**：runtime 层**离线**枚举所选 jar 内全部可启动的 Applet 入口类——在 Node 侧直接解析 class 文件的常量池/超类链/访问标志/构造器（借鉴 DECRAFT 的 `JavaClassReader`，与 JVM 内 `isAssignableFrom` 读同一份权威数据），全程不起 JVM、不出现任何窗口，甚至不要求机器上装了 Java。启动面板有一个常驻的临时入口下拉（正式 UI 设计阶段会重做），始终展示将要启动的真实入口类：单入口 jar 只有一项，Infdev 20100617 的 jar 则额外带 `net.minecraft.isom.IsomPreviewApplet` 可选；所选入口随启动透传给 Java 宿主；isom 的窗口标题写为其真名 **Infinite Map Visualizer**，不与 Minecraft 共用。
- **原生窗口捕获（已可用，Phase 2）**：`@mcanextgen/native-win32` 以 koffi 直绑 user32/kernel32（懒加载、非 Windows 平台可安全 import），按**属主进程 + 窗口类双锚点**（`SunAwtFrame` / `LWJGL`）识别游戏窗口、不依赖窗口标题；`GameWindowTracker` 以 500ms 轮询上报窗口创建/销毁，并带「存活窗口期间不被顶替」护栏——实测搜狗 IME 会向 java 进程注入可见顶层 `SoPY_Status`，真窗嵌入变 WS_CHILD 后从 `EnumWindows` 消失时曾遭顶替。跨进程 SetParent 会**隐式 attach 输入队列**，因此外窗文本一律只经 `SendMessageTimeoutW(SMTO_ABORTIFHUNG)` 读取：裸 `GetWindowText` 是同步跨进程 send，实测曾与 Java 线程的激活流量对撞、冻结整个宿主。
- **Windows 子窗口嵌入（已可用，Phase 3）**：游戏窗不直接挂进 Electron 顶层 HWND（那是 Chromium 的资产，会就 z-order 与命中测试打架），中间垫一层 koffi 自绘的 `WS_CHILD` 裁剪容器；游戏窗在嵌入时刻原生剥装饰、转 `WS_CHILD` 挂进裁剪窗，由容器客户区布局与裁剪。fixed 版本以原生分辨率在 854×480 CSS 槽位居中显示（Windows 无法缩放子窗口内容，拉伸留给 resizable 策略），letterbox 背景即 DOM 本身。实测 Classic 0.0.21a_01 槽内渲染与输入正常（617 fps）。三个实测定案的硬依赖：宿主全局 `--disable-direct-composition`（否则 Chromium 的 DComp 视觉树无视 z-order 盖死一切原生子窗）；frame 必须**带装饰创建、原生剥除**（Java 侧 undecorated 会破坏 LWJGL2 parented 模式）；嵌入前屏外停放、嵌入后落位，实现零标题栏闪现（Java watchdog 与原生 `bringWindowOnScreen` 双兜底，拆卸时同样先停外再脱父、零残留闪现）。
- **Applet 时代死锁消除 + 宿主焦点转发（已可用）**：「失焦后点 Back to game 冻结」的 Applet 通病在此复现，被三份间隔 3 分钟的 jstack 抓成现行——三方 AWT 死锁（游戏线程持 AWTTreeLock 逐帧进 AWT native ↔ EDT 持 AWT_LOCK 等 Win32 SetFocus ↔ AWT-Windows）。宿主以 `protectAppletMouseMode` 反射翻掉游戏的 applet 鼠标模式标志、把鼠标切到 LWJGL 原生捕获分支（与 Betacraft v1 wrapper 的 Linux mouse fix 同款手法），死锁环失去一边；随之而来的是嵌入场景下 LWJGL 子窗拿不到 Win32 键盘焦点的输入缺口——由宿主**焦点转发**补齐：无消息枚举子窗锁定 `LWJGL` 焦点目标，`AttachThreadInput` + `SetFocus` 跨线程边界送达（触发点：`BrowserWindow focus` 与渲染层非交互区点击转发）；`blur` 侧对称地 `SetFocus(NULL)` 让游戏收到真实 WM_KILLFOCUS（弹暂停菜单、释放鼠标捕获）。已知残留：焦点住在 attach 队列里时 Chromium 的 `blur` 事件不保证触发，Alt+Tab 后游戏可能短暂保持聚焦（视觉级，输入正确性优先，详见 plan.md 风险登记 #3）。
- **能力探测（已可用，纯离线）**：与入口枚举同一套 jar 内字节码解析，判定每个入口类的 **`resizable`**（游戏主循环是否逐帧轮询 canvas 尺寸）与 **`supportsFullscreen`**（F11 按键检查与全屏 API 引用必须共现）——嵌入策略由字节码证据决定而非年代猜测；锚点全部带 owner/邻接限定（owner 盲的 `getWidth()I` 会误中 Classic 的 `DisplayMode.getWidth`），6 个已注册 entry 的判定与 javap 地面真值逐行对齐。
- **嵌入窗口管理（Phase 4，大半已随嵌入链路落地）**：宿主缩放同步通道（渲染层物理 rect → 主进程 → 按 `resizePolicy` 布局：fixed 居中不拉伸、resizable 随容器 `MoveWindow`）、焦点变化/鼠标捕获/键盘焦点处置、游戏进程退出与宿主关窗拆卸——均已实现（resizable 半侧待 Indev/Infdev 实测）。**尚未实现/待实测**：F11 重映射（能力探测已划定安装范围：Indev/Infdev 为 `supportsFullscreen`，Classic 与 isom 天然豁免）、minimize/restore 与每显示器 DPI 变化、游戏重启、按嵌入窗口原生尺寸推导宿主最小窗（当前为静态 640）。
- **规划中（按 plan.md 阶段推进）**：Applet 风格 UI、更多历史版本、Linux 支持、Tauri Edition。

---

## 📁 客户端 JAR 包放置指引 (Client JAR Placement)

⚠️ **特别说明（版权合规）**：受 DMCA 与版权合规限制，**本 GitHub 仓库不提供、不分发任何官方 Minecraft 游戏 `.jar` 客户端文件**（仓库仅包含宿主与启动器源码；各 channel 目录已预建占位，干净克隆后除 `.gitkeep` 外为空）。

请自行准备或提取您的 Minecraft 历史版本 `.jar` 文件，并放置在**仓库级的 `assets/minecraft/` 目录**下对应的 channel 子文件夹中（`.gitignore` 已排除该目录下的一切文件，放入后不会被误提交）：

- **Classic JAR**：放置于 `assets/minecraft/classic/`（例如 `assets/minecraft/classic/c0.0.21a_01.jar`）
- **Indev JAR**：放置于 `assets/minecraft/indev/`（例如 `assets/minecraft/indev/in-20100223.jar`）
- **Infdev JAR**：放置于 `assets/minecraft/infdev/`（例如 `assets/minecraft/infdev/inf-20100617-1531.jar`）
- **Alpha JAR**：放置于 `assets/minecraft/alpha/`
- **Beta JAR**：放置于 `assets/minecraft/beta/`
- **Release JAR**：放置于 `assets/minecraft/release/`

> **为什么没有 isom 目录**：Infinite Map Visualizer 不是独立版本——infdev 20100617 的 jar 里同时含 `net.minecraft.client.MinecraftApplet` 与 `net.minecraft.isom.IsomPreviewApplet` 两个入口类。宿主会在后台**离线解析字节码**（不起 JVM、全程无窗口）枚举所选 jar 里全部可启动的 Applet 入口，MCAHTML/MCAJNLP 手工维护的 isom 渠道在这里只是启动面板里的一个入口选择（选它启动时窗口标题显示为 Infinite Map Visualizer）。

> **与参考项目的差异**：这里取代了 MCAHTML 与 MCAJNLP 使用的 `bin/<channel>/` 布局；channel 子目录名保持完全一致，因此从两个参考项目搬运 jar 时只需换一个父目录。
>
> **当前已注册版本**：Classic **0.0.21a_01**（`assets/minecraft/classic/c0.0.21a_01.jar`，classicmp 栏，仅开放 server/port 联机输入），以及四个测试用途的历史版本——**c0.0.12a_03-200018**（classicpre12a 栏，`dpi_fix` 已实测破除硬编码 640x480）、**c0.0.15a-05311904**（classic15a 栏，`15a_server_patch` 已实测绕过硬编码多人探测）、Indev **in-20100223**（已实测 indev 系固定分辨率的缩放行为）、Infdev **inf-20100617-1531**（首个双入口 jar：常规客户端 + isom 预览，选中后面板出现入口下拉）。若文件缺失，点击【Launch】时宿主会在错误信息里报告它期望的**完整路径**，按提示补文件即可。`assets/minecraft/` 属于 **runtime 层**而非 Electron Edition 独有，未来的图形化版本管理器也读取同一目录。

---

## 💻 运行环境要求

### 1. Java 运行环境（游戏侧必需）

- **推荐版本：64 位 Java 8（JRE 或 JDK 均可）**，探测逻辑会优先命中它；**32 位 Java 8** 仅作为没有 64 位时的回退。
- **归档支持：Java 6 ~ Java 7**（部分极端怀旧的早期 Applet 在 Java 8 下存在渲染 Bug，规划中允许按版本指定更低版本）。
- 探测**不依赖 `PATH` 里第一个 `java` 是谁**：即使系统默认 `java` 已是 Java 21 / 25，只要机器上装有 Java 8 就能被找到并选中。

> 如需下载 Oracle Java，可参考：
> - **Java 8 官方下载**：<https://www.java.com/zh-CN/download/>
> - **Java 6 归档下载**：<https://www.oracle.com/java/technologies/javase-java-archive-javase6-downloads.html>
> - **Java 7 归档下载**：<https://www.oracle.com/java/technologies/javase/javase7-archive-downloads.html>

### 2. 开发环境（构建宿主本体）

- **Node.js >= 20.19**
- **pnpm 10**（仓库已声明 `packageManager: pnpm@10.x`，建议 `corepack enable` 后直接 `pnpm install`）
- 操作系统：**Windows x86_64 优先**（原生窗口嵌入相关实现依赖 Win32），Linux 支持排在 Phase 9

---

## 🚀 如何编译与运行

### 1. 从源码构建（开发者）

```bash
# 克隆仓库
git clone https://github.com/CreatorCSIE/MCANextGen.git
cd MCANextGen

# 安装 workspace 依赖（apps/electron + packages/runtime）
pnpm install

# （可选）重新编译 Java 侧启动器；产物 runtime/minecraft-host/build/mcanextgen-host.jar 已随仓库提交
# 需要 JDK 8：$env:JAVA_HOME_8 = "C:\Program Files\Java\jdk1.8.0_xxx"
powershell -ExecutionPolicy Bypass -File runtime/minecraft-host/build.ps1

# 启动 Electron Edition（带热更新）
pnpm dev

# 打包 main / preload / renderer
pnpm build

# 运行打包产物
pnpm preview

# 全仓库类型检查
pnpm typecheck
```

> **CI（临时最简闸门）**：上述 `typecheck` / `build` 以及「用 JDK 8 重编 `mcanextgen-host.jar`」已在 GitHub Actions 中自动化——`push`（main/master）与所有 PR 触发，见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。所有客户端 jar 均被 gitignore，CI 不依赖任何受版权保护资产、也不启动游戏；待后续阶段（嵌入窗口管理、打包产物、跨平台矩阵）引入后本工作流会被替换。

### 2. 仓库结构 (Repository Layout)

```text
MCANextGen
├── plan.md                 开发计划（按 Phase 划分）
├── .github/workflows/      GitHub Actions 静态 CI（typecheck + build + JDK 8 jar 重编，临时最简闸门）
├── assets/
│   ├── minecraft/          历史版本客户端 jar（用户自行放置，不分发）
│   │   ├── classic/  ├── indev/  ├── infdev/  ├── alpha/
│   │   ├── beta/     └── release/
│   └── lwjgl/2.9.3/        随仓库分发的 LWJGL jar 与 windows natives
├── runtime/
│   └── minecraft-host/     Java 8 启动器（AppletStub + 生命周期容器）
│       ├── src/            javac 1.8 源码
│       ├── build/          mcanextgen-host.jar（随仓库分发；classes 不入库）
│       └── build.ps1       构建脚本
├── apps/
│   └── electron/           Electron Edition（Chromium UI + 原生宿主）
│       └── src/
│           ├── main/       Electron 主进程（原生窗口拥有者 + 嵌入/焦点转发控制器）
│           ├── preload/    通过 contextBridge 暴露给渲染层
│           ├── renderer/   Vue 3 界面
│           └── shared/     main / preload / renderer 的唯一契约
└── packages/
    ├── native-win32/       koffi 直绑 Win32：窗口枚举/跟踪、裁剪容器、嵌入与焦点操作（非 Windows 可安全 import）
    └── runtime/            Minecraft 运行时层，与 Vue / Electron 无关
        └── src/
            ├── java/       Java 发现、探测与 Java 8 选择
            └── minecraft/  版本注册表、资产布局、JVM 参数组、Applet 入口枚举与能力探测、进程启动
```

---

## 🌐 Localization / 国际化与多语言支持

本项目（包含宿主界面与文档）随时欢迎社区提供多语言本地化（i18n）与翻译支持！
*This repository, host UI, and documentation welcome community contributions for localization (i18n) and translations at any time!*

如果你希望为本项目贡献其他语言（如 English、繁體中文等）的 README 文档或界面翻译，欢迎随时提交 **Pull Request** 或开 **Issue** 讨论！

---

## ❓ 常见问题排查与解决

### 1. 探测面板提示「找不到 Java 8」

宿主窗口中的 Java runtime 面板会列出**全部候选**（版本号、架构、发现来源）以及每个探测失败的 executable 与原因（如 `ENOENT`、探测超时）：

- **探测顺序**：注册表（`HKLM\SOFTWARE\JavaSoft\JDK` / `JRE` / `Java Development Kit` / `Java Runtime Environment` / `Java Plug-in`，64 位视图与 32 位 `WOW6432Node` 都查）→ 安装目录扫描（`Java`、Adoptium、Corretto、Zulu 等厂商目录）→ `JAVA_HOME` / `JDK_HOME` → `PATH`。
- **候选必须实测**：注册表与目录只提供线索，版本号 / 位数一律以真实 `java` 进程的输出为准，因此**卸载残留的转发壳不会污染结果**。
- **玩家可以自行处理**：安装 **64 位 Java 8**；或把 `JAVA_HOME` 指向已有的 JRE/JDK 根目录。（手动指定 JDK 路径的参数在 runtime 层已预留，图形化设置界面尚未实现。）

### 2. `pnpm install` 后启动报找不到 `dist\electron.exe`

某些网络环境下 Electron 的二进制下载步骤会失败（依赖装完了但可执行文件缺失）。可手动补一次下载：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
cd node_modules\.pnpm\electron@<版本号>\node_modules\electron
node install.js
```

### 3. `pnpm` 报 workspace 清单文件命名错误

workspace 清单必须是 **`pnpm-workspace.yaml`**（不是 `.yml`），且请在**仓库根目录**执行 `pnpm` 命令；`apps/*` 与 `packages/*` 已在该文件中声明。

### 4. 还需要像参考项目那样改 `java.policy` 吗？——不需要

MCAJNLP 走 `javaws`（Java Web Start 沙箱）、MCAHTML 走浏览器 NPAPI 插件，因此需要在 JRE 的 `lib\security\java.policy` 里追加 `SocketPermission` / `AllPermission`。**MCANextGen 以普通 `java -cp` 方式启动游戏进程，没有 Applet 沙箱**，本地读写与 Socket 天然可用，无需改动任何 policy 文件。

### 5. 高 DPI 屏上游戏窗口发糊 / 与 Betacraft 窗口同尺寸不同清晰度

系统 Java 8 的 `java.exe` 是 DPI-unaware：Windows 会按缩放比例（如 150%）对窗口做位图拉伸，物理尺寸正确但内容模糊；Betacraft 自带打了 DPI-aware manifest 的 JRE 所以像素原生。宿主嵌入（Phase 3）已把几何交接统一为**物理像素**（槽位尺寸 = 物理分辨率，CSS px ÷ devicePixelRatio），游戏窗口以客户区精确等于目标物理分辨率嵌入；DPI-unaware 进程侧的渲染细节仍以高分屏实测为准（Phase 4 清单内的 DPI 缩放项）。

---

## 📄 许可证与版权声明 (License & Copyright)

- 本项目仅供 Minecraft 历史版本研究、Applet 怀旧与技术交流使用。
- 为了防止代码被恶意倒卖、闭源修改或注入恶意软件，本项目源码采用 **[GNU General Public License v3 (GPL v3) 许可证](LICENSE)** 进行强制开源。
  - **Copyright (c) 2026 CreatorCSIE. All rights reserved.**
- **第三方资产与商标免责声明**：
  - 本仓库**不包含、不分发任何官方 Minecraft 游戏 `.jar` 客户端包或音效资源**。
  - 本项目所涉及的 Minecraft 游戏资产、商标与品牌版权均归 **Mojang Studios / Microsoft** 所有。
