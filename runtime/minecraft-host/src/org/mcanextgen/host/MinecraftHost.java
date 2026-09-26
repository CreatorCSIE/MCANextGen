package org.mcanextgen.host;

import java.applet.Applet;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.EventQueue;
import java.awt.Frame;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.File;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.Map;

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
        EventQueue.invokeAndWait(new Runnable() {
            public void run() {
                applet.init();
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

    private MinecraftHost() {
    }
}
