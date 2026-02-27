# Nitpicker - AI Agent Guide

## 概要

Nitpicker は Web サイト全体のデータを取得するクローラー＋監査ツール。ヘッドレスブラウザで各ページをレンダリングし、メタデータ・リンク構造・ネットワークリソース・HTML スナップショットを `.nitpicker` アーカイブ（tar 形式）に保存する。さらに、保存したアーカイブに対して各種 analyze プラグインを実行し、Google Sheets にレポートを出力できる。

Lerna + Yarn Workspaces のモノレポ構成で、`@nitpicker` スコープ配下の全パッケージ + E2E テストサーバーから成る。

## パッケージ構成

```
packages/
├── @nitpicker/
│   ├── cli/                       # 統合 CLI (bin: nitpicker)
│   ├── crawler/                   # クローラーエンジン（オーケストレーター + アーカイブ + ユーティリティ）
│   ├── core/                      # 監査エンジン（Nitpicker クラス + deal() による並列処理）
│   ├── types/                     # 監査型定義（Report, ConfigJSON）
│   ├── analyze-axe/               # アクセシビリティ監査
│   ├── analyze-lighthouse/        # Lighthouse 監査
│   ├── analyze-main-contents/     # メインコンテンツ検出
│   ├── analyze-markuplint/        # マークアップ検証
│   ├── analyze-search/            # キーワード検索
│   ├── analyze-textlint/          # テキスト校正
│   └── report-google-sheets/      # Google Sheets レポーター
└── test-server/                   # E2E テスト用 Hono サーバー
```

### 依存グラフ

```
@d-zero/beholder（外部）
      ↑
      └── crawler ── @nitpicker/cli ← @d-zero/roar（外部）
           ↑              ↑      ↑
           │             core   report-google-sheets
           │              ↑
           │         analyze-* プラグイン
           └── @d-zero/dealer（外部）
```

## CLI コマンド

```sh
npx @nitpicker/cli crawl <URL> [options]     # Web サイトをクロールして .nitpicker ファイルを生成
npx @nitpicker/cli analyze <file> [options]  # .nitpicker ファイルに対して analyze プラグインを実行
npx @nitpicker/cli report <file> [options]   # .nitpicker ファイルから Google Sheets レポートを生成
```

## 主要アーキテクチャ

### データフロー（crawl）

```
CrawlerOrchestrator.crawling(urls, options)
  → Archive.create()（SQLite DB を tmpDir に作成）
  → Crawler → deal()（@d-zero/dealer で並列制御）
    → 各 URL: puppeteer.launch() → Scraper.scrapeStart(page, ...)
      → ScrapeResult を戻り値で返却
    → LinkList.done() + Archive にページデータ保存
    → push() で発見した新 URL を動的にキューに追加
  → CrawlerOrchestrator.write()（tmpDir を .nitpicker tar に圧縮）
```

### データフロー（analyze）

```
Nitpicker.analyze(archivePath, plugins)
  → Archive.connect() → ArchiveAccessor
  → getPagesWithRefs() で全ページ取得
  → deal()（@d-zero/dealer, limit: 50）で並列分析
    → 各 Page: runInWorker() で Worker スレッドでプラグイン実行
    → deal() が進捗表示を担当（プラグイン内の console.log は不要）
  → レポートファイル書き出し
```

### @d-zero/shared 統合

以下の機能は `@d-zero/shared` から提供されており、独自実装は不要:

- `detectCompress` / `detectCDN` — beholder から re-export
- `parseUrl` — `@d-zero/shared/parse-url`
- `delay` — `@d-zero/shared/delay`
- `isError` — beholder/is-error.ts に集約、crawler は re-export

### deal() の利用箇所

- **crawler**: URL スクレイピングの並列制御
- **core（analyze）**: ページ分析の並列処理（limit: 50）

## テスト

```sh
yarn test                                          # ユニットテスト
yarn vitest run --config vitest.e2e.config.ts      # E2E テスト（maxWorkers: 1）
yarn build                                         # 全パッケージビルド
yarn lint                                          # lint + cspell
```

- E2E テストサーバー: Hono on port 8010（`test-server/src/__tests__/e2e/global-setup.ts`）
- 外部リンクのシミュレーション: `127.0.0.1`（`localhost` と異なるホスト名で外部判定）
- **1関数1ファイルにはユニットテスト必須**: エクスポートされた関数ごとにユニットテストを必ず作成する
- **課題が明確な場合はテストファースト**: バグ修正や仕様が明確な機能追加では、実装より先にテストを書く

## コマンド制約

- **yarn のみ使用**: npm 厳禁。すべてのコマンドは `yarn` 経由で実行する
- **パッケージディレクトリに cd しない**: 個別パッケージディレクトリに移動してコマンドを実行しない。常にリポジトリルートから `yarn build` 等を実行する
- **ビルドは `yarn build` のみ**: `npx tsc`, `yarn tsc`, `npx nx`, `yarn dlx tsc` 等は禁止
- **対象を限定した操作**: ビルド検証は `yarn build` で全パッケージ一括実行

## ディレクトリ・構造ルール

- **1ファイル1エクスポート**: エクスポートする関数/クラスは1つのみ。同居可能なのはファイルスコープに閉じた非エクスポートの内部関数のみ
- **index.ts 禁止**: `index.ts` を作成しない。モジュールの公開はすべて package.json の `exports` フィールドで行う
- **型は types.ts に集約**: ドメインごとに専用 `types.ts` を作成する

## 必読ドキュメント

| ドキュメント      | 内容                                                  | 対象読者           |
| ----------------- | ----------------------------------------------------- | ------------------ |
| `README.md`       | CLI の使い方・オプション・出力形式                    | API ユーザー       |
| `ARCHITECTURE.md` | パッケージ構成・データフロー・DB スキーマ・テスト構成 | コントリビューター |

ドキュメントと実装に矛盾がある場合は、**実装が正**とし、ドキュメントを修正すること。

## スキル

タスクに応じて `.claude/skills/` 配下のスキルを参照すること。

| スキル          | パス                                      | 用途                                                                        |
| --------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| Product Manager | `.claude/skills/product-manager/SKILL.md` | リポジトリ分析、ドキュメント生成・レビュー、アーキテクチャ評価、PR レビュー |
| QA Engineer     | `.claude/skills/qa-engineer/SKILL.md`     | コードレビュー、テスト品質チェック、カバレッジ改善、リファクタリング提案    |

## コーディング規約

- `import { describe, it, expect } from 'vitest'` を明示的に記述（Vitest 4 の要件）
- `@d-zero/shared` はサブパスエクスポート（`@d-zero/shared/delay` 形式）
- analyze プラグインでは `console.log` を使わない（deal() が進捗表示を担当）
- **JSDoc 必須**: すべての関数、クラス、クラスメンバー変数、クラスメンバー関数（private 含む）、interface、interface プロパティ、type、type オブジェクトリテラルプロパティ、関数型、トップレベル定数に JSDoc を記述する
- **interface 優先**: `type` はユニオン型・交差型・マップ型など `type` でしか定義できない場合のみ使用する
- **公開 API はオブジェクトコンテキスト**: パラメータ3つ以上の関数は名前付きオブジェクトにまとめる
- **Options は Partial**: オプショナル設定は `Partial<OptionsType>` パターンを使用する
- **exports で公開 API を厳選**: package.json の `exports` フィールドにサブパスを明示的に定義し、公開 API を限定する。モノレポ内パッケージ間でも exports 経由でのみアクセスする

## AI 操作プロトコル

- **修正前にスキャン**: コード変更を行う前に、対象パッケージの構造・依存関係・exports を確認してから修正を開始する
- **exports を壊さない**: package.json の `exports` フィールドを変更する場合は差分のみ追記し、既存のエクスポートパスを削除しない
- **アーキテクチャガード**: 変更後にディレクトリ・構造ルール（1ファイル1エクスポート、index.ts 禁止、型の集約）に違反していないかセルフチェックする
