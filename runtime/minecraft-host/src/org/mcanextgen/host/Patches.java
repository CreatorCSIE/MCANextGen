package org.mcanextgen.host;

import java.applet.Applet;
import java.awt.BorderLayout;
import java.awt.Canvas;
import java.awt.Component;
import java.awt.GraphicsConfiguration;
import java.awt.GraphicsEnvironment;
import java.awt.Toolkit;
import java.awt.geom.AffineTransform;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.util.Map;

/**
 * 两个补丁的移植版，源自 MCWebPort 的 lwjgl_util_applet fork
 * （AppletLoader.applyDpiResolutionFix / patchClassic15aServer，见 plan.md 18.6）。
 *
 * 全部走反射、只依赖 JDK 8 编译，不与任何具体游戏类产生编译期耦合；
 * 开关来自 applet 参数（与当年 <embed> 的参数名一致）：
 * dpi_fix / 15a_server_patch。
 */
public final class Patches {

    /**
     * init() 之后、start() 之前调用：把游戏内硬编码的 framebuffer 尺寸
     * （640x480 或 1024x768）改写为容器实际尺寸（乘系统 DPI 缩放系数）。
     * LWJGL 的 Display 在 start() 后的渲染循环里才读取这两个字段，改写时机安全。
     */
    public static void applyDpiFix(Applet applet) {
        try {
            int containerW = applet.getWidth() > 0 ? applet.getWidth() : 854;
            int containerH = applet.getHeight() > 0 ? applet.getHeight() : 480;
            double dpiScale = systemDpiScale();
            int targetW = (int) Math.round(containerW * dpiScale);
            int targetH = (int) Math.round(containerH * dpiScale);
            System.out.println("[mcanextgen][dpi_fix] 容器 " + containerW + "x" + containerH
                    + " × scale " + dpiScale);

            // 1) 游戏实例的 width/height 字段（glViewport / 投影的尺寸来源）。
            //    12a 构造器里是 `sipush 640; putfield a`，候选名单 a/b 即其混淆名；
            //    12a/21a 的 run() 又用 new DisplayMode(a, b) 调 setDisplayMode，
            //    所以视口与 framebuffer 的尺寸来源都收敛在这两个 int 字段上。
            rewriteGameSizeFields(applet, targetW, targetH);
            // 2) LWJGL Display 的当前 DisplayMode（framebuffer 尺寸来源）。
            //    游戏在构造器里就 Display.setDisplayMode(new DisplayMode(640,480))，
            //    只改游戏字段的话视口扩了、可绘制区仍是 640x480（右侧黑边根因）。
            rewriteLwjglDisplayMode(applet.getClass().getClassLoader(), targetW, targetH);
        } catch (Throwable t) {
            System.err.println("[mcanextgen][dpi_fix] 失败（保持原分辨率继续运行）: " + t);
        }
    }

    /** 游戏类各版本混淆名不同（15a: w/x，12a/21a: a/b），按候选名 + 硬编码值双重判断。 */
    private static void rewriteGameSizeFields(Applet applet, int targetW, int targetH) {
        Field mcField = findField(applet.getClass(), "minecraft", "a", "b", "c");
        if (mcField == null) {
            System.err.println("[mcanextgen][dpi_fix] 未找到 Minecraft 实例字段，跳过");
            return;
        }
        try {
            Object minecraft = mcField.get(applet);
            if (minecraft == null) {
                return;
            }
            // 必须按 int 类型过滤：12a 的 c.w 是 boolean、21a 的 d.w 是 FloatBuffer，
            // 只按名字命中会在 getInt 处抛异常、让整个改写静默失败。
            Class<?> mcClass = minecraft.getClass();
            Field widthField = findIntField(mcClass, "width", "w", "a");
            Field heightField = findIntField(mcClass, "height", "x", "b");
            if (widthField == null || heightField == null) {
                System.err.println("[mcanextgen][dpi_fix] 未找到 width/height 字段，跳过");
                return;
            }
            int currentW = widthField.getInt(minecraft);
            int currentH = heightField.getInt(minecraft);
            if (!looksHardcoded(currentW, currentH)) {
                System.out.println("[mcanextgen][dpi_fix] 游戏尺寸 " + currentW + "x" + currentH
                        + " 非硬编码，保持不变");
                return;
            }
            widthField.setInt(minecraft, targetW);
            heightField.setInt(minecraft, targetH);
            System.out.println("[mcanextgen][dpi_fix] 游戏尺寸 " + currentW + "x" + currentH
                    + " -> " + targetW + "x" + targetH + "（字段 "
                    + mcClass.getSimpleName() + "." + widthField.getName()
                    + "/" + heightField.getName() + "）");
        } catch (Throwable t) {
            System.err.println("[mcanextgen][dpi_fix] 游戏字段改写失败: " + t);
        }
    }

    /**
     * LWJGL 2.x 的 Display 用静态字段 `mode` 保存 setDisplayMode 的结果，
     * create() 时按它开 framebuffer。只按硬编码值命中才改写，
     * desktop（真实桌面分辨率）与非常规尺寸一律不碰。
     */
    private static void rewriteLwjglDisplayMode(ClassLoader loader, int targetW, int targetH) {
        try {
            Class<?> display = loader.loadClass("org.lwjgl.opengl.Display");
            int rewritten = 0;
            for (Field f : display.getDeclaredFields()) {
                if (!java.lang.reflect.Modifier.isStatic(f.getModifiers())) {
                    continue;
                }
                if (!f.getType().getName().equals("org.lwjgl.opengl.DisplayMode")) {
                    continue;
                }
                f.setAccessible(true);
                Object mode = f.get(null);
                if (mode == null) {
                    continue;
                }
                Field mw = mode.getClass().getDeclaredField("width");
                Field mh = mode.getClass().getDeclaredField("height");
                mw.setAccessible(true);
                mh.setAccessible(true);
                int cw = mw.getInt(mode);
                int ch = mh.getInt(mode);
                if (looksHardcoded(cw, ch)) {
                    mw.setInt(mode, targetW);
                    mh.setInt(mode, targetH);
                    rewritten++;
                    System.out.println("[mcanextgen][dpi_fix] Display." + f.getName()
                            + " " + cw + "x" + ch + " -> " + targetW + "x" + targetH);
                }
            }
            if (rewritten == 0) {
                System.out.println("[mcanextgen][dpi_fix] LWJGL DisplayMode 无硬编码尺寸，保持不变");
            }
        } catch (Throwable t) {
            System.err.println("[mcanextgen][dpi_fix] DisplayMode 改写失败: " + t);
        }
    }

    /** 经典系已知的硬编码 framebuffer 尺寸（0.0.12a~0.30c 时代）。 */
    private static boolean looksHardcoded(int w, int h) {
        return (w == 640 && h == 480) || (w == 1024 && h == 768) || (w == 800 && h == 480);
    }

    /**
     * 替代 0.0.15a 的原生 init()：原实现会先探测已死掉的硬编码多人地址
     * （表现为数秒黑屏后才回退单人）。这里直接手工完成 init() 的效果——
     * 反射构造 Canvas/Minecraft 内部件并注入 applet，单人模式下发送队列强制置
     * null（0ms 启动），只有给出 server+port 参数时才真正联机。
     * 组装失败时由调用方回退 applet.init()。
     */
    public static void patchClassic15a(Applet applet, Map<String, String> parameters)
            throws Exception {
        ClassLoader loader = applet.getClass().getClassLoader();
        Class<?> appletClass = applet.getClass();
        System.out.println("[mcanextgen][15a] 反射组装 0.0.15a（Tiny mappings）……");

        // 1. applet 的 Canvas 内部类（MinecraftApplet$1，覆写 addNotify 供 LWJGL 挂 Display）
        Class<?> canvasClass = findClass(loader,
                appletClass.getName() + "$1", "com.mojang.minecraft.MinecraftApplet$1");
        Constructor<?> canvasCon = canvasClass.getDeclaredConstructor(appletClass);
        canvasCon.setAccessible(true);
        Canvas canvas = (Canvas) canvasCon.newInstance(applet);
        Field canvasField = findField(appletClass, "canvas");
        if (canvasField != null) {
            canvasField.set(applet, canvas);
        }

        // 2. Minecraft 主类（0.0.15a 混淆名 com.mojang.minecraft.c）
        Class<?> mcClass = findClass(loader,
                "com.mojang.minecraft.c", "com.mojang.minecraft.Minecraft");
        Constructor<?> mcCon = mcClass.getConstructor(
                Canvas.class, int.class, int.class, boolean.class);
        Object minecraft = mcCon.newInstance(canvas, applet.getWidth(), applet.getHeight(), false);
        Field mcField = findField(appletClass, "minecraft");
        if (mcField == null) {
            mcField = findFieldOfType(appletClass, mcClass);
        }
        if (mcField != null) {
            mcField.set(applet, minecraft);
        }

        // 3. 网络连接队列（映射: C -> sendQueue）
        Field queue = findField(mcClass, "C", "sendQueue");
        String server = parameters.get("server");
        String port = parameters.get("port");
        if (server != null && port != null && queue != null) {
            try {
                Class<?> manager = findClass(loader,
                        "com.mojang.minecraft.net.b", "com.mojang.minecraft.net.ConnectionManager");
                Constructor<?> con = manager.getConstructor(
                        mcClass, String.class, int.class, String.class);
                Object newQueue = con.newInstance(minecraft, server, Integer.parseInt(port),
                        orDefault(parameters.get("username"), "guest"));
                queue.set(minecraft, newQueue);
                System.out.println("[mcanextgen][15a] 多人 -> " + server + ":" + port);
            } catch (Exception e) {
                System.err.println("[mcanextgen][15a] 连接构造失败，回退单人: " + e);
                if (queue != null) {
                    queue.set(minecraft, null);
                }
            }
        } else if (queue != null) {
            queue.set(minecraft, null);
            System.out.println("[mcanextgen][15a] 单人模式（跳过原生 init() 的连接探测）");
        }

        // 4. 其余字段（Tiny mappings 混淆名单字母）
        Field uriField = findField(mcClass, "f", "minecraftUri");
        if (uriField != null && applet.getCodeBase() != null) {
            try {
                uriField.set(minecraft, applet.getCodeBase().getHost()
                        + ":" + applet.getCodeBase().getPort());
            } catch (Throwable ignored) {
            }
        }
        String username = parameters.get("username");
        String sessionid = parameters.get("sessionid");
        if (username != null && sessionid != null) {
            try {
                Class<?> userClass = findClass(loader,
                        "com.mojang.minecraft.a", "com.mojang.minecraft.User");
                Constructor<?> userCon = userClass.getConstructor(String.class, String.class);
                Field userField = findField(mcClass, "e", "user");
                if (userField != null) {
                    userField.set(minecraft, userCon.newInstance(username, sessionid));
                }
            } catch (Throwable ignored) {
            }
        }
        if (parameters.get("loadmap_user") != null && parameters.get("loadmap_id") != null) {
            try {
                Field lmUser = findField(mcClass, "j", "loadMapUser");
                Field lmId = findField(mcClass, "k", "loadMapID");
                if (lmUser != null) {
                    lmUser.set(minecraft, parameters.get("loadmap_user"));
                }
                if (lmId != null) {
                    lmId.set(minecraft, Integer.parseInt(parameters.get("loadmap_id")));
                }
            } catch (Throwable ignored) {
            }
        }
        Field appletMode = findField(mcClass, "g", "appletMode");
        if (appletMode != null) {
            try {
                appletMode.setBoolean(minecraft, true);
            } catch (Throwable ignored) {
            }
        }

        // 5. 布局：像原生 init() 那样把 Canvas 挂进 applet
        applet.setLayout(new BorderLayout());
        applet.add((Component) canvas, BorderLayout.CENTER);
        canvas.setFocusable(true);
        applet.validate();
    }

    /** 只接受 int 字段的查找（尺寸字段专用，见 rewriteGameSizeFields 的注释）。 */
    private static Field findIntField(Class<?> type, String... names) {
        for (Class<?> c = type; c != null && c != Object.class; c = c.getSuperclass()) {
            for (String name : names) {
                try {
                    Field f = c.getDeclaredField(name);
                    if (f.getType() == int.class) {
                        f.setAccessible(true);
                        return f;
                    }
                } catch (NoSuchFieldException ignored) {
                }
            }
        }
        return null;
    }

    /** 依次尝试候选名，沿父类链找可访问字段（游戏类可能把字段放在父类）。 */
    private static Field findField(Class<?> type, String... names) {
        for (Class<?> c = type; c != null && c != Object.class; c = c.getSuperclass()) {
            for (String name : names) {
                try {
                    Field f = c.getDeclaredField(name);
                    f.setAccessible(true);
                    return f;
                } catch (NoSuchFieldException ignored) {
                }
            }
        }
        return null;
    }

    /** 按类型兜底（0.0.12a 风格的单字母混淆字段名）。 */
    private static Field findFieldOfType(Class<?> type, Class<?> wanted) {
        for (Class<?> c = type; c != null && c != Object.class; c = c.getSuperclass()) {
            for (Field f : c.getDeclaredFields()) {
                if (f.getType() == wanted) {
                    f.setAccessible(true);
                    return f;
                }
            }
        }
        return null;
    }

    private static Class<?> findClass(ClassLoader loader, String... names)
            throws ClassNotFoundException {
        ClassNotFoundException last = null;
        for (String name : names) {
            try {
                return loader.loadClass(name);
            } catch (ClassNotFoundException e) {
                last = e;
            }
        }
        throw last;
    }

    /** 与 fork 相同的双重来源：GraphicsConfiguration 变换优先，ScreenResolution 兜底。 */
    private static double systemDpiScale() {
        try {
            GraphicsConfiguration gc = GraphicsEnvironment
                    .getLocalGraphicsEnvironment().getDefaultScreenDevice()
                    .getDefaultConfiguration();
            if (gc != null) {
                AffineTransform t = gc.getDefaultTransform();
                return t.getScaleX();
            }
        } catch (Throwable ignored) {
        }
        try {
            int dpi = Toolkit.getDefaultToolkit().getScreenResolution();
            return dpi / 96.0;
        } catch (Throwable ignored) {
        }
        return 1.0;
    }

    private static String orDefault(String value, String fallback) {
        return value != null ? value : fallback;
    }

    private Patches() {
    }
}
