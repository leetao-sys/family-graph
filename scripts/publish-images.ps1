<#
  构建镜像并推送到镜像仓库（NAS 上直接 docker compose pull 拉取）。
  同时构建 x86_64 与 ARM64 两种架构，适配大多数 NAS。

  用法（在项目根目录）：
    docker login                                          # 先登录 Docker Hub（阿里云等需写仓库域名）
    .\scripts\publish-images.ps1 -Repo leetaooooo/family-graph
    .\scripts\publish-images.ps1 -Repo leetaooooo/family-graph -Tag 1.0.0
  三个镜像推送到同一个仓库，标签为 backend-<Tag>、web-<Tag>、backup-<Tag>。
#>
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Tag = "latest",
  [string]$Platforms = "linux/amd64,linux/arm64"
)
Set-Location (Split-Path $PSScriptRoot -Parent)

docker buildx version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "找不到 docker buildx，请确认 Docker Desktop 已启动（参见 README「Docker 命令找不到」）" }

# 多架构构建需要 docker-container 驱动的 builder
docker buildx inspect family-graph-builder 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { docker buildx create --name family-graph-builder --driver docker-container | Out-Null }

$images = @(
  @{ Name = "backend"; Context = "backend" },
  @{ Name = "web"; Context = "frontend" },
  @{ Name = "backup"; Context = "scripts" }
)
foreach ($img in $images) {
  $ref = "${Repo}:$($img.Name)-$Tag"
  Write-Host "==> 构建并推送 $ref ($Platforms)" -ForegroundColor Cyan
  docker buildx build --builder family-graph-builder --platform $Platforms -t $ref --push $img.Context
  if ($LASTEXITCODE -ne 0) { throw "构建 $ref 失败" }
}
Write-Host "完成。在 NAS 的 .env 中设置 IMAGE_REPO=$Repo 与 IMAGE_TAG=$Tag，然后 docker compose pull; docker compose up -d" -ForegroundColor Green
