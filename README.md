# PoloX Open Source

A local AI creative workspace for image and video generation, Agent conversations, and an infinite canvas. Built with Nuxt, Vue, and SQLite, PoloX connects to OpenRouter and fal using your own API keys and keeps projects, generation history, conversations, and media on your machine. There are no accounts, login screens, subscriptions or account credit balances.

PoloX 是一个本地运行的 AI 创作工作台，将图片与视频生成、Agent 对话和无限画布整合到同一个项目空间。通过自己的 OpenRouter 和 fal API 密钥连接模型服务，项目、生成记录、对话与媒体文件保存在本地，无需注册或订阅应用账号。模型推理使用外部服务，相关输入会发送给服务提供商，API 使用费用由提供商收取。

## Features

- **AI image and video generation** — connect to fal models with your own API key.
- **Agent workspace** — use OpenRouter-powered conversations to plan and execute creative tasks.
- **Infinite canvas** — arrange and manage creative assets within each project.
- **Local storage** — persist projects, conversations, and generation history in SQLite, with media saved on disk.
- **Creative tools and exports** — work with image layers and text, stitch videos, and export media or ZIP archives.

Model inference uses external providers: relevant inputs are sent to OpenRouter or fal, and provider API charges apply.

## Run locally

Use Node.js 22.20 or newer and pnpm.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3001. Click Service connection in the top-right corner to enter your OpenRouter API key, model name and fal API key, then click Test connection. Both tests must pass before the indicator turns green. Credentials are stored in the local SQLite database and never returned to the browser. Generation approval remains available; there is no login or balance check.

## Local data

SQLite is created automatically at `.data/polox.sqlite`. The application reads one local dataset, with no MongoDB connection and no automatic import of the original service's data.

Stop the server before backing up or moving the database. If copying while it is running, use SQLite's backup mechanism so the WAL is included. Preserve the `.data` directory across deployments. Workspace routes are accessible without authentication, so run this as a local or otherwise privately accessible application.

## Verify and build

```sh
pnpm test:sqlite
pnpm test:media
pnpm build
pnpm preview --port 3001
```

The SQLite tests use temporary databases and cover persistence, atomic task claims, rollback, history deduplication and pagination. Provider API usage and local file storage are independent of SQLite.

Built on the Nuxt Shadcn Dashboard template. See LICENSE for the software license.


## Local media and background tasks

Uploads, generated results, Agent attachments, stitched videos and ZIP exports are saved under `.data/media` in this project. Nuxt serves them at `/media/...`, including HEAD requests and byte ranges for video playback. Input files are also uploaded to the fal CDN using the server-side fal SDK and the same fal API key. Generated results remain stored locally. The generation resume loop and Agent tasks run inside the same Nuxt process and use the same local writer.

Local media is served at `http://localhost:3001`. Before generation, local input URLs are automatically copied to the fal CDN so external models can read them without a tunnel. The Serverless private-file upload API is not used: its authenticated files are unsuitable as public model inputs.

Back up both `.data/polox.sqlite` and `.data/media`; preserve `.data` across rebuilds and deployments. Previously stored remote files are not downloaded automatically. The homepage's remote video background has been replaced with a local CSS background.

All projects and conversations belong to this local installation. No identity or tenant parameter is stored or required. Existing local database records are upgraded automatically while preserving project IDs, conversations and media URLs. Projects are available at `/projects`.
