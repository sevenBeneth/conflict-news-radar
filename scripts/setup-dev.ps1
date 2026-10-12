<#
============================================================================
 CNR · 一键初始化脚本（Windows / PowerShell）
----------------------------------------------------------------------------
 作用：
   1. 检查运行环境（Node、MySQL 客户端）
   2. 创建数据库 cnr 与专用账号，并授权
   3. 依次执行 database/01-schema.sql（建表）与 02-seed.sql（演示数据）
   4. 生成 .env 与 frontend/.env.local 配置文件
   5. 打印后续启动指引

 用法（在仓库根目录执行）：
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-dev.ps1
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-dev.ps1 -SkipDb
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-dev.ps1 -MysqlRootPassword 你的root密码

 说明：
   · 本脚本为 Windows 原生初始化脚本，不依赖 Docker。
   · 若你选择用 docker compose 启动，则无需运行本脚本的建库步骤，
     MySQL 容器会在首次启动时自动执行 database/ 下的两个 SQL 文件。
   · MySQL 客户端若不在 PATH 中，脚本会自动搜索常见安装路径。
============================================================================
#>

[CmdletBinding()]
param(
    # MySQL 管理员账号（用于建库授权）
    [string]$MysqlAdminUser = 'root',
    # MySQL 管理员密码
    [string]$MysqlRootPassword = '123456',
    # 目标库与业务账号
    [string]$DbName = 'cnr',
    [string]$DbUser = 'cnr',
    [string]$DbPassword = 'cnr_password',
    [string]$DbHost = '127.0.0.1',
    [int]$DbPort = 3306,
    # 跳过建库步骤（例如使用 Docker 时）
    [switch]$SkipDb,
    # 跳过配置文件生成
    [switch]$SkipEnv
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Write-Head($text) {
    Write-Host ''
    Write-Host ('=' * 70) -ForegroundColor DarkCyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host ('=' * 70) -ForegroundColor DarkCyan
}

function Write-Ok($text) { Write-Host "  [OK]   $text" -ForegroundColor Green }
function Write-Warn2($text) { Write-Host "  [警告] $text" -ForegroundColor Yellow }
function Write-Err($text) { Write-Host "  [错误] $text" -ForegroundColor Red }

# ─── 定位 mysql 客户端 ───────────────────────────────────────────────────────
function Find-MysqlClient {
    $cmd = Get-Command mysql -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # PATH 中没有则搜索常见安装位置
    $candidates = @(
        'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe',
        'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe',
        'C:\Program Files (x86)\MySQL\MySQL Server 8.0\bin\mysql.exe',
        'D:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }

    # 兜底：递归搜索（限制深度，避免过慢）
    foreach ($root in @('C:\Program Files\MySQL', 'C:\Program Files (x86)\MySQL')) {
        if (Test-Path $root) {
            $hit = Get-ChildItem $root -Recurse -Filter 'mysql.exe' -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($hit) { return $hit.FullName }
        }
    }
    return $null
}

Write-Head 'CNR 环境初始化'

# ─── 1. 环境检查 ─────────────────────────────────────────────────────────────
Write-Host '  [1/5] 检查运行环境' -ForegroundColor White

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Err ' 未找到 Node.js，请先安装 Node.js 20 或更高版本：https://nodejs.org/'
    exit 1
}
$nodeVersion = (& node -v).TrimStart('v')
$nodeMajor = [int]($nodeVersion -split '\.')[0]
if ($nodeMajor -lt 20) {
    Write-Warn2 " 当前 Node.js 版本为 $nodeVersion，建议升级到 20 或更高"
}
else {
    Write-Ok "Node.js $nodeVersion"
}

$mysqlClient = Find-MysqlClient
if ($mysqlClient) {
    $verOut = & $mysqlClient --version 2>&1 | Select-Object -First 1
    Write-Ok "MySQL 客户端：$verOut"
}
else {
    Write-Warn2 ' 未找到 mysql 客户端，将跳过建库步骤'
    Write-Host '         若已安装 MySQL，请把其 bin 目录加入 PATH 后重试；' -ForegroundColor DarkGray
    Write-Host '         或直接改用 docker compose 启动（容器会自动建库）。' -ForegroundColor DarkGray
}

# ─── 2. 建库与授权 ───────────────────────────────────────────────────────────
if (-not $SkipDb -and $mysqlClient) {
    Write-Host ''
    Write-Host '  [2/5] 创建数据库与账号' -ForegroundColor White

    $setupSql = @"
CREATE DATABASE IF NOT EXISTS ``$DbName``
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS '$DbUser'@'localhost' IDENTIFIED BY '$DbPassword';
CREATE USER IF NOT EXISTS '$DbUser'@'%' IDENTIFIED BY '$DbPassword';
GRANT ALL PRIVILEGES ON ``$DbName``.* TO '$DbUser'@'localhost';
GRANT ALL PRIVILEGES ON ``$DbName``.* TO '$DbUser'@'%';
FLUSH PRIVILEGES;
"@

    $setupSql | & $mysqlClient -h $DbHost -P $DbPort -u $MysqlAdminUser "-p$MysqlRootPassword" `
        --default-character-set=utf8mb4 2>&1 |
        Where-Object { $_ -notmatch 'Warning.*password' } |
        ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray }

    if ($LASTEXITCODE -ne 0) {
        Write-Err ' 建库失败。请确认 MySQL 已启动，且管理员账号密码正确。'
        Write-Host '         可显式传入：-MysqlRootPassword 你的密码' -ForegroundColor DarkGray
        exit 1
    }
    Write-Ok "数据库 $DbName 与账号 $DbUser 已就绪"

    # ─── 3. 执行结构与种子数据 ──────────────────────────────────────────────
    Write-Host ''
    Write-Host '  [3/5] 导入数据库结构与演示数据' -ForegroundColor White

    foreach ($file in @('database\01-schema.sql', 'database\02-seed.sql')) {
        $path = Join-Path $repoRoot $file
        if (-not (Test-Path $path)) {
            Write-Err " 缺少文件：$file"
            exit 1
        }
        # 使用管道输入而非 source 命令：避免 Windows 反斜杠路径被 mysql 当作转义符
        $sql = [System.IO.File]::ReadAllText($path)
        $out = $sql | & $mysqlClient -h $DbHost -P $DbPort -u $DbUser "-p$DbPassword" `
            --default-character-set=utf8mb4 2>&1 |
            Where-Object { $_ -notmatch 'Warning.*password' }

        if ($LASTEXITCODE -ne 0) {
            Write-Err " 执行 $file 失败："
            $out | ForEach-Object { Write-Host "         $_" -ForegroundColor Red }
            exit 1
        }
        if ($out) { $out | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkGray } }
        Write-Ok "$file 已导入"
    }

    # 校验结果
    $check = "USE ``$DbName``; SELECT COUNT(*) AS t FROM information_schema.tables WHERE table_schema='$DbName';" |
        & $mysqlClient -h $DbHost -P $DbPort -u $DbUser "-p$DbPassword" --skip-column-names 2>&1 |
        Where-Object { $_ -notmatch 'Warning.*password' }
    Write-Ok "当前库中共有 $($check | Select-Object -First 1) 张表"
}
elseif (-not $SkipDb) {
    Write-Host ''
    Write-Host '  [2/5] 跳过建库（未找到 mysql 客户端）' -ForegroundColor White
    Write-Host '  [3/5] 跳过导入' -ForegroundColor White
}
else {
    Write-Host ''
    Write-Host '  [2/5] 按参数要求跳过建库' -ForegroundColor White
    Write-Host '  [3/5] 按参数要求跳过导入' -ForegroundColor White
}

# ─── 4. 生成配置文件 ─────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  [4/5] 生成配置文件' -ForegroundColor White

if ($SkipEnv) {
    Write-Host '        按参数要求跳过' -ForegroundColor DarkGray
}
else {
    $envExample = Join-Path $repoRoot '.env.example'

    # 后端 / 采集器使用 .env
    $envTarget = Join-Path $repoRoot '.env'
    if (Test-Path $envTarget) {
        Write-Warn2 '.env 已存在，未覆盖'
    }
    else {
        Copy-Item $envExample $envTarget
        Write-Ok '.env 已生成（后端与采集器共用）'
    }

    # 前端使用 frontend/.env.local
    $feTarget = Join-Path $repoRoot 'frontend\.env.local'
    if (Test-Path $feTarget) {
        Write-Warn2 'frontend\.env.local 已存在，未覆盖'
    }
    else {
        Copy-Item $envExample $feTarget
        Write-Ok 'frontend\.env.local 已生成（前端）'
    }
}

# ─── 5. 完成提示 ─────────────────────────────────────────────────────────────
Write-Head '初始化完成'
Write-Host ''
Write-Host '  后续启动方式（三选一）' -ForegroundColor White
Write-Host ''
Write-Host '  【方式一】原生本地启动（推荐开发时使用，三个终端窗口）' -ForegroundColor Cyan
Write-Host '    cd backend  ; npm install ; npm run dev     # 后端  http://localhost:4000'
Write-Host '    cd workers  ; npm install ; npm run dev     # 采集器'
Write-Host '    cd frontend ; npm install ; npm run dev     # 前端  http://localhost:3000'
Write-Host ''
Write-Host '  【方式二】Docker 一键启动（需 Docker Desktop 已运行）' -ForegroundColor Cyan
Write-Host '    docker compose up --build'
Write-Host ''
Write-Host '  【方式三】本地大模型（AI 分析功能需要）' -ForegroundColor Cyan
Write-Host '    ollama serve'
Write-Host '    ollama pull qwen2.5:7b        # 中文能力优于 llama3，推荐'
Write-Host ''
Write-Host '  说明：' -ForegroundColor DarkGray
Write-Host '    · 未配置任何数据源凭据时，界面使用 database/02-seed.sql 的演示数据，' -ForegroundColor DarkGray
Write-Host '      航班 / 船舶 / 冲突 / 新闻四个图层均可正常显示。' -ForegroundColor DarkGray
Write-Host '    · 地图底图默认使用天地图（需在 frontend/.env.local 配置' -ForegroundColor DarkGray
Write-Host '      NEXT_PUBLIC_TIANDITU_KEY）；未配置时自动回退免 Key 的高德底图。' -ForegroundColor DarkGray
Write-Host '    · 数据源国内化替换进度见数据库 data_sources 表。' -ForegroundColor DarkGray
Write-Host ''
