# Nitpicker

Web サイト全体のデータを取得するツール。クロール、リンクのメタデータ取得、ネットワークリソースの記録、各ページのレンダリング後 HTML スナップショット生成が可能。

## 概要

ヘッドレスブラウザで各ページをレンダリングし、JavaScript などレンダリングに影響するほぼすべての処理が完了するまで待機する。これにより、生成された DOM から HTML スナップショットを取得できる。また、`loading=lazy` 属性や `IntersectionObserver` で遅延されるネットワーク処理や DOM 操作を捕捉するため、各ページの末尾までスクロールし、ページコンテンツを網羅的に取得する。

## 取得可能なデータ

- サイトマップと URL 一覧
- 各ページのメタデータ
- 各ネットワークリクエストのリクエスト・レスポンスヘッダー
- 各ページのレンダリング後 DOM の HTML スナップショット

## 使い方

### Crawl

Web サイトをクロールして `.nitpicker` アーカイブファイルを生成する。

```sh
$ npx @nitpicker/cli crawl <URL>
```

**作業ディレクトリ** に `example.com-YYYYMMDDHHMMSSmmm.nitpicker` というファイルが作成される。

#### 例

```sh
$ npx @nitpicker/cli crawl https://example.com
```

#### オプション

| オプション                    | 値                            | デフォルト            | 複数指定 | 説明                                         |
| ----------------------------- | ----------------------------- | --------------------- | -------- | -------------------------------------------- |
| `--interval` `-I`             | 数値                          | なし                  | 不可     | クロール時のリクエスト間隔（ミリ秒）         |
| `--parallels` `-P`            | 数値                          | なし                  | 不可     | 並列スクレイピングプロセス数                 |
| `--no-image`                  | なし                          | なし                  | 不可     | 画像を取得しない                             |
| `--image-file-size-threshold` | 数値                          | なし                  | 不可     | 画像ファイルサイズの閾値（バイト）           |
| `--single`                    | なし                          | なし                  | 不可     | 単一ページモード（リンク探索なし）           |
| `--no-fetch-external`         | なし                          | なし                  | 不可     | 外部リンクを取得しない                       |
| `--no-recursive`              | なし                          | なし                  | 不可     | 再帰クロールを無効化                         |
| `--scope`                     | ホスト名/URL（カンマ区切り）  | なし                  | 不可     | クロールスコープに追加するホスト名・URL      |
| `--exclude`                   | URL パス（glob パターン）     | なし                  | 可       | 指定パスに一致するページを除外               |
| `--exclude-keyword`           | 文字列または正規表現          | なし                  | 可       | 指定キーワードを含むページを除外             |
| `--exclude-url`               | URL プレフィックス            | なし                  | 可       | 指定プレフィックスで始まる URL を除外        |
| `--disable-queries` `-Q`      | なし                          | なし                  | 不可     | URL のクエリ文字列を無効化                   |
| `--max-excluded-depth`        | 数値                          | なし                  | 不可     | 指定した深さを超えるクロールをスキップ       |
| `--retry`                     | 数値                          | `3`                   | 不可     | スクレイプ失敗時の URL ごとのリトライ回数    |
| `--list`                      | URL                           | なし                  | 可       | 指定リストのページのみクロール               |
| `--list-file`                 | ファイルパス                  | なし                  | 不可     | リストファイルに記載されたページのみクロール |
| `--resume` `-R`               | ファイルパス（stub ファイル） | なし                  | 不可     | 保存された状態からクロールを再開             |
| `--user-agent`                | 文字列                        | `Nitpicker/<version>` | 不可     | HTTP リクエストのカスタム User-Agent 文字列  |
| `--ignore-robots`             | なし                          | なし                  | 不可     | robots.txt の制限を無視する                  |
| `--verbose`                   | なし                          | なし                  | 不可     | 実行中に詳細ログを標準出力に表示             |
| `--silent`                    | なし                          | なし                  | 不可     | 実行中のログ出力を抑制                       |
| `--diff`                      | なし                          | なし                  | 不可     | 差分モード                                   |

#### 例

```sh
$ npx @nitpicker/cli crawl https://example.com --interval 5000
$ npx @nitpicker/cli crawl https://example.com --parallels 50
$ npx @nitpicker/cli crawl https://example.com --no-image
$ npx @nitpicker/cli crawl https://example.com --no-fetch-external
$ npx @nitpicker/cli crawl https://example.com --no-recursive
$ npx @nitpicker/cli crawl https://example.com --scope "www.example.com, www3.example.com, https://blog.example.com/blog"
$ npx @nitpicker/cli crawl https://example.com --exclude "/blog/**/*"
$ npx @nitpicker/cli crawl https://example.com --exclude-keyword "/Error/i" --exclude-keyword "404"
$ npx @nitpicker/cli crawl https://example.com --max-excluded-depth 10
$ npx @nitpicker/cli crawl --list-file ./page-list.txt
$ npx @nitpicker/cli crawl --list https://example.com/page1 https://example.com/page2 https://example.com/page3
$ npx @nitpicker/cli crawl --resume ./suspended-logs.stub
$ cat page-list.txt | xargs npx @nitpicker/cli crawl --list
$ npx @nitpicker/cli crawl https://example.com --verbose
$ npx @nitpicker/cli crawl https://example.com --user-agent "MyBot/1.0"
$ npx @nitpicker/cli crawl https://example.com --ignore-robots
```

##### Tips: 認証付き URL

```sh
$ npx @nitpicker/cli crawl https://USERNAME:PASSWORD@demo.example.com
```

#### 責任あるクローリング

Nitpicker はデフォルトで以下の責任あるクローリング機能を備えています:

- **robots.txt 準拠**: 各サイトの `robots.txt` を自動的に取得・遵守します。`--ignore-robots` フラグで無効化できますが、使用には十分注意してください。
- **User-Agent 識別**: デフォルトで `Nitpicker/<version>` を User-Agent として送信し、サイト管理者がクローラーを識別できるようにします。`--user-agent` で変更可能です。
- **リクエスト間隔**: `--interval` オプションでリクエスト間の待機時間をミリ秒単位で設定でき、対象サーバーへの負荷を軽減できます。

> **注意**: 本ツールの使用はユーザー自身の責任において行ってください。クローリング対象サイトの利用規約を必ず遵守してください。許可なくクローリングを行うことは法的リスクを伴う場合があります。

### Analyze

`.nitpicker` アーカイブファイルに対して analyze プラグインを実行する。axe（アクセシビリティ）、Lighthouse（パフォーマンス）、markuplint（HTML 検証）、textlint（テキスト校正）などのプラグインを実行できる。

```sh
$ npx @nitpicker/cli analyze <file>
```

#### 例

```sh
$ npx @nitpicker/cli analyze example.com-20250101120000000.nitpicker
$ npx @nitpicker/cli analyze example.com-20250101120000000.nitpicker --all
```

#### オプション

| オプション  | 値   | デフォルト | 説明                                                      |
| ----------- | ---- | ---------- | --------------------------------------------------------- |
| `--all`     | なし | なし       | 対話プロンプトなしで設定済みの全 analyze プラグインを実行 |
| `--verbose` | なし | なし       | 分析中に詳細ログを出力                                    |

`--all` を指定しない場合、実行するプラグインを選択する対話式マルチセレクトプロンプトが表示される。

### Report

`.nitpicker` アーカイブファイルから Google Sheets レポートを生成する。Google Sheets の URL と OAuth2 サービスアカウントの認証情報が必要。

```sh
$ npx @nitpicker/cli report <file> --sheet <URL>
```

#### 例

```sh
$ npx @nitpicker/cli report example.com-20250101120000000.nitpicker --sheet "https://docs.google.com/spreadsheets/d/xxx/edit"
$ npx @nitpicker/cli report example.com-20250101120000000.nitpicker --sheet "https://docs.google.com/spreadsheets/d/xxx/edit" --credentials ./my-credentials.json
$ npx @nitpicker/cli report example.com-20250101120000000.nitpicker --sheet "https://docs.google.com/spreadsheets/d/xxx/edit" --config ./nitpicker.config.json
```

#### オプション

| オプション           | 値           | デフォルト           | 説明                           |
| -------------------- | ------------ | -------------------- | ------------------------------ |
| `--sheet` `-S`       | URL          | （必須）             | Google Sheets の URL           |
| `--credentials` `-C` | ファイルパス | `./credentials.json` | OAuth2 認証情報ファイルのパス  |
| `--config` `-c`      | ファイルパス | なし                 | nitpicker 設定ファイルのパス   |
| `--limit` `-l`       | 数値         | `100000`             | ページデータ取得のバッチサイズ |

生成するシートを選択する対話式マルチセレクトプロンプトが表示される（Page List、Links、Resources、Images、Violations、Compares、Summary、Referrers Relational Table、Resources Relational Table）。
