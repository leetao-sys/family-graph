# family-graph · 家族关系图谱系统

以“人物节点 + 关系连线”的图模型统一表达家族中的血亲、婚姻、姻亲与朋友、同学、同事等社会关系。同一份数据提供两种视角：

- **人物关系视图**：以选定“谱心”为中心的纸面谱系桌面，按世代分行展开；初始只展开谱心的一度亲缘；单击某个人物，展开 TA 的一跳亲缘；不再随拖动/缩放自动加载。
- **族谱视图**：family-chart 式横向人物卡片 + 细折线 + 世代横带，默认「上下三代」，可切换「血亲旁系 / 祖先 / 后代」；孙辈及更远分支默认折叠，点卡片下方 + 逐支展开；附带**称呼计算器**，自动算出“A 称呼 B 为什么”。

本仓库实现设计文档中的 **V1.0 Web 版**范围（登录与权限、人物与关系管理、人物关系视图、族谱树、称呼计算器、管理后台、Docker 部署）。

## 部署

项目有两种 Docker 部署方式，镜像都是同一仓库下的 3 个自建镜像（标签 `backend-<版本>`、`web-<版本>`、`backup-<版本>`）加官方 `postgres:17-alpine`。已发布的镜像仓库：[leetaooooo/family-graph](https://hub.docker.com/r/leetaooooo/family-graph)。

| 方式 | 适合 | 用到的文件 |
|---|---|---|
| A. 从源代码构建 | 有源代码的开发机 / 服务器 | 根目录 `docker-compose.yml` |
| B. 只拉取镜像（推荐用于 NAS） | NAS、不想放源代码的服务器 | `deploy/docker-compose.yml` + `deploy/.env` |

### A. 从源代码构建运行

```bash
cp .env.example .env      # 修改其中的 DB_PASSWORD / SECRET_KEY / ADMIN_PASSWORD
docker compose up -d --build
```

### B. 部署到 NAS（推荐，不需要源代码）

镜像已发布在 [Docker Hub](https://hub.docker.com/r/leetaooooo/family-graph)：`backend-latest`、`web-latest`、`backup-latest`，同时支持 64 位 x86（amd64）与 ARM（arm64）NAS。32 位 ARM（armv7）NAS 不支持。

**第 1 步：在 NAS 上建目录。** 例如 `/volume1/docker/family-graph`，放入两个文件：

- `deploy/docker-compose.yml`
- 把 `deploy/.env.example` 复制为 `.env`，填写 `DB_PASSWORD`、`SECRET_KEY`、`ADMIN_PASSWORD`（生成方法写在 `.env` 顶部；`DB_PASSWORD` 只能用字母、数字、`-`、`_`）

**第 2 步：启动。** 需要 Docker Compose v2（`docker compose version` 能正常输出；群晖 DSM 7.2 的 Container Manager、威联通 Container Station 3 均自带）：

```bash
cd /volume1/docker/family-graph
docker compose pull
docker compose up -d
docker compose ps          # 等 db / backend / web 都变成 healthy
```

群晖 Container Manager：项目 → 新增 → 选择该文件夹；威联通 Container Station：应用程序 → 创建 → 使用 YAML。

**第 3 步：登录。** 浏览器打开 `http://NAS地址:8080`，用 `admin` 和 `.env` 中的 `ADMIN_PASSWORD` 登录，首次登录会要求修改密码。

**升级**：`docker compose pull && docker compose up -d`。数据库会自动迁移，数据保留在 Docker 卷中。

**立即备份一次**：`docker compose run --rm backup now`；备份文件在 `BACKUP_DIR`（默认是 compose 文件所在目录下的 `backups`，仓库里即 `deploy/backups`），每天 `BACKUP_HOUR` 点也会自动备份。

**从源代码构建 / 导出离线镜像**（可选）：

- 推送到镜像仓库（同时构建 x86_64 与 ARM64）：
  ```powershell
  docker login
  .\scripts\publish-images.ps1 -Repo leetaooooo/family-graph
  ```
- 导出为文件（不需要镜像仓库）：生成 `family-graph-images.tar`（约 210 MB，含 PostgreSQL），ARM 架构的 NAS 加 `-Platform linux/arm64`：
  ```powershell
  .\scripts\export-images.ps1
  ```
  把 tar 拷到 NAS，执行 `docker load -i family-graph-images.tar`，并把 `.env` 中的 `IMAGE_REPO` 改为 `family-graph`。

### 部署注意事项

- 数据库与头像存放在 Docker 卷 `db-data`、`media` 中；`docker compose down` 不会删除数据，`down -v` 会。升级时不要执行 `down -v`。
- 首次启动后不要再改 `.env` 里的 `DB_PASSWORD`：Postgres 数据卷里的密码不会跟着变，后端会连不上。确需修改要先进数据库执行 `ALTER USER`，或删卷重来（会丢数据）。改 `SECRET_KEY` 会让所有登录会话失效。
- `ADMIN_PASSWORD` 只在首次初始化时使用；登录后改的密码保存在数据库里，不会回写 `.env`。
- 直接用 `http://` 访问时 `COOKIE_SECURE` 必须为 `false`；通过 HTTPS 反向代理访问时改为 `true`。
- NAS 上 8080 被占用（如 Web Station）时，把 `.env` 中的 `WEB_PORT` 改成其他端口。
- 国内拉取 Docker Hub 较慢或超时：可给 Docker 配置镜像加速，或把三个镜像推到阿里云 ACR，把 `IMAGE_REPO` 改成 `registry.cn-hangzhou.aliyuncs.com/命名空间/family-graph`。
- 地图需要在「系统设置」中重新填写高德 Key，并把 NAS 的访问域名或 IP 加入 Key 白名单。
- 本地开发库的数据可在「管理后台 → 导入导出」导出 JSON，再在 NAS 上导入。

### Docker 命令找不到

如果终端提示 `docker: unknown command: docker compose`（或 `docker buildx`），说明 Docker CLI 没找到 Docker Desktop 自带的插件。在 `%USERPROFILE%\.docker\config.json` 中加入一行后重开终端：

```json
"cliPluginsExtraDirs": ["C:\\Users\\<用户名>\\AppData\\Local\\Programs\\DockerDesktop\\resources\\cli-plugins"]
```

## 前端改版（2026-11）

上一版前端完整备份在 `frontend_backup_20261114/`（只含源代码，不含 `node_modules`）。新前端保留了上一版由家族设计的**李氏图腾 Logo**（`public/logo.svg`，并用于登录页、页头与 favicon），以「纸谱 · 墨线」为视觉主题：宣纸底、墨线、朱砂印，左侧谱签导航，人物关系页改为可拖动缩放的谱系桌面，改为点人物展开其一跳亲缘，不再自动加载。族谱页按 family-chart 的形态重做为横向人物卡片：方形肖像、姓名、生卒、字辈；男/女卡片分别用靛青/绛红淡底，夫妻上方用两枚小色签标记配偶；亲子连线纤细、圆角，世代行铺浅色横带；默认「上下三代」，孙辈及更远分支先折叠，点 + 逐支展开。关系图与族谱中的已故人物统一用**黛青（松烟）**标记：肖像/卡片边框、左侧色条、`故` 印和年份文字，图例可查。后端接口与数据结构未改动。










## 本地开发

后端（Python 3.12+，默认使用 SQLite `backend/data/family.db`）：

```bash
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # Linux/macOS 用 .venv/bin/pip
.venv/Scripts/python -m app.demo                                       # 可选：演示数据
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

前端（Node 20+）：

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 ，/api 代理到 8000
```

Windows 上也可以用一条命令同时启动前后端（自动选用依赖齐全的虚拟环境，等待两个服务就绪，按 Ctrl+C 一起停止）：

```powershell
.\scripts\dev.ps1                                        # 后端 8000、前端 5173
.\scripts\dev.ps1 -BackendPort 8001 -FrontendPort 5191    # 换端口，前端代理会自动跟随
```

也可以双击根目录的 `dev.cmd`（绕过 PowerShell 执行策略），或执行 `dev.cmd -NoReload`。首次运行前仍需完成后端依赖安装与 `npm install`；脚本会依次检查 `backend/.venv`、根目录 `.venv` 和 PATH 中的 Python，跳过依赖不完整的环境。若本机代理导致就绪探测超时，可加 `-SkipChecks`。

API 文档（OpenAPI）：`http://localhost:8000/api/docs`

### 测试

```bash
cd backend && .venv/Scripts/python -m pytest -q        # 169 个用例
cd frontend && npm run build                           # 类型检查 + 构建
```

- `tests/test_kinship.py`：称呼计算器预置测试集，直系 / 旁系 / 姻亲共 150+ 组用例（验收要求 ≥100）。
- `tests/test_api.py`：未登录拦截、CSRF、越权、关系校验（成环、年龄矛盾、重复）、隐私、头像上传、导入导出、审计等。

### 性能基准

```bash
cd backend && DATABASE_URL=sqlite:///./data/bench.db .venv/Scripts/python -m app.demo --large
```

生成 3000 人物、2 万条关系。在开发机上：全量图快照装载约 90 ms（之后按数据版本缓存），关系网展开 1–3 层约 15 ms，称谓计算约 7 ms，均远低于设计文档 2 秒 / 1 秒 / 500 毫秒的指标。关系图改为自绘的 DOM + SVG 谱系桌面：初始只加载谱心的一度亲缘，点某个人物展开其一跳亲缘；同一代人物横向排列，新节点从父节点方向生长并带逐级出现的墨线动画。

## 目录结构

```
backend/
  app/
    main.py            FastAPI 入口、CSRF 与安全响应头
    models.py          Person / Relationship / RelationType / User / KinshipRule / AuditLog / Setting
    services.py        图数据快照与缓存、隐私、关系校验
    kinship/engine.py  族谱图、最短亲属路径（含 Yen 多路径）、称谓解析、世代计算
    kinship/rules.py   默认称谓规则表（关系链 → 称谓，可在后台修改）
    routers/           auth / persons / relationships / graph / admin
    demo.py            演示数据与 3000 人基准数据
  migrations/          Alembic 数据库迁移
  tests/
frontend/
  src/atlas/layout.ts  谱系桌面布局（世代分行、同辈避让、按需增量落位）
  src/styles/          纸谱设计系统（纸色 / 墨线 / 朱砂、组件、图谱、族谱、页面）
  src/tree/layout.ts   族谱树布局（夫妻并排、多段婚姻、收养虚线）
  src/pages/           Network / Tree / Kinship / PersonDetail / Profile / Admin
scripts/               备份与恢复
docker-compose.yml
```

## 关键设计

**统一图模型**：族谱关系只存最基本的直接关系（亲子、收养、继亲、配偶；父母不详时可直接录兄弟姐妹）。兄弟姐妹由“共同父母”推导，叔伯、堂表等全部由称谓规则推导，避免冗余与不一致。两个视图共用同一套 API 与数据，任何一端修改后另一端刷新即可见。

**称呼计算**：在族谱子图上做 BFS 求 A→B 最短亲属路径，路径转成关系链记号（`f` 父、`m` 母、`ob` 兄、`ys` 妹、`s` 子 … 同辈堂表亲附 `&o`/`&y` 区分长幼），再查规则表得到称谓，如 `m,os,s&o` → 表哥。长幼依据出生日期（支持不完整日期）或排行；无法判断时给出“堂兄/堂弟”两种。用 Yen 算法额外找出称谓不同的其他路径（如既是妻子又是表妹），并展示完整推导链路。规则表存在数据库，管理员可在后台增改（为方言称谓预留）。

**关系图布局**：不再使用力导向或 Canvas 图库，改为按“世代”分行的纸面谱系布局——上一代在上、同辈居中、下一代在下；同辈之间按最小间距横向避让，父母/子女分别从上方/下方以曲线相连，配偶用朱线并在中点打结。切换谱心后重新展卷；拖动画布时只展开视野附近、尚未展开的人物，新人物从父节点方向生长入场，边线逐条绘出；点“旁支”可显示非谱心的其他关系。这样既能一眼看清直系亲缘，又不会被整族连线淹没。已故人物在关系图中用黛青肖像边框、`故` 印和黛青年份标记；族谱卡片同样用黛青左侧色条、`故` 印与年份，并在图例中说明。

**文章阅读**：识别「多节古文 + 末尾今译」的文章，按节左右对照排版；左侧原文、右侧今译，诗句保留分行、校注用小字，手机端自动上下排列。没有这种结构的文章仍使用普通正文。

**地图与地理数据**：人物原始历史地名保留在「出生地（旧）」，新增「出生地（今）」；地图按「已故安葬地 > 现居地 > 女性出嫁地（无明确记录时由丈夫地点推断） > 出生地（今/旧） > 籍贯」定位并显示旧地名对照；地图标记使用人物头像（多人地点叠放显示），点击头像右侧打开人物笺；点击人物笺底部的关系人物，会切换右侧人物并自动飞到该人物的地点；首次进入自动聚焦人数最多的地点，并可点「全览」回到全国视角。原 155 个古地名归并为 43 个现代县/乡镇地址（如「大定县」→大方县、「东关公社」→东关乡）；旧小传中提取出 45 位已故人物的安葬地、52 位女性的明确出嫁地（出嫁/出阁/出客）和 74 位女性的推断出嫁地，共 292 人有地点；27 人仍无地址，需补录。已故人物头像在人物页、关系图、族谱和地图地点详情中统一灰色；默认头像采用男性靛蓝底、女性绛红底、已故黛青灰底，剪影统一为米白/墨色高对比。

**权限**：会话存于 HttpOnly + SameSite Cookie，写操作额外要求 `X-Requested-With` 头防 CSRF；密码 PBKDF2-SHA256 加盐哈希；连续 5 次登录失败锁定 15 分钟；改密 / 重置 / 停用后旧会话立即失效。普通成员只能修改自己的资料、维护与自己相关的社会关系；族谱关系仅管理员可改。敏感字段（手机、邮箱、现居地等）可设“全体 / 近亲 / 仅本人”可见。所有增删改写入审计日志（含修改前后字段）。

## 地图与年谱

族谱页面的「地图」「年谱」两个标签页：

- **地图**：使用高德地图 JS API 2.0，按 现居地 > 出生地 > 籍贯 的优先级标注每个人（现居地受隐私设置约束，看不到时自动退回下一项）。同一地点的头像叠放显示，点击头像查看人物；左侧面板可搜索地点或人名，点击地点查看此处的人物。地址由浏览器端调用高德地理编码转成坐标，结果缓存在服务器 `places` 表中，之后打开无需再次解析。
  - 需要管理员在「管理后台 → 系统设置」填写高德 **Web端(JS API)** 的 Key 与安全密钥，并在高德控制台把站点域名加入白名单。
- **年谱**：以时间轴展示出生、结婚、离异、去世事件（结婚/离异取自配偶关系的开始/结束时间），上方曲线为事件密度。支持滚轮缩放、拖动平移、按事件类型或“某人及近亲”筛选，点击事件查看人物详情。

## 文章、农历生日、关系可见性与生日提醒

- **农历生日**：勾选「农历生日」后按 年 + 月（正月…腊月，可选闰月）+ 日（初一…三十）录入，时辰（子…亥）可不填；显示为“农历乙巳年二月初二寅时（2025）”，括号内为农历年份。农历日期存于 `birth_date`（农历年-月-日），`birth_lunar_leap` 标记闰月，`birth_hour` 存时辰地支。农历换算使用 `lunardate`（支持 1900–2099 年）。
- **文章**：顶部导航「文章」。所有成员可阅读、发表；作者本人或管理员可编辑、删除。编辑器可在 Markdown（工具栏 + 分栏预览）与富文本之间切换，切换时自动转换已有内容；渲染前经 DOMPurify 净化。
- **人物简介**：与文章使用同一编辑器，`bio_format` 记录 markdown / html。
- **社会关系（按账号开通）**：朋友、同学、老师等社会关系默认对普通成员隐藏——看不到社会关系类型，也看不到任何社会关系。管理员在「管理后台 → 账号」为某个账号勾选「社会关系」后，该账号才能登记社会关系，且登记的关系只有他本人（和管理员）能看到。关闭后其登记的关系随之隐藏，数据保留，重新开通即恢复。管理员始终可用并可查看全部关系。族谱关系始终对所有人可见。关系网、人物关系、关系列表、路径查询、统计等接口都按此过滤。
- **族谱“血亲”视图**（可在族谱页切换到「血亲旁系」）：显示直系血亲（上下各选定代数）和三代以内旁系血亲——兄弟姐妹、伯叔姑舅姨、堂表兄弟姐妹、侄甥，以及他们的配偶。默认的「上下三代」只显示直系上下与配偶，避免一打开就铺满整个旁系巨树。父母一行左侧为父系、右侧为母系，祖父母 / 外祖父母挂在各自子女上方。堂表兄弟姐妹的子女、侄孙、叔祖等四代旁系不显示；本人没有登记父母时按“沙漏”方式显示。
- **CSV 批量导入**（管理后台 → 导入导出）：先导入人物、再导入关系，两个模板都可在页面下载。人物表支持农历 / 闰月 / 时辰（出生与去世各自独立）、在世、字号、堂号等；日期可写 1960、1960/5/1、1960年5月1日，农历可直接写“1798年闰二月初二寅时”。关系表每行为“人物A 是 人物B 的 [关系]”（父亲、母亲、儿子、妻子、配偶、哥哥…），同名人物写“姓名#出生年”或“#人物编号”。任何一行有错则整个文件不导入并列出行号与原因；同一关系表重复导入会自动跳过已有关系。
- **生日提醒**：页头铃铛列出 30 天内过生日的在世人物（角标为 7 天内未读），区分农历 / 公历，农历生日换算为今年对应的公历日期。受隐私设置保护、当前用户看不到完整生日的人物不会出现。接口：`GET /api/notifications/birthdays?days=30`。

## 备份与恢复

`backup` 服务每天 `BACKUP_HOUR` 点（按 `TZ` 时区，默认北京时间）把数据库（`pg_dump`）和头像文件打包到 `BACKUP_DIR/<时间戳>/`，保留 `BACKUP_KEEP_DAYS` 天。NAS 上立即备份一次：`docker compose run --rm backup now`。

```bash
./scripts/backup.sh                                # 立即备份一次
./scripts/restore.sh backups/20261021-030000       # 从指定备份恢复（会覆盖当前数据）
```

管理后台“导入导出”还可导出 / 追加导入全部数据的 JSON，以及用 CSV 批量导入人物（提供模板下载）。

## V1.0 范围说明

已实现：设计文档中 V1.0 的全部 P0 需求，以及部分 P1（登录限流锁定、关系类型字典、审计日志、字段级可见范围、两人关系路径查询、关系需对方确认开关、人物列表与简单统计、族谱图导出 PNG）。

尚未实现（按设计文档列入 V1.x 及以后）：相册与照片人物标注、人物事件、GEDCOM 导入导出、更正申请流程、重复人物合并、审计回滚、WebSocket 实时推送（当前为切换视图 / 刷新时重新拉取）、方言称谓规则集、PDF 导出。
