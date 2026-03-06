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

**作業ディレクトリ** に `example.com-YYYYMMDDHHMMSSmmm.nitpicker` というファイルが作成される。`--output` (`-o`) を指定した場合はそのパスに出力される。

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
| `--output` `-o`               | ファイルパス                  | 自動生成              | 不可     | アーカイブファイルの出力先パス               |
| `--strict`                    | なし                          | なし                  | 不可     | 外部リンクエラーも致命的エラーとして扱う     |
| `--verbose`                   | なし                          | なし                  | 不可     | 実行中に詳細ログを標準出力に表示             |
| `--silent`                    | なし                          | なし                  | 不可     | 実行中のログ出力を抑制                       |
| `--diff`                      | なし                          | なし                  | 不可     | 差分モード                                   |

#### 例

```sh
$ npx @nitpicker/cli crawl https://example.com --interval 5000
$ npx @nitpicker/cli crawl https://example.com --parallels 50
$ npx @nitpicker/cli crawl https://example.com --no-image
$ npx @nitpicker/cli crawl https://example.com --single
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
$ npx @nitpicker/cli crawl https://example.com --output ./reports/site.nitpicker
$ npx @nitpicker/cli crawl https://example.com -o custom-name
```

#### 終了コード

| コード | 意味                   | 説明                                                           |
| ------ | ---------------------- | -------------------------------------------------------------- |
| `0`    | 成功                   | エラーなしで完了                                               |
| `1`    | 致命的エラー           | 引数不足、内部エラー、スコープ内ページのスクレイプ失敗など     |
| `2`    | 警告（外部エラーのみ） | 外部リンク（DNS 失敗、証明書エラー等）のみでクロール自体は成功 |

CI/CD パイプラインでは、外部リンクの一時的な障害でビルドが失敗しないよう exit code `2` を利用できる。`--strict` を指定すると外部リンクエラーも exit code `1`（致命的）として扱う。

```sh
# CI: 外部リンクエラーを無視（exit 2 を許容）
npx @nitpicker/cli crawl https://example.com || [ $? -eq 2 ]

# CI: 外部リンクエラーも失敗にする
npx @nitpicker/cli crawl https://example.com --strict
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
$ npx @nitpicker/cli analyze example.com-20250101120000000.nitpicker --plugin @nitpicker/analyze-axe
$ npx @nitpicker/cli analyze example.com-20250101120000000.nitpicker --plugin @nitpicker/analyze-axe --plugin @nitpicker/analyze-textlint
```

#### オプション

| オプション                | 値              | デフォルト | 複数指定 | 説明                                                                               |
| ------------------------- | --------------- | ---------- | -------- | ---------------------------------------------------------------------------------- |
| `--all`                   | なし            | なし       | 不可     | 対話プロンプトなしで設定済みの全 analyze プラグインを実行                          |
| `--plugin`                | プラグイン名    | なし       | 可       | 実行するプラグインを指定（`--all` より優先度が低い）                               |
| `--verbose`               | なし            | なし       | 不可     | 分析中に詳細ログを出力                                                             |
| `--search-keywords`       | 文字列          | なし       | 可       | analyze-search プラグインの検索キーワード（設定ファイルを上書き）                  |
| `--search-scope`          | CSS セレクタ    | なし       | 不可     | analyze-search プラグインの検索スコープ（設定ファイルを上書き）                    |
| `--main-content-selector` | CSS セレクタ    | なし       | 不可     | analyze-main-contents プラグインのメインコンテンツセレクタ（設定ファイルを上書き） |
| `--axe-lang`              | BCP 47 言語タグ | なし       | 不可     | analyze-axe プラグインの言語設定（設定ファイルを上書き）                           |
| `--silent`                | なし            | なし       | 不可     | 実行中のログ出力を抑制                                                             |

`--all` も `--plugin` も指定しない場合、実行するプラグインを選択する対話式マルチセレクトプロンプトが表示される。非 TTY 環境（CI/CD パイプラインなど）ではプロンプトを表示できないため、全プラグインが自動的に実行される。また、非 TTY 環境では `--verbose` が自動的に有効になり、エラー発生時のスタックトレースが CI ログに出力される。

`--search-keywords` などのプラグインオプションフラグは、設定ファイル（`.nitpickerrc` 等）の該当プラグイン設定を上書きする。指定しないフラグは設定ファイルの値がそのまま使用される。

#### 例

```sh
$ npx @nitpicker/cli analyze site.nitpicker --all --axe-lang ja
$ npx @nitpicker/cli analyze site.nitpicker --all --search-keywords "keyword1" --search-keywords "keyword2"
$ npx @nitpicker/cli analyze site.nitpicker --all --search-scope "main" --main-content-selector "#content"
```

### Report

`.nitpicker` アーカイブファイルから Google Sheets レポートを生成する。Google Sheets の URL と OAuth2 サービスアカウントの認証情報が必要。

```sh
$ npx @nitpicker/cli report <file> --sheet <URL>
```

#### オプション

| オプション           | 値           | デフォルト           | 説明                                                            |
| -------------------- | ------------ | -------------------- | --------------------------------------------------------------- |
| `--sheet` `-S`       | URL          | （必須）             | Google Sheets の URL                                            |
| `--credentials` `-C` | ファイルパス | `./credentials.json` | OAuth2 認証情報ファイルのパス                                   |
| `--config` `-c`      | ファイルパス | なし                 | nitpicker 設定ファイルのパス                                    |
| `--limit` `-l`       | 数値         | `100000`             | ページデータ取得のバッチサイズ                                  |
| `--all`              | なし         | なし                 | 対話プロンプトなしで全シートを生成（非TTY環境では自動的に有効） |
| `--verbose`          | なし         | なし                 | 実行中に詳細ログを標準出力に表示                                |
| `--silent`           | なし         | なし                 | 実行中のログ出力を抑制                                          |

`--all` を指定しない場合、生成するシートを選択する対話式マルチセレクトプロンプトが表示される（Page List、Links、Resources、Images、Violations、Discrepancies、Summary、Referrers Relational Table、Resources Relational Table）。非TTY環境（CI パイプライン等）では `--all` と `--verbose` が自動的に有効になり、エラー発生時のスタックトレースが CI ログに出力される。

#### 例

```sh
$ npx @nitpicker/cli report example.com-20250101120000000.nitpicker --sheet "https://docs.google.com/spreadsheets/d/xxx/edit"
$ npx @nitpicker/cli report example.com-20250101120000000.nitpicker --sheet "https://docs.google.com/spreadsheets/d/xxx/edit" --credentials ./my-credentials.json
$ npx @nitpicker/cli report example.com-20250101120000000.nitpicker --sheet "https://docs.google.com/spreadsheets/d/xxx/edit" --config ./nitpicker.config.json
$ npx @nitpicker/cli report example.com-20250101120000000.nitpicker --sheet "https://docs.google.com/spreadsheets/d/xxx/edit" --all --silent
```

### Pipeline

crawl → analyze → report の全ワークフローを直列で実行する。1コマンドでクロールから分析・レポートまで完結できる。

```sh
$ npx @nitpicker/cli pipeline <URL>
```

`--sheet` を指定した場合のみ report ステップが実行される。指定しない場合は crawl + analyze の 2 ステップのみ実行される。

#### オプション

crawl / analyze / report のオプションをすべて指定可能。各ステップに対応するフラグが自動的にルーティングされる。

| カテゴリ | 主要オプション                                                                               | 説明                                           |
| -------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| crawl    | `--interval`, `--parallels`, `--no-image`, `--scope`, `--exclude`, `--output`, `--strict` 等 | クロール動作の制御（crawl セクション参照）     |
| analyze  | `--all`, `--plugin`, `--search-keywords`, `--axe-lang` 等                                    | 分析プラグインの制御（analyze セクション参照） |
| report   | `--sheet`, `--credentials`, `--config`, `--limit`                                            | レポート出力の制御（report セクション参照）    |
| 共通     | `--verbose`, `--silent`                                                                      | ログ出力の制御                                 |

> **注意**: `--resume`, `--diff` は crawl 専用モードのため pipeline では使用不可。

#### 例

```sh
# 基本: crawl + analyze（report なし）
$ npx @nitpicker/cli pipeline https://example.com --all

# フル: crawl + analyze + report
$ npx @nitpicker/cli pipeline https://example.com --all --sheet "https://docs.google.com/spreadsheets/d/xxx/edit"

# プラグイン指定 + レポート
$ npx @nitpicker/cli pipeline https://example.com --plugin @nitpicker/analyze-axe --sheet "https://docs.google.com/spreadsheets/d/xxx/edit"

# CI 向け: 全自動 + ログ抑制
$ npx @nitpicker/cli pipeline https://example.com --all --silent --sheet "https://docs.google.com/spreadsheets/d/xxx/edit"

# 出力パス指定
$ npx @nitpicker/cli pipeline https://example.com --all --output ./reports/site
```
