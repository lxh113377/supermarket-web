#!/usr/bin/env bash
# P0-1 历史清理：用 git filter-repo 重写仓库历史，替换所有明文 ADMIN_KEY（REDACTED）。
# 前置条件：
#   1. git filter-repo 已安装（git filter-repo --version）
#   2. GitHub 认证可用：gh auth login 或导出 GH_TOKEN
#   3. 无未提交改动（或已自行确认）
# 风险：force-push 会重写远端历史；若有协作者/fork 需先协调。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/3 备份当前 HEAD（回滚锚点：git reset --hard backup-pre-purge）"
git tag backup-pre-purge HEAD

echo "==> 2/3 重写全部历史（REDACTED ==> REDACTED）"
printf 'REDACTED==>REDACTED\n' > /tmp/admin-key-replacements.txt
git filter-repo --replace-text /tmp/admin-key-replacements.txt --force
rm -f /tmp/admin-key-replacements.txt

echo "==> 3/3 重新关联远端并强制推送 main"
git remote add origin https://github.com/lxh113377/supermarket-web.git
git push --force origin main
git push --force origin main --tags

echo "==> 完成。验证：下面命令应无输出（历史中不再有明文）"
git log -p --all -S 'REDACTED' --oneline | head -5
echo "==> 验证结束"
