#!/bin/sh
# 立即备份一次（在项目根目录执行）：./scripts/backup.sh
set -eu
docker compose run --rm backup now
