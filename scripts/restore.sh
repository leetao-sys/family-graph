#!/bin/sh
# 从备份恢复（在项目根目录执行）：./scripts/restore.sh backups/20261021-030000
# 会覆盖当前数据库与头像文件，请先确认。
set -eu
dir="${1:?用法：./scripts/restore.sh <备份目录>}"
[ -f "$dir/db.dump" ] || { echo "找不到 $dir/db.dump"; exit 1; }

printf "将用 %s 覆盖当前数据，输入 yes 继续：" "$dir"
read -r answer
[ "$answer" = "yes" ] || { echo "已取消"; exit 1; }

docker compose stop backend
docker compose cp "$dir/db.dump" db:/tmp/restore.dump
docker compose exec -T db pg_restore --clean --if-exists --no-owner -U family -d family /tmp/restore.dump
docker compose exec -T db rm -f /tmp/restore.dump
if [ -f "$dir/media.tar.gz" ]; then
  docker compose run --rm -T --no-deps --entrypoint /bin/sh \
    -v "$(cd "$dir" && pwd)":/restore:ro -v family-graph_media:/data/media \
    backup -c "rm -rf /data/media/* && tar -xzf /restore/media.tar.gz -C /data"
fi
docker compose start backend
echo "恢复完成"
