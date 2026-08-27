# Nitpicker

[![CI](https://github.com/d-zero-dev/nitpicker/actions/workflows/ci.yml/badge.svg)](https://github.com/d-zero-dev/nitpicker/actions/workflows/ci.yml)
[![E2E](https://github.com/d-zero-dev/nitpicker/actions/workflows/e2e.yml/badge.svg)](https://github.com/d-zero-dev/nitpicker/actions/workflows/e2e.yml)

Nitpicker は、Web サイトをクロールしてページ情報・リンク・リソース・HTML スナップショットを `.nitpicker` アーカイブに保存し、分析やレポート出力まで行うツールキットです。

ヘッドレスブラウザでページをレンダリングし、遅延読み込みされるコンテンツも取得対象にします。アーキテクチャの索引（全体地図・境界・依存方向・不変条件・Reading paths）は [ARCHITECTURE.md](./ARCHITECTURE.md)、実装詳細は各ソースの JSDoc を参照してください。

## 基本ワークフロー

```sh
npx @nitpicker/cli crawl https://example.com
npx @nitpicker/cli analyze ./example.com.nitpicker --all
npx @nitpicker/cli report ./example.com.nitpicker --sheet <Google Sheets URL> --all
npx @nitpicker/cli report ./example.com.nitpicker --html
```

必要に応じて、保存済みアーカイブを JSON で調べたり、ローカルビューアで確認できます。

```sh
npx @nitpicker/cli query ./example.com.nitpicker summary --pretty
npx @nitpicker/cli viewer ./example.com.nitpicker
```

CLI の詳細な使い方と全オプションは [@nitpicker/cli README](./packages/@nitpicker/cli/README.md) を参照してください。

## `.nitpicker` アーカイブ

`.nitpicker` は `crawl` が生成するアーカイブファイルです。クロール結果、レンダリング後の HTML スナップショット、リンク、ネットワークリソース、画像情報、分析結果などを保存します。

このファイルは `analyze` / `report` / `query` / `viewer` の入力になります。保存形式やスキーマの概要は [ARCHITECTURE.md](./ARCHITECTURE.md) の「アーカイブ（DB スキーマ概要）」、定義の正は `packages/@nitpicker/crawler/src/archive/init-schema.ts` を参照してください。

## パッケージ

| パッケージ                                                                              | 用途                                                    |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [@nitpicker/cli](./packages/@nitpicker/cli/README.md)                                   | クロール、分析、レポート、クエリ、ビューアを実行するCLI |
| [@nitpicker/crawler](./packages/@nitpicker/crawler/README.md)                           | ヘッドレスブラウザによるクロールとアーカイブ生成        |
| [@nitpicker/core](./packages/@nitpicker/core/README.md)                                 | analyzeプラグインを実行する分析エンジン                 |
| [@nitpicker/query](./packages/@nitpicker/query/README.md)                               | `.nitpicker` アーカイブのクエリ関数                     |
| [@nitpicker/report-google-sheets](./packages/@nitpicker/report-google-sheets/README.md) | Google Sheets向けレポート出力                           |
| [@nitpicker/report-html](./packages/@nitpicker/report-html/README.md)                   | 単一ファイルの静的HTMLレポート出力                      |
| [@nitpicker/mcp-server](./packages/@nitpicker/mcp-server/README.md)                     | MCP経由でアーカイブを問い合わせるサーバー               |
| [@nitpicker/viewer](./packages/@nitpicker/viewer/README.md)                             | `.nitpicker` アーカイブを閲覧するローカルビューア       |
| [@nitpicker/types](./packages/@nitpicker/types/README.md)                               | 共有TypeScript型定義                                    |
| [@nitpicker/analyze-axe](./packages/@nitpicker/analyze-axe/README.md)                   | axe-coreによるアクセシビリティ分析プラグイン            |
| [@nitpicker/analyze-lighthouse](./packages/@nitpicker/analyze-lighthouse/README.md)     | Lighthouseによるパフォーマンス分析プラグイン            |
| [@nitpicker/analyze-markuplint](./packages/@nitpicker/analyze-markuplint/README.md)     | markuplintによるHTML検証プラグイン                      |
| [@nitpicker/analyze-textlint](./packages/@nitpicker/analyze-textlint/README.md)         | textlintによる日本語文章校正プラグイン                  |
| [@nitpicker/analyze-search](./packages/@nitpicker/analyze-search/README.md)             | キーワード・CSSセレクタ検索プラグイン                   |
| [test-server](./packages/test-server/README.md)                                         | E2Eテスト用サーバー                                     |

## ライセンス

Apache-2.0
