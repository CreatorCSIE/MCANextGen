package org.mcanextgen.host;

import java.applet.AppletContext;
import java.applet.AppletStub;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * 最小 AppletStub 契约，逐项对齐 plan.md 18.6.1 中 MinecraftStub 的行为：
 *
 * - documentBase / codeBase 固定为历史地址 http://www.minecraft.net/game/
 *   （老客户端以它为基准解析皮肤、声音、/mp 等 URL）；
 * - getParameter 直通宿主传入的参数表，缺省返回 null（经典版均有 null 保护）；
 * - isActive 恒为 true，桌面宿主不能让游戏以为页面被切走；
 * - appletResize 为空实现，尺寸由宿主窗口管理决定。
 */
public final class HostStub implements AppletStub {

    private static final String HISTORICAL_BASE = "http://www.minecraft.net/game/";

    private final Map<String, String> parameters;
    private final AppletContext context;

    public HostStub(Map<String, String> parameters) {
        this.parameters = parameters;
        this.context = new HostContext();
    }

    public URL getDocumentBase() {
        return historicalBase();
    }

    public URL getCodeBase() {
        return historicalBase();
    }

    public String getParameter(String name) {
        return parameters.get(name);
    }

    public AppletContext getAppletContext() {
        return context;
    }

    public boolean isActive() {
        return true;
    }

    public void appletResize(int width, int height) {
        // 由宿主管控尺寸，游戏不得自行 resize
    }

    private static URL historicalBase() {
        try {
            return new URL(HISTORICAL_BASE);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 读取宿主（runtime 层）写入的扁平 JSON 参数文件：{"username":"Player",...}。
     * 只支持字符串键值——参数经命令行传递容易受平台转义影响，落盘更稳。
     */
    public static Map<String, String> loadParameters(String file) {
        Map<String, String> result = new HashMap<String, String>();
        if (file == null || file.trim().isEmpty()) {
            return result;
        }
        try {
            String text = read(new File(file));
            // 去掉可能的 UTF-8 BOM，避免 JSON 首字符判定失败
            if (!text.isEmpty() && text.charAt(0) == '\uFEFF') {
                text = text.substring(1);
            }
            parseIntoObject(text, result);
        } catch (Exception e) {
            System.err.println("[mcanextgen] 参数文件解析失败: " + file + " (" + e + ")");
        }
        return result;
    }

    private static String read(File f) throws Exception {
        StringBuilder text = new StringBuilder();
        Reader reader = new InputStreamReader(new FileInputStream(f), "UTF-8");
        try {
            char[] buf = new char[4096];
            int n;
            while ((n = reader.read(buf)) > 0) {
                text.append(buf, 0, n);
            }
        } finally {
            reader.close();
        }
        return text.toString();
    }

    /**
     * 极简「扁平字符串 JSON 对象」解析器：无嵌套、无数值/布尔字面量需求。
     * 游标随读取推进，避免转义序列的原始长度与解码长度不一致的问题。
     */
    private static void parseIntoObject(String json, Map<String, String> out) {
        int[] pos = { skipSpace(json, 0) };
        expect(json, pos, '{');
        skip(json, pos);
        if (json.charAt(pos[0]) == '}') {
            return;
        }
        while (true) {
            skip(json, pos);
            String key = readString(json, pos);
            skip(json, pos);
            expect(json, pos, ':');
            skip(json, pos);
            String value = readString(json, pos);
            out.put(key, value);
            skip(json, pos);
            char c = json.charAt(pos[0]++);
            if (c == ',') {
                continue;
            }
            if (c == '}') {
                return;
            }
            throw new IllegalArgumentException("期望 ',' 或 '}'");
        }
    }

    private static void skip(String json, int[] pos) {
        pos[0] = skipSpace(json, pos[0]);
    }

    private static void expect(String json, int[] pos, char c) {
        if (pos[0] >= json.length() || json.charAt(pos[0]) != c) {
            throw new IllegalArgumentException("期望 '" + c + "'");
        }
        pos[0]++;
    }

    private static String readString(String json, int[] pos) {
        expect(json, pos, '"');
        StringBuilder sb = new StringBuilder();
        while (pos[0] < json.length()) {
            char c = json.charAt(pos[0]++);
            if (c == '"') {
                return sb.toString();
            }
            if (c != '\\') {
                sb.append(c);
                continue;
            }
            char e = json.charAt(pos[0]++);
            switch (e) {
                case 'n': sb.append('\n'); break;
                case 't': sb.append('\t'); break;
                case 'r': sb.append('\r'); break;
                case 'b': sb.append('\b'); break;
                case 'f': sb.append('\f'); break;
                case '/': sb.append('/'); break;
                case '\\': sb.append('\\'); break;
                case '"': sb.append('"'); break;
                case 'u':
                    sb.append((char) Integer.parseInt(
                            json.substring(pos[0], pos[0] + 4), 16));
                    pos[0] += 4;
                    break;
                default:
                    throw new IllegalArgumentException("非法转义: \\" + e);
            }
        }
        throw new IllegalArgumentException("字符串未闭合");
    }

    private static int skipSpace(String json, int pos) {
        int i = pos;
        while (i < json.length() && Character.isWhitespace(json.charAt(i))) {
            i++;
        }
        return i;
    }
}
