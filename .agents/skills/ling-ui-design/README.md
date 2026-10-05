# Ling UI Design

A visual-first Agent Skill for text-to-code and screenshot-to-code development,
using image generation, layer decomposition, and asset extraction before
implementation, followed by browser-based visual verification.

[SKILL.md](SKILL.md) defines the execution workflow, asset acceptance criteria, and
retry limits. Supporting references are loaded as needed.

## Workflow

- **Text-to-code:** select a visual direction, generate and inspect a reference,
  then follow the screenshot-to-code path. Use a preset, a custom style, or no preset.
- **Screenshot-to-code:** inspect the reference, decompose layers, extract and
  review asset candidates, complete the pre-implementation checklist, then implement.
- **Verification:** render at the target viewports, inspect screenshots, correct
  material mismatches, and verify interactions and asset loading.

Resolve material raster assets before implementation. Automatic crops require
visual acceptance; a reference screenshot must never replace page layout in code.
The brief governs content and behavior. Visual references guide appearance.
Skip a model-backed stage only with explicit user direction; do not silently
substitute direct coding when a service is unavailable.

## Installation

Python 3.10+ is required for the helper scripts.

Enter the skill directory, replacing the example path with its actual location:

```bash
cd path/to/ling-ui-design
```

Then run one of the following from that directory:

```bash
# Project scope
python scripts/install.py --scope project --project-root /absolute/path/to/app

# User scope
python scripts/install.py --scope user
```

Project scope installs for one project; user scope installs for the current user.
The default location follows the `.agents/skills` convention. Use `--harness claude`
for `.claude/skills`, or `--destination` for a custom skill path. The installer uses
symlinks by default, so keep the source directory in place. Use `--mode copy` for a
self-contained installation that excludes local credentials. Existing destinations
are not overwritten. Run `python scripts/install.py --help` for all options.

After installation, run the configuration and dependency commands below from the
installed skill directory. With `--mode copy`, this is the installation destination,
not the downloaded source directory.

## Configuration

Create a personal API key at [Novita](https://novita.ai/).
Set it as `LING_UI_DESIGN_API_KEY` for
image generation and layer decomposition.

Choose either configuration method:

- **Environment:** run `export LING_UI_DESIGN_API_KEY='<your-api-key>'` in the shell
  that launches the agent (PowerShell: `$env:LING_UI_DESIGN_API_KEY='<your-api-key>'`).
- **File:** set `LING_UI_DESIGN_API_KEY=<your-api-key>` in the installed skill's `.env`.
  The bundled installer creates this file; `python scripts/configure.py --init`
  also creates it without overwriting existing configuration.

Environment values take precedence. From the skill root, verify configuration before
the first service request:

```bash
python scripts/configure.py --check
```

The check verifies key presence, not validity or service connectivity. If the key is
missing, it exits with status 1 and provides the key-creation guide and configuration
instructions. Do not share the key in chat.

The default API base is `https://api.novita.ai/openai/v1/`. The default model IDs
are `ming-image-0.1-design` and `ming-image-0.1-design-layer`.
For a compatible service, override `LING_UI_DESIGN_API_BASE`,
`LING_UI_DESIGN_IMAGE_MODEL`, `LING_UI_DESIGN_DECOMPOSE_MODEL`, and
`LING_UI_DESIGN_API_KEY` in `.env` or the process environment. Resolution and timeout
settings are listed in [.env.example](.env.example).
Keep credentials out of prompts, command arguments,
logs, and version control. Never serve or deploy the skill directory or its `.env`.

## Runtime

Use a Python environment with the declared dependencies. To create an isolated
environment in the installed skill directory:

```bash
python -m venv .venv
.venv/bin/python -m pip install -e .
```

On Windows, use `.venv\Scripts\python.exe` instead of `.venv/bin/python`.

Run task commands from the **target application root**, using that Python environment
and absolute paths to the installed skill's scripts. Set `LING_UI_DESIGN_SKILL_ROOT` to
that skill path. Store references, layers, crops, and previews in the application's
`artifacts/`; copy accepted assets to its `assets/`. Do not write task outputs into
the skill directory.

Use an available harness browser or Playwright integration for visual verification.
See [visual validation](references/visual-validation.md) for supported routes and commands.

To invoke the workflow: `Use ling-ui-design to build a responsive museum landing page.`

## Development validation

From the skill directory, using its Python environment:

```bash
python -m pip install -e '.[test]'
python -m pytest
```

The tests do not call live services. If available, run `skills-ref validate .` to
validate the skill manifest.

## License

This project is licensed under the [MIT License](LICENSE).
