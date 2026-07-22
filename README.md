# 轻盈 - AI 减肥与记重助手

响应式 AI 体重记录 Web 应用。用户必须先完成管理员登录，登录后通过 AI 识图新增每日体重记录，查看动态趋势、目标进度、历史明细和虚拟奖励。服务端调用支持视觉的大模型识别体重，系统只接受达到 85% 可信度门槛的结果，用户确认后按减重数额发放虚拟奖励。

工作台支持修改起始体重和目标体重、覆盖同一天的记录、删除误记录，以及在近 7 次和近 30 天两种趋势范围间切换。所有指标均由历史记录实时计算，不使用固定展示数值。

## 架构

- 浏览器：React、Vite、Tailwind CSS、Shadcn UI、Radix UI、Lucide 和 Recharts。
- 服务端：Node.js 22.5+、内置 SQLite，托管静态页面并代理大模型请求。
- 大模型：兼容 OpenAI Chat Completions 的视觉接口，默认使用[凌云 API 识图接口](https://yunai.apifox.cn/api-487299942)。
- 部署：单容器运行，管理员在系统界面配置 API Key，服务端加密持久化。
- 权限：工作台和识图接口均要求有效管理员会话，退出后立即返回登录页。

## 项目结构

```text
.
├── src/                 # React 前端
│   ├── components/ui/   # Shadcn UI 本地组件
│   ├── components/      # 业务组件
│   ├── lib/             # API 与通用工具
│   ├── App.jsx
│   └── index.css
├── server/
│   ├── server.js        # HTTP 服务、AI 代理和管理员接口
│   ├── auth.js          # 管理员会话与登录限流
│   └── system-store.js  # 密码哈希、配置加密与持久化
├── test/                # Node 自动化测试
├── components.json      # Shadcn UI 配置
├── vite.config.js
├── tailwind.config.js
├── Dockerfile
├── compose.yaml
└── .env.example
```

## GitHub Docker 镜像

项目通过 GitHub Actions 自动构建 `linux/amd64` 和 `linux/arm64` 镜像并发布到 GitHub Container Registry：

```text
ghcr.io/rise-001/jfrj:latest
```

以下操作会触发镜像构建：

- 推送到 `main`：发布 `latest` 和 `sha-<提交号>` 标签。
- 推送 `v*` 版本标签：发布对应版本标签，例如 `v1.0.0`、`1.0.0` 和 `1.0`。
- Pull Request：仅验证镜像可以构建，不发布镜像。
- 在 GitHub Actions 页面手动运行 `Build and publish Docker image`。

首次发布后，可在 GitHub 仓库的 Packages 页面将镜像可见性设置为 Public，服务器即可免登录拉取。

## Docker 部署

服务器需要预先安装 Docker Engine 和 Docker Compose v2。部署步骤：

1. 拉取项目并进入目录：

   ```bash
   git clone https://github.com/rise-001/JFRJ.git
   cd JFRJ
   ```

2. 创建配置文件：

   ```bash
   cp .env.example .env
   ```

3. 可按需编辑 `.env` 中的端口和会话配置。API Key 不需要写入文件；首次登录后可在系统设置中保存。

4. 拉取 GitHub 已构建的镜像并启动：

   ```bash
   docker compose pull
   docker compose up -d --no-build
   ```

   如需在服务器上从源码重新构建，可改用：

   ```bash
   docker compose up -d --build
   ```

5. 确认服务健康：

   ```bash
   docker compose ps
   curl http://127.0.0.1:3000/health
   ```

6. 在云服务器安全组或防火墙中放行 TCP `3000` 端口，然后打开 `http://服务器IP:3000`：

   - 首次使用时创建至少 8 位的管理员密码。
   - 登录后填写 API 地址、视觉模型和 API Key。
   - 保存后即可直接上传截图识别体重。

   查看实时日志：

   ```bash
   docker compose logs -f qingying
   ```

升级部署：

```bash
git pull
docker compose pull
docker compose up -d --no-build
docker image prune -f
```

模型设置、管理员密码和体重数据保存在 `qingying-data` Docker 卷中，不会因重建容器丢失。可使用以下命令备份数据卷：

```bash
docker run --rm -v qingying-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/qingying-data-backup.tar.gz -C /data .
```

生产环境建议由 Nginx 或 Caddy 反向代理到 `127.0.0.1:3000` 并启用 HTTPS；启用 HTTPS 后应将 `.env` 中的 `COOKIE_SECURE` 设置为 `true`。

## 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_PORT` | `3000` | Docker 映射到宿主机的端口 |
| `AI_API_URL` | `https://yunllm.com/v1/chat/completions` | Chat Completions 完整地址 |
| `AI_API_KEY` | 空 | 可选的环境变量备用 Key；推荐在系统界面配置 |
| `AI_MODEL` | `gpt-4o` | 支持图片输入的模型名称 |
| `AI_TIMEOUT_MS` | `45000` | 上游调用超时，单位毫秒 |
| `AI_JSON_MODE` | `true` | 是否发送 `response_format: json_object`；模型不支持时设为 `false` |
| `MAX_IMAGE_BYTES` | `8388608` | 图片最大字节数，默认 8 MB |
| `MAX_BODY_BYTES` | `12582912` | HTTP 请求体最大字节数，默认 12 MB |
| `ADMIN_PASSWORD` | 空 | 可选的初始管理员密码；留空时由首次访问创建 |
| `SESSION_HOURS` | `12` | 管理员登录有效时间 |
| `COOKIE_SECURE` | `false` | 仅通过 HTTPS 部署时设为 `true` |
| `CONFIG_SECRET` | 空 | 可选的固定加密密钥；留空时在数据卷自动生成 |
| `DATA_DIR` | `项目/data` | 加密配置存储目录，容器内为 `/app/data` |

可以在系统设置中替换为其他 OpenAI 兼容视觉模型。API Key 不会返回给浏览器，只显示末四位掩码；服务端使用 AES-256-GCM 加密保存，管理员密码使用 scrypt 哈希保存。请同时备份完整的 `qingying-data` 卷，因为自动生成的加密密钥也位于其中。

## 本地运行与测试

需要 Node.js 22.5 或更高版本（使用内置 `node:sqlite`）。首次安装：

```bash
npm install
```

开发模式使用两个终端：

```bash
# 终端 1：API 服务（3000）
npm run dev:server

# 终端 2：Vite 页面（5173）
npm run dev
```

访问 `http://127.0.0.1:5173`。Vite 会自动代理 `/api` 到后端。

生产模式：

```bash
npm run build
npm start
```

访问 `http://127.0.0.1:3000`。测试命令：

```bash
npm test
```

从右上角系统设置完成首次初始化并填写 Key。本地加密配置保存在 `data/`，该目录已加入 `.gitignore`。

## 接口

- `GET /health`：容器健康状态，不返回密钥。
- `GET /api/config`：前端可见的模型配置状态，不返回密钥。
- `POST /api/recognize-weight`：接收 `{ "image": "data:image/png;base64,..." }`，返回 AI 识别结果和一次性 `recognitionId`，可信度低于 85% 的结果会被拒绝。
- `GET /api/dashboard`：读取 SQLite 中的目标、AI 记录和钱包，需要登录。
- `POST /api/weight-records/confirm`：使用一次性 `recognitionId` 确认写入 SQLite，需要登录；不接受体重数值。
- `DELETE /api/weight-records/:id`：删除一条 AI 记录，需要登录。
- `PUT /api/dashboard/profile`：保存起始体重和目标体重，需要登录。
- `GET /api/admin/status`：管理员初始化、登录和模型配置状态。
- `POST /api/admin/setup`：首次创建管理员密码。
- `POST /api/admin/login`、`POST /api/admin/logout`：管理员登录与退出。
- `GET/PUT /api/admin/settings`：读取掩码配置或保存模型配置，需要登录。
- `PUT /api/admin/password`：修改管理员密码，需要登录。

体重目标、AI 识别产生的记录和奖励账本保存在 `DATA_DIR/qingying.sqlite` SQLite 数据库中，浏览器不再保存业务数据。新版不生成演示数据，也不会导入旧版固定趋势数据，首次使用时趋势和钱包均为空。SQLite 文件位于 Docker 数据卷内，备份该数据卷即可迁移记录。若要支持多用户，应为记录增加用户 ID 和权限隔离。
