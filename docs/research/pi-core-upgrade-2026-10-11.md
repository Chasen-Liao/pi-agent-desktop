# Pi SDK 升级 0.99.1 → 1.1.0 调研与实施记录

> 日期：2026-10-11（Asia/Shanghai）。基线为本项目升级前锁定并实际安装的 0.99.1；目标为 npm `latest` 的 1.1.0。本次已修改依赖与锁文件、跑通类型检查 / lint / 全量测试（668/671 通过，唯一失败为既有环境抖动），未做正式三平台打包验证。
> 来源：npm 官方 registry、上游 `earendil-works/pi` 固定 `v1.1.0` 标签的 changelog 与源码入口、本项目接入代码。上游 changelog 日期与 npm 发布时刻分别记录，不混用时区。

## 结论

把三个直接依赖 `@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-mcp` 一起升到 **1.1.0**。这是一次**跨 1.0 大版本**的跳跃（0.99.1 → 1.0.0 → 1.1.0）。初次升级只修改了 Azure 图标常量；2026-10-12 用真实 SDK 核查后，还发现桌面自定义 MCP loader 需要适配新增的 provider 凭据边界和项目级部分覆盖，现已补齐实现与回归测试。初次类型检查与 lint 通过，全量测试 668/671 通过（唯一失败为既有的 Windows 进程树抖动，详见「验证」一节）；后续修复验证单独记录。

上一轮升级记录：[pi-core-upgrade-2026-09-30.md](pi-core-upgrade-2026-09-30.md)（0.84.3 → 0.99.1）。

## 版本与发布时间

| 包 | 升级前 | 升级后 | npm 发布时间 UTC | Node 要求 |
|---|---|---|---|---|
| pi-ai | 0.99.1 | 1.1.0 | 2026-10-07T22:12:10Z | >=22.19.0 |
| pi-coding-agent | 0.99.1 | 1.1.0 | 2026-10-07T22:16:27Z | >=22.19.0 |
| pi-mcp | 0.99.1 | 1.1.0 | 2026-10-07T22:14:40Z | >=22.19.0 |
| pi-agent-core / pi-tui / pi-codemode / chord（传递依赖） | 0.99.1 | 1.1.0 | 同上 | >=22.19.0 |

时间来自各 registry 文档 `time["1.1.0"]`，版本来自 `dist-tags.latest`。本机 Node v24.16.0 满足要求。1.1.0 相对 0.99.1 的 manifest 新增直接依赖 `brace-expansion@5.0.12`（上游为修 GHSA-q2hr-2g5m-vwhr 等漏洞而钉版本）。

## 破坏性变更命中评估

| 上游变更 | 本项目是否触达 | 证据 |
|---|---|---|
| pi-agent-core 1.0.0 删除 experimental harness、`./node` / `./harness/*` / `./experimental/pico3` 子路径导出 | **否** | 全仓无 `@earendil-works/pi-agent-core` 导入，仅传递依赖 |
| pi-ai 1.1.0 要求 stream 函数返回 `AssistantMessageEventStream` | **否** | 无自定义 provider / stream 实现；`lib/pi-runtime.ts` 只做只读 `getProviders()` |
| pi-tui 1.1.0 `Terminal` 须实现 `setProgramStatus` | **否** | 无 Terminal 实现，pi-tui 仅传递依赖 |
| pi-mcp 1.0.1 `OAuthClientProvider.clientMetadataUrl` → `clientMetadataDocument` | **否** | 无 `OAuthClientProvider` 引用；`lib/mcp-config.ts` 只透传 `oauth` JSON 字段 |
| coding-agent `agent_settled` 新增必填 `aborted` 字段 | **没有新增类型实现要求** | `lib/rpc-manager.ts` 使用本地事件类型；新增字段本身不改变现有分派条件，取消、排队与 settled 行为仍须通过测试确认，不能仅凭不报类型错误判断兼容 |
| **Azure provider 改名 `azure-openai-responses` → `azure`** | **是** | `components/models-config/PROVIDER_ICONS.tsx` 以旧 id 为 key，改名后图标失配（已修正） |
| **深层 dist 导入** `dist/core/export-html/index.js` | **是（脆弱）** | `lib/session-export.ts` 直接 import 该未文档化路径；1.1.0 该文件与内部结构仍存在，测试通过 |
| MCP 0.99.2 `auth.provider` | **是（运行时）** | 桌面自定义 loader 绕过原生全局配置限制，需拒绝项目凭据引用并限制凭据目标为 HTTPS / loopback HTTP |
| MCP 1.0.1 项目级部分覆盖 | **是（运行时）** | 原 loader 整项覆盖丢失全局连接字段；现仅合并 enabled/exposure/toolExposure，并保留 source/override/projectConfig |

### 值得关注的 1.0 / 1.1 改动（对本项目有间接价值）

| 版本 | 对桌面端的价值 |
|---|---|
| 1.0.0，2026-10-01 | Codemode 提示词 token 降约 40%；codemode 支持图像生成；MCP OAuth 加固（per-server 凭证、`iss` 校验、step-up 登录）；Anthropic copy-code 登录支持无头环境。 |
| 1.0.1，2026-10-03 | MCP 项目级 override（`.pi/mcp.json` 可对用户级服务只改 enabled/exposure）；`pi.registerToolRenderer()` 可为任意工具（含尚未注册的 MCP 工具）定义渲染；钉 `brace-expansion@5.0.12` 修漏洞。 |
| 1.0.3，2026-10-05 | Azure provider 改名（见上）；codemode `image()` 落盘临时文件并回传路径。 |
| 1.1.0，2026-10-07 | `--tools +name/-name` 增量调整默认工具；`agent_settled` 新增 `aborted`；tool render context 与 `tool_execution_end` 新增 `durationMs`；MCP OAuth 全链路可取消 + 请求超时；`/mcp` 实时可用；Claude Haiku 5.5。 |

来源：[coding-agent CHANGELOG](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/CHANGELOG.md)、[pi-ai CHANGELOG](https://github.com/earendil-works/pi/blob/v1.1.0/packages/ai/CHANGELOG.md)、[pi-agent-core](https://github.com/earendil-works/pi/blob/v1.1.0/packages/agent/CHANGELOG.md)、[pi-tui](https://github.com/earendil-works/pi/blob/v1.1.0/packages/tui/CHANGELOG.md)、[pi-mcp](https://github.com/earendil-works/pi/blob/v1.1.0/packages/mcp/CHANGELOG.md)。

## 实际改动

| 类别 | 文件 | 动作 |
|---|---|---|
| 依赖 | `package.json` | 三包 `^0.99.1` → `^1.1.0` |
| 依赖 | `package-lock.json` | `npm install` 重生成，闭包全部升到 1.1.x |
| 代码 | `components/models-config/PROVIDER_ICONS.tsx` | Azure key `azure-openai-responses` → `azure` |
| 代码（2026-10-12） | `lib/mcp-config.ts` | 统一 UI / runtime 合并逻辑；校验 provider 认证范围、HTTPS 和项目部分覆盖 |
| 测试（2026-10-12） | `lib/mcp-config.test.ts` / `lib/desktop-native-runtime.test.ts` | 配置拒绝、保存拒绝、覆盖继承与真实 SDK 会话回归 |
| 文档 | `docs/ARCHITECTURE.md` / `docs/architecture.html` | 版本号 0.84.3 → 1.1.0（该两文件此前滞后两轮，一并修正） |
| 文档 | `.zread/wiki/versions/2026-10-06-001245/*` → `docs/wiki/content/*` | 版本号 0.99.1 → 1.1.0，`npm run sync:wiki-pages` 同步 |

**未修改**的接入文件：`lib/rpc-manager.ts`（继续调用修复后的 MCP loader）、`lib/pi-runtime.ts`、`lib/session-export.ts`（深层路径 1.1.0 仍存在）。Azure 还需要迁移 `auth.json`、`models.json.providers` 及 `settings.json` 的 `defaultProvider`、`enabledModels`、`modelThinkingLevels`；API id `azure-openai-responses` 不改。恢复旧会话可能回退到其他模型并失去原提示词缓存，应用不自动改写用户认证与历史文件。

## 打包与构建触点核查（预期无需改，已确认）

- `next.config.ts`：`piVersion` 从实际安装版本读取，自动生效；`serverExternalPackages` / `outputFileTracingIncludes` 对 1.1.0 仍适用。
- `scripts/ensure-standalone-pi-runtime.mjs`：BFS 遍历依赖闭包，1.1.0 新依赖（含 `brace-expansion`）自动带上。
- `electron-builder.yml` 的 `x64ArchFiles`：`pi-tui/native/darwin/prebuilds/{arm64,x64}`、`@img/sharp-darwin-*`、`@esbuild/darwin-*` 在 1.1.0 均存在；`@mariozechner/clipboard-darwin-*` 在升级前后锁文件中**均不存在**，属既有 pattern 冗余，非本次引入。
- `scripts/smoke-standalone-server.mjs`：硬编码入口 `pi-ai/dist/index.js` 在 1.1.0 仍存在。

## 验证

- `npm install` 后 `npm ls`：三包均为 1.1.0。
- `npx tsc --noEmit`：通过（0 错误）。
- `npm run lint`：0 error，10 个既有 warning（与本次改动无关）。
- `npm test`：671 项，668 通过、1 失败、2 跳过。唯一失败为 `electron/process-tree.test.ts` 的 Windows 进程树终止测试（`buf parse yielded NaN`），在**未改动的工作树**上以相同方式失败，属既有 Windows 环境抖动，与 SDK 升级无关。

未覆盖：正式三平台打包（Windows NSIS / macOS Universal / Linux DEB）、真实外部 MCP 服务的 OAuth 与登录 UI 全链路。遵守项目约定未在 dev 环境运行 `next build`。

### 2026-10-12 修复验证

- 配置回归测试先在原实现上执行：6 项失败，分别命中项目凭据引用、远程 HTTP、部分覆盖、legacy disabled、非法覆盖和无全局定义的覆盖；修复后全部通过。
- `node --test --test-force-exit lib/mcp-config.test.ts lib/desktop-native-runtime.test.ts`：21 项通过，含真实 stdio 握手、项目部分覆盖后的 Codemode 调用与权限拦截，以及危险项目配置在创建 transport 前被拒绝。
- `npx tsc --noEmit --incremental false`：通过。
- `npm run lint`：0 error，10 个既有 warning；本次修改的三个 TypeScript 文件单独 ESLint 无 warning。
- `npm test`：680 项，678 通过、0 失败、2 跳过。
- 本次相关文件 `git diff --check`：通过。
- 修复未新增 SDK 内部路径导入，未读写真实 provider 凭据，未在开发环境执行生产构建；正式三平台安装包与真实外部 OAuth 全链路仍未覆盖。

### v0.10.0 发布前补充核查

- 复核发现 UI 编辑项目部分覆盖时会把继承连接写成完整项目定义，丢失全局认证。现对未修改连接的表单保存仅写项目可覆盖字段，继续继承全局认证及后续连接更新；实际改变连接时生成不携带全局 provider 凭据的项目定义。
- 被运行时拒绝的对象配置保留在设置列表，显示错误并允许修正或删除；不会进入 SDK 连接列表。
- Next.js / eslint-config-next 更新为 16.3.8；Sharp 为 0.35.5，http-cache-semantics 为 4.3.0，source-map-js 为 1.2.2；通过根 overrides 将 KaTeX 统一到 0.18.2。Pi SDK 保持 1.1.0。
- npm 审计由 23 条降至 13 条（0 critical、5 high、8 moderate）。残余来自两项上游无补丁告警：braces（ESLint → fast-glob → micromatch）与 sprintf-js（electron-builder → @electron/get → global-agent → roarr）。[braces 公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)、[sprintf-js 公告](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)。npm 建议的 force 修复会降级 ESLint／打包器，未采用。
- 从 Next.js、三项 Pi SDK 与 electron-updater 根包遍历实际安装的 dependencies / optionalDependencies，核查 151 个包，未发现残余告警包 braces / sprintf-js。此项是声明依赖闭包检查，不能替代完整安装包与打包结果验证。
- 补修与安全依赖更新后：25 项 MCP 专项测试通过；全量测试 684 项、682 通过、0 失败、2 跳过；主项目与 Electron 类型检查通过；lint 0 error、10 个既有 warning；KaTeX SSR、Electron 更新依赖检查与相关 diff 空白检查通过。生产构建和正式安装包验证继续交由当前提交的 CI。
