# git-push-fallback.ps1 — 代理直连双通道推送（坑29 脚本化，2026-09-05）
#
# 背景：git 全局 http.proxy 指向 Clash Verge(127.0.0.1:7897)。Clash 在跑时走代理加速；
# Clash 未启动/代理端口拒连时 git push 报 "Failed to connect to github.com:443 over proxy"
# （坑29）。git 原生不支持"代理失败自动回退"，故本脚本：先按默认(走代理)推送，
# 失败则自动带 -c http.proxy= -c https.proxy= 直连重试一次。
#
# 用法（PowerShell）:
#   .\scripts\git-push-fallback.ps1 origin main
#   .\scripts\git-push-fallback.ps1 origin main --force
# 等价于用 -- 传递任意 git push 参数；commit 前的任何参数校验逻辑不受影响。

param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$GitArgs
)

$ErrorActionPreference = 'Continue'

Write-Host "[git-push] ============================================"
Write-Host "[git-push] 第 1 次尝试：走全局代理推送 (http.proxy=127.0.0.1:7897)"
git push @GitArgs
if ($LASTEXITCODE -eq 0) {
  Write-Host "[git-push] ✅ 代理通道推送成功"
  exit 0
}

Write-Host "[git-push] ⚠️  代理推送失败 (exit=$LASTEXITCODE)，回退直连重试...（坑29 兜底）"
Write-Host "[git-push] 第 2 次尝试：git -c http.proxy= -c https.proxy= push"
git -c http.proxy= -c https.proxy= push @GitArgs
if ($LASTEXITCODE -eq 0) {
  Write-Host "[git-push] ✅ 直连通道推送成功（Clash 未运行或代理不通）"
  exit 0
}

Write-Host "[git-push] ❌ 代理与直连双通道均失败（exit=$LASTEXITCODE）。"
Write-Host "[git-push]    排查：1) Clash 是否开启/配置 7897  2) 网络连通性  3) 认证 (credential manager)"
exit $LASTEXITCODE