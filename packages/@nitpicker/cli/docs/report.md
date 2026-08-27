# report

`.nitpicker` アーカイブをGoogle Sheetsまたは単一の静的HTMLファイルへ出力します。

## 基本形

```sh
npx @nitpicker/cli report <archive>.nitpicker --sheet <Google Sheets URL> [options]
npx @nitpicker/cli report <archive>.nitpicker --html [options]
```

例:

```sh
npx @nitpicker/cli report ./site.nitpicker --sheet <Google Sheets URL> --all
npx @nitpicker/cli report ./site.nitpicker --html --output ./site.html
```

非TTY環境では対話選択で停止しないように、すべてのシート生成と詳細ログが有効になります。

## 静的HTMLレポート

`--html` はGoogle認証を行わず、viewerと同じサマリ表示と内部ページ一覧を
`file://` で開ける自己完結HTMLへ出力します。出力先を省略すると、現在の
ディレクトリにアーカイブ名と同じ `.html` ファイルを作成します。

一覧が10,000件を超える場合は、対象ディレクトリをカンマ区切りで入力します。
単一ホストでは `/docs` のようなpathnameまたは完全なURLを使用できます。
複数ホストを含むアーカイブでは完全なURLだけを使用できます。非TTY環境では
`--html-dirs` で同じ値を指定してください。

`--output` の親ディレクトリは作成しません。ネストしたパスを指定する場合は、
先にディレクトリを用意してください。既存のファイルは確認なしで上書きします。

```sh
npx @nitpicker/cli report ./site.nitpicker --html --html-dirs /docs,/help
```

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

| オプション            | 型      | 説明                                          |
| --------------------- | ------- | --------------------------------------------- |
| `--sheet`, `-S`       | string  | 出力先Google Sheets URL                       |
| `--html`, `-H`        | boolean | 自己完結した静的HTMLを生成                    |
| `--output`, `-o`      | string  | HTML出力先                                    |
| `--html-dirs`         | string  | HTMLの対象ディレクトリ接頭辞（カンマ区切り）  |
| `--credentials`, `-C` | string  | 認証情報ファイル。既定は `./credentials.json` |
| `--config`, `-c`      | string  | 設定ファイルパス                              |
| `--all`               | boolean | 対話選択なしですべてのシートを生成            |
| `--dedupe-resources`  | boolean | Resourcesシートをcanonical URL単位で集約      |
| `--verbose`           | boolean | 詳細ログを出力                                |
| `--silent`            | boolean | 標準出力ログを抑制                            |
