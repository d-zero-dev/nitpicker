# Nitpicker

[![CI](https://github.com/d-zero-dev/nitpicker/actions/workflows/ci.yml/badge.svg)](https://github.com/d-zero-dev/nitpicker/actions/workflows/ci.yml)
[![E2E](https://github.com/d-zero-dev/nitpicker/actions/workflows/e2e.yml/badge.svg)](https://github.com/d-zero-dev/nitpicker/actions/workflows/e2e.yml)

Web サイト全体のデータを取得するツール。クロール、リンクのメタデータ取得、ネットワークリソースの記録、各ページのレンダリング後 HTML スナップショット生成が可能。

## 概要

ヘッドレスブラウザで各ページをレンダリングし、JavaScript などレンダリングに影響するほぼすべての処理が完了するまで待機する。これにより、生成された DOM から HTML スナップショットを取得できる。また、`loading=lazy` 属性や `IntersectionObserver` で遅延されるネットワーク処理や DOM 操作を捕捉するため、各ページの末尾までスクロールし、ページコンテンツを網羅的に取得する。

## 取得可能なデータ

- サイトマップと URL 一覧
- 各ページのメタデータ
- 各ネットワークリクエストのリクエスト・レスポンスヘッダー
- 各ページのレンダリング後 DOM の HTML スナップショット

## 使い方

### バージョン確認

```sh
$ npx @nitpicker/cli -v
$ npx @nitpicker/cli --version
```

`@nitpicker/cli` パッケージのバージョンを出力して終了する（exit code 0）。バグレポートや CI ログにバージョンを残す際に使用する。

### Crawl

Web サイトをクロールして `.nitpicker` アーカイブファイルを生成する。

```sh
$ npx @nitpicker/cli crawl <URL> [<URL>...]
```

**作業ディレクトリ** に `example.com-YYYYMMDDHHMMSSmmm.nitpicker` というファイルが作成される。`--output` (`-o`) を指定した場合はそのパスに出力される。

URL を複数渡すと、それぞれが「再帰クロールの起点」かつ「scope エントリ」として扱われ、1 つの `.nitpicker` に集約される（multi-root クロール）。既存 `.nitpicker` に対しては `crawl <archive> --append <URL>` の形で起点 URL を追加クロールできる。

#### 例

```sh
$ npx @nitpicker/cli crawl https://example.com
$ npx @nitpicker/cli crawl https://www.example.com/blog/ https://www.example.com/news/
$ npx @nitpicker/cli crawl existing.nitpicker --append https://sample-b.com/
```

#### オプション

| オプション                    | 値                                      | デフォルト            | 複数指定 | 説明                                                                                                                                                                                   |
| ----------------------------- | --------------------------------------- | --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--interval` `-I`             | 数値                                    | なし                  | 不可     | クロール時のリクエスト間隔（ミリ秒）                                                                                                                                                   |
| `--parallels` `-P`            | 数値                                    | なし                  | 不可     | 並列スクレイピングプロセス数                                                                                                                                                           |
| `--no-image`                  | なし                                    | なし                  | 不可     | 画像を取得しない                                                                                                                                                                       |
| `--image-file-size-threshold` | 数値                                    | なし                  | 不可     | 画像ファイルサイズの閾値（バイト）                                                                                                                                                     |
| `--single`                    | なし                                    | なし                  | 不可     | 単一ページモード（リンク探索なし）                                                                                                                                                     |
| `--no-fetch-external`         | なし                                    | なし                  | 不可     | 外部リンクを取得しない                                                                                                                                                                 |
| `--no-recursive`              | なし                                    | なし                  | 不可     | 再帰クロールを無効化                                                                                                                                                                   |
| `--exclude`                   | URL パス（glob パターン、カンマ区切り） | なし                  | 可       | 指定パスに一致するページを除外                                                                                                                                                         |
| `--exclude-keyword`           | 文字列または正規表現                    | なし                  | 可       | 指定キーワードを含むページを除外                                                                                                                                                       |
| `--exclude-url`               | URL プレフィックス                      | なし                  | 可       | 指定プレフィックスで始まる URL を除外                                                                                                                                                  |
| `--disable-queries` `-Q`      | なし                                    | なし                  | 不可     | URL のクエリ文字列を無効化                                                                                                                                                             |
| `--max-excluded-depth`        | 数値                                    | なし                  | 不可     | 指定した深さを超えるクロールをスキップ                                                                                                                                                 |
| `--retry`                     | 数値                                    | `3`                   | 不可     | スクレイプ失敗時の URL ごとのリトライ回数                                                                                                                                              |
| `--list`                      | URL                                     | なし                  | 可       | 指定リストのページのみクロール                                                                                                                                                         |
| `--list-file`                 | ファイルパス                            | なし                  | 不可     | リストファイルに記載されたページのみクロール                                                                                                                                           |
| `--resume` `-R`               | ファイルパス（stub ファイル）           | なし                  | 不可     | 保存された状態からクロールを再開                                                                                                                                                       |
| `--append` `-A`               | URL                                     | なし                  | 可       | 位置引数のアーカイブに対して URL を新しい起点として追加クロール。スコープに新たに含まれる旧 external ページは internal として再スクレイプされる。失敗時は `<archive>.bak` から自動復元 |
| `--user-agent`                | 文字列                                  | `Nitpicker/<version>` | 不可     | HTTP リクエストのカスタム User-Agent 文字列                                                                                                                                            |
| `--ignore-robots`             | なし                                    | なし                  | 不可     | robots.txt の制限を無視する                                                                                                                                                            |
| `--output` `-o`               | ファイルパス                            | 自動生成              | 不可     | アーカイブファイルの出力先パス                                                                                                                                                         |
| `--strict`                    | なし                                    | なし                  | 不可     | 外部リンクエラーも致命的エラーとして扱う                                                                                                                                               |
| `--verbose`                   | なし                                    | なし                  | 不可     | 実行中に詳細ログを標準出力に表示                                                                                                                                                       |
| `--silent`                    | なし                                    | なし                  | 不可     | 実行中のログ出力を抑制                                                                                                                                                                 |
| `--diff`                      | なし                                    | なし                  | 不可     | 差分モード                                                                                                                                                                             |

> **URL の形式**: URL 引数および `--list` / `--list-file` で指定する URL は、プロトコルを含む完全な形式（例: `https://example.com`）である必要があります。`example.com` のようなホスト名のみの指定はエラーになります。

#### 例

```sh
$ npx @nitpicker/cli crawl https://example.com --interval 5000
$ npx @nitpicker/cli crawl https://example.com --parallels 50
$ npx @nitpicker/cli crawl https://example.com --no-image
$ npx @nitpicker/cli crawl https://example.com --single
$ npx @nitpicker/cli crawl https://example.com --no-fetch-external
$ npx @nitpicker/cli crawl https://example.com --no-recursive
$ npx @nitpicker/cli crawl https://example.com --exclude "/blog/**/*"
$ npx @nitpicker/cli crawl https://example.com --exclude "/blog/**/*,/facility/**/*"
$ npx @nitpicker/cli crawl https://example.com --exclude-keyword "/Error/i" --exclude-keyword "404"
$ npx @nitpicker/cli crawl https://example.com --max-excluded-depth 10
$ npx @nitpicker/cli crawl --list-file ./page-list.txt
$ npx @nitpicker/cli crawl --list https://example.com/page1 https://example.com/page2 https://example.com/page3
$ npx @nitpicker/cli crawl --resume ./suspended-logs.stub
$ npx @nitpicker/cli crawl ./existing.nitpicker --append https://sample-b.com/
$ npx @nitpicker/cli crawl ./existing.nitpicker --append https://a.com/ --append https://b.com/
$ npx @nitpicker/cli crawl https://www.example.com/blog/ https://www.example.com/news/
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

##### Multi-root クロール

位置引数で複数 URL を渡すと、それぞれが「再帰クロールの起点」かつ「スコープエントリ」として扱われ、1 つの `.nitpicker` に集約される。

```sh
# 同一ホストの複数サブパスを 1 アーカイブに集約
$ npx @nitpicker/cli crawl \
    https://www.example.com/blog/ \
    https://www.example.com/news/

# 異なるホストを 1 プロジェクトとして扱う（サブドメイン群など）
$ npx @nitpicker/cli crawl https://www.example.com/ https://blog.example.com/
```

スコープ判定は `(hostname, port, path)` のトリプル。ドメインスコープ（path=`/`）とサブディレクトリスコープ（path=`/blog/`）は同じ仕組みで表現され、同一ホストの異なるポート（`localhost:3000` と `localhost:8080`）は別 scope として隔離される。

##### `--append`: 既存アーカイブへの追加クロール

既存の `.nitpicker` を位置引数で渡し、`--append` で追加する起点 URL を指定する。`--append` は次の `--flag` まで連続する URL を貪欲に吸い上げるので、複数 URL は単一の `--append` の後ろにスペース区切りで並べてもよいし、`--append` を繰り返してもよい。

```sh
# 単一 URL を追加
$ npx @nitpicker/cli crawl ./existing.nitpicker --append https://sample-b.com/

# 複数 URL を追加（貪欲形 — 次の --flag まで全部 --append の値になる）
$ npx @nitpicker/cli crawl ./existing.nitpicker \
    --append https://a.com/ https://b.com/ https://c.com/ \
    --interval 5000

# 複数 URL を追加（繰り返し形）
$ npx @nitpicker/cli crawl ./existing.nitpicker --append https://a.com/ --append https://b.com/
```

挙動:

- `--append` の URL 群が新しい再帰起点として `info.roots` に追加される
- 既存アーカイブで `external` として保存されていたページのうち、拡張後のスコープに該当するものは `internal` として再スクレイプされる
- クロール開始前に `<archive>.bak` バックアップを作成。クロール失敗時は `.bak` から自動復元、成功時は `.bak` を削除
- `--list` / `--list-file` で作成された list-mode archive への append は拒否される
- `--resume` / `--diff` / `--output` / `--list` / `--list-file` / `--single` との同時指定は不可

##### Tips: 認証付き URL

```sh
$ npx @nitpicker/cli crawl https://USERNAME:PASSWORD@demo.example.com
```

スコープエントリに付与された Basic 認証情報は、同じ `(hostname, port)` 配下の URL にのみ注入される。別ポートや別ホストへのリクエストには漏れない設計。

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
| `--limit` `-l`       | 数値         | `100000`             | アーカイブからページを取得する 1 バッチあたりのページ数         |
| `--all`              | なし         | なし                 | 対話プロンプトなしで全シートを生成（非TTY環境では自動的に有効） |
| `--dedupe-resources` | なし         | なし                 | Resources シートを canonical URL で集約（後述）                 |
| `--verbose`          | なし         | なし                 | 実行中に詳細ログを標準出力に表示                                |
| `--silent`           | なし         | なし                 | 実行中のログ出力を抑制                                          |

`--all` を指定しない場合、生成するシートを選択する対話式マルチセレクトプロンプトが表示される（Page List、Links、Resources、Images、Violations、Discrepancies、Summary、Referrers Relational Table、Resources Relational Table）。非TTY環境（CI パイプライン等）では `--all` と `--verbose` が自動的に有効になり、エラー発生時のスタックトレースが CI ログに出力される。

`--limit` はアーカイブからメモリへ一度に読み込むページ数を制御する値で、Google Sheets API への 1 リクエストあたりの行数とは別物。各シートの行送信は `@d-zero/google-sheets` の `Sheet.appendRow` が内部で 2500 行ごとに自動 flush するため、呼び出し元側のメモリ滞留はチャンクサイズ分に抑えられる。Page List のような遅延セルを含むシートは、library が自動的にバッチ末尾の `flush()` まで送信を保留する（詳細は `ARCHITECTURE.md` の Report 章を参照）。

Resources シートは出力時に URL の自然順（`image-2.jpg` が `image-10.jpg` より先に出る並び順、大文字小文字は同一視）でソートされる。raw / dedupe 両モードに同じ並び順が適用されるので、複数回 report しても同じ URL が同じ場所に出る。実装は Martin Pool の `strnatcmp` の JS 移植で、文字コードを直接比較する on-the-fly 方式（派生文字列を生成しないため大規模アーカイブでもメモリを浪費しない）。

##### `--dedupe-resources`: Resources シートの集約

Google Sheets には 1 ドキュメントあたり **10,000,000 セル** という上限がある。広告/解析タグ（Google Ads conversion, Facebook Pixel, Yahoo, Bing UET, LINE Tag 等）はページごとに per-request unique なクエリパラメータ付き URL を生成するため、`Resources` テーブルに数百万件のレコードが積まれることがあり、6 列 × 数百万行ですぐ上限に達する。

`--dedupe-resources` を指定すると、Resources シートを **canonical URL** で集約して出力する。

- **canonical 化規則**: パスはそのまま、クエリは値を捨てキーのみ sort & unique。フラグメントは元から除去済み
  - 例: `?auid=XYZ&capi=1&crd=ABC` → `?auid&capi&crd`
- **集約キー**: `(canonical URL, status, contentType)` の組
- **追加列**: 末尾に `Count`（その canonical group に集約された raw レコード数）と `Query Pattern`（各クエリキーのユニーク値数）
- **Content Length 列**: グループ内で値が異なれば `100-500` のような min-max 表示
- **Referrers 列**: グループ内の全 referrer URL を union（重複排除）してセル note に列挙
- **path 内の ID は保持**: `/pagead/viewthroughconversion/10840516367/` のような conversion ID はそのまま残るので、クライアントへの「Google Ads 入っていますか / どの conversion ID 使っていますか」の質問にこの 1 シートで答えられる
- **Query Pattern 列**: 各クエリキーに対して観測されたユニーク値数を `key=N` 形式で列挙。例: `auid=27, capi=1, crd=25, dt=2`。`N=1` は実質定数（例: `capi=1` は全件同じ値）、`N>1` は per-request 変動キー（例: `auid=27` は 27 個の session ID が観測された）。サンプル上限 100 を超えた場合のみ `key=100+` 表示（100 ジャストの場合は `key=100` で `+` は付かない）。値そのものは記録しない（プライバシー / メモリ配慮）

実例: 1,600,724 件の raw resource が 63,385 件まで集約（**96% 削減**、Google Sheets 上の 9.6M セルが 380K セルになる）。

##### 使い分けの目安

- **デフォルト（指定なし、raw mode）**: 通常はこちらで十分。raw URL を 1 件ずつそのまま出力するため、特定のリクエスト URL を完全に追跡したい場合に有用。Resources 件数が数万件以下のサイトはほぼ常にこのモードで問題ない。
- **`--dedupe-resources` 指定（dedupe mode）**: 以下のいずれかに該当するときに検討する。
  - report 実行時に `Error: This document is too large to continue editing.` が出る
  - 事前に Resources 件数を見積もって 100,000 件を超えると分かっている（広告/解析タグ多数 + ページ数大、写真ライブラリのような per-image unique URL を大量に生成するサイト等）
  - クライアントへの監査レポート用途で「どんなトラッキングが入っているか」を一覧化したい（per-request の細かい値より、ホスト+パス+クエリキー構成での集約のほうが読みやすい）

> **メモリ目安**: 1.6M リソース級のアーカイブでは `getResources()` の結果配列だけで約 1〜1.5 GB を消費する。Sort 自体は派生文字列を生成しない on-the-fly 比較（Pool 移植版）なので追加メモリは O(1) per compare、auxiliary 約 13 MB のみ。dedupe モードでは集約用 Map と referrer 集合がさらに数百 MB を要する。Node デフォルトヒープ（4 GB）で 1.6M 級は厳しいので、巨大アーカイブには `NODE_OPTIONS=--max-old-space-size=8192` を指定すること。10 万件規模なら 1〜2 GB で収まりデフォルトで動く。
>
> ```sh
> NODE_OPTIONS=--max-old-space-size=8192 npx nitpicker report ./archive.nitpicker -S ... --dedupe-resources
> ```

#### 例

```sh
$ npx @nitpicker/cli report example.com-20250101120000000.nitpicker --sheet "https://docs.google.com/spreadsheets/d/xxx/edit"
$ npx @nitpicker/cli report example.com-20250101120000000.nitpicker --sheet "https://docs.google.com/spreadsheets/d/xxx/edit" --credentials ./my-credentials.json
$ npx @nitpicker/cli report example.com-20250101120000000.nitpicker --sheet "https://docs.google.com/spreadsheets/d/xxx/edit" --config ./nitpicker.config.json
$ npx @nitpicker/cli report example.com-20250101120000000.nitpicker --sheet "https://docs.google.com/spreadsheets/d/xxx/edit" --all --silent

# Resources が大量にあるサイト（広告/解析タグ多数等）で canonical 集約
$ npx @nitpicker/cli report example.com-20250101120000000.nitpicker --sheet "https://docs.google.com/spreadsheets/d/xxx/edit" --dedupe-resources
```

### Pipeline

crawl → analyze → report の全ワークフローを直列で実行する。1コマンドでクロールから分析・レポートまで完結できる。

```sh
$ npx @nitpicker/cli pipeline <URL>
```

`--sheet` を指定した場合のみ report ステップが実行される。指定しない場合は crawl + analyze の 2 ステップのみ実行される。

#### オプション

crawl / analyze / report のオプションをすべて指定可能。各ステップに対応するフラグが自動的にルーティングされる。

| カテゴリ | 主要オプション                                                                    | 説明                                           |
| -------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| crawl    | `--interval`, `--parallels`, `--no-image`, `--exclude`, `--output`, `--strict` 等 | クロール動作の制御（crawl セクション参照）     |
| analyze  | `--all`, `--plugin`, `--search-keywords`, `--axe-lang` 等                         | 分析プラグインの制御（analyze セクション参照） |
| report   | `--sheet`, `--credentials`, `--config`, `--limit`, `--dedupe-resources`           | レポート出力の制御（report セクション参照）    |
| 共通     | `--verbose`, `--silent`                                                           | ログ出力の制御                                 |

> **注意**: `--resume`, `--append`, `--diff` は crawl 専用モードのため pipeline では使用不可。

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

# CI: 外部リンクエラーを無視（exit 2 を許容）
$ npx @nitpicker/cli pipeline https://example.com --all --silent || [ $? -eq 2 ]

# CI: 外部リンクエラーも失敗にする
$ npx @nitpicker/cli pipeline https://example.com --all --silent --strict
```

#### 終了コード

crawl コマンドと同じ終了コード体系に従う。詳細は [crawl の終了コード](#終了コード) を参照。

### Query

`.nitpicker` アーカイブファイルに対してクエリを実行し、結果を JSON で出力する。MCP サーバーと同等のクエリ機能を CLI から利用できる。

```sh
$ npx @nitpicker/cli query <file> <sub-command> [options]
```

#### サブコマンド

| サブコマンド         | 説明                                                           | 必須オプション |
| -------------------- | -------------------------------------------------------------- | -------------- |
| `summary`            | サイト全体の概要（ページ数、ステータス分布、メタデータ充足率） | なし           |
| `pages`              | ページ一覧（ステータス・メタデータ欠損・noindex 等で絞り込み） | なし           |
| `page-detail`        | 特定ページの全詳細（メタデータ、リンク、リダイレクト）         | `--url`        |
| `html`               | ページの HTML スナップショットを取得                           | `--url`        |
| `links`              | リンク分析（broken / external / orphaned）                     | `--type`       |
| `resources`          | サブリソース一覧（CSS, JS, 画像、フォント）                    | なし           |
| `images`             | 画像一覧（alt 欠損、寸法欠損、オーバーサイズ検出）             | なし           |
| `violations`         | 分析プラグインの違反データ                                     | なし           |
| `duplicates`         | 重複タイトル・説明の検出                                       | なし           |
| `mismatches`         | メタデータ不一致の検出                                         | `--type`       |
| `headers`            | セキュリティヘッダーチェック                                   | なし           |
| `resource-referrers` | 特定リソースを参照しているページの特定                         | `--url`        |

#### オプション

| オプション              | 値     | デフォルト | 説明                                                                                                                                                                                                                                                         |
| ----------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--limit` `-l`          | 数値   | なし       | 最大結果数                                                                                                                                                                                                                                                   |
| `--offset` `-o`         | 数値   | なし       | スキップする結果数                                                                                                                                                                                                                                           |
| `--url`                 | URL    | なし       | 対象 URL（`page-detail`, `html`, `resource-referrers` で必須）                                                                                                                                                                                               |
| `--status`              | 数値   | なし       | HTTP ステータスコードで絞り込み                                                                                                                                                                                                                              |
| `--statusMin`           | 数値   | なし       | 最小 HTTP ステータスコード（以上）                                                                                                                                                                                                                           |
| `--statusMax`           | 数値   | なし       | 最大 HTTP ステータスコード（以下）                                                                                                                                                                                                                           |
| `--isExternal`          | なし   | なし       | 外部ページのみ表示                                                                                                                                                                                                                                           |
| `--missingTitle`        | なし   | なし       | title 欠損ページのみ表示                                                                                                                                                                                                                                     |
| `--missingDescription`  | なし   | なし       | description 欠損ページのみ表示                                                                                                                                                                                                                               |
| `--noindex`             | なし   | なし       | noindex ページのみ表示                                                                                                                                                                                                                                       |
| `--urlPattern`          | 文字列 | なし       | URL パターンで絞り込み（SQL LIKE パターン）                                                                                                                                                                                                                  |
| `--directory`           | 文字列 | なし       | ディレクトリパスプレフィックスで絞り込み                                                                                                                                                                                                                     |
| `--sortBy`              | 文字列 | なし       | ソートフィールド（`url`, `status`, `title`）                                                                                                                                                                                                                 |
| `--sortOrder`           | 文字列 | なし       | ソート方向（`asc`, `desc`）                                                                                                                                                                                                                                  |
| `--type`                | 文字列 | なし       | `links`: `broken`, `external`, `orphaned` / `mismatches`: `canonical`, `og:title`, `og:description`                                                                                                                                                          |
| `--contentType`         | 文字列 | なし       | Content-Type プレフィックスで絞り込み（例: `text/css`）                                                                                                                                                                                                      |
| `--contentTypeCategory` | 文字列 | なし       | `pages` のみ。Content-Type カテゴリで絞り込み（`html`, `pdf`, `image`, `css`, `javascript`, `json`, `xml`, `font`, `audio`, `video`, `archive`, `text`, `other`, `unknown`）。指定時は既定の HTML-or-null ベースフィルタを外し、PDF など非 HTML 行も列挙する |
| `--missingAlt`          | なし   | なし       | alt 属性欠損の画像のみ表示                                                                                                                                                                                                                                   |
| `--missingDimensions`   | なし   | なし       | 寸法欠損の画像のみ表示                                                                                                                                                                                                                                       |
| `--oversizedThreshold`  | 数値   | なし       | 指定寸法を超える画像のみ表示                                                                                                                                                                                                                                 |
| `--validator`           | 文字列 | なし       | バリデータ名で絞り込み（例: `axe`, `markuplint`）                                                                                                                                                                                                            |
| `--severity`            | 文字列 | なし       | 重要度で絞り込み                                                                                                                                                                                                                                             |
| `--rule`                | 文字列 | なし       | ルール ID で絞り込み                                                                                                                                                                                                                                         |
| `--field`               | 文字列 | `title`    | 重複チェック対象フィールド（`title`, `description`）                                                                                                                                                                                                         |
| `--missingOnly`         | なし   | なし       | セキュリティヘッダー欠損ページのみ表示                                                                                                                                                                                                                       |
| `--maxLength`           | 数値   | なし       | 返却する HTML の最大長                                                                                                                                                                                                                                       |
| `--pretty`              | なし   | なし       | JSON 出力を整形表示                                                                                                                                                                                                                                          |

> **`--type` フラグの使い分け**: `links` サブコマンドでは `broken`, `external`, `orphaned` のいずれか、`mismatches` サブコマンドでは `canonical`, `og:title`, `og:description` のいずれかを指定する。

#### 例

```sh
# サイト概要を取得
$ npx @nitpicker/cli query site.nitpicker summary

# ページ一覧（ステータスコード 404 で絞り込み）
$ npx @nitpicker/cli query site.nitpicker pages --status 404

# Content-Type カテゴリで絞り込み（既定の HTML-or-null 制約を外して PDF を一覧）
$ npx @nitpicker/cli query site.nitpicker pages --contentTypeCategory pdf

# 特定ページの詳細
$ npx @nitpicker/cli query site.nitpicker page-detail --url "https://example.com/about"

# HTML スナップショット取得（最大 10000 文字）
$ npx @nitpicker/cli query site.nitpicker html --url "https://example.com" --maxLength 10000

# リンク切れ一覧
$ npx @nitpicker/cli query site.nitpicker links --type broken

# alt 欠損画像の一覧
$ npx @nitpicker/cli query site.nitpicker images --missingAlt

# アクセシビリティ違反の一覧
$ npx @nitpicker/cli query site.nitpicker violations --validator axe

# 重複タイトルの検出
$ npx @nitpicker/cli query site.nitpicker duplicates --field title

# canonical 不一致の検出
$ npx @nitpicker/cli query site.nitpicker mismatches --type canonical

# セキュリティヘッダー欠損ページ
$ npx @nitpicker/cli query site.nitpicker headers --missingOnly

# 整形出力
$ npx @nitpicker/cli query site.nitpicker summary --pretty
```

### Viewer

`.nitpicker` アーカイブ、または `crawl` を強制停止した際に残る **stub ディレクトリ**（`._nitpicker-*`）をローカルブラウザで対話的に閲覧する Web ビューア。Hono バックエンド（`@nitpicker/query` を再利用）+ React SPA（Vite ビルド）で構成され、サマリー・ページ一覧（10 万ページ規模に耐える仮想スクロール）・ページ詳細（メタデータ + リンク + HTML スナップショットプレビュー）・リソース / 画像 / リンク / violations などを表示する。アーカイブを 1 つ開いたままサーバが常駐し、`Ctrl-C` で停止する。

```sh
$ npx @nitpicker/cli viewer <file-or-stub-dir> [options]
```

#### オプション

| オプション    | 値     | デフォルト  | 説明                                         |
| ------------- | ------ | ----------- | -------------------------------------------- |
| `--port` `-p` | 数値   | `4324`      | リッスンポート（使用中なら空きポートに退避） |
| `--host`      | 文字列 | `localhost` | バインドするホスト名                         |
| `--no-open`   | なし   | （開く）    | ブラウザの自動オープンを無効化               |

#### 例

```sh
# ビューアを起動してブラウザを開く
$ npx @nitpicker/cli viewer site.nitpicker

# ポート指定・ブラウザを開かない
$ npx @nitpicker/cli viewer site.nitpicker --port 9000 --no-open

# crawl を Ctrl-C で止めたあと、残った stub ディレクトリをそのまま開く
$ npx @nitpicker/cli viewer ._nitpicker-site
```

> **Stub ディレクトリのビューア**: `crawl` を `Ctrl-C` 等で停止すると `._nitpicker-*` ディレクトリが残る。`crawl --resume <stub>` で再開できるのと同じパスを `viewer <stub>` に渡せば、その時点までに集めたデータを read-only で閲覧できる。viewer は **read-only オープン**（`Archive.connect`）に固定されるため、`.nitpicker` ファイルへの tar 化も tmpDir の削除も `info` テーブルのマイグレーションも一切走らず、その後 `crawl --resume` を安全に続行できる。クロールが現在進行中の場合は footer に "Live crawl in progress (PID xxx)" バッジが、停止済みの場合は "Interrupted crawl stub" バッジが表示される（`<tmpDir>.lock/pid.txt` を probe して判定）。

> **仮想スクロール**: ページ一覧などの大規模テーブルは、サーバ側ページネーション（`limit`/`offset`）+ TanStack Query の infinite query + TanStack Virtual による行の仮想化で、クライアントに全件を載せずに 10 万行規模を一定メモリで表示する。

> **HTML スナップショット**: ページ詳細のプレビューは `<iframe sandbox>`（`allow-same-origin`/`allow-scripts` なし）でレンダリングするためローカルでも安全。ソース表示にも切り替えられる。

> **Content-Type 分類**: Summary 画面に Content-Type カテゴリ（`html`/`pdf`/`image`/`css`/...）の **シェア（合計に対する内訳）を 1 本の積み上げバー + 凡例** で表示する（macOS / iOS のストレージ画面と同じ可視化）。各セグメントは固定色 + 罫線/水玉のパターンオーバーレイを常時持つので、色覚多様性のあるユーザでもカテゴリを区別できる。サブピクセルセグメントは CSS の `min-inline-size: 4px` でホバー可能な細片に底上げされる一方、JS は再正規化せず生のシェアを返すため凡例の % はバー幅と一致する。Pages 画面のフィルタバーで Content-Type を選ぶと、既定の HTML-or-null 制約を外して PDF 等の非 HTML ページも一覧できる（例: 「30 万 URL の大半が PDF」を直接ブラウズ）。カテゴリ判定は `@nitpicker/query` の `classifyContentType` ルール表に集約され、Summary チャートと Pages フィルタが同じ行を同じカテゴリに数える。

#### アクセシビリティ

ビューアは WCAG 2.1 AA を満たすことを目標に実装されている。主な保証:

- **キーボード操作**: スキップリンク（最初の Tab で本文へジャンプ）、列リサイザーは矢印キーで幅変更（Shift で大ステップ）、全コントロールにフォーカスリング。
- **スクリーンリーダー**: 仮想テーブルは flexbox レイアウトでもネイティブ table セマンティクスを失わないよう、明示的な ARIA ロール（`table`/`row`/`columnheader`/`cell`）+ `aria-rowcount`/`aria-colcount`/`aria-rowindex`/`aria-colindex` を付与。フィルタ/ソートの input・select はすべてアクセシブルネームを持ち、行数表示はライブリージョン（`aria-live="polite"`）。ネットワークグラフ（canvas）は `role="img"` + 説明ラベルで、同じデータは「ページリンク」表からアクセシブルに参照できる。
- **視覚**: ダーク/ライト両テーマでリンク等のコントラストが AA（4.5:1）以上。`prefers-reduced-motion` 指定時はローディング/スケルトンのアニメーションを停止。

検証方法（回帰防止）:

- **自動 E2E**: `yarn workspace @nitpicker/viewer test:e2e`（Playwright）に a11y 専用テスト群を同梱。スキップリンク・テーブルロール・コントロール名・矢印キーリサイズ・ライブリージョン・グラフ代替テキストを検証する。
- **手動監査**: Chrome DevTools / Lighthouse の Accessibility カテゴリ（全ルートで 100 を確認済み）。`axe-core` ベースなので CI への組み込みも可能。

> **保守メモ**: `web/components/virtual-table.tsx` の CSS は table 要素を `display: flex/block` でレイアウトしており、これがネイティブの table セマンティクスをアクセシビリティツリーから剥がす。**ロール属性を削除すると画面読み上げで「ただのテキストの羅列」に退行する**ため、ARIA ロールは必須。理由は同ファイルのコメントに記載。

### MCP Server

`.nitpicker` アーカイブファイルを AI アシスタント（Claude 等）から直接クエリするための [Model Context Protocol](https://modelcontextprotocol.io/) サーバー。14 のツールを提供し、サイト構造・メタデータ・リンク・リソース・画像・セキュリティヘッダーなどを対話的に分析できる。

#### セットアップ（Claude Desktop）

`claude_desktop_config.json` に以下を追加:

```json
{
	"mcpServers": {
		"nitpicker": {
			"command": "npx",
			"args": ["@nitpicker/mcp-server"]
		}
	}
}
```

#### 利用可能なツール

| ツール                   | 説明                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- |
| `open_archive`           | `.nitpicker` ファイル **または** stub directory を開く（他のツール使用前に必須） |
| `close_archive`          | アーカイブを閉じてリソースを解放                                                 |
| `get_summary`            | サイト全体の概要（ページ数、ステータス分布、メタデータ充足率）                   |
| `list_pages`             | ページ一覧（ステータス・メタデータ欠損・noindex・URL パターン等で絞り込み）      |
| `get_page_detail`        | 特定ページの全詳細（メタデータ、リンク、リダイレクト、ヘッダー）                 |
| `get_page_html`          | ページの HTML スナップショットを取得                                             |
| `list_links`             | リンク分析（broken / external / orphaned）                                       |
| `list_resources`         | サブリソース一覧（CSS, JS, 画像、フォント）                                      |
| `list_images`            | 画像一覧（alt 欠損、寸法欠損、オーバーサイズ検出）                               |
| `get_violations`         | 分析プラグインの違反データ（axe, markuplint, textlint, lighthouse）              |
| `find_duplicates`        | 重複タイトル・説明の検出                                                         |
| `find_mismatches`        | メタデータ不一致の検出（canonical, og:title, og:description）                    |
| `get_resource_referrers` | 特定リソースを参照しているページの特定                                           |
| `check_headers`          | セキュリティヘッダーチェック（CSP, X-Frame-Options, HSTS 等）                    |

#### 使用例

```
> .nitpicker ファイルを開いて、404 エラーのページを教えてください

AI: open_archive で読み込み → list_pages で status=404 のページをフィルタ → 結果を表示
```

#### `open_archive` のレスポンス契約

`open_archive` は以下の形を返す（LLM が data の鮮度を判定できるよう **`mode` と `crawlerPid` を常に同梱**）:

| フィールド   | 型                    | 説明                                                                                                                 |
| ------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `archiveId`  | `string`              | 以降のツール呼び出しで使う識別子                                                                                     |
| `baseUrl`    | `string`              | クロール対象のベース URL                                                                                             |
| `roots`      | `string[]`            | multi-root クロールの全 root URL                                                                                     |
| `totalPages` | `number`              | 全ページ数                                                                                                           |
| `mode`       | `"archive" \| "stub"` | `"archive"` = 完成した `.nitpicker` ファイル / `"stub"` = クロール中断後の作業ディレクトリ（データはまだ変化しうる） |
| `crawlerPid` | `number \| null`      | stub かつ live crawler が検出された場合に PID を返す。`null` なら interrupted stub または finished archive           |

> **重要（AI/LLM 側の判断材料）**: `mode === "stub"` の場合、`list_pages` や `get_summary` の結果は **point-in-time snapshot**。`crawlerPid !== null` なら crawl が現在進行中で数字は刻々と変わる可能性がある。ユーザーへの返答ではこの点を明示すること。

検索キーワード: `nitpicker MCP open_archive mode` / `nitpicker MCP stub`

## トラブルシューティング

`crawl` / `--append` / `--resume` の運用で遭遇しがちなエラーと対処法。

### `Archive is being used by another process (PID xxx): <path>.lock`

別プロセスが同じ archive を開いているときに発生する。`.lock` ディレクトリの `pid.txt` が保持する PID を `ps -p <PID>` で確認し、稼働中ならそのプロセスの終了を待つ。

PID 既に終了していれば次回 open 時に自動で stale 検出されて回復する。それでも残るときは安全を確認したうえで `rm -rf <path>.lock` で手動削除可能。

検索キーワード: `nitpicker lock file` / `ArchiveLockError`

### `Cannot append to a list-mode archive`

`--list` / `--list-file` で作成された archive（`info.fromList=true`）に対して `--append` を実行したときに発生する。list-mode archive はメタデータのみのページを含み再帰クロールの土台にならないため、append 経路は閉じている。新規 archive を作るか、フルクロールで作り直すこと。

検索キーワード: `nitpicker append fromList` / `list-mode archive`

### `<archive>.bak` が残っている

`--append` は実行前にバックアップを作り、成功時に削除、失敗時に原本を `.bak` から復元してから削除する。それでも残っている場合は、append 中の crash 後の復元自体が失敗した状態（`AggregateError` でログに残るはず）。手動で `mv <archive>.bak <archive>` で原本を復元できる。

検索キーワード: `nitpicker .bak file` / `AggregateError append`

### `[migrate] info table upgraded (...)`（stderr に 1 行）

旧版スキーマの archive を初めて開いたときに出力される **正常通知**。エラーではない。括弧内は実際に行われた変換のリスト（`roots seeded`、`scope dropped`、両方の場合はカンマ区切り）。`info.roots` カラム追加と `info.scope` カラム削除の冪等 migration。

> **Note**: この通知は **writer モードでのみ** 出力される。`viewer` / `mcp-server` から `.nitpicker` ファイルや stub directory を開いた場合は `Archive.connect({readOnly: true})` 経路に固定されるため、migration は走らず、この行は出力されない（user の tmpDir を絶対に書き換えない設計）。古いスキーマを永続的に更新したい場合は `crawl --resume <stub>` を 1 回走らせると正規化される。

検索キーワード: `nitpicker info table migration` / `nitpicker info.roots`

### `[nitpicker] Crawler appears to be running on this stub (PID xxx)`（stderr に 1 行）

`viewer <stub-dir>` / MCP `open_archive <stub-dir>` を実行した時点で `<tmpDir>.lock` が **生きているプロセス** に保持されていた場合の **正常通知**。viewer footer の "Live crawl in progress" バッジと連動する。read-only オープン（`Archive.connect`）なので WAL モードの SQLite に対する concurrent read は安全。`peekArchiveLockHolder` は lock を取りに行かず PID を probe するだけなので、crawler の進行を妨げない。

> **既知の制約**: PID liveness の判定は viewer 起動時の **one-shot snapshot**。起動後に crawler が終了したり、新規に開始しても footer のバッジは更新されない。状態を再評価したい場合は viewer を再起動する。

検索キーワード: `nitpicker stub crawler running` / `peekArchiveLockHolder`

### Viewer 起動中に crawl が完了 → footer / API が古い tmpDir を指したまま

viewer が stub directory を開いている間に同じ archive で `crawl --resume <stub>` を走らせ、それが完了すると、crawler は `tmpDir` を `.nitpicker` tar に変換して tmpDir を削除する。viewer 側はその瞬間に SQLite ハンドルが宙吊りになり、後続クエリが I/O エラーを返すようになる。

**対処**: viewer を `Ctrl-C` で停止 → 生成された `.nitpicker` ファイルを viewer で開き直す。viewer 側は **stub の状態を変更しない**ことを保証するだけで、stub が外部から消えるケースまではフォローしない設計判断（finding を参照: 検索キーワード `nitpicker viewer tmpDir lifecycle`）。

検索キーワード: `nitpicker viewer stale handle` / `nitpicker crawl finalize while viewing`

### `Path "..." looks like a .nitpicker archive file but resolves to a directory`

`.nitpicker` 拡張子の symlink が directory を指している場合のエラー。viewer / MCP は **入力パスの拡張子で user intent を判定** するため、`current.nitpicker -> ._nitpicker-foo/` のような構成は意図的に拒否される（archive を期待しているのに stub が返るのは plugin data の欠落を生むため）。対処: symlink を貼り直すか、stub directory を直接指定する。

検索キーワード: `nitpicker symlink stub classification` / `classifySource`
