<p align="right">
  <a href="README.md">English</a> | <b>简体中文</b>
</p>

# Image to Editable PPT (图片转可编辑 PPT)

将单张幻灯片图片、截图或 AI 生成的演示页面，逆向重建为一份元素完全可编辑的 PowerPoint (`.pptx`) 幻灯片。普通文本转换为原生文本框，简单容器转换为原生形状，复杂插画与视觉元素则通过图层解耦精准裁剪为可独立移动、缩放与替换的位图素材。

该工作流依赖具备强视觉空间解构能力的模型（如 `Ming-Image-0.1-Design-Layer`）。Agent 会审阅输入图片，制定图层切分策略，审查并接收/拒绝各图层，最终生成结构化的 `scene.json` 并编译为 PPTX。

## 安装

将当前目录复制到对应 Agent 工具的 skills 目录中，并保持目录名为 `image-to-editable-ppt`：

| 工具 | 推荐安装路径 |
| :--- | :--- |
| Codex | `~/.codex/skills/image-to-editable-ppt` |
| Claude Code | `~/.claude/skills/image-to-editable-ppt` |
| Cursor | `~/.cursor/skills/image-to-editable-ppt` |

如仅在单个项目中使用，可直接放置于项目根目录下的 `.codex/skills/`、`.claude/skills/` 或 `.cursor/skills/` 中。

环境要求 Python 3.9+。如缺少依赖，请在当前目录下执行安装：

```bash
python3 -m pip install -r requirements.txt
```

在当前目录下复制 `.env.example` 为 `.env`，并配置 `LING_BASE_URL`、`LING_MODEL` 与 `LING_API_KEY`。切勿将 `.env` 提交至代码仓库，也切勿在命令行参数中明文传递密钥。

## 使用方式

向 Agent 提供参考图片并显式调用本 Skill，例如：

```text
使用 $image-to-editable-ppt 将这张幻灯片图片重建为可编辑的 PowerPoint。
```

也可以直接表述为：*“将这张幻灯片图片转换为可编辑 PPT”*，系统会根据任务描述自动命中该 Skill。

## 适用边界

本 Skill 专用于将**单张参考图像逆向还原为单页原生幻灯片**。请勿用于以下场景：
- 普通文本大纲扩写或整套 Deck 生成；
- 原始分层矢量素材已完整具备的场景；
- 脱离原图参考的开放式文生图。

## 开源许可证 (License)

本项目采用 [MIT License](LICENSE) 许可证发布。
