# Nitpicker

[![CI](https://github.com/d-zero-dev/nitpicker/actions/workflows/ci.yml/badge.svg)](https://github.com/d-zero-dev/nitpicker/actions/workflows/ci.yml)
[![E2E](https://github.com/d-zero-dev/nitpicker/actions/workflows/e2e.yml/badge.svg)](https://github.com/d-zero-dev/nitpicker/actions/workflows/e2e.yml)

Web サイト全体のデータを取得する CLI / MCP / Viewer。ヘッドレスブラウザで各ページをレンダリングし、`loading=lazy` や `IntersectionObserver` 起因の遅延読み込みを末尾までスクロールして網羅的に取得する。

設計詳細・データフロー・DB スキーマは [ARCHITECTURE.md](./ARCHITECTURE.md) を参照。各コマンドのオプション一覧は `--help` で確認できる。

## 取得可能なデータ

- サイトマップと URL 一覧、各ページのメタデータ
- 各ネットワークリクエスト/レスポンスヘッダー
- レンダリング後 DOM の HTML スナップショット

## Crawl

Web サイトをクロールして `.nitpicker` アーカイブを生成。

```sh
npx @nitpicker/cli crawl <URL> [<URL>...]
npx @nitpicker/cli crawl existing.nitpicker --append <URL>
npx @nitpicker/cli crawl existing.nitpicker --retry-failed
```

### スコープと multi-root

複数 URL を渡すと、それぞれが「再帰クロールの起点」かつ「スコープエントリ」として扱われ、1 つの `.nitpicker` に集約される。スコープ判定は **`(hostname, port, path)` のトリプル**。同一ホスト異ポート（`localhost:3000` と `localhost:8080`）は別スコープとして隔離される。

### `--append`: 既存アーカイブへの追加クロール

- `--append` の URL 群が新しい再帰起点として `info.roots` に追加される
- 既存 `external` ページのうち拡張後のスコープに該当するものは `internal` として再スクレイプされる
- クロール開始前に `<archive>.bak` を作成。失敗時は自動復元、成功時は `.bak` を削除
- list-mode archive（`--list` / `--list-file` で作成）への append は不可
- `--resume` / `--diff` / `--output` / `--list` / `--list-file` / `--single` と同時指定不可

### `--retry-failed`: 失敗ページの再取得

前回クロールで失敗したページだけを再取得する。「サーバ側の一時障害やタイムアウトで取りこぼしたページを、フルクロールし直さずに回収する」ためのモード。

- 再取得対象は **status が `-1`（ネットワークエラー/タイムアウト/ブラウザクラッシュの sentinel）/ `NULL`、content-type が `NULL`、または status が 5xx** のページ。確定応答である 4xx は再取得しても結果が変わらないため対象外
- `internal` / `external` 両方を対象にする（external はメタデータのみ再取得）
- 再取得したページが HTML なら新リンクを辿り、未取得の新 URL があればそこから再帰クロールする（デフォルト ON）。`--no-recursive` で「失敗ページの再取得のみ」に限定できる。**この recursive 設定はフラグ値が優先され、アーカイブ作成時の recursive 設定は継承しない**
- スコープ・除外（`--exclude` 系）・User-Agent などは **アーカイブに保存された設定値を流用**する。明示的にフラグ指定したものだけ上書きされる
- クロール開始前に `<archive>.bak` を作成。失敗時は自動復元、成功時は `.bak` を削除
- list-mode archive への retry は不可
- `--resume` / `--append` / `--diff` / `--output` / `--list` / `--list-file` / `--single` と同時指定不可

### Basic 認証

`https://USER:PASS@host/` 形式。**スコープエントリの資格情報は同じ `(hostname, port)` 配下にのみ注入**される（他ホストへの漏洩防止）。

### 終了コード

| code | 意味                                                             |
| ---- | ---------------------------------------------------------------- |
| `0`  | 成功                                                             |
| `1`  | 致命的（引数不足、内部エラー、スコープ内ページのスクレイプ失敗） |
| `2`  | 警告（外部リンクエラーのみ。`--strict` で 1 に格上げ）           |

CI/CD で外部リンクの一時的障害でビルドを落としたくない場合は `|| [ $? -eq 2 ]` で 2 を許容できる。

### 責任あるクローリング

- `robots.txt` 自動準拠（`--ignore-robots` で無効化可能、慎重に）
- User-Agent デフォルト `Nitpicker/<version>`（`--user-agent` 変更可）
- `--interval` でリクエスト間隔（ms）

## Analyze

```sh
npx @nitpicker/cli analyze <file> [--plugin <name>]... [--all]
```

axe / Lighthouse / markuplint / textlint / main-contents / search プラグインを実行し、結果をアーカイブに書き戻す。

## Report

`.nitpicker` を Google Sheets に出力。

```sh
npx @nitpicker/cli report <file> --sheet <URL> [--all] [--dedupe-resources]
```

### `--dedupe-resources`: Resources シートの集約

Google Sheets は **1 ドキュメント 10M セル上限**。広告/解析タグ（Google Ads / Facebook Pixel / Yahoo / Bing UET / LINE Tag 等）はページごとに per-request unique なクエリ付き URL を生成するため、数百万件のレコードで上限に達することがある。

`--dedupe-resources` は Resources シートを **canonical URL** で集約する:

- **canonical 化**: パス保持、クエリは値を捨ててキーのみ sort & unique（例: `?auid=XYZ&capi=1` → `?auid&capi`）
- **集約キー**: `(canonical URL, status, contentType)`
- **追加列**: `Count`（集約件数）と `Query Pattern`（各キーのユニーク値数 `key=N`、`N=1` は実質定数、`N>1` は per-request 変動、上限 100 超は `key=100+`）
- **path 内 ID は保持**: `/pagead/viewthroughconversion/10840516367/` のような conversion ID は残るので、「Google Ads 入っていますか / どの conversion ID？」がこの 1 シートで答えられる
- **値そのものは記録しない**（プライバシー / メモリ配慮）

実例: 1.6M raw → 63K 行（96% 削減、9.6M セル → 380K セル）。

### Resources シートの自然順 sort

raw / dedupe 両モードで URL の自然順（`image-2.jpg` が `image-10.jpg` より先、大文字小文字同視）に並ぶ。実装は Martin Pool の `strnatcmp` の JS 移植で、**文字コードを直接比較する on-the-fly 方式**。派生文字列を生成しないため大規模アーカイブでもメモリを浪費しない。

### メモリ目安

1.6M リソース級では `getResources()` 結果配列だけで約 1〜1.5GB。Node デフォルトヒープ (4GB) では厳しいので `NODE_OPTIONS=--max-old-space-size=8192` を指定:

```sh
NODE_OPTIONS=--max-old-space-size=8192 npx @nitpicker/cli report ./archive.nitpicker -S ... --dedupe-resources
```

10 万件規模なら 1〜2GB で収まり、デフォルトで動く。

### `--limit` の意味

アーカイブからメモリへ一度に読み込むページ数を制御する値。Google Sheets API への 1 リクエストあたりの行数とは別物。各シートの行送信は `@d-zero/google-sheets` の `Sheet.appendRow` が内部で **2500 行ごとに自動 flush** するため、呼び出し元のメモリ滞留はチャンクサイズ分に抑えられる。

## Pipeline

crawl → analyze → report を 1 コマンドで直列実行。`--sheet` を指定したときのみ report ステップが走る。

```sh
npx @nitpicker/cli pipeline <URL> --sheet <URL> --all
```

各ステップに対応するフラグが自動でルーティングされる。終了コードは crawl と同じ体系。

## Query

`.nitpicker` に対してクエリを実行して JSON 出力。MCP サーバーと同等。

```sh
npx @nitpicker/cli query <file> <sub-command> [options]
```

サブコマンド: `summary` / `pages` / `page-detail` / `html` / `links` / `resources` / `images` / `violations` / `duplicates` / `mismatches` / `headers` / `resource-referrers` / `error-kinds`。詳細は `--help`。

### `--contentTypeCategory`

`pages` のみで使える。**指定時は既定の HTML-or-null ベースフィルタを外し、PDF など非 HTML 行も列挙する**。カテゴリ判定は `@nitpicker/query` の `classifyContentType` ルール表に集約され、Summary チャートと Pages フィルタが同じ行を同じカテゴリに数える。

### `error-kinds`: クロール失敗の原因分類

クロール失敗を原因別（`dns` / `connection-refused` / `connection-reset` / `connection-timeout` / `tls` / `timeout` / `protocol` / `unknown`）に集計する。DNS 解決失敗や接続拒否が、ただの「タイムアウト/不明」に埋もれず区別できる。kind 別件数 + ホスト別内訳 + サンプル URL を JSON で返す。

原因の判定（`classifyErrorKind`）は **保存された値ではなく `message` から読み取り時に行う**ため、この機能より前に作成した既存アーカイブもそのまま分類できる。失敗の取得元は 2 系統: スクレイプ経路の失敗は `page_errors`、DNS/接続/TLS など crawler レベルの失敗は構造化テーブル `crawl_errors`（無い古いアーカイブでは `error.log` を読んでフォールバック）。応答しないページが per-property の累積タイムアウトで `timeout` に倒れる現象は beholder 側の既知課題（`getMeta` の逐次取得）。

## Viewer

`.nitpicker` または **stub ディレクトリ**（`crawl` 強制停止時の `._nitpicker-*`）をローカルブラウザで対話的に閲覧する。Hono バックエンド + React SPA。

```sh
npx @nitpicker/cli viewer <file-or-stub-dir> [--port 9000] [--no-open]
```

### Stub ディレクトリのビューア

`crawl --resume <stub>` と同じパスを `viewer <stub>` に渡せば、その時点までに集めたデータを **read-only オープン**（`Archive.connect`）で閲覧できる。`.nitpicker` ファイルへの tar 化も tmpDir 削除も `info` マイグレーションも一切走らないため、その後 `crawl --resume` を安全に続行できる。Footer に "Live crawl in progress (PID xxx)" / "Interrupted crawl stub" のバッジが出る（`<tmpDir>.lock/pid.txt` を probe して判定）。

### 仮想スクロール

ページ一覧は サーバ側ページネーション（`limit`/`offset`）+ TanStack Query infinite query + TanStack Virtual の組み合わせで、**10 万行規模をクライアント全件ロードせず一定メモリで表示**する。

### Errors ビュー

`query error-kinds` と同じ集計をブラウザで表示する。kind 別のバーを選ぶと、その原因で失敗したホスト内訳とサンプル URL にドリルダウンできる。サンプル URL は（解決失敗・接続拒否など本来開けない URL なので）リンクではなく診断用のテキストとして表示する。

### HTML スナップショットプレビュー

`<iframe sandbox>`（`allow-same-origin` / `allow-scripts` なし）でレンダリングするためローカルでも安全。ソース表示にも切り替え可。

### アクセシビリティ

WCAG 2.1 AA 目標。仮想テーブルは flexbox レイアウトで table セマンティクスがアクセシビリティツリーから剥がれるため、**ARIA ロール（`table`/`row`/`columnheader`/`cell`）と `aria-rowcount`/`aria-colcount` を明示付与**する設計。`web/components/virtual-table.tsx` のロール属性を削除すると画面読み上げで「ただのテキストの羅列」に退行するため必須。検証は `yarn workspace @nitpicker/viewer test:e2e` の a11y 専用テスト群でカバー。

## MCP Server

`.nitpicker` を AI アシスタント（Claude 等）から直接クエリする [Model Context Protocol](https://modelcontextprotocol.io/) サーバー。

`claude_desktop_config.json`:

```json
{
	"mcpServers": {
		"nitpicker": { "command": "npx", "args": ["@nitpicker/mcp-server"] }
	}
}
```

ツール一覧（14 種）と引数仕様は `@nitpicker/mcp-server` の `src/tools/` の JSDoc を参照。

### `open_archive` のレスポンス契約

LLM が data の鮮度を判定できるよう **`mode` と `crawlerPid` を常に同梱**する。

| field        | type                    | 説明                                                                                      |
| ------------ | ----------------------- | ----------------------------------------------------------------------------------------- |
| `archiveId`  | string                  | 以降のツール呼び出し識別子                                                                |
| `mode`       | `"archive"` \| `"stub"` | `"stub"` は **point-in-time snapshot**                                                    |
| `crawlerPid` | `number \| null`        | stub かつ live crawler 検出時に PID。`null` なら interrupted stub または finished archive |

**重要（LLM 側の判断）**: `mode === "stub"` で `crawlerPid !== null` の場合、`list_pages` / `get_summary` の結果は刻々と変わる可能性があるため、ユーザーへの返答でその点を明示すること。

## トラブルシューティング

### `Archive is being used by another process (PID xxx): <path>.lock`

別プロセスが同じ archive を開いている。`.lock/pid.txt` の PID を `ps -p <PID>` で確認し、稼働中なら終了を待つ。既に終了していれば次回 open 時に stale 検出で自動回復。それでも残れば `rm -rf <path>.lock` で手動削除可能。

### `Cannot append to a list-mode archive` / `Cannot retry a list-mode archive`

`--list` / `--list-file` で作成された archive（`info.fromList=true`）は再帰クロールの土台にならないため append / retry 経路は閉じている。新規 archive を作るかフルクロールで作り直すこと。

### `<archive>.bak` が残っている

`--append` / `--retry-failed` の失敗時復元自体が失敗した状態。`AggregateError` がログに残るはず。`mv <archive>.bak <archive>` で原本を復元できる。

### `[migrate] info table upgraded (...)`

旧版スキーマの archive を初めて開いたときの **正常通知**。`info.roots` 追加と `info.scope` 削除の冪等 migration。`viewer` / `mcp-server` は `Archive.connect({readOnly: true})` 固定のため migration は走らず、この行は出ない（user の tmpDir を絶対に書き換えない設計）。

### `Crawler appears to be running on this stub (PID xxx)`

`viewer <stub-dir>` / MCP `open_archive <stub-dir>` 時の **正常通知**。read-only オープンなので WAL モード SQLite の concurrent read は安全。`peekArchiveLockHolder` は lock を取りに行かず PID を probe するだけなので crawler を妨げない。PID liveness は **one-shot snapshot** で、起動後の変化は footer に反映されない（再起動が必要）。

### Viewer 起動中に crawl が完了 → API が古い tmpDir を指したまま

viewer が stub を開いている間に同じ archive で `crawl --resume <stub>` を完走させると、crawler は tmpDir を `.nitpicker` tar に変換して tmpDir を削除する。viewer 側は SQLite ハンドルが宙吊りになり後続クエリが I/O エラー。**対処**: viewer を `Ctrl-C` で停止 → 生成された `.nitpicker` で開き直す。viewer は「stub の状態を変更しない」ことしか保証しない設計判断。

### `Path "..." looks like a .nitpicker archive file but resolves to a directory`

`.nitpicker` 拡張子の symlink が directory を指している場合のエラー。viewer / MCP は **入力パスの拡張子で user intent を判定**するため、`current.nitpicker -> ._nitpicker-foo/` のような構成は意図的に拒否される（archive を期待しているのに stub が返るのは plugin data の欠落を生むため）。symlink を貼り直すか stub を直接指定する。
