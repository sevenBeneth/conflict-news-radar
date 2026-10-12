# ============================================================================
#  CNR · 共享层同步脚本
# ----------------------------------------------------------------------------
#  背景：
#    backend 与 workers 是两个独立的 npm 包，各自有独立的 tsconfig.json 与
#    Dockerfile（构建上下文分别为 ./backend 和 ./workers）。若两者直接以
#    `../../shared/db` 相互引用，会把文件推到各自 tsconfig 的 rootDir 之外，
#    TypeScript 会抛出 TS6059（文件不在 rootDir 下），且 Docker 构建上下文
#    也取不到该文件。
#
#  方案：
#    shared/ 作为唯一事实来源（single source of truth），构建前由本脚本
#    同步到 backend/src/shared/ 与 workers/src/shared/。
#    这样既能保证两端逻辑完全一致，又不破坏各自的独立构建。
#
#  用法：
#    pwsh -File scripts/sync-shared.ps1          # 同步
#    pwsh -File scripts/sync-shared.ps1 -Check   # 仅校验是否已同步（CI 用）
#
#  注意：同步产物 backend/src/shared/ 与 workers/src/shared/ 属于生成物，
#        已加入 .gitignore，请勿直接编辑，改动请改 shared/ 下的源文件。
# ============================================================================

[CmdletBinding()]
param(
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $repoRoot 'shared'
$targets = @(
    (Join-Path $repoRoot 'backend/src/shared'),
    (Join-Path $repoRoot 'workers/src/shared')
)

if (-not (Test-Path $sourceDir)) {
    throw "未找到共享层源目录：$sourceDir"
}

$sourceFiles = Get-ChildItem -Path $sourceDir -Filter '*.ts' -File
if ($sourceFiles.Count -eq 0) {
    throw "共享层源目录中没有 .ts 文件：$sourceDir"
}

Write-Host "共享层同步：$sourceDir" -ForegroundColor Cyan
Write-Host ("  源文件 {0} 个：{1}" -f $sourceFiles.Count, (($sourceFiles | Select-Object -ExpandProperty Name) -join ', '))

$drift = 0

foreach ($target in $targets) {
    if (-not (Test-Path $target)) {
        if ($Check) {
            Write-Host ("  [缺失] {0}" -f $target) -ForegroundColor Red
            $drift++
            continue
        }
        New-Item -ItemType Directory -Path $target -Force | Out-Null
    }

    foreach ($file in $sourceFiles) {
        $dest = Join-Path $target $file.Name

        $needsCopy = $true
        if (Test-Path $dest) {
            $srcHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            $dstHash = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
            $needsCopy = ($srcHash -ne $dstHash)
        }

        if ($needsCopy) {
            if ($Check) {
                Write-Host ("  [未同步] {0}" -f $dest) -ForegroundColor Yellow
                $drift++
            }
            else {
                Copy-Item -LiteralPath $file.FullName -Destination $dest -Force
                Write-Host ("  [已同步] {0}" -f $dest) -ForegroundColor Green
            }
        }
        else {
            Write-Host ("  [一致]   {0}" -f $dest) -ForegroundColor DarkGray
        }
    }
}

if ($Check) {
    if ($drift -gt 0) {
        Write-Host ""
        Write-Host ("校验失败：有 {0} 处未同步，请执行 pwsh -File scripts/sync-shared.ps1" -f $drift) -ForegroundColor Red
        exit 1
    }
    Write-Host ""
    Write-Host "校验通过：共享层与各端副本一致。" -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "共享层同步完成。" -ForegroundColor Green
