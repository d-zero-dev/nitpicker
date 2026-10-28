# @nitpicker/cli

Web サイトのクロール、分析、Google Sheets／静的HTMLレポート、アーカイブクエリ、ローカルビューアを実行する CLI です。

## 実行方法

CLI の呼び出しは`npx @nitpicker/cli`に統一しています。

```sh
npx @nitpicker/cli <command> [options]
```

ネイティブ処理（テンプレート分類、`query`の走査と URL の並び替えなど）のスレッド数と同時実行数は、環境変数`NITPICKER_NATIVE_THREADS`（既定は論理コア数）と`NITPICKER_NATIVE_CONCURRENCY`（既定は 1）で変えられます。対象は`crawl`/`pipeline`/`query`/`viewer`/`viewer-build`/`concat`/`split`で、正の整数でない値は、作業を始める前に終了コード 1 で拒否します（`report`と`cache`は検査しません）。詳細は[@nitpicker/core](../core/README.md)を参照してください。

保存済みのHTMLスナップショットは、zstdの1文書あたり展開後約1.5 GiB（クローラーが保存できる最大のバイト数）までしか展開しません。展開できないスナップショット（データが壊れているもの、上限を超えるもの）があると、`query search-html`/`match-selector`、HTMLの取得、`viewer-build`（crawl完了時の自動ビルドも）の read model ビルドは、そのページと`page_html_blobs`の hash を示すエラーで止まります。「不一致」や「HTMLなし」として黙って進めません。

## コマンド

| コマンド   | 用途                                                      | 詳細                                   |
| ---------- | --------------------------------------------------------- | -------------------------------------- |
| `crawl`    | Webサイトをクロールして`.nitpicker`アーカイブを作成・更新 | [docs/crawl.md](./docs/crawl.md)       |
| `report`   | アーカイブをGoogle Sheetsまたは静的HTMLへ出力             | [docs/report.md](./docs/report.md)     |
| `pipeline` | `crawl` → `report`を直列実行                              | [docs/pipeline.md](./docs/pipeline.md) |
| `query`    | `.nitpicker`アーカイブをJSONで問い合わせ                  | [docs/query.md](./docs/query.md)       |
| `viewer`   | `.nitpicker`アーカイブまたはstubをローカルビューアで開く  | [docs/viewer.md](./docs/viewer.md)     |
| `concat`   | 複数の`.nitpicker`アーカイブを1つに結合                   | [docs/concat.md](./docs/concat.md)     |
| `split`    | `.nitpicker`アーカイブから指定スコープだけを抽出          | [docs/split.md](./docs/split.md)       |

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

## `.nitpicker`アーカイブ

`.nitpicker`は`crawl`が生成するアーカイブファイルです。保存済みのページ、HTMLスナップショット、リンク、リソース、画像を、後続の`report`/`query`/`viewer`で再利用します。

アーカイブ形式や内部スキーマの詳細はリポジトリルートの[ARCHITECTURE.md](../../../ARCHITECTURE.md)を参照してください。

## ライセンス

Apache-2.0
