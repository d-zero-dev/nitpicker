# pipeline

`crawl`、`analyze`、`report` を1コマンドで直列実行します。

## 基本形

```sh
npx @nitpicker/cli pipeline <URL> [options]
```

例:

```sh
npx @nitpicker/cli pipeline https://example.com --all
npx @nitpicker/cli pipeline https://example.com --sheet <Google Sheets URL> --all
```

`--sheet` を指定した場合だけ `report` ステップを実行します。指定しない場合は `crawl` と `analyze` までを実行します。

## オプション一覧

### crawl系

| オプション                                 | 型                 | 説明                                                  |
| ------------------------------------------ | ------------------ | ----------------------------------------------------- |
| `--interval`, `-I`                         | number             | リクエスト間隔をミリ秒で指定                          |
| `--image` / `--no-image`                   | boolean            | 画像を取得するか。既定は有効                          |
| `--fetch-external` / `--no-fetch-external` | boolean            | 外部リンクを取得するか。既定は有効                    |
| `--parallels`, `-P`                        | number             | 並列スクレイピング数                                  |
| `--recursive` / `--no-recursive`           | boolean            | 再帰クロールするか。既定は有効                        |
| `--exclude`                                | string, repeatable | 除外するページURLパスのglob                           |
| `--exclude-keyword`                        | string, repeatable | ページ本文に含まれる除外キーワード                    |
| `--exclude-url`                            | string, repeatable | 除外する外部URL prefix                                |
| `--disable-queries`, `-Q`                  | boolean            | URLのクエリ文字列を無効化                             |
| `--image-file-size-threshold`              | number             | 画像ファイルサイズのしきい値                          |
| `--single`                                 | boolean            | 単一ページモード                                      |
| `--max-excluded-depth`                     | number             | 指定深さを超えるクロールを避ける                      |
| `--retry`                                  | number             | URLごとのスクレイプ失敗リトライ回数。既定は `3`       |
| `--list`                                   | string, repeatable | 指定URLリストだけをクロール                           |
| `--list-file`                              | string             | URLリストファイルだけをクロール                       |
| `--user-agent`                             | string             | HTTPリクエストのUser-Agent                            |
| `--ignore-robots`                          | boolean            | robots.txt制限を無視                                  |
| `--main-content-selector`                  | string             | メインコンテンツ領域の自動検出を上書きするCSSセレクタ |
| `--output`, `-o`                           | string             | 出力 `.nitpicker` ファイルパス                        |
| `--strict`                                 | boolean            | 外部リンクエラーを致命的エラーとして扱う              |

### analyze系

| オプション          | 型                 | 説明                                                           |
| ------------------- | ------------------ | -------------------------------------------------------------- |
| `--all`             | boolean            | すべての分析プラグインを実行し、reportでもすべてのシートを生成 |
| `--plugin`          | string, repeatable | 実行するプラグイン名を指定                                     |
| `--search-keywords` | string, repeatable | `analyze-search` の検索キーワードを設定ファイルより優先        |
| `--search-scope`    | string             | `analyze-search` の検索範囲CSSセレクタを設定ファイルより優先   |
| `--axe-lang`        | string             | `analyze-axe` のBCP 47言語タグを設定ファイルより優先           |

### report系

| オプション            | 型      | 説明                                                  |
| --------------------- | ------- | ----------------------------------------------------- |
| `--sheet`, `-S`       | string  | Google Sheets URL。指定時だけreportステップを実行     |
| `--credentials`, `-C` | string  | 認証情報ファイル。既定は `./credentials.json`         |
| `--config`, `-c`      | string  | 設定ファイルパス                                      |
| `--limit`, `-l`       | number  | アーカイブから一度に読み込むページ数。既定は `100000` |
| `--dedupe-resources`  | boolean | Resourcesシートをcanonical URL単位で集約              |

### 共通

| オプション  | 型      | 説明               |
| ----------- | ------- | ------------------ |
| `--verbose` | boolean | 詳細ログを出力     |
| `--silent`  | boolean | 標準出力ログを抑制 |
