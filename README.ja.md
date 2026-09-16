<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <strong>日本語</strong>
</p>

---

<div align="center">

<a href="https://github.com/Chasen-Liao/pi-agent-desktop">
  <img src="public/logo.png" alt="Pi Agent Desktop ロゴ" width="128" height="128" />
</a>

# Pi Agent Desktop

**目標：個人向けミニマルな Codex** — [Pi コーディングエージェント](https://github.com/badlogic/pi-mono) のネイティブデスクトップクライアント。Electron ベースで、ブラウザよりもネイティブな使い心地を提供します。

[![Release](https://img.shields.io/github/v/release/Chasen-Liao/pi-agent-desktop?color=orange&logo=github)](https://github.com/Chasen-Liao/pi-agent-desktop/releases)
[![License](https://img.shields.io/github/license/Chasen-Liao/pi-agent-desktop?color=blue)](LICENSE)
[![Landing](https://img.shields.io/badge/Landing-GitHub%20Pages-111111?logo=githubpages)](https://chasen-liao.github.io/pi-agent-desktop/)

![Pi Agent Desktop デモ](public/pi.gif)

</div>

> **アップストリーム**：本プロジェクトは [pi-web](https://github.com/agegr/pi-web) から派生しており、デスクトップ体験の最適化と機能拡張に注力しています。

## 目次

- [特徴](#特徴)
- [ダウンロードとインストール](#ダウンロードとインストール)
- [開発](#開発)
- [プロジェクト構成](#プロジェクト構成)
- [技術スタック](#技術スタック)
- [謝辞](#謝辞)
- [コントリビューション](#コントリビューション)
- [ライセンス](#ライセンス)

## 特徴

### 🖥️ デスクトップ体験

- **ネイティブなデスクトップアプリ** — Electron ベースの独立ウィンドウ。システムトレイとトレイへの最小化に対応
- **ネイティブなワークスペース UI** — Apple 風のデスクトップレイアウト、リキッド思考ボール、よりコンパクトなメッセージ入力欄
- **自動更新** — GitHub Releases からの自動更新チェックに対応
- **ショートカットキー** — `Ctrl+B` で左サイドバー、`Ctrl+Alt+B` で右パネルを切り替え

### 💬 セッションと会話

- **セッションブラウザ** — 作業ディレクトリごとにすべての Pi セッションをグループ化して表示
- **リアルタイム会話** — SSE ストリーミングでエージェントとリアルタイムにやり取り
- **実行中メッセージキュー** — `Enter` で即座に steer、`Alt+Enter` でキューに追加。ドラッグ＆キーボードで Follow-up を並べ替え
- **セッション内ブランチ** — 任意のノードに戻って会話を継続。ブランチは同じファイル内に保持
- **ブランチナビゲーター** — セッション内のブランチをビジュアルに切り替え
- **セッションのフォークとクローン** — API/UI で任意のノードから Branch、またはセッションを通常ディレクトリや Git Worktree の新規ブランチに Clone
- **セッションのエクスポート** — HTML / Markdown 形式でワンクリックエクスポート
- **モデル切り替え** — 会話の途中でもモデルを切り替え。セレクターと認証パネルはローカルの Pi 拡張機能が動的登録したプロバイダーを読み込み

### 🤖 エージェント機能

- **Agent モード** — Plan / Ask / Full の 3 つの安全モードと、Ask ツールのインターセプト確認
- **Extension UI Bridge** — 拡張機能の `confirm` / `select` / `input` / `editor` / `notify` 操作をネイティブダイアログで表示
- **プロジェクト信頼** — Project Trust 409 ハンドシェイクと認可ダイアログ
- **ツールパネル** — エージェントが使用できるツールを制御
- **長期記憶 LTM** — プロジェクト単位の SQLite メモリ（`memory_save` / `memory_recall` / `memory_forget`）でセッションをまたいだ検索に対応。中国語・日本語・韓国語は FTS5 trigram で検索。`agent_end` と compact の前に自動で観察を書き込み

### ⚙️ 設定と管理

- **MCP サーバー管理** — グローバル（`~/.pi/agent/mcp.json`）とプロジェクト（`<cwd>/.pi/mcp.json`）の MCP 設定を UI から管理
- **拡張機能と Skill の管理** — グローバル・プロジェクトの拡張機能と Skill の有効化・診断を一元管理する UI
- **AgentMode の永続化** — `.jsonl` にカスタムの `desktop_agent_mode` ノードを書き込み、リロード時に履歴モードを復元
- **表示言語** — 中国語 / 英語、システムに追従
- **ファイルブラウザ** — サイドバー内蔵のファイルブラウザとビューア

## ダウンロードとインストール

最新のインストーラーは [Releases](https://github.com/Chasen-Liao/pi-agent-desktop/releases) ページから入手してください。

お使いの OS に合わせてパッケージを選んでください（現在の Release アセットに従ってください）：

| プラットフォーム | パッケージ |
| --- | --- |
| Windows | `Pi-Agent-Desktop-Setup-x.x.x.exe` |
| macOS（Universal、Intel + Apple Silicon） | `Pi-Agent-Desktop-x.x.x-mac-universal.dmg`（自動更新用 ZIP あり） |
| Linux x64 | `Pi-Agent-Desktop-x.x.x-linux-amd64.deb` |

## 開発

```bash
# 依存関係のインストール
npm install

# 開発モード（ブラウザ）
npm run dev          # http://localhost:30141

# 開発モード（Electron デスクトップウィンドウ）
npm run dev:electron

# 型チェック
npx tsc --noEmit

# リント
npm run lint

# ユニットテスト（middleware.test.ts を含む。--test-force-exit は外さないこと）
npm test

# Windows CI サブセット（パス / Electron）
npm run test:windows

# macOS CI サブセット（パス / Electron / パッケージ設定）
npm run test:macos

# 現在のシステム用インストーラーをビルド（Windows NSIS / Linux DEB。macOS は次の行を使用）
npm run dist

# Intel + Apple Silicon Universal macOS インストーラーをビルド
npm run dist:mac

# GitHub Release：vX.Y.Z タグをプッシュし、Actions が 3 プラットフォームをビルド（docs/RELEASING.md 参照）
```

## プロジェクト構成

```
app/
  api/
    sessions/      # セッションファイルの読み込み
    agent/         # コマンド送信、SSE イベントストリーム
    memory/        # 長期記憶 recall / remember / forget / stats / health
    files/         # ファイル内容の読み込み
    models/        # 利用可能なモデルとデフォルトモデル
    models-config/ # models.json の読み書き
    skills/        # Skill の検索とインストール
    auth/          # ログインと API Key 管理
    mcp/           # MCP サーバー設定の読み書き
    extensions/    # 拡張機能管理
    trust/         # プロジェクト信頼ハンドシェイク
    desktop-settings/ # デスクトップ設定
    default-cwd/   # デフォルト作業ディレクトリ
    select-directory/ # ディレクトリ選択
    statusline/    # ステータスラインデータ
    home/          # ホームデータ
    health/        # ヘルスチェック
components/        # UI コンポーネント
electron/          # Electron メインプロセス
hooks/             # React フック（セッション管理、パネルレイアウトなど）
lib/
  ltm/               # 長期記憶（SQLite + MemoryService + hooks）
  i18n/              # UI 文言（en / zh-CN / system）
  session-reader.ts  # .jsonl セッションファイルの解析
  session-branch-clone.ts # セッションのフォーク・クローン用パラメータとヘッダー
  git-worktree.ts    # Git Worktree の作成、本人確認、クリーンアップ
  rpc-manager.ts     # AgentSession のライフサイクル管理
  normalize.ts       # toolCall フィールド名の正規化
  types.ts
scripts/
  ensure-standalone-next-runtimes.mjs             # Turbopack ランタイムを補完
  ensure-standalone-pi-runtime.mjs                # Pi ランタイムの依存クロージャを補完
  ensure-standalone-macos-universal-runtimes.mjs  # macOS 用 Sharp ランタイム 2 種を補完
  dereference-standalone-symlinks.mjs             # パッケージング前に standalone シンボリックリンクを解決
  smoke-standalone-server.mjs                      # standalone サーバーのスモークテスト
  smoke-packaged-standalone.mjs                    # パッケージ済みアプリのスモークテスト
```

## 技術スタック

| レイヤー | 技術 |
| --- | --- |
| フロントエンド | Next.js + React + TypeScript + Tailwind CSS |
| デスクトップ | Electron |
| パッケージング | electron-builder（Windows NSIS / macOS Universal DMG + ZIP / Linux DEB） |
| リアルタイム通信 | SSE (Server-Sent Events) ストリーミング |

## 謝辞

- [pi-mono](https://github.com/badlogic/pi-mono) — Pi コーディングエージェントのコア
- [pi-web](https://github.com/agegr/pi-web) — アップストリームの Web UI プロジェクト

## コントリビューション

Issue の報告、PR の作成、マージ方法は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。新機能は `dev/` または `future/` ブランチで開発します。リリース手順は [docs/RELEASING.md](docs/RELEASING.md) に従います。

## ライセンス

MIT License

## Star History

<a href="https://www.star-history.com/?repos=Chasen-Liao%2Fpi-agent-desktop&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Chasen-Liao/pi-agent-desktop&type=date&theme=dark&legend=top-left&sealed_token=aFn-TCmARmvfk1wIdKSpOk7h46vafl3D-moDORISvD96gQ2y3nR3DvatGktptaV93Dz0ULxRvLxCT5yJ3_FzrPGXVjg7f-tJTmKpafiODarLHzonGBnXQw" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Chasen-Liao/pi-agent-desktop&type=date&legend=top-left&sealed_token=aFn-TCmARmvfk1wIdKSpOk7h46vafl3D-moDORISvD96gQ2y3nR3DvatGktptaV93Dz0ULxRvLxCT5yJ3_FzrPGXVjg7f-tJTmKpafiODarLHzonGBnXQw" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Chasen-Liao/pi-agent-desktop&type=date&legend=top-left&sealed_token=aFn-TCmARmvfk1wIdKSpOk7h46vafl3D-moDORISvD96gQ2y3nR3DvatGktptaV93Dz0ULxRvLxCT5yJ3_FzrPGXVjg7f-tJTmKpafiODarLHzonGBnXQw" />
 </picture>
</a>
