# 备份镜像：基于 PostgreSQL 客户端，内置每日备份脚本（无需在服务器上放源代码）
FROM postgres:17-alpine
COPY backup-loop.sh /usr/local/bin/backup-loop.sh
ENTRYPOINT ["/bin/sh", "/usr/local/bin/backup-loop.sh"]
