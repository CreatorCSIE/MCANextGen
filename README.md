> [!IMPORTANT]
> **项目状态提示**：本项目处于**早期开发阶段**。目前已完成工程脚手架（Phase 0）与 **Java 运行时自动探测**；**游戏启动、原生窗口捕获与嵌入尚未实现**，因此现在克隆仓库还玩不到游戏。
> *Status Notice: this project is under early development. The scaffolding (Phase 0) and the Java runtime probe are done; launching Minecraft, capturing and embedding its native window are **not implemented yet**.*

# MCANextGen - 旧版 Minecraft Applet 桌面宿主 (Legacy Minecraft Applet Desktop Host)

`MCANextGen` 是一个**面向 Minecraft 早期历史版本（Classic、Indev、Infdev、Alpha、Beta、Release 与 Infinite Map Visualizer）Java Applet 的现代桌面宿主**。

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
- **规划中（按 plan.md 阶段推进）**：拉起原始 `MinecraftApplet` 进程、原生窗口句柄捕获、Windows 子窗口嵌入 PoC 与嵌入窗口管理、Applet 风格 UI、LWJGL 2 运行时依赖、Linux 支持、Tauri Edition。

---

## 📁 客户端 JAR 包放置指引 (Client JAR Placement)

⚠️ **特别说明（版权合规）**：受 DMCA 与版权合规限制，**本 GitHub 仓库不提供、不分发任何官方 Minecraft 游戏 `.jar` 客户端文件**（仓库仅包含宿主与启动器源码，干净克隆后各 channel 目录为空）。

请自行准备或提取您的 Minecraft 历史版本 `.jar` 文件，并放置在**仓库级的 `assets/minecraft/` 目录**下对应的 channel 子文件夹中：

- **Classic JAR**：放置于 `assets/minecraft/classic/`（例如 `assets/minecraft/classic/c0.0.21a_01.jar`）
- **Indev JAR**：放置于 `assets/minecraft/indev/`（例如 `assets/minecraft/indev/in-20100223.jar`）
- **Infdev JAR**：放置于 `assets/minecraft/infdev/`
- **Alpha JAR**：放置于 `assets/minecraft/alpha/`
- **Beta JAR**：放置于 `assets/minecraft/beta/`
- **Release JAR**：放置于 `assets/minecraft/release/`
- **Infinite Map Visualizer JAR**：放置于 `assets/minecraft/isom/`

> **与参考项目的差异**：这里取代了 MCAHTML 与 MCAJNLP 使用的 `bin/<channel>/` 布局；channel 子目录名保持完全一致，因此从两个参考项目搬运 jar 时只需换一个父目录。
>
> **提示**：`assets/minecraft/` 属于 **runtime 层**而非 Electron Edition 独有；当图形化版本管理实现后，若选中的版本缺少 jar，宿主会报告它期望的**完整路径**，按该提示补文件即可。

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
│   └── minecraft/          历史版本客户端 jar（用户自行放置，不分发）
│       ├── classic/  ├── indev/  ├── infdev/  ├── alpha/
│       ├── beta/     ├── release/ └── isom/
├── apps/
│   └── electron/           Electron Edition（Chromium UI + 原生宿主）
│       └── src/
│           ├── main/       Electron 主进程（拥有原生窗口）
│           ├── preload/    通过 contextBridge 暴露给渲染层
│           ├── renderer/   Vue 3 界面
│           └── shared/     main / preload / renderer 的唯一契约
└── packages/
    └── runtime/            Minecraft 运行时层，与 Vue / Electron 无关
        └── src/java/       Java 发现、探测与 Java 8 选择
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

### 4. 游戏报 `java.security.AccessControlException`（待游戏侧实现后适用）

Java 默认沙箱会限制本地文件读写与 Socket。参考项目的既有做法是在所用 JRE/JDK 的 `lib\security\java.policy` 的 `grant { ... };` 末尾追加：

```text
permission java.net.SocketPermission "*:*", "accept,connect,resolve";
permission java.security.AllPermission;
```

---

## 📄 许可证与版权声明 (License & Copyright)

- 本项目仅供 Minecraft 历史版本研究、Applet 怀旧与技术交流使用。
- 为了防止代码被恶意倒卖、闭源修改或注入恶意软件，本项目源码采用 **[GNU General Public License v3 (GPL v3) 许可证](LICENSE)** 进行强制开源。
  - **Copyright (c) 2026 CreatorCSIE. All rights reserved.**
- **第三方资产与商标免责声明**：
  - 本仓库**不包含、不分发任何官方 Minecraft 游戏 `.jar` 客户端包或音效资源**。
  - 本项目所涉及的 Minecraft 游戏资产、商标与品牌版权均归 **Mojang Studios / Microsoft** 所有。
