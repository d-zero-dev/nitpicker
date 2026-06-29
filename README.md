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

### `--inventory`: サーバーファイルリストとの突合

サーバー側で取得した URL リストファイル（1 行 1 URL、空行 / `#` コメント可）と既存
`.nitpicker` を突き合わせ、**まだアーカイブに無い URL だけを取り込む** モード。
クロールでは到達できなかった「孤立 LP」「使われていない置きっぱなしファイル」を
浮かび上がらせる用途。

```sh
npx @nitpicker/cli crawl <archive> --inventory <urls.txt>
```

- URL は **拡張子ヒューリスティクス**（`isLikelyHtmlUrl`）で HTML / 非 HTML に同期分類する。HEAD pre-flight は orchestrator 段では行わず、HTML 判定されたものだけ Crawler の通常 dealer 経路（HEAD + puppeteer 描画 + 再帰クロール）に流す。`.html` / `.htm` / 拡張子なしなどが HTML 扱い、`.pdf` / `.jpg` / `.css` / `.js` 等が非 HTML 扱い
- HTML として処理された新規 page は `'inventory-seed'`、その描画中に anchor / subresource として発見された URL は `'inventory-discovered'` のラベルで保存
- 非 HTML 判定された URL は `status` / `contentType` / `contentLength` 全 null の薄い `resources` 行として `'inventory-seed'` ラベルで chunked bulk insert される。HEAD を撃たないので「URL が実在するか / 何バイトか」は確定しない — 後で `query unused-resources` で referrer 0 件として浮上することだけ保証する
- **scrape 中の Ctrl+C 耐性 (issue #121)**: HTML seed は scrape 開始前に `pages` へ `scraped=0, source='inventory-seed'` の placeholder として pre-insert される。dealer pick と `setPage` の間で中断しても URL が archive に残り、`crawl <archive> --resume` で続きを scrape できる
- **source 優先度は `'crawled' > 'inventory-seed' > 'inventory-discovered'`**。inventory は「離れ小島の発見」が目的なので、既存 `'inventory-*'` 行が後の crawl で anchor 到達された瞬間に `'crawled'` に降格する（孤立判定の精度を保つ）
- 既存 `pages` / `resources` にすでにある URL は skip（2 回目以降の `--inventory` は新規分だけ処理）
- スコープ外 URL は警告して skip
- アーカイブに pending URL (scraped=0) が残っていても hard reject せず `console.warn` で続行（crawled-wins UPDATE が source ラベルの整合性を保つ前提）
- 結果は `query isolated-pages` (完全孤立 = singleton inventory-_ ページ) / `query isolated-clusters` (孤立集合 = inventory-_ 同士で繋がるが crawled 集合からは隔離されたクラスタ) / `query unused-resources` で見るのが想定動線（後述）。 `crawled` ラベルの行は定義上孤立にならない（source = `crawled` は「クロール経路で到達した」を assertively 表す）
- **監査ログ (Phase 1)**: `inventory_runs` テーブルへ 1 行追加される（`ran_at` / 自動命名 `list_label` / stream hash された `source_file_sha256` / `total_lines` / `new_pages` / `new_resources` / `scope_skipped`）。issue #121 以降は **ingestion フェーズ内**（pre-insert + audit + `.bak` 削除を 1 セット）で書かれるので、scrape フェーズの Ctrl+C / クラッシュでも監査行は残る。`source_file_path` は永続化されない（privacy; 詳細は ARCHITECTURE.md）。`nitpicker query <archive> inventory-runs --pretty` で履歴一覧
- `--append` / `--retry-failed` / `--resume` / `--diff` / `--output` / `--list` / `--list-file` / `--single` と同時指定不可

### `--retry-failed`: 失敗ページの再取得

前回クロールで失敗したページだけを再取得する。「サーバ側の一時障害やタイムアウトで取りこぼしたページを、フルクロールし直さずに回収する」ためのモード。

- 再取得対象は **status が `-1`（ネットワークエラー/タイムアウト/ブラウザクラッシュの sentinel）/ `NULL`、content-type が `NULL`、または status が 5xx** のページ。確定応答である 4xx は再取得しても結果が変わらないため対象外
- さらに、最終エラーメッセージが**永続失敗 kind**（`dns` / `tls` / `client-blocked` / `parse-error` / `connection-refused`）に分類されるページは **対象から除外**される。NXDOMAIN や証明書失効、Chromium のブロック判定、HTTP パースエラーなどは再試行しても同じ結果しか返さないため、`--retry-failed` を繰り返すほどリトライ対象が縮んでいく（収束する）。一過性のネットワーク要因や middlebox 由来のタイムアウトは引き続きリトライ対象
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

### 過去アーカイブの移行

v0.10 で archive フォーマットが大きく変わった (#84 で HTML を `snapshot-html.zip`
から SQLite BLOB に移行、#85 で beholder 3.0.0 の nested Meta を受けて pages テーブルを
リシェイプ + `page_tags` / `page_jsonld` 追加)。新 CLI は `info.version >= 0.10.0`
を要求し、それより古い archive は `IncompatibleArchiveError` で拒否する。

移行は下記スクリプトを **一度だけ** 走らせる:

```sh
# リポジトリを clone した状態で
yarn install
yarn build          # Step C が crawler の compiled lib/ から meta 派生 helper を import するため必須
node scripts/migrate-to-0.10.mjs <old.nitpicker> [<new.nitpicker>]
```

スクリプトは入力の状態を検知して必要なステップだけ実行する（HTML→BLOB がまだなら
それも、メタスキーマだけ古いならそれだけ）。さらに最後のステップとして、保存済み
HTML BLOB を jsdom でパースして beholder 3.1.0 の `extractMetaFromDocument` に渡し、
0.10 で追加した meta 列・`meta_extras`・`page_tags`・`page_jsonld` を新規 crawl と
同等の状態に充填する。最後に `info.version` を `0.10.0` に bump する。出力先を
省略すると `<old>.0.10.nitpicker` を入力と同じディレクトリに作る (元ファイルは
触らない)。10 万ページ規模で実行時間は **数時間〜十数時間オーダー** (jsdom + Wappalyzer
が per-page CPU bound)。スクリプトは `@nitpicker/cli` の npm パッケージには含まれて
いないので、移行が必要な場合は `git clone` してリポジトリルートから実行する。

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

サブコマンド: `summary` / `pages` / `page-detail` / `html` / `links` (`--type broken|external`) / `resources` / `images` / `violations` / `duplicates` / `mismatches` / `headers` / `resource-referrers` / `error-kinds` / `isolated-pages` (完全孤立 = singleton inventory-_ ページ) / `isolated-clusters` (孤立集合 = inventory-_ connected component, size ≥ 2) / `get-isolated-cluster --representativeUrl <url>` (特定クラスタの member 詳細) / `unused-resources` / `inventory-runs` / `pages-by-tag` / `count-pages-by-tag` / `pages-by-jsonld-type` / `count-pages-by-jsonld-type` / `tag-inventory` / `page-jsonld` / `page-jsonld-overview` / `page-tags`。詳細は `--help`。

> **redirect-source 取扱い**: `query links` の broken / external は anchor の `dest` を `pages.redirectDestId` 経由で canonical destination まで解決した上で判定する。301 中間ホップは表示しない。`--include-redirect-sources` で resolution を無効化し literal anchor target を見ることもできる（診断用）。`isolated-pages` / `isolated-clusters` は inventory subgraph 内のみを扱う source-based filter なので、redirect-source 行は常に除外される（`crawled` 行も同様に除外）。

### `--contentTypeCategory`

`pages` のみで使える。**指定時は既定の HTML-or-null ベースフィルタを外し、PDF など非 HTML 行も列挙する**。カテゴリ判定は `@nitpicker/query` の `classifyContentType` ルール表に集約され、Summary チャートと Pages フィルタが同じ行を同じカテゴリに数える。

### `inventory-runs`: `--inventory` 実行履歴

成功した `crawl --inventory <urls.txt>` 1 回ごとに 1 行が `inventory_runs` テーブルに記録され、ここで `ran_at DESC` 順 (新しい順) で取得できる。クライアント / ディレクター対応の「先月もらった list 反映しました？」「同じ list 2 度反映してないですよね？」に archive 単独で答えるための監査ログ。

```sh
npx @nitpicker/cli query <file> inventory-runs --pretty
```

各行: `id` / `ran_at` (ISO 8601) / `list_label` (未指定なら `inventory-${ran_at}` 自動命名) / `source_file_sha256` (stream hash) / `total_lines` / `new_pages` / `new_resources` / `scope_skipped` / `notes`。`source_file_path` は永続化されない (privacy; ARCHITECTURE.md 参照)。

**append-only / UNIQUE 制約なし**: 同じ list を 2 回 apply すれば 2 行できる。重複検知 / 旧 list との差分適用は Phase 3 (`--refresh`) で導入予定。

**noop run は記録されない**: 全 URL が既存だった場合は `.bak` を作らない設計なので run 行も書かない (Phase 1 の trade-off)。console log には `[inventory] N already in archive, 0 new` が残る。

**Phase 1 deploy 前の archive**: 初回 writer 接続時に `migrateInventoryRuns` がテーブルを作成する。read-only 接続のみ (viewer / stub mode) では migration が走らないので `query inventory-runs` は空配列フォールバックを返す。

**Phase 1 デプロイ前の inventory pass を後付け記録する (one-off backfill)**:

`--register-run` CLI は Phase 1 では実装していない。1 回限りの手動 INSERT は次のシェルコマンドで:

```sh
# 1. アーカイブを writer モードで一度開いて `inventory_runs` テーブルを作成させる
#    (--retry-failed や --resume を起動して migration を走らせる)
npx @nitpicker/cli crawl <archive>.nitpicker --retry-failed
# Ctrl-C で停止 → テーブルは作成済の状態で残る

# 2. sha256 を計算
sha=$(shasum -a 256 ./<list>.txt | cut -c1-64)

# 3. アーカイブ (もしくは stub tmpDir) の db.sqlite に直接 INSERT
sqlite3 <stubDir>/db.sqlite "
INSERT INTO inventory_runs
  (ran_at, list_label, source_file_sha256, total_lines, notes)
VALUES
  ('2026-06-19T22:09:00+09:00',    -- 実際に走った日時 (backdate)
   '2026-06-19-initial',           -- 任意ラベル
   '$sha',
   $(awk 'NF{c++}END{print c}' ./<list>.txt),  -- 非空行数
   'Backfilled — initial inventory pass before run tracking shipped');
"
```

`new_pages` / `new_resources` / `scope_skipped` は NULL でよい (Phase 1 では正確な値を遡及計算する API なし、Phase 2 の差分機能で扱う領域)。

### `error-kinds`: クロール失敗の原因分類

クロール失敗を原因別に集計する。kind の網羅集合は `@nitpicker/crawler` の `ErrorKind` union（`packages/@nitpicker/crawler/src/types.ts`）が正で、現在は `dns` / `dns-transient` / `connection-refused` / `connection-reset` / `connection-timeout` / `tls` / `local-network` / `parse-error` / `client-blocked` / `timeout` / `protocol` / `unknown` の 12 種。DNS 解決失敗や Chromium のブロック判定、HTTP パースエラーが、ただの「タイムアウト/不明」に埋もれず区別できる。kind 別件数 + ホスト別内訳 + サンプル URL を JSON で返す。

原因の判定（`classifyErrorKind`）は **保存された値ではなく `message` から読み取り時に行う**ため、この機能より前に作成した既存アーカイブもそのまま分類できる。失敗の取得元は 2 系統: スクレイプ経路の失敗は `page_errors`、DNS/接続/TLS など crawler レベルの失敗は構造化テーブル `crawl_errors`（無い古いアーカイブでは `error.log` を読んでフォールバック）。応答しないページが per-property の累積タイムアウトで `timeout` に倒れる現象は beholder 側の既知課題（`getMeta` の逐次取得）。

## Viewer

`.nitpicker` または **stub ディレクトリ**（`crawl` 強制停止時の `._nitpicker-*`）をローカルブラウザで対話的に閲覧する。Hono バックエンド + React SPA。

```sh
npx @nitpicker/cli viewer <file-or-stub-dir> [--port 9000] [--no-open]
```

### Stub ディレクトリのビューア

`crawl --resume <stub>` と同じパスを `viewer <stub>` に渡せば、その時点までに集めたデータを **read-only オープン**（`Archive.connect`）で閲覧できる。`.nitpicker` ファイルへの tar 化も tmpDir 削除も `info` マイグレーションも一切走らないため、その後 `crawl --resume` を安全に続行できる。Footer に "Live crawl in progress (PID xxx)" / "Interrupted crawl stub" のバッジが出る（`<tmpDir>.lock/pid.txt` を probe して判定）。

### タールキャッシュ（同じアーカイブの 2 回目以降の起動を高速化）

`.nitpicker` ファイルを開くと、untar 結果が OS の temp スコープ（`<os.tmpdir>/nitpicker/cache/<key>-<basename>/`）に **永続キャッシュ** される。同じファイルの 2 回目以降の起動は untar をスキップして即起動する（10 GB 級で cold ~10 秒 → warm 即時）。MCP / `query` CLI も同じキャッシュを共有する。**キャッシュの evict は OS の temp cleanup に任せる**（macOS は再起動時、Linux は `systemd-tmpfiles` で 10 日、Windows は Disk Cleanup）。手動で空にしたい場合は `rm -rf $(node -e 'console.log(require("os").tmpdir())')/nitpicker/cache/`。

| env 変数                      | デフォルト                     | 用途                                                                                                                                                                            |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NITPICKER_TAR_CACHE_DIR`     | `<os.tmpdir>/nitpicker/cache/` | キャッシュの配置先を override（CI / 別ボリュームに置きたい場合）。`0` / `false` / `null` などの sentinel 風ワードはデフォルトに倒す                                             |
| `NITPICKER_DISABLE_TAR_CACHE` | (未設定)                       | `1` / `true` / `yes` / `on` のいずれかを設定するとキャッシュを完全に無効化し、毎回 `<cwd>/._nitpicker-*` に untar してクローズ時に削除する旧挙動に戻る（debug / sandbox CI 用） |

クロール経路（`crawl --append` / `--retry-failed`）は env と無関係に常に旧挙動。キャッシュは reader 経路（viewer / MCP / `query`）専用。

### viewer プロセス内キャッシュ（同一アーカイブ内の重い計算を 1 回だけにする）

10 GB クラスのアーカイブで `Isolated pages` / `Isolated clusters` / `Page links` 画面が初回 20-30 秒、2 回目以降は数ミリ秒に縮む。viewer プロセス側で per-archive の Map を 4 archive 分まで LRU で持っており、同じアーカイブを開いている間は union-find / referrer count GROUP BY を再実行しない。stub mode（live crawl 中の `._nitpicker-*` ディレクトリ）は **キャッシュを使わず毎回再計算する**（クロール中に追加された anchor / page を即座に反映するため、画面ロードは遅いままだが数字は常に live）。CLI / MCP には影響なし（1 回呼び切りでペイバックできないので元の SQL 経路のまま）。

### ページネーション（MPA がデフォルト / 仮想スクロールは opt-in）

ページ一覧は TopBar のモード切替で **MPA ページネーション**（既定）と **仮想スクロール** を切り替えられる。

- **MPA**: Prev / Next + ページ番号 + ジャンプ入力。現在ページとページサイズはどちらも URL クエリ（`?page=N` / `?pageSize=N`、ともに 1-indexed）に乗るため deep-link / 共有 / ブラウザ戻る/進むが完全に成立する（ページサイズが URL に無いと、`?page=5` を共有しても受け手側のサイズ次第で別の行が見えてしまう）。表示件数は 50 / 100 / 200。フィルタ変更で `?page=` は自動クリア、ページサイズ変更時も `?page=` を 1 に戻す（旧オフセットは新しい窓では意味を持たない）。デフォルト値（page=1, pageSize=100）は URL から省略
- **仮想スクロール**: TanStack Query infinite query + TanStack Virtual。**10 万行規模をクライアント全件ロードせず一定メモリで表示**するため、deep-link は捨てて巨大データの探索性を優先したいときの opt-in

モード本体は localStorage（`nitpicker-pagination-mode`）。ページサイズも localStorage（`nitpicker-page-size`）に保存されるが、これは新規タブ・直 URL 訪問時の hint であり、URL の `?pageSize=` が常に優先される。両モードとも backend は同じ `limit`/`offset` API（無改修）。

### Errors ビュー

`query error-kinds` と同じ集計をブラウザで表示する。kind 別のバーを選ぶと、その原因で失敗したホスト内訳とサンプル URL にドリルダウンできる。サンプル URL は（解決失敗・接続拒否など本来開けない URL なので）リンクではなく診断用のテキストとして表示する。

### HTML スナップショットプレビュー

`<iframe sandbox>`（`allow-same-origin` / `allow-scripts` なし）でレンダリングするためローカルでも安全。ソース表示にも切り替え可。

### アクセシビリティ

WCAG 2.1 AA 目標。`PagedTable`（MPA）/ `VirtualTable`（仮想スクロール）の両方が flexbox レイアウトで table セマンティクスをアクセシビリティツリーから剥がすため、**ARIA ロール（`table`/`row`/`columnheader`/`cell`）と `aria-rowcount`/`aria-colcount` を明示付与**する設計。`web/components/{paged,virtual}-table.tsx` のロール属性を削除すると画面読み上げで「ただのテキストの羅列」に退行するため必須。検証は `yarn workspace @nitpicker/viewer test:e2e` の a11y 専用テスト群が両モード分カバー。

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

ツール一覧（22 種）と引数仕様は `@nitpicker/mcp-server` の `src/tool-definitions.ts` の description / JSON Schema を参照。v2 で追加された Wappalyzer / JSON-LD 系（`list_pages_by_tag` / `count_pages_by_tag` / `list_pages_by_jsonld_type` / `count_pages_by_jsonld_type` / `get_tag_inventory` / `get_page_tags` / `get_page_jsonld` / `get_page_jsonld_overview`）は MB 級になり得るので、大規模サイトでは事前に `count_*` で size-check し、本体は CLI `nitpicker query <subcommand>` + `jq` 経由を推奨。

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
