# Nitpicker - AI Agent Guide

Nitpicker は Web サイト全体をヘッドレスブラウザでクロールし、メタデータ・リンク構造・リソース・HTML スナップショットを `.nitpicker` アーカイブ（tar + SQLite）に保存するクローラー＋監査ツール。保存したアーカイブに analyze プラグインを実行し、Google Sheets レポートやローカルビューアで確認できる。Lerna + Yarn Workspaces のモノレポ（`@nitpicker/*` + test-server）。

## 実装把握の入口

コードを読み始める前に **[ARCHITECTURE.md](./ARCHITECTURE.md)** を読むこと。全体地図・境界と所有権・依存方向・不変条件・負の知識・変更種別ごとの Reading paths（読むファイル順）を索引化してある。実装詳細の正は各ソースの JSDoc。

## CLI コマンド

```sh
npx @nitpicker/cli crawl <URL> [<URL>...]              # クロールして .nitpicker 生成（複数 URL で multi-root）
npx @nitpicker/cli crawl <archive> --append <URL>      # 既存アーカイブに起点を追加クロール
npx @nitpicker/cli crawl <archive> --retry-failed      # 失敗ページのみ再取得（永続失敗は自動除外）
npx @nitpicker/cli crawl <archive> --inventory <urls.txt>  # URL リストとの突合で未発見ページを取り込み
npx @nitpicker/cli analyze <file>                      # analyze プラグイン実行
npx @nitpicker/cli report <file>                       # Google Sheets レポート生成
npx @nitpicker/cli pipeline <URL>                      # crawl → analyze → report を直列実行
npx @nitpicker/cli query <file> <sub-command>          # アーカイブへのクエリ（JSON 出力）
npx @nitpicker/cli viewer <file-or-stub-dir>           # ローカルビューア起動（常駐、Ctrl-C で停止）
npx @nitpicker/cli viewer-build <archive> [--force]    # viewer read model を明示的に(再)ビルド
```

フラグの相互排他・挙動の詳細は `--help` と各コマンド実装（`packages/@nitpicker/cli/src/commands/`）の JSDoc を参照。

## テスト・ビルド・lint

```sh
yarn test                                          # ユニットテスト（Vitest）
yarn vitest run --config vitest.e2e.config.ts      # E2E（maxWorkers: 1、test-server port 8010）
yarn workspace @nitpicker/viewer test:e2e          # viewer の Playwright E2E
yarn build                                         # 全パッケージビルド
yarn lint                                          # lint + prettier + cspell
```

- **1関数1ファイルにはユニットテスト必須**。バグ修正や仕様が明確な変更はテストファースト
- E2E で外部リンクは `127.0.0.1` でシミュレートする（`localhost` と別ホスト名扱い）
- **git worktree からのビルドは `NX_WORKSPACE_ROOT_PATH` 必須**: リポジトリ内部にネストした worktree（`.claude/worktrees/*` 等）から素の `yarn build` を実行すると、Nx がルートをメインチェックアウトに誤解決し、成功表示のまま成果物がメイン側に書かれる（worktree の `lib/` は生成されない）。`NX_WORKSPACE_ROOT_PATH=<worktree絶対パス> yarn build` でルートを明示すること

## コマンド制約

- **yarn のみ使用**: npm / npx 直実行は禁止。`yarn <script>` 経由で実行する
- **全体実行の強制**: 時間がかかっても `yarn build` / `yarn lint` / `yarn test` のリポジトリ全体実行を使う。`tsc` / `eslint` / `prettier` の単発実行・ファイルスコープ実行（`npx eslint <file>`、`prettier --write <file>`、`tsc -p <pkg>` 等）は禁止
- **パッケージディレクトリに cd しない**: 常にリポジトリルートから実行する
- **コマンドの連続実行禁止**: `&&` / `;` / 改行連結をしない。1 回の実行で 1 コマンドのみ（permissions のパターンマッチを守るため）

## ドキュメント原則

情報は置き場で役割が決まる。**コードには How、テストコードには What、コミットログには Why、コードコメントには Why not**（Why が必要なときは Why も書く）。

- **JSDoc = 公開 API（export）の API ユーザー向け文書**: IDE ホバーで実装を読まない読者に届くため、WHAT / HOW / WHY を適切に書き、`@example` を必須とする。メインの公開 API は README にも載せる
- **非公開 API の JSDoc は必須にしない**: ただし複雑な内部モジュールの設計 WHY / Why not はファイルレベル JSDoc が推奨置き場
- **計画相対概念の禁止**: 実装計画に由来する相対概念（Phase/Step 番号、「本 PR」「今回」「旧実装」「導入予定」）を JSDoc・テスト名・ドキュメントに書かない。現在の挙動と意図的な不在（Why not）として自己完結に書く。外部参照は issue / PR 番号のみ可。リトマス試験:「その語彙はコードに実在するか、計画会話にしか存在しないか」
- **ドキュメントと実装の矛盾**: 実装詳細の矛盾は実装が正としてドキュメントを直す。ARCHITECTURE.md の不変条件・境界との矛盾は実装が設計違反の可能性を先に調査する（検出ゲートは PR ごとの `/product-manager` チェック）

## ディレクトリ・構造ルール

- **1ファイル1エクスポート**: 同居可能なのはファイルスコープに閉じた非エクスポート内部関数のみ
- **index.ts 禁止**: モジュール公開は package.json の `exports` フィールドで行う
- **型は types.ts に集約**: ドメインごとに専用 `types.ts`
- **interface 優先**: `type` はユニオン・交差・マップ型など `type` でしか書けない場合のみ
- **パラメータ 3 つ以上は名前付きオブジェクト**、オプショナル設定は `Partial<OptionsType>`
- **exports で公開 API を厳選**: モノレポ内パッケージ間でも exports 経由でのみアクセスする

## コーディング規約

- `import { describe, it, expect } from 'vitest'` を明示（Vitest 4 の要件）
- `@d-zero/shared` はサブパスエクスポート形式（`@d-zero/shared/delay`）
- analyze プラグインで `console.log` を使わない（進捗表示は `Lanes`）
- 禁止パターン（decorator / `Promise.race` の timer 放置 / 派生文字列を作る sort 等）は ARCHITECTURE.md の「不変条件・負の知識」を正とする

## セキュリティ

- `.env` 等の機密ファイルを読み取り・編集・コミットしない（判断は `.gitignore` を参考にする）
- コミット前に `git diff --staged` で機密情報（API キー、トークン、パスワード、企業名、顧客情報）を確認する
- **サンプル値は予約済み慣例に従う**: ドメインは `example.com` / `*.example` / `*.test` 等（RFC 2606/6761）、IP は TEST-NET。実在の無関係ドメイン・未取得の創作ドメイン・案件識別子・dogfooding 由来の実データを成果物に残さない（詳細は `.claude/skills/git/SKILL.md`）
- 環境変数やシークレットをコードにハードコードしない
- **yarn dlx は完全禁止**、npx は原則使わない。依存追加はバージョン固定（`yarn add foo@1.2.3`）で信頼性を確認してから。yarn.lock の手動編集禁止

## スキル

| スキル          | パス                                      | 用途                                                    |
| --------------- | ----------------------------------------- | ------------------------------------------------------- |
| Product Manager | `.claude/skills/product-manager/SKILL.md` | リポジトリ分析、ドキュメント整合チェック、PR レビュー   |
| QA Engineer     | `.claude/skills/qa-engineer/SKILL.md`     | コードレビュー、テスト品質チェック                      |
| Impl            | `.claude/skills/impl/SKILL.md`            | 合意済み計画の実装・検証・PR 作成のオーケストレーション |
| Grill me        | `.claude/skills/grill-me/SKILL.md`        | 計画・設計の前提を掘り下げて合意形成する                |
| Git             | `.claude/skills/git/SKILL.md`             | コミット規約・コミット前コンテンツチェック              |
| PR              | `.claude/skills/pr/SKILL.md`              | PR 作成フロー（base 追従・push はユーザー実行・CI 監視） |

## AI 操作プロトコル

- **exports を壊さない**: package.json の `exports` は差分追記のみ。既存パスを削除しない
- **アーキテクチャガード**: 変更後に構造ルールと ARCHITECTURE.md の不変条件に違反していないかセルフチェックする
