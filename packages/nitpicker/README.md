# nitpicker

Web サイトのクローラー・分析・レポート統合 CLI。

## 概要

ヘッドレスブラウザで Web サイトをクロールし、各ページのメタデータ・リンク構造・ネットワークリソース・HTML スナップショットを `.nitpicker` アーカイブに保存します。さらに、アーカイブに対して各種プラグインによる分析を実行し、Google Sheets にレポートを出力できます。

## インストール

```sh
npm install -g nitpicker
```

## コマンド

```sh
nitpicker crawl <URL>     # Web サイトをクロール
nitpicker analyze <file>  # 分析プラグインを実行
nitpicker report <file>   # Google Sheets レポートを生成
```

詳細なオプションは[ルートの README](../../README.md) を参照してください。

## ライセンス

Apache-2.0
