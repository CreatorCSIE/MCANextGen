package org.mcanextgen.host;

import java.applet.Applet;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.EventQueue;
import java.awt.Frame;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.File;
import java.lang.reflect.Constructor;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/**
 * MCANextGen Java 侧启动入口。
 *
 * 它扮演当年「浏览器 + AppletLoader」的容器角色，但去掉了所有 jar 下载 / 证书 /
 * natives 解压逻辑——进程、classpath 与 native 目录全部由宿主（runtime 层）掌控。
 *
 * 生命周期顺序遵循 plan.md 18.6.2：
 * loadClass -> newInstance -> setStub -> setSize -> add -> validate/setVisible -> init -> start
 */
public final class MinecraftHost {

    public static void main(String[] args) throws Exception {
        // runtime 层的入口类枚举模式（--list-applets）：headless 扫描 jar，
        // 不创建任何窗口，输出 "MCANEXTGEN_APPLET <类名>" 供 TS 侧解析。
        if (args.length > 0 && "--list-applets".equals(args[0])) {
            listAppletClasses();
            return;
        }
        final Map<String, String> parameters = HostStub.loadParameters(
                System.getProperty("mcanextgen.params"));
        final String appletClass = System.getProperty(
                "mcanextgen.appletClass", "com.mojang.minecraft.MinecraftApplet");
        final int width = Integer.getInteger("mcanextgen.width", 854);
        final int height = Integer.getInteger("mcanextgen.height", 480);
        final String title = System.getProperty("mcanextgen.title", "Minecraft");

        // 与 AppletLoader 一致：游戏类走独立 ClassLoader，并设为线程上下文 loader
        ClassLoader loader = buildClassLoader();
        Thread.currentThread().setContextClassLoader(loader);

        final Applet applet;
        try {
            applet = (Applet) loader.loadClass(appletClass).newInstance();
        } catch (Throwable t) {
            System.err.println("[mcanextgen] 无法加载 Applet 主类: " + appletClass);
            throw t;
        }

        final Frame frame = new Frame(title);
        frame.setLayout(new BorderLayout());
        // 关键：在触碰游戏之前先注入 Stub（18.6.1 契约）
        applet.setStub(new HostStub(parameters));
        // pack() 让「客户区」恰好等于 width x height（frame.setSize 会把标题栏/边框算进去，
        // 导致 LWJGL 视口缩水成 ~832x440）
        applet.setPreferredSize(new Dimension(width, height));
        frame.add(applet, BorderLayout.CENTER);
        frame.pack();
        frame.addWindowListener(new WindowAdapter() {
            public void windowClosing(WindowEvent e) {
                shutdown(applet);
            }
        });

        // Canvas 的 native peer 必须先于 init() 出现：LWJGL 的 Display 会挂到它上面
        EventQueue.invokeAndWait(new Runnable() {
            public void run() {
                frame.setVisible(true);
                frame.validate();
                applet.setSize(width, height);
            }
        });

        // 补丁开关与当年 <embed> 的参数名一致（runtime 层按版本注册表注入，见 version.ts）
        final boolean patch15a = "true".equals(parameters.get("15a_server_patch"));
        final boolean dpiFix = "true".equals(parameters.get("dpi_fix"));
        EventQueue.invokeAndWait(new Runnable() {
            public void run() {
                if (patch15a) {
                    // 用反射组装替代原生 init()，避开硬编码多人地址的连接探测
                    try {
                        Patches.patchClassic15a(applet, parameters);
                    } catch (Throwable t) {
                        System.err.println("[mcanextgen][15a] 组装失败，回退原生 init(): " + t);
                        applet.init();
                    }
                } else {
                    applet.init();
                }
                if (dpiFix) {
                    // init() 已创建 Minecraft 实例、start() 尚未读取尺寸——正是改写窗口
                    Patches.applyDpiFix(applet);
                }
                applet.start();
            }
        });
    }

    private static void shutdown(Applet applet) {
        try {
            applet.stop();
            applet.destroy();
        } catch (Throwable ignored) {
            // 游戏线程可能已经随窗口一起消亡
        }
        System.exit(0);
    }

    private static ClassLoader buildClassLoader() throws Exception {
        String jars = System.getProperty("mcanextgen.jars");
        if (jars == null || jars.trim().isEmpty()) {
            return ClassLoader.getSystemClassLoader();
        }
        String[] entries = jars.split(File.pathSeparator);
        URL[] urls = new URL[entries.length];
        for (int i = 0; i < entries.length; i++) {
            urls[i] = new File(entries[i]).getAbsoluteFile().toURI().toURL();
        }
        return new URLClassLoader(urls, ClassLoader.getSystemClassLoader());
    }

    /**
     * 枚举 -Dmcanextgen.scanJar 指向的客户端 jar 里全部可启动的 Applet 子类，
     * 每行输出 {@code MCANEXTGEN_APPLET <全限定类名>}。
     *
     * 用真实的 isAssignableFrom 判定而非类名启发式——infdev 20100617 的 jar
     * 同时含 net.minecraft.client.MinecraftApplet 与
     * net.minecraft.isom.IsomPreviewApplet（MCAHTML/MCAJNLP 手工硬编码的
     * isom 渠道其实就是这里的第二个入口类）。只 load 不 initialize，
     * 不会触发任何游戏静态初始化，全程 headless 无窗口。
     */
    private static void listAppletClasses() throws Exception {
        String scanJar = System.getProperty("mcanextgen.scanJar");
        if (scanJar == null || scanJar.trim().isEmpty()) {
            System.err.println("[mcanextgen][applets] 缺少 -Dmcanextgen.scanJar");
            System.exit(2);
        }
        ClassLoader loader = buildClassLoader();
        Thread.currentThread().setContextClassLoader(loader);
        List<String> found = new ArrayList<String>();
        JarFile jar = new JarFile(new File(scanJar));
        try {
            Enumeration<JarEntry> entries = jar.entries();
            while (entries.hasMoreElements()) {
                String name = entries.nextElement().getName();
                // 跳过内部类（MinecraftApplet$1 之类不是独立入口）
                if (!name.endsWith(".class") || name.indexOf('$') >= 0) {
                    continue;
                }
                String className = name
                        .substring(0, name.length() - ".class".length())
                        .replace('/', '.');
                try {
                    Class<?> candidate = loader.loadClass(className);
                    if (!Applet.class.isAssignableFrom(candidate)
                            || Modifier.isAbstract(candidate.getModifiers())) {
                        continue;
                    }
                    Constructor<?> ctor = candidate.getDeclaredConstructor();
                    if (!Modifier.isPublic(ctor.getModifiers())) {
                        continue;
                    }
                    found.add(className);
                } catch (Throwable ignored) {
                    // 依赖缺失、缺无参构造等：不是可用入口，跳过
                }
            }
        } finally {
            jar.close();
        }
        Collections.sort(found);
        for (String className : found) {
            System.out.println("MCANEXTGEN_APPLET " + className);
        }
    }

    private MinecraftHost() {
    }
}
