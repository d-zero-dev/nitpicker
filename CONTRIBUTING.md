# Contributing to Nitpicker

Nitpicker へのコントリビューションを歓迎します。

## 開発環境セットアップ

```sh
# リポジトリをクローン
git clone https://github.com/d-zero-dev/nitpicker.git
cd nitpicker

# 依存関係をインストール（Yarn のみ使用、npm 厳禁）
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

commitlint がプリコミットフックで検証します。

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

- `console.log` を使わない（`deal()` が進捗表示を担当）
- `definePlugin()` でプラグインを定義
- `eachPage` / `eachUrl` コールバックでページ単位の分析を実装

## PR ガイドライン

1. 変更の目的を明確に記述
2. テストを追加・更新
3. `yarn build && yarn test && yarn lint:check` がパスすることを確認
4. 破壊的変更にはマイグレーションガイドを同梱

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
