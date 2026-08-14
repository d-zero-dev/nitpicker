# Contributing to Nitpicker

Nitpicker へのコントリビューションを歓迎します。

## 開発環境セットアップ

```sh
# リポジトリをクローン
git clone https://github.com/d-zero-dev/nitpicker.git
cd nitpicker

# 依存関係をインストール（Yarn のみ使用、npm 厳禁）
# Node 26 以降は corepack が同梱されないため、未導入の場合は先に入れる
npm install -g corepack
corepack enable
yarn install --immutable

# 全パッケージをビルド
yarn build

# テスト実行
yarn test
```

### 必要な環境

- **Node.js** 24 以上（Volta でバージョン管理推奨）
- **Yarn** 4.x（`corepack enable` で自動有効化）
- **npm は使用しない**: すべてのコマンドは `yarn` 経由で実行

## 開発ワークフロー

### ブランチ戦略

- `main` ブランチから feature ブランチを作成
- ブランチ名: `feat/機能名`, `fix/バグ名`, `docs/ドキュメント名`

### コマンド制約

- **パッケージディレクトリに `cd` しない**: 常にリポジトリルートからコマンドを実行
- **ビルドは `yarn build` のみ**: `npx tsc`, `yarn tsc` 等は禁止
- **対象を限定した操作**: ビルド検証は `yarn build` で全パッケージ一括実行

```sh
# 全パッケージビルド
yarn build

# ユニットテスト
yarn test

# E2E テスト
yarn vitest run --config vitest.e2e.config.ts

# lint
yarn lint:check
```

### コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/) に準拠:

```
feat(crawler): add retry logic for failed requests
fix(core): prevent analyze results from being silently empty
docs: update README with new CLI options
```

`.commitlintrc` で設定されていますが、現在 Git フックには組み込まれていません。CI やレビュー時にコミットメッセージを確認してください。

## コーディング規約

### ファイル構成

- **1ファイル1エクスポート**: エクスポートする関数/クラスは1つのみ
- **`index.ts` 禁止**: モジュールの公開は `package.json` の `exports` フィールドで行う
- **型は `types.ts` に集約**: ドメインごとに専用 `types.ts` を作成

### TypeScript

- **JSDoc 必須**: すべての公開関数、クラス、interface、type に JSDoc を記述
- **`interface` 優先**: `type` はユニオン型・交差型など `type` でしか定義できない場合のみ
- **パラメータ3つ以上**: 名前付きオブジェクトにまとめる
- **Vitest 4**: `import { describe, it, expect } from 'vitest'` を明示的に記述

### テスト

- **1関数1ファイルにはユニットテスト必須**
- **テストファーストを推奨**: バグ修正や明確な仕様の機能追加では、実装より先にテスト

### analyze プラグイン

- `console.log` を使わない（`Lanes` が進捗表示を担当）
- `definePlugin()` でプラグインを定義
- `eachPage` / `eachUrl` コールバックでページ単位の分析を実装
- **`concurrency` の宣言**: プラグインが返すオブジェクトに `concurrency: number` を含めると、`Nitpicker` が生成する専用 `WorkerPool` のサイズに使われる。省略時は `os.cpus().length`
  - **重いプラグイン（Chrome 起動・大規模パース等）は小さく**: 例 `analyze-lighthouse` は `concurrency: 2`。Chrome 1 プロセス ≒ 300〜500MB あるため CPU コア数並列だと簡単に数十 GB 消費する
  - **軽量な DOM 解析のみは省略可**: JSDOM 単体なら CPU コア数並列でほぼ問題ない。`analyze-search` 等は宣言不要
  - **判断基準**: 1 ページ処理時のメモリ消費 × 並列度 が 1〜2GB を超える見込みなら明示的に下げる

### Google Sheets レポートシート

`packages/@nitpicker/report-google-sheets/src/data/create-*.ts` に新規シートを追加する場合:

- **行送信は library 任せ**: `createSheets()` は `sheet.appendRow(...data)` で行を都度送る。チャンク化（2500 行ごとの自動 flush）と遅延セル検出は `@d-zero/google-sheets` の `Sheet` が内部で処理するため、新規シート側で意識する必要はない
- **遅延セル (`createCellData(() => ...)`) は使ってよい**: `appendRow()` は遅延セルを含む行を検出すると自動的に buffered モードに切り替わり、明示的な `flush()` まで送信を保留する。Page List の「Internal Referrers」列がこの仕組みに乗っている
- **テストでガード**: 各 `create-*.spec.ts` には「`eachPage`／`eachResource` が返すセルが `Cell.prototype.provide` に揃っているか（=eager のみ）」を検証するアサーションがある。streaming 経路の高速性を維持するため、遅延セルを使う必要のないシートでは引き続き eager のみで実装すること。Page List 側の spec は逆向きで、少なくとも 1 つの遅延セルが含まれることをアサートしている
- 詳細は `sheets/create-sheets.ts` / `sheets/run-finalize-resources.ts` の JSDoc と ARCHITECTURE.md の「不変条件・負の知識」を参照

## 互換性ポリシー

- **`0.x` 系（現行）**: SemVer の仕様上、互換性保証の対象外。既存の公開 API・CLI オプション・アーカイブフォーマットは予告なく変更してよく、マイグレーションガイドも不要（実際に v0.12.0 でも `feat(viewer)!:` の破壊的変更をガイドなしでリリース済み）
- **`1.0.0` 以降**: メジャーバージョンでの破壊的変更にはマイグレーションガイドが必須。マイナー/パッチへの破壊的変更混入は不可
- **マイグレーションガイドの要件（`1.0.0` 以降のメジャーバージョンのみ）**:
  - 影響を受ける API・設定・データ構造の一覧
  - before → after の具体的な書き換え例
  - 段階的な移行手順（一括移行が困難な場合の中間状態を含む）
- **非推奨化**: 削除予定バージョンと移行先を JSDoc `@deprecated` タグに明記する

## PR ガイドライン

1. 変更の目的を明確に記述
2. テストを追加・更新
3. `yarn build && yarn test && yarn lint:check` がパスすることを確認
4. `1.0.0` 以降のメジャーバージョンでの破壊的変更にはマイグレーションガイドを同梱（`0.x` 系は対象外）

## パッケージ構成

詳細は [ARCHITECTURE.md](./ARCHITECTURE.md) を参照。

## 外部依存パッケージ

| パッケージ              | 用途                                           | 参照                         |
| ----------------------- | ---------------------------------------------- | ---------------------------- |
| `@d-zero/beholder`      | Puppeteer ベースのスクレイパー                 | npm: `@d-zero/beholder`      |
| `@d-zero/dealer`        | 並列処理・スケジューリング                     | npm: `@d-zero/dealer`        |
| `@d-zero/shared`        | 共有ユーティリティ（サブパスエクスポート形式） | npm: `@d-zero/shared`        |
| `@d-zero/roar`          | CLI フレームワーク                             | npm: `@d-zero/roar`          |
| `@d-zero/google-auth`   | OAuth2 認証                                    | npm: `@d-zero/google-auth`   |
| `@d-zero/google-sheets` | Google Sheets API クライアント                 | npm: `@d-zero/google-sheets` |

## ライセンス

Apache 2.0 — 詳細は [LICENSE](./LICENSE) を参照。
