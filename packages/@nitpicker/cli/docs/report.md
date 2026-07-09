# report

`.nitpicker` アーカイブのクロール・分析結果をGoogle Sheetsへ出力します。

## 基本形

```sh
npx @nitpicker/cli report <archive>.nitpicker --sheet <Google Sheets URL> [options]
```

例:

```sh
npx @nitpicker/cli report ./site.nitpicker --sheet <Google Sheets URL> --all
```

非TTY環境では対話選択で停止しないように、すべてのシート生成と詳細ログが有効になります。

## `--dedupe-resources`

Google Sheetsには1ドキュメントあたりのセル上限があります。広告タグや解析タグはページごとに異なるクエリ付きURLを大量生成することがあり、Resourcesシートが上限に達する場合があります。

`--dedupe-resources` はResourcesシートをcanonical URL、status、content typeで集約し、`Count` 列を追加します。クエリ値は捨て、クエリキーだけを並べてURLの傾向を残します。

```sh
npx @nitpicker/cli report ./site.nitpicker --sheet <Google Sheets URL> --all --dedupe-resources
```

大きなアーカイブではNode.jsのヒープを増やして実行してください。

```sh
NODE_OPTIONS=--max-old-space-size=8192 npx @nitpicker/cli report ./site.nitpicker --sheet <Google Sheets URL> --all --dedupe-resources
```

## オプション一覧

| オプション            | 型               | 説明                                                  |
| --------------------- | ---------------- | ----------------------------------------------------- |
| `--sheet`, `-S`       | string, required | 出力先Google Sheets URL                               |
| `--credentials`, `-C` | string           | 認証情報ファイル。既定は `./credentials.json`         |
| `--config`, `-c`      | string           | 設定ファイルパス                                      |
| `--limit`, `-l`       | number           | アーカイブから一度に読み込むページ数。既定は `100000` |
| `--all`               | boolean          | 対話選択なしですべてのシートを生成                    |
| `--dedupe-resources`  | boolean          | Resourcesシートをcanonical URL単位で集約              |
| `--verbose`           | boolean          | 詳細ログを出力                                        |
| `--silent`            | boolean          | 標準出力ログを抑制                                    |
