package org.mcanextgen.host;

import java.applet.Applet;
import java.applet.AppletContext;
import java.applet.AudioClip;
import java.awt.Image;
import java.net.URL;
import java.util.Enumeration;
import java.util.Hashtable;

/**
 * 最小 AppletContext（对应 18.6.1 中 parent.getAppletContext() 的直通角色）。
 * 经典客户端几乎不触碰它；这里只保证调用不炸、状态可见。
 */
final class HostContext implements AppletContext {

    public AudioClip getAudioClip(URL url) {
        return null;
    }

    public Image getImage(URL url) {
        return null;
    }

    public Applet getApplet(String name) {
        return null;
    }

    public Enumeration<Applet> getApplets() {
        return new Hashtable<Applet, Object>().keys();
    }

    public void showDocument(URL url) {
        // 桌面宿主没有可跳转的浏览器页面
    }

    public void showDocument(URL url, String target) {
        // 同上
    }

    public void showStatus(String status) {
        System.out.println("[mcanextgen:status] " + status);
    }

    // 本 JDK 的 AppletContext 还带流相关抽象方法，一并给个无害实现
    private final Hashtable<String, java.io.InputStream> streams =
            new Hashtable<String, java.io.InputStream>();

    public void setStream(String mimeType, java.io.InputStream stream) throws java.io.IOException {
        streams.put(mimeType, stream);
    }

    public java.io.InputStream getStream(String mimeType) {
        java.io.InputStream stream = streams.get(mimeType);
        streams.remove(mimeType);
        return stream;
    }

    public java.util.Iterator<String> getStreamKeys() {
        return streams.keySet().iterator();
    }
}
