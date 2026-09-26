# 编译 MCANextGen Java 启动器（目标版本 1.8，需要 JDK 8）
# 用法：powershell -File runtime/minecraft-host/build.ps1
# 可通过 $env:JAVA_HOME_8 指定 JDK 8 根目录，否则使用 PATH 中的 javac/jar。
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here "src"
$classes = Join-Path $here "build\classes"
$jar = Join-Path $here "build\mcanextgen-host.jar"

if ($env:JAVA_HOME_8) {
    $javac = Join-Path $env:JAVA_HOME_8 "bin\javac.exe"
    $jarTool = Join-Path $env:JAVA_HOME_8 "bin\jar.exe"
} else {
    $javac = "javac"
    $jarTool = "jar"
}

if (Test-Path $classes) { Remove-Item -Recurse -Force $classes }
New-Item -ItemType Directory -Force -Path $classes | Out-Null

$sources = Get-ChildItem -Recurse -Filter *.java $src | ForEach-Object { $_.FullName }
& $javac -encoding UTF-8 -source 1.8 -target 1.8 -d $classes @sources
if ($LASTEXITCODE -ne 0) { throw "javac 失败" }

& $jarTool cfm $jar (Join-Path $here "manifest.mf") -C $classes .
if ($LASTEXITCODE -ne 0) { throw "jar 打包失败" }

Write-Host "已生成 $jar"
