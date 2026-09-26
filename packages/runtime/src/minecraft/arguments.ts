/**
 * JVM argument sets ported from the reference projects:
 * MCAHTML `js/launcher.js` (`java_arguments` / `fix_arguments`) and
 * MCAJNLP `MainWindowViewModel.cs` (`vmArgs` / `fixArgs`) — both ship the same
 * two groups, so MCANextGen keeps them as one shared default.
 *
 * Deliberately NOT ported: `-Dorg.lwjgl.util.NoChecks=true`. That flag is only
 * read by AppletLoader's signed-LWJGL check, which we never run (the host owns
 * classpath and natives outright).
 */

/** Runtime sizing and AWT behaviour, from `java_arguments` / `vmArgs`. */
export const DEFAULT_JVM_ARGUMENTS: readonly string[] = [
  '-Xmx800M',
  '-XX:MaxDirectMemorySize=1024M',
  // Old clients compare with inconsistent comparators; TimSort (Java 7+) throws
  // "Comparison method violates its general contract!" without this.
  '-Djava.util.Arrays.useLegacyMergeSort=true',
  // Keep AWT coordinates in raw pixels; Java2D's own HiDPI scaling must stay off.
  '-Dsun.java2d.uiScale.enabled=false',
  '-Dsun.java2d.dpiaware=false'
]

/** Rendering + network fixes, from `fix_arguments` / `fixArgs`. */
export const DEFAULT_FIX_ARGUMENTS: readonly string[] = [
  // Betacraft compatibility proxy: the historical clients hard-code
  // www.minecraft.net URLs (skins, /mp list, level download); routing JVM-wide
  // HTTP through betacraft.uk re-points them at working services. api/files
  // stay direct, exactly like MCAHTML and MCAJNLP.
  '-Dhttp.proxyHost=betacraft.uk',
  '-Dhttp.proxyPort=11702',
  '-Dhttp.nonProxyHosts=api.betacraft.uk|files.betacraft.uk',
  '-Djava.net.useSystemProxies=false',
  // Render fixes: force the old Java2D pipeline, avoid flicker/black canvas and
  // tearing on modern Windows GPU drivers with DirectDraw/D3D.
  '-Dsun.java2d.noddraw=true',
  '-Dsun.awt.noerasebackground=true',
  '-Dsun.java2d.d3d=false',
  '-Dsun.java2d.opengl=false',
  '-Dsun.java2d.pmoffscreen=false'
]

/** What `launchMinecraft` passes when the caller does not override. */
export const DEFAULT_GAME_JVM_ARGUMENTS: readonly string[] = [
  ...DEFAULT_JVM_ARGUMENTS,
  ...DEFAULT_FIX_ARGUMENTS
]
