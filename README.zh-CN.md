<p align="center">
  <img src="public/brand/polox-logo.png" alt="PoloX AI 标志" width="140" />
</p>

<h1 align="center">PoloX AI — Multimodal AI Agent</h1>

<p align="center">
  基于 DeepSeek Harness 构建的开源多模态 AI Agent 平台。
</p>

<p align="center">
  <a href="LICENSE">MIT 协议</a>
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

## 简介

本项目是 [PoloX AI](https://polox.ai) 的开源版本，与 [Lovart](https://lovart.ai)、[Crepal](https://crepal.ai) 同属 AI 创作平台。PoloX 采用 **Agent 原生**的产品设计：以 Agent 对话与无限画布承载全部交互，将创作、生成与编辑融入连续的工作流程。你只需描述想法，与 Agent 沟通，并在画布上持续完善结果。

PoloX 基于 Nuxt、Vue 和 SQLite 在本地运行。使用自己的 OpenRouter 和 fal API Key 即可，无需注册 PoloX 账号或订阅。项目、对话、生成记录和媒体文件保存在本机；AI 推理由外部服务提供，相关输入会发送给服务商，API 使用费用由服务商收取。

## 使用 Codex 安装

在 Codex 中创建一个新任务，发送以下内容：

```text
请帮我在本地安装 PoloX AI：
1. 检查是否已安装 Node.js 22.20 或更新版本，以及 pnpm；如有缺失，请安装。
2. 安装 FFmpeg（包含 ffprobe），用于视频拼接，并确认这两个命令可用。
3. 克隆 https://github.com/saihhold-zhao/polox_ai 并进入项目目录。
4. 执行 pnpm i 安装依赖。
```

## 使用 Codex 本地运行

每次使用时，在 Codex 中打开本项目，发送：

```text
请在本项目中执行 pnpm dev，并在浏览器中打开本地页面。使用期间请保持服务运行。
```

默认地址为 [http://localhost:3001](http://localhost:3001)。**日常本地使用无需执行 `pnpm build`。**

## 手动运行

请先安装 **Node.js 22.20 或更新版本**和 **pnpm**。首次运行：

```sh
git clone https://github.com/saihhold-zhao/polox_ai.git
cd polox_ai
pnpm i
pnpm dev
```

之后每次使用，只需在项目目录中打开终端，执行：

```sh
pnpm dev
```

打开 [http://localhost:3001](http://localhost:3001)，使用期间保持终端运行。按 `Ctrl+C` 可停止服务。

### 安装 FFmpeg：用于视频拼接

将生成的视频片段拼接成长视频，需要安装 **FFmpeg 和 ffprobe**。普通上传和 AI 生成不依赖它们，`pnpm i` 也不会自动安装它们。

macOS（使用 Homebrew）：

```sh
brew install ffmpeg
```

Ubuntu / Debian：

```sh
sudo apt update
sudo apt install ffmpeg
```

Windows 用户请安装同时包含这两个工具的 FFmpeg 版本，并将其 `bin` 目录加入 `PATH`。在启动 PoloX 的终端中验证：

```sh
ffmpeg -version
ffprobe -version
```

安装完成后，请重新启动开发服务。

## 获取并配置 OpenRouter 和 fal API Key

1. 启动 PoloX，点击右上角红色的 **API keys not configured**（尚未配置 API Key）提示。
2. 在 **Service connection**（服务连接）弹窗中，通过 **Get API key** 链接获取 [OpenRouter Key](https://openrouter.ai/workspaces/default/keys) 和 [fal Key](https://fal.ai/login?returnTo=%2Fdashboard%2Fkeys)。
3. 将两个 Key 分别填入对应输入框，点击 **Test connection**（连通测试）。
4. 两项测试通过后，提示会变为绿色的 **Services connected**（服务已连接），即可开始创作。

默认 Agent 模型为 **DeepSeek V4 Flash Vision Exp**（`deepseek/deepseek-v4-flash-vision-exp`），在维护者的测试中表现良好。你可以在同一弹窗中修改 OpenRouter 模型。连通测试会发送一次简短的模型请求，可能产生少量 API 费用。

## 已接入的 AI 模型

首页的 **Frontier AI models** 区域展示了已接入的模型。如果希望 Agent 使用特定模型，请在消息中通过 **@** 选择并指定。

## 实用工具

| 工具 | 功能与用法 |
| --- | --- |
| **Image Text Editor · 图片文字编辑** | 编辑图片中的文字。可以直接询问 PoloX Agent 如何操作；支持一次上传多张图片进行批量编辑。 |
| **Image Layer Splitter · 图片图层拆分** | 将图片中指定的元素提取为独立图层。上传图片并告诉 Agent 你想拆分哪些元素，Agent 会引导你选择元素或绘制选框。 |
| **Image Background Removal · 图片去背景** | 移除上传图片的背景，保留透明 PNG。 |
| **AI Image Editor · AI 图片编辑** | 上传图片，用自然语言描述修改需求，通过图生图（image-to-image）模型完成编辑。 |
| **AI Video Editor · AI 视频编辑** | 上传视频，用自然语言描述修改需求，通过参考生视频（reference-to-video）模型完成编辑。 |

## 长视频生成

你可以让 Agent 制作 5 分钟、10 分钟或更长的视频。它会调用 AI 视频模型生成多个分镜片段，再通过 FFmpeg 拼接成连续视频。维护者目前已测试 10 个 5 分钟的视频，结果符合预期；这套工作流仍处于早期阶段，实际效果取决于所选模型和创作需求。

典型流程如下：

1. **规划分镜**：Agent 根据你的描述，规划场景与镜头内容。
2. **确定角色形象**：生成角色参考图，例如角色三视图。你也可以上传自己的角色图片，并明确要求使用该形象。
3. **生成分镜首帧**：以角色参考图为基础，为各分镜生成首帧图片，帮助保持角色的视觉一致性。
4. **生成视频片段**：调用视频模型，根据分镜与参考图生成各个片段。
5. **拼接完整视频**：所有片段完成后，按分镜顺序自动拼接。

视频拼接完成后，你仍可以通过对话要求 Agent 修改镜头或补充场景，整个创作过程都可以围绕与 Agent 的沟通展开。

这套流程由[长视频生成 Skill](server/agent/skills/long-form-video.md) 定义，还有较多优化空间，例如引入声音参考以保持角色声音一致。欢迎通过 [Issue](https://github.com/saihhold-zhao/polox_ai/issues) 提出建议或参与改进。

## 问题排查与反馈

安装或使用过程中遇到问题，可以先让 Codex 检查报错并协助解决。提供相关错误信息，以及问题发生前的操作，有助于定位原因。

如果发现值得修复的问题，或有对其他用户也有帮助的建议，欢迎[提交 Issue](https://github.com/saihhold-zhao/polox_ai/issues)。不熟悉操作也没关系，可以让 Codex 帮你整理并提交。请附上复现步骤、操作系统和相关日志，并在分享前删除 API Key 等私密信息。

## 本地数据

SQLite 数据库保存在 `.data/polox.sqlite`，媒体文件保存在 `.data/media`。请停止服务后备份整个 `.data` 目录，以保留项目和文件。API Key 也保存在本地数据库中，请妥善保管备份。

本版本面向本地使用，工作区接口无需身份验证，请在本机或私有网络中运行。

## 使用到的开源项目

感谢以下项目为 PoloX 提供基础：

| 用途 | 项目 |
| --- | --- |
| 应用框架 | [Nuxt](https://github.com/nuxt/nuxt) |
| UI 基础 | [shadcn/ui](https://github.com/shadcn-ui/ui) 及其 Vue 生态 |
| UI 模板 | [nuxt-shadcn-dashboard](https://github.com/dianprata/nuxt-shadcn-dashboard) |
| Agent Harness | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) |

## 开源协议

本项目采用 [MIT 协议](LICENSE)，并保留第三方项目原有的版权与许可声明。
