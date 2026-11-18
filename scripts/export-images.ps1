<#
  不使用镜像仓库时：把全部镜像（含 PostgreSQL）导出为一个 tar 文件，拷到 NAS 后导入。

  用法（在项目根目录）：
    .\scripts\export-images.ps1                          # x86_64 NAS（群晖 Plus/威联通大多数机型）
    .\scripts\export-images.ps1 -Platform linux/arm64    # ARM NAS（群晖 j/value 系列部分机型、树莓派等）

  在 NAS 上：docker load -i family-graph-images.tar
  （群晖 Container Manager：映像 → 新增 → 从文件添加）
#>
param(
  [string]$Platform = "linux/amd64",
  [string]$Tag = "latest",
  [string]$Output = "family-graph-images.tar"
)
Set-Location (Split-Path $PSScriptRoot -Parent)

docker buildx version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "找不到 docker buildx，请确认 Docker Desktop 已启动（参见 README「Docker 命令找不到」）" }

$images = @(
  @{ Name = "backend"; Context = "backend" },
  @{ Name = "web"; Context = "frontend" },
  @{ Name = "backup"; Context = "scripts" }
)
$refs = @()
foreach ($img in $images) {
  $ref = "family-graph:$($img.Name)-$Tag"
  Write-Host "==> 构建 $ref ($Platform)" -ForegroundColor Cyan
  docker buildx build --platform $Platform -t $ref --load $img.Context
  if ($LASTEXITCODE -ne 0) { throw "构建 $ref 失败" }
  $refs += $ref
}
docker pull --platform $Platform postgres:17-alpine
if ($LASTEXITCODE -ne 0) { throw "拉取 postgres:17-alpine 失败" }
$refs += "postgres:17-alpine"

Write-Host "==> 导出到 $Output" -ForegroundColor Cyan
docker save -o $Output @refs
if ($LASTEXITCODE -ne 0) { throw "导出失败" }
$size = [math]::Round((Get-Item $Output).Length / 1MB)
Write-Host "完成：$Output（$size MB）。NAS 的 .env 中使用 IMAGE_REPO=family-graph、IMAGE_TAG=$Tag" -ForegroundColor Green
