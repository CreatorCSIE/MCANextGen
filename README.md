> [!IMPORTANT]
> **项目状态提示**：本项目处于**早期开发阶段**。目前已完成工程脚手架（Phase 0）、**Java 运行时自动探测**与 **Classic 核心启动**（Phase 1：游戏以独立 Java 8 进程运行、弹出独立窗口），并已注册 0.0.21a_01 与四个测试历史版本（含双入口的 Infdev 20100617-1531）、移植 `dpi_fix` / `15a_server_patch` 两项补丁（均已实测生效）、实现 headless 的 Applet 入口枚举；**原生窗口捕获与嵌入（Phase 2/3/4）尚未实现**，游戏窗口暂时游离在宿主之外。
> *Status Notice: the scaffolding, the Java runtime probe and the core launch path (Classic 0.0.21a_01 plus four registered historical test builds—including the dual-entry Infdev 20100617-1531—, the ported `dpi_fix` / `15a_server_patch` optional fixes verified live, and headless Applet entry enumeration) are done; capturing and embedding the game's native window into the host is **not implemented yet**.*

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
- **旧版客户端核心启动（已可用，Phase 1）**：`runtime/minecraft-host` 以自制的 `AppletStub` 容器直接驱动原始 `com.mojang.minecraft.MinecraftApplet`（不含 AppletLoader 的下载/签名机制），配合随仓库分发的 LWJGL 2.9.3 与 natives，把 Classic 0.0.21a_01 作为独立 Java 8 进程拉起；游戏窗口客户区精确等于设定分辨率（`setPreferredSize + pack()`）。缺 jar 时宿主报告期望的完整路径，Stop / 退出宿主都会收掉游戏进程。
- **移植参考项目的 JVM 参数组（已可用）**：`java_arguments` + `fix_arguments`（MCAHTML 与 MCAJNLP 共用同一套）已接入 `packages/runtime/src/minecraft/arguments.ts`——含 Betacraft 兼容代理（历史客户端硬编码的 `www.minecraft.net` HTTP 流量重定向）、渲染修复五连（`noddraw` / `noerasebackground` / `d3d` / `opengl` / `pmoffscreen`）、`useLegacyMergeSort`（经典版比较器不满足 TimSort 契约）与内存上限，调用方可整体覆写。
- **AppletLoader 补丁作为按版本声明的可选功能（已可用）**：LWJGL fork 的两项修复移植到 `runtime/minecraft-host`（`Patches.java`，纯反射实现、与游戏类零编译期耦合）——`dpi_fix` 破除 pre-0.0.12a_03 硬编码的 640x480（视口与 framebuffer 的尺寸来源收敛在游戏 `a`/`b` 字段，`run()` 再据此 `setDisplayMode`；实测 640x480 → 854x480，右侧黑边消失）；`15a_server_patch` 跳过 0.0.15a 对已死硬编码地址的数秒连接探测黑屏（反射组装替代原生 `init()`，给出 server/port 则直连）。按 MCAHTML/MCAJNLP 的栏位规则在版本注册表中声明：`classicpre12a` 仅出 dpi_fix 复选框、`classic15a` 仅出 15a 补丁复选框、`classicmp`（原生 server/port 时代）不显示任何复选框；启动面板按注册表动态生成勾选框，支持逐次启动开关。
- **Applet 入口枚举与 isom 预览入口（已可用）**：宿主机用独立的 headless JVM 枚举所选 jar 内全部可启动的 Applet 入口类（真实 `Applet.isAssignableFrom` 判定、只 load 不 initialize，全程不会出现任何窗口）。发现多个入口时（Infdev 20100617 的 jar 在常规客户端之外还带 `net.minecraft.isom.IsomPreviewApplet`），启动面板出现一个临时的入口下拉（正式 UI 设计阶段会重做），所选入口随启动透传给 Java 宿主；isom 的窗口标题写为其真名 **Infinite Map Visualizer**，不与 Minecraft 共用。
- **规划中（按 plan.md 阶段推进）**：原生窗口句柄捕获、Windows 子窗口嵌入 PoC 与嵌入窗口管理、Applet 风格 UI、更多历史版本、Linux 支持、Tauri Edition。

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

> **为什么没有 isom 目录**：Infinite Map Visualizer 不是独立版本——infdev 20100617 的 jar 里同时含 `net.minecraft.client.MinecraftApplet` 与 `net.minecraft.isom.IsomPreviewApplet` 两个入口类。宿主会在后台（headless、无窗口）扫描所选 jar 并枚举全部可启动的 Applet 入口，MCAHTML/MCAJNLP 手工维护的 isom 渠道在这里只是启动面板里的一个入口选择（选它启动时窗口标题显示为 Infinite Map Visualizer）。

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

### 2. 仓库结构 (Repository Layout)

```text
MCANextGen
├── plan.md                 开发计划（按 Phase 划分）
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
│           ├── main/       Electron 主进程（拥有原生窗口）
│           ├── preload/    通过 contextBridge 暴露给渲染层
│           ├── renderer/   Vue 3 界面
│           └── shared/     main / preload / renderer 的唯一契约
└── packages/
    └── runtime/            Minecraft 运行时层，与 Vue / Electron 无关
        └── src/
            ├── java/       Java 发现、探测与 Java 8 选择
            └── minecraft/  版本注册表、资产布局、JVM 参数组、Applet 入口枚举与进程启动
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

系统 Java 8 的 `java.exe` 是 DPI-unaware：Windows 会按缩放比例（如 150%）对窗口做位图拉伸，物理尺寸正确但内容模糊；Betacraft 自带打了 DPI-aware manifest 的 JRE 所以像素原生。这属于已知差异，宿主嵌入（Phase 3/4）后将以物理像素传尺寸统一处理。

---

## 📄 许可证与版权声明 (License & Copyright)

- 本项目仅供 Minecraft 历史版本研究、Applet 怀旧与技术交流使用。
- 为了防止代码被恶意倒卖、闭源修改或注入恶意软件，本项目源码采用 **[GNU General Public License v3 (GPL v3) 许可证](LICENSE)** 进行强制开源。
  - **Copyright (c) 2026 CreatorCSIE. All rights reserved.**
- **第三方资产与商标免责声明**：
  - 本仓库**不包含、不分发任何官方 Minecraft 游戏 `.jar` 客户端包或音效资源**。
  - 本项目所涉及的 Minecraft 游戏资产、商标与品牌版权均归 **Mojang Studios / Microsoft** 所有。
