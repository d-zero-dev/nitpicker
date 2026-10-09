# @nitpicker/cli

Web サイトのクロール、分析、Google Sheets／静的HTMLレポート、アーカイブクエリ、ローカルビューアを実行する CLI です。

## 実行方法

CLI の呼び出しは `npx @nitpicker/cli` に統一しています。

```sh
npx @nitpicker/cli <command> [options]
```

## コマンド

| コマンド   | 用途                                                        | 詳細                                   |
| ---------- | ----------------------------------------------------------- | -------------------------------------- |
| `crawl`    | Webサイトをクロールして `.nitpicker` アーカイブを作成・更新 | [docs/crawl.md](./docs/crawl.md)       |
| `report`   | アーカイブをGoogle Sheetsまたは静的HTMLへ出力               | [docs/report.md](./docs/report.md)     |
| `pipeline` | `crawl` → `report` を直列実行                               | [docs/pipeline.md](./docs/pipeline.md) |
| `query`    | `.nitpicker` アーカイブをJSONで問い合わせ                   | [docs/query.md](./docs/query.md)       |
| `viewer`   | `.nitpicker` アーカイブまたはstubをローカルビューアで開く   | [docs/viewer.md](./docs/viewer.md)     |
| `concat`   | 複数の `.nitpicker` アーカイブを1つに結合                   | [docs/concat.md](./docs/concat.md)     |
| `split`    | `.nitpicker` アーカイブから指定スコープだけを抽出           | [docs/split.md](./docs/split.md)       |

## よく使う例

```sh
npx @nitpicker/cli crawl https://example.com
npx @nitpicker/cli crawl ./example.com.nitpicker --retry-failed
npx @nitpicker/cli report ./example.com.nitpicker --sheet <Google Sheets URL> --all
npx @nitpicker/cli report ./example.com.nitpicker --html
npx @nitpicker/cli query ./example.com.nitpicker summary --pretty
npx @nitpicker/cli viewer ./example.com.nitpicker
npx @nitpicker/cli concat a.nitpicker b.nitpicker -o merged
npx @nitpicker/cli split ./example.com.nitpicker https://example.com/blog/ -o blog-only
```

## `.nitpicker` アーカイブ

`.nitpicker` は `crawl` が生成するアーカイブファイルです。保存済みのページ、HTMLスナップショット、リンク、リソース、画像を、後続の `report` / `query` / `viewer` で再利用します。

アーカイブ形式や内部スキーマの詳細はリポジトリルートの [ARCHITECTURE.md](../../../ARCHITECTURE.md) を参照してください。

## ライセンス

Apache-2.0
