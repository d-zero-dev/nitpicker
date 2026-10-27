# scripts

手動で実行する開発用スクリプト群。ビルド済みの `packages/*/lib/` を直接 import するため、実行前に `yarn build` が必要。

## Rust 化のベンチ基準値（#424）

Rust に移植する処理（#420 のロードマップ）の時間とピーク RSS を、JavaScript 版と Rust 版で同じスクリプトを使って比べるためのベンチ。移植で出力が変わらないことの確認は、下の「テンプレート分類の golden」と「alias・isolated clusters・リンクグラフの golden」を参照。

| スクリプト                          | 計測対象                                                                                     | ケース                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `bench-template-classification.mjs` | `classifyArchivePageTemplates`                                                               | `full`                                                      |
| `bench-url-natural-sort.mjs`        | `buildPageNaturalUrlRankMap` と `sortArchiveUrls`                                            | `rank-map` / `all-urls`                                     |
| `bench-isolated-clusters.mjs`       | `computeIsolatedClusters`                                                                    | `default`                                                   |
| `bench-alias-backfill.mjs`          | `backfillAliasOfId`                                                                          | `default`                                                   |
| `bench-get-link-graph.mjs`          | `getLinkGraph`（全ノード・全辺と `limit: 500`）                                              | `all` / `limit-500`                                         |
| `bench-match-selector.mjs`          | `matchSelector`（単純・子孫結合子・`:nth-child()`）                                          | `simple` / `compound` / `nth`                               |
| `bench-search-html.mjs`             | `searchHtml`（リテラル・正規表現 × ヒット多・少）                                            | `literal-many` / `literal-few` / `regex-many` / `regex-few` |
| `bench-body-hash.mjs`               | `computeBodyHash` を全 HTML スナップショットに適用（Rust 版と JS 段階実装）                  | `rust` / `js`                                               |
| `bench-tech-signals.mjs`            | `matchStructuralTechnologySignals` を全 HTML スナップショットに適用（Rust 版と JS 正規表現） | `rust` / `js`                                               |
| `bench-read-model-build.mjs`        | `buildViewerReadModel`（SQL 時間と JS 時間に分割。フェーズごとの内訳つき）                   | `full` / `floor`                                            |

計測対象のスコープ（何を含め、何を `timeMs` から除くか）と各指標の意味は、各スクリプト冒頭のコメントを参照。ケースの一覧は `bench-lib/bench-cases.mjs` が唯一の正（各スクリプトの `--case` 検証と `bench-suite.mjs` の両方がこれを読む）。ケースを足したらこの表も更新する。

- `body-hash` と `tech-signals` の `js` は、oracle として残している JS 実装（body hash の段階実装、技術検出の正規表現）を測る。その JS 実装を削除するときにこのケースも削除する

### 実行

```sh
yarn build
node scripts/bench-suite.mjs <archive.nitpicker>                   # 全ケース
node scripts/bench-suite.mjs <archive.nitpicker> --only body-hash  # 一部だけ（--only は複数指定可）
node scripts/bench-run.mjs body-hash <archive.nitpicker> --case js # 1 ケースだけ
```

- 1 回の実行で 1 ケースだけを測る。ピーク RSS は計測後にベンチ自身が `process.resourceUsage().maxRSS` で記録する。RSS はプロセス内で減らないため、`bench-run.mjs` と `bench-suite.mjs` はケースごとに別プロセスを起動する
- ピーク RSS はプロセス全体の値で、Node 本体・モジュール読み込み・アーカイブを開く分（2 ページの fixture でも 100 MiB 強）を含む。Rust 版でも同じ下限が乗るので、同じアーカイブ同士の絶対値で比べる
- 結果は `bench-run.mjs` と `bench-suite.mjs` が `bench-output/`（gitignore 済み）に JSON で保存する。`bench-suite.mjs` は全ケースの結果を `suite-<日時>.json` にまとめ、標準出力に Markdown の表を出す
- 各 `bench-*.mjs` は単体でも実行でき、`--json` を付けると結果を 1 行の JSON で標準出力に出す（`bench-output/` には保存しない）
- アーカイブ本体は変更しない。書き込みを伴う計測（`template-classification`・`alias-backfill`）は、OS の一時ディレクトリに展開したコピー（`nitpicker-bench-*`）で行い、終了時に削除する。Ctrl-C などで強制終了した場合は残るので手で消す
- HTML スナップショットを全件走査する計測（`body-hash`・`tech-signals`）は、ページから参照されているスナップショットだけを対象にする（再クロールで置き換わった古いスナップショットは数えない）
- `read-model-build` の `full` は read model をビルドして、フェーズごとの最大 RSS・`heapUsed`・外部メモリも記録する（`rssByPhase` などは、フェーズの開始時点と進捗コールバックが呼ばれた時点の値の最大。進捗コールバックの無いフェーズの途中のピークは取れない）。時間を SQL（knex の `query` から `query-response` までの区間の和集合）と JS（残り）に分ける。libsql は SQL の実行と行のオブジェクト化を 1 回の同期ネイティブ呼び出しで行うので、行のオブジェクト化は SQL 側に入る。そのぶん `jsRatio` は JS 割合の下限値になる。`floor` はアーカイブのコピーを開くだけでビルドしないケースで、そのピーク RSS はビルドの変更で減らせない下限（Node 本体・モジュール読み込み・アーカイブを開く分）。実装同士は `full` と `floor` のピーク RSS の差で比べ、生の値も併記する
  - `full` は各フェーズの開始時点の WAL ファイルのサイズも `walBytesAtPhaseStart` に記録する。ビルドは 1 つのトランザクションで全テーブルを書くので、コミット前の書き込み量がどう増えるかが分かる。`final` はビルド末尾の `wal_checkpoint(TRUNCATE)` の後の値なので常に 0
  - 以下のオプションは `bench-read-model-build.mjs` を直接実行したときだけ使える（`bench-run.mjs` / `bench-suite.mjs` は `--case` 以外を渡さない）: `node --expose-gc scripts/bench-read-model-build.mjs <archive.nitpicker> --regions --gc --json`
  - `--regions` を付けると、同じ時点で OS から常駐メモリの内訳を `memoryRegionsAtPhaseStart` に記録する。`malloc` された領域（SQLite のページキャッシュ、行のバッファ）と、`PRAGMA mmap_size` で map された DB ファイル、WAL の共有メモリを分けて見るためのもの。記録の形は OS で違う: macOS は `vmmap --summary` のリージョン名（`MALLOC_LARGE`、`mapped file`、`shared memory` など）ごとに virtual / resident / dirty のバイト数、Linux は `/proc/self/status` の `RssAnon` / `RssFile` / `RssShmem` の resident だけ。どちらも読めない環境（Windows、`vmmap` が無い）では `null` を記録し、stderr に 1 回だけその旨を出す。macOS では採取のたびにプロセスが 1 秒ほど止まり、その時間は `timeMs` に入るので、時間は `--regions` の有無を揃えて比べる。`--case floor` では採るものが無いので指定するとエラーになる
  - `--pragma name=value`（複数可）で、ビルド前にビルド用の接続へ PRAGMA を当てられる（`temp_store=FILE`、`cache_spill=false`、`wal_autocheckpoint=0` など）。当てたものは `pragmas` に記録される（`floor` でも）。`mmap_size`・`cache_size` はビルド自身が入口で自分の値に設定する（`withBulkWritePragmas`）ので指定するとエラーになる
  - `--gc`（`node --expose-gc` が必要）を付けると、進捗コールバックのたびに full GC を走らせる（`gcEachProgress` で記録）。ビルドの計測ではなく診断用で、JS 側のラッパーが回収されるまで解放されないネイティブメモリ（prepared statement のコンパイル済みプログラムとバインド値のコピー）と、それ以外の理由で保持されているメモリを分けるためのもの。`--case floor` ではエラーになる
- `bench-body-hash.mjs --case js` と `bench-tech-signals.mjs --case js` は、ビルド対象外の JS 実装を `src/` から Node の型ストリップで読み込むため、Node 24 以上が必要
- 各計測は 1 回だけ実行する。固定費（初回呼び出しの準備など）の影響が小さくなる中・大サイズのアーカイブで値を比べる

### 結果の形式

```json
{
	"bench": "body-hash",
	"case": "rust",
	"input": { "pages": 1000, "archiveBytes": 100000000 },
	"env": { "node": "v24.20.0", "platform": "linux", "arch": "x64" },
	"timeMs": 120.5,
	"peakRssBytes": 200000000,
	"metrics": {
		"snapshots": 900,
		"decodedBytes": 45000000,
		"decodeMs": 210,
		"msPerSnapshot": 0.134
	}
}
```

同じ処理の JavaScript 版と Rust 版を同じ形式で比べるため、フィールドは追加だけにして、既存のフィールドの意味は変えない。`input` はページ数（取得済みの内部 HTML ページ数。未取得の URL・リダイレクト元・PDF などは数えない）とアーカイブのバイト数だけを持ち、アーカイブのパスや名前は含めない。

### 入力と基準値の記録

- 小: コミット済みの `packages/test-server/src/__tests__/e2e/fixtures/report-query-fixture.nitpicker`（2 ページ）。CI の `bench-smoke` ジョブが `yarn bench:smoke` で全ケースを回す。全ケースが動いて結果を出すことだけを確認し、値は検証しない。2 ページでは通らない分岐が多い（ブロックが 1 ページずつ、inventory ページなし。`template-classification` のサンプリング経路は類似度表がメモリ上限を超えるブロックか保持ページ数の上限を超える場合でしか通らない）。分岐の正しさは `bench-lib/` のユニットテストと各処理自身のテストで確認する
- 中（数千ページ）・大（10 万ページ超）: 手元のアーカイブで実行し、`bench-suite.mjs` が出す表を該当 issue のコメントに貼る。**貼るのは表と JSON だけにする**（進捗ログにはパスが出ることがある）。アーカイブ名・URL・ホスト名など、クロール対象を特定できる情報は書かない。Node のバージョンとマシン種別（`darwin-arm64` / `linux-x64`）は表の上の行に出る
- `isolated-clusters` は alias 元を候補から除くため、read model をビルド済み（`alias_of_id` が埋まっている）のアーカイブで測る

## テンプレート分類の golden（#426）

`template-classification-golden.mjs` は、コミットできない実アーカイブ（dogfooding のクロール）で、テンプレート分類の出力が変わっていないことを確かめる。コミット済みの golden（`packages/@nitpicker/archive/src/template-classification/golden/`）は合成サイトと HTML fixture しか持たないので、その補完。

```sh
yarn build
node scripts/template-classification-golden.mjs dump <archive.nitpicker> <out.json>     # 今の実装の出力を保存
node scripts/template-classification-golden.mjs check <archive.nitpicker> <golden.json> # 保存した出力と比べる（差分があれば終了コード 1、比較できなければ 2）
```

- `template-classification-golden.mjs` は環境変数を読まず、常に既定のメモリ上限で分類する。メモリ上限を変えて取った dump とは比べない
- 本番の入口（`classifyArchivePageTemplates`）を、一時ディレクトリに展開したコピーで、CLI と同じく進捗コールバック付きで実行する。比べるのは、保存された `page_templates`（URL → テンプレートキー）と `page_template_clusters` の reason（展開後の JSON 文字列）。アーカイブ本体は変更しない
- コピーに残っている前回の分類は先に消す。分類したページがすべて保存されていなければ失敗する。分類が 0 件のとき前回の行を比べてしまう事故と、URL を行に戻せず保存されなかったページの見落としを防ぐため
- 補助関数は `golden-lib/` にある（ユニットテスト付き）
- `dump` は実装を変える**前に**、信頼できる実装で取る。出力にはクロールした URL が入るので、**リポジトリの外に置く**。`check` が出す差分の例にも URL が入るので、issue や PR に貼らない

## alias・isolated clusters・リンクグラフの golden（#429）

`isolated-alias-golden.mjs` は、コミットできない実アーカイブで、alias の判定（`backfillAliasOfId`）・alias キー（Tier A / B）・isolated clusters（`computeIsolatedClusters`）・リンクグラフ（`getLinkGraph`）の出力が変わっていないことを確かめる。

```sh
yarn build
node scripts/isolated-alias-golden.mjs dump <archive.nitpicker> <out.jsonl>     # 今の実装の出力を保存
node scripts/isolated-alias-golden.mjs check <archive.nitpicker> <golden.jsonl> # 保存した出力と比べる（差分があれば終了コード 1、比較できなければ 2）
```

- 一時ディレクトリに展開したコピーで viewer-build と同じ順（`backfillBodyHashFromHtmlBlobs` → `backfillAliasOfId` → `computeIsolatedClusters` → `getLinkGraph`）に実行し、結果を 1 行 1 エントリの JSONL（`[カテゴリ, キー, 値]`）で保存する。全 URL のキーを持つので 1 つの JSON 文字列に収まらない。アーカイブ本体は変更しない
- 比べるのは、alias（メンバー URL → 代表 URL）・`url_refs.url` 全件の Tier A / B キー・isolated の成分の順序と各成分のメンバー（返された順）・リンクグラフのノード（`status|inDegree|source`）と辺（辺の順序は定義がないので、ソートした行の SHA-256 と件数）。`limit: 500` のグラフも同じ形で比べる
- **inventory のページを持たないアーカイブでは isolated の成分が 0 件で、isolated の出力は比べられない**。成分を持つ実アーカイブがなければ、`query/src/compute-isolated-clusters.parity.spec.ts`（参照実装との突き合わせ）と `compute-isolated-clusters.spec.ts` が根拠になる
- `dump` は実装を変える**前に**、信頼できる実装で取る。出力にはクロールした URL が入るので、**リポジトリの外に置く**。`check` が出す差分の例にも URL が入るので、issue や PR に貼らない

## viewer read model の golden

`viewer-read-model-golden.mjs` は、コミットできない実アーカイブで、`buildViewerReadModel` が作る全 `viewer_*` テーブルの内容が変わっていないことを確かめる。

```sh
yarn build
node scripts/viewer-read-model-golden.mjs dump <archive.nitpicker> <out.jsonl>     # 今の実装の出力を保存
node scripts/viewer-read-model-golden.mjs check <archive.nitpicker> <golden.jsonl> # 保存した出力と比べる（差分があれば終了コード 1、比較できなければ 2）
```

- 一時ディレクトリに展開したコピーで `buildViewerReadModel` を実行し、`sqlite_master` から列挙した全 `viewer_*` テーブル（あとからテーブルを足しても、このスクリプトの変更は要らない）を、テーブルが行を保持する順序で読む。rowid テーブルは rowid 順（挿入順は出力の一部）、`WITHOUT ROWID` テーブルは主キー順。`viewer_read_model_meta.built_at` はビルドのたびに変わるので比べない
- テーブルごとに、行数と 10,000 行ごとの SHA-256 を 1 行 1 エントリの JSONL（`[テーブル, キー, 値]`）で保存する。行そのものは持たない（最大のテーブルは数百万行で、クロールした URL を含むため）。`check` は食い違ったテーブルについて行数と、最初の数エントリのキー（`chunk:<先頭の行番号>`）だけを出す。行の中身は出さない
- `dump` は実装を変える**前に**、信頼できる実装で取る。出力にはクロールした URL のハッシュしか入らないが、アーカイブを特定できる情報なので**リポジトリの外に置く**
