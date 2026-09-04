# crawl

Webサイトをクロールして `.nitpicker` アーカイブを作成または更新します。

## 基本形

```sh
npx @nitpicker/cli crawl <URL> [<URL>...]
npx @nitpicker/cli crawl <archive>.nitpicker --retry-failed
npx @nitpicker/cli crawl --resume <stub-dir>
```

複数URLを渡すと、それぞれがクロール起点かつスコープエントリになります。スコープは `(hostname, port, path)` で判定されます。

## 前提条件: Puppeteer用Chrome

`crawl`（`--diff` を除く全モード）はPuppeteer経由でヘッドレスChromeを起動します。環境（npmのinstall-scriptブロック方針、`unzip` 等の展開ツール不在、ネットワーク制限など）によってはpostinstallでのChrome自動ダウンロードが行われないことがあります。

Chromeが見つからない場合、クロールが実際にページを取得し始める前に以下のようなエラーで即座に停止します。

```
Error: Chrome executable not found at: <解決されたパス>
Run `npx puppeteer@<pinned-version> browsers install chrome` to install the Chrome build Puppeteer expects, then retry.
```

案内された通り、表示された `npx puppeteer@<version> browsers install chrome` コマンドをそのまま実行すればインストールできます。

## 通常クロール

```sh
npx @nitpicker/cli crawl https://example.com
npx @nitpicker/cli crawl https://example.com https://example.com/docs/
npx @nitpicker/cli crawl https://example.com --output ./site.nitpicker
```

通常クロールはURLから開始し、ページ、リンク、リソース、画像、レンダリング後HTMLを `.nitpicker` アーカイブへ保存します。

### Basic認証つきサイト

Basic認証で保護されたサイトは、URLに `ユーザー名:パスワード@` を埋め込んでクロールできます。認証情報はスコープ単位で継承され、同一スコープ内で発見されたページにも自動で適用されます。

```sh
npx @nitpicker/cli crawl 'https://user:pass@staging.example.com/'
```

パスワードに `[` `]` `{` `}` `=` などURLで特別な意味を持つ文字が含まれる場合は、そのまま書いても `encodeURIComponent` でエンコードして書いても、どちらでも同じように認証されます。シェルのメタ文字（`&` `!` `$` など）と解釈されないよう、URL全体をシングルクォートで囲んでください。

唯一の例外は `%` そのものを含むパスワードです。`%` の直後の2文字が16進数として解釈できる並び（例: パスワードがリテラルの `pa%5Bss`）はパーセントデコードされてしまうため、`%` を `%25` と書いてください（`pa%255Bss`）。これは `curl` や Node.js が URL 内の認証情報を扱う際と同じ規則です。

パスワードが空の認証（`https://user:@host/`）は、起点として直接指定したURLの取得には適用されますが、クロール中に発見されたリンク先へのスコープ継承には現在対応していません。空パスワードのサイト全体をクロールする場合は、ダミーではないパスワードの利用を検討してください。

認証情報はクロール対象への認証にのみ使用され、スコープ外ホストへのリクエストには送信されません。ページの保存URLにも含まれません。ただし、アーカイブ内のクロール設定（起点URL）には再クロール（`--append` / `--retry-failed`）のために元のURLがそのまま保存されるため、Basic認証つきでクロールした `.nitpicker` ファイルを第三者へ共有する場合は認証情報が含まれる点に注意してください。

## `--resume`: 中断したクロールの再開

長時間クロールは Ctrl+C で停止できます。停止時には、完成済みの `.nitpicker` とは別に、未完了クロールの作業状態を保持するstubディレクトリが残ります。

stubディレクトリは「途中まで進んだクロールの状態」です。完成した成果物ではないため、`analyze` や `report` の入力にはせず、`--resume` で再開します。

```sh
npx @nitpicker/cli crawl --resume <stub-dir>
```

`--resume` ではstub内に保存されたURLキューとクロール状態から処理を続行します。出力先はstub側の状態から決まるため、`--output` は指定できません。

同時指定できない主なフラグ:

| フラグ           | 理由                                                |
| ---------------- | --------------------------------------------------- |
| `--output`       | 出力先はstubから決まる                              |
| `--append`       | 既存アーカイブ更新モードと競合する                  |
| `--retry-failed` | 完了済みアーカイブの失敗再取得モードと競合する      |
| `--inventory`    | 既存アーカイブへのURLリスト取り込みモードと競合する |

## `--retry-failed`: 失敗ページの再取得

クロールは実行マシンのネットワーク状態に影響されます。DNS、TLS、タイムアウト、接続リセット、対象サイトの一時障害などにより、本来取得できるページが失敗として記録されることがあります。

一度 `crawl` が最後まで終わって `.nitpicker` が作成済みの場合は、再度フルクロールするより `--retry-failed` を推奨します。

```sh
npx @nitpicker/cli crawl ./site.nitpicker --retry-failed
```

`--retry-failed` は、既存アーカイブ内の失敗ページだけを再取得します。再取得したHTMLから新しいURLが見つかった場合は、通常はそこから再帰クロールします。

失敗ページの再取得だけに絞る場合は `--no-recursive` を使います。

```sh
npx @nitpicker/cli crawl ./site.nitpicker --retry-failed --no-recursive
```

再取得対象:

| 対象                 | 説明                                                     |
| -------------------- | -------------------------------------------------------- |
| status `-1` / `NULL` | ネットワークエラー、タイムアウト、ブラウザクラッシュなど |
| content-type `NULL`  | 応答種別が確定していないページ                           |
| 5xx                  | 対象サイト側の一時障害の可能性があるページ               |

4xxは確定応答として扱われるため、通常は再取得対象になりません。DNS失敗、TLS失敗、クライアントブロック、HTTPパースエラーなどの永続失敗に分類されるものは再試行対象から外れ、`--retry-failed` を繰り返すほど対象が収束します。

同時指定できない主なフラグ:

| フラグ                                | 理由                                 |
| ------------------------------------- | ------------------------------------ |
| `--output`                            | 更新対象は位置引数の既存アーカイブ   |
| `--append`                            | 追加クロールモードと競合する         |
| `--inventory`                         | URLリスト取り込みモードと競合する    |
| `--list` / `--list-file` / `--single` | 失敗ページ再取得の対象選択と競合する |

## `--inventory`: サーバー側URLリストの取り込み

通常のクロールはリンクを辿って到達できるページを中心に収集します。そのため、どこからもリンクされていない孤立ページ、置きっぱなしのHTML、未使用のPDFや画像などは見つからないことがあります。

`--inventory` は、サーバー側で取得したURLリストを既存 `.nitpicker` アーカイブに突き合わせ、まだアーカイブにないURLだけを取り込む機能です。孤立ページや未使用リソースを監査するための大きなタスクとして使います。

```sh
npx @nitpicker/cli crawl ./site.nitpicker --inventory ./urls.txt
```

URLリストは1行1URLです。空行と `#` コメント行は無視されます。

取り込みの流れ:

| 種別          | 処理                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| 既存URL       | 取り込みをスキップ                                                                |
| スコープ外URL | 警告してスキップ                                                                  |
| 除外対象URL   | スキップ済みページとして記録（取得しない。`excludes` / `excludeUrls` 設定に一致） |
| HTML候補      | ページとして登録し、ヘッドレスブラウザで描画して再帰クロール                      |
| 非HTML候補    | リソースとして登録                                                                |

除外判定は通常クロールと同じ `--exclude`（globパターン）と `--exclude-url`（prefix）を使います。アーカイブに保存された設定が基準になり、`--inventory` と同時に指定したフラグがあればそちらで上書きされます。除外に一致したURLは、通常クロールでリンク発見された除外URLと同じ「スキップ済み（取得しない）」状態のページ行として記録されます — 同じURLは発見経路によらず同じ状態でアーカイブに残ります。すでにアーカイブにあるURLはこの判定より先に既存URLとしてスキップされるため、クロール済みページが後から除外設定に一致しても上書きされません。`--exclude-keyword` はページ本文に対する判定のため取り込み時分類には参加しません（HTML候補の描画時に適用されます）。

HTMLかどうかはURL拡張子のヒューリスティックで分類します。`.html`、`.htm`、拡張子なしURLなどはHTML候補になり、`.pdf`、`.jpg`、`.css`、`.js` などは非HTML候補になります。

`--inventory` の結果は、主に次の `query` サブコマンドで確認します。

```sh
npx @nitpicker/cli query ./site.nitpicker isolated-pages --pretty
npx @nitpicker/cli query ./site.nitpicker isolated-clusters --pretty
npx @nitpicker/cli query ./site.nitpicker unused-resources --pretty
npx @nitpicker/cli query ./site.nitpicker list-reconcile-runs --pretty
```

| query                 | 用途                                                |
| --------------------- | --------------------------------------------------- |
| `isolated-pages`      | 完全に孤立したinventory由来ページを列挙             |
| `isolated-clusters`   | inventory由来ページ同士でつながる孤立クラスタを列挙 |
| `unused-resources`    | 参照元がないinventory由来リソースを列挙             |
| `list-reconcile-runs` | `--inventory` / `--recrawl` の実行履歴を列挙        |

`--inventory` / `--recrawl` の実行履歴はアーカイブ内に記録されます（同じ `list_reconcile_runs` テーブルに集約）。記録されるのは実行日時、リストラベル、リスト内容のSHA-256、行数、新規ページ数、新規リソース数、スコープ外件数、除外一致件数などです。元ファイルの絶対パスは保存しません。

同じリストを再度適用しても、実行履歴の重複は自動抑止されません。すでに登録済みのURLはスキップされますが、監査履歴としては別実行として扱います。

同時指定できない主なフラグ:

| フラグ                                | 理由                               |
| ------------------------------------- | ---------------------------------- |
| `--output`                            | 更新対象は位置引数の既存アーカイブ |
| `--append`                            | 追加クロールモードと競合する       |
| `--retry-failed`                      | 失敗ページ再取得モードと競合する   |
| `--resume`                            | 中断クロール再開モードと競合する   |
| `--list` / `--list-file` / `--single` | inventoryのURLリスト処理と競合する |

## `--append`: 既存アーカイブへの追加クロール

```sh
npx @nitpicker/cli crawl ./site.nitpicker --append https://example.com/new-section/
```

`--append` は既存アーカイブに新しい再帰クロール起点を追加します。新しいURLは `info.roots` に追加され、拡張後のスコープに入る既存externalページはinternalとして再取得されます。

クロール開始前に `<archive>.bak` を作成し、失敗時は自動復元、成功時は削除します。

## `--diff`: アーカイブ差分

```sh
npx @nitpicker/cli crawl --diff ./before.nitpicker ./after.nitpicker
```

2つのアーカイブを比較し、URLリストの差分を出力します。

## オプション一覧

| オプション                                 | 型                 | 説明                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--resume`, `-R`                           | string             | stubディレクトリからクロールを再開                                                                                                                                                                                                                                        |
| `--append`, `-A`                           | string, repeatable | 既存アーカイブへ新しい再帰クロール起点を追加                                                                                                                                                                                                                              |
| `--retry-failed`                           | boolean            | 既存アーカイブ内の失敗ページを再取得                                                                                                                                                                                                                                      |
| `--inventory`                              | string             | サーバー側URLリストを既存アーカイブへ取り込み                                                                                                                                                                                                                             |
| `--interval`, `-I`                         | number             | リクエスト間隔をミリ秒で指定                                                                                                                                                                                                                                              |
| `--image` / `--no-image`                   | boolean            | 画像を取得するか。既定は有効                                                                                                                                                                                                                                              |
| `--fetch-external` / `--no-fetch-external` | boolean            | 外部リンクを取得するか。既定は有効                                                                                                                                                                                                                                        |
| `--parallels`, `-P`                        | number             | 並列スクレイピング数                                                                                                                                                                                                                                                      |
| `--recursive` / `--no-recursive`           | boolean            | 再帰クロールするか。既定は有効                                                                                                                                                                                                                                            |
| `--exclude`                                | string, repeatable | 除外するページURLパスのglob                                                                                                                                                                                                                                               |
| `--exclude-keyword`                        | string, repeatable | ページ本文に含まれる除外キーワード                                                                                                                                                                                                                                        |
| `--exclude-url`                            | string, repeatable | 除外する外部URL prefix                                                                                                                                                                                                                                                    |
| `--disable-queries`, `-Q`                  | boolean            | URLのクエリ文字列を無効化                                                                                                                                                                                                                                                 |
| `--image-file-size-threshold`              | number             | 画像ファイルサイズのしきい値                                                                                                                                                                                                                                              |
| `--single`                                 | boolean            | 単一ページモード                                                                                                                                                                                                                                                          |
| `--max-excluded-depth`                     | number             | 指定深さを超えるクロールを避ける                                                                                                                                                                                                                                          |
| `--retry`                                  | number             | URLごとのスクレイプ失敗リトライ回数。既定は `3`                                                                                                                                                                                                                           |
| `--list`                                   | string, repeatable | 指定URLリストだけをクロール                                                                                                                                                                                                                                               |
| `--list-file`                              | string             | URLリストファイルだけをクロール                                                                                                                                                                                                                                           |
| `--user-agent`                             | string             | HTTPリクエストのUser-Agent                                                                                                                                                                                                                                                |
| `--ignore-robots`                          | boolean            | robots.txt制限を無視                                                                                                                                                                                                                                                      |
| `--skip-technology-js-scan`                | boolean            | クロール完了後のJSリソース再取得（技術スタックのライセンスコメントスキャン）をスキップし、追加のネットワークリクエストを避ける                                                                                                                                            |
| `--main-content-selector`                  | string             | メインコンテンツ領域の自動検出を上書きするCSSセレクタ                                                                                                                                                                                                                     |
| `--output`, `-o`                           | string             | 出力 `.nitpicker` ファイルパス                                                                                                                                                                                                                                            |
| `--strict`                                 | boolean            | 外部リンクエラーを致命的エラーとして扱う                                                                                                                                                                                                                                  |
| `--verbose`                                | boolean            | 詳細ログを出力                                                                                                                                                                                                                                                            |
| `--silent`                                 | boolean            | 標準出力ログを抑制                                                                                                                                                                                                                                                        |
| `--diff`                                   | boolean            | 2つのアーカイブの差分を出力                                                                                                                                                                                                                                               |
| `--dedupe-cap`                             | number             | 同一クラスタ soft cap。URL形状（例: `/news/date/{n}/`）ごとにtitle/description/og:tagが一致する観測がこの件数に達したら以降の新規URLをenqueueしない。opt-in（省略で無効）。自己生成型のpager/queryパラメータtrapへの保険。発火内容は `query dedupe-cap-events` で確認可能 |
| `--dedupe-map-cap`                         | number             | `--dedupe-cap` が同時追跡するURL形状の数の上限。超過分は最も長く未更新の形状から破棄。`--dedupe-cap` 指定時のみ有効                                                                                                                                                       |

## 終了コード

| code | 意味                                                   |
| ---- | ------------------------------------------------------ |
| `0`  | 成功                                                   |
| `1`  | 致命的エラー                                           |
| `2`  | 外部リンクエラーのみの警告。`--strict` で `1` に格上げ |
