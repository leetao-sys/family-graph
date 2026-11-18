#!/bin/sh
# 在 backup 容器中运行：每天 BACKUP_HOUR 点备份一次，并清理过期备份。
set -eu

run_backup() {
  ts=$(date +%Y%m%d-%H%M%S)
  dir="/backups/$ts"
  mkdir -p "$dir"
  pg_dump --format=custom --file="$dir/db.dump"
  tar -czf "$dir/media.tar.gz" -C /data media
  echo "[backup] $(date '+%F %T') 完成：$dir"
  find /backups -mindepth 1 -maxdepth 1 -type d -mtime +"${BACKUP_KEEP_DAYS:-14}" -exec rm -rf {} +
}

if [ "${1:-}" = "now" ]; then
  run_backup
  exit 0
fi

echo "[backup] 已启动，每天 ${BACKUP_HOUR:-3} 点备份，保留 ${BACKUP_KEEP_DAYS:-14} 天"
last=""
while true; do
  hour=$(date +%H | sed 's/^0//')
  today=$(date +%F)
  if [ "${hour:-0}" -eq "${BACKUP_HOUR:-3}" ] && [ "$last" != "$today" ]; then
    run_backup || echo "[backup] 备份失败"
    last="$today"
  fi
  sleep 300
done
