# Nitpicker

[![CI](https://github.com/d-zero-dev/nitpicker/actions/workflows/ci.yml/badge.svg)](https://github.com/d-zero-dev/nitpicker/actions/workflows/ci.yml)
[![E2E](https://github.com/d-zero-dev/nitpicker/actions/workflows/e2e.yml/badge.svg)](https://github.com/d-zero-dev/nitpicker/actions/workflows/e2e.yml)

Nitpicker は、Web サイトをクロールしてページ情報・リンク・リソース・HTML スナップショットを `.nitpicker` アーカイブに保存し、レポート出力まで行うツールキットです。

ヘッドレスブラウザでページをレンダリングし、遅延読み込みされるコンテンツも取得対象にします。アーキテクチャの索引（全体地図・境界・依存方向・不変条件・Reading paths）は [ARCHITECTURE.md](./ARCHITECTURE.md)、実装詳細は各ソースの JSDoc を参照してください。

## 基本ワークフロー

```sh
npx @nitpicker/cli crawl https://example.com
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

`.nitpicker` は `crawl` が生成するアーカイブファイルです。クロール結果、レンダリング後の HTML スナップショット、リンク、ネットワークリソース、画像情報などを保存します。

このファイルは `report` / `query` / `viewer` の入力になります。保存形式やスキーマの概要は [ARCHITECTURE.md](./ARCHITECTURE.md) の「アーカイブ（DB スキーマ概要）」、定義の正は `packages/@nitpicker/archive/src/init-schema.ts` を参照してください。

## パッケージ

| パッケージ                                                                              | 用途                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [@nitpicker/archive](./packages/@nitpicker/archive/README.md)                           | `.nitpicker` アーカイブの読み書き・移行・結合分割 |
| [@nitpicker/cli](./packages/@nitpicker/cli/README.md)                                   | クロール、レポート、クエリ、ビューアを実行するCLI |
| [@nitpicker/crawler](./packages/@nitpicker/crawler/README.md)                           | ヘッドレスブラウザによるクロール                  |
| [@nitpicker/query](./packages/@nitpicker/query/README.md)                               | `.nitpicker` アーカイブのクエリ関数               |
| [@nitpicker/report-google-sheets](./packages/@nitpicker/report-google-sheets/README.md) | Google Sheets向けレポート出力                     |
| [@nitpicker/report-html](./packages/@nitpicker/report-html/README.md)                   | 単一ファイルの静的HTMLレポート出力                |
| [@nitpicker/mcp-server](./packages/@nitpicker/mcp-server/README.md)                     | MCP経由でアーカイブを問い合わせるサーバー         |
| [@nitpicker/viewer](./packages/@nitpicker/viewer/README.md)                             | `.nitpicker` アーカイブを閲覧するローカルビューア |
| [test-server](./packages/test-server/README.md)                                         | E2Eテスト用サーバー                               |

## ライセンス

Apache-2.0
