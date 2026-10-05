<p align="right">
  <b>English</b> | <a href="README-zh.md">简体中文</a>
</p>

# Image to Editable PPT

Recreate one slide image, screenshot, or AI-rendered page as one editable PowerPoint slide. Ordinary text becomes text boxes, simple containers become native shapes, and complex artwork becomes tightly cropped images.

The workflow needs a strong model. The agent has to inspect the image, choose the layer split, accept or reject each layer, and author `scene.json`.

## Install

Copy this directory into the tool's skills folder and keep the folder name `image-to-editable-ppt`:

| Tool | Path |
|---|---|
| Codex | `~/.codex/skills/image-to-editable-ppt` |
| Claude Code | `~/.claude/skills/image-to-editable-ppt` |
| Cursor | `~/.cursor/skills/image-to-editable-ppt` |

For one project, use that project's `.codex/skills/`, `.claude/skills/`, or `.cursor/skills/`.

Requires Python 3.9+. If an import is missing, install the declared dependencies from this directory:

```bash
python3 -m pip install -r requirements.txt
```

Copy `.env.example` to `.env` in this directory and replace the API key. Do not commit `.env` or pass the key on the command line. The layer API is [Ming Image Layer Decoupling](https://docs.novita.ai/api-reference/model-apis-ming-image-layer):

```bash
LING_BASE_URL=https://api.novita.ai/openai/v1
LING_API_KEY=sk_xxx
LING_MODEL=ming-image-0.1-design-layer
```

## Use

Give the agent the source image and name this skill. For example:

```text
Use $image-to-editable-ppt to recreate this slide image as an editable PowerPoint.
```

You can also say "turn this slide image into an editable PPT." A matching description selects the skill automatically.

It converts one reference image into one slide. Do not use it for ordinary presentation writing, text-to-deck authoring, or replication when transparent layers are already provided.

## License

This project is licensed under the [MIT License](LICENSE).
