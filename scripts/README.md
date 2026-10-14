# scripts

手動で実行する開発用スクリプト群。ビルド済みの `packages/*/lib/` を直接 import するため、実行前に `yarn build` が必要。

## Rust 化のベンチ基準値（#424）

Rust に移植する処理（#420 のロードマップ）の時間とピーク RSS を、JavaScript 版と Rust 版で同じスクリプトを使って比べるためのベンチ。移植で出力が変わらないことの確認は、下の「テンプレート分類の golden」を参照。

| スクリプト                          | 計測対象                                                                    | ケース                                                      |
| ----------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `bench-template-classification.mjs` | `classifyArchivePageTemplates`                                              | `full`                                                      |
| `bench-url-natural-sort.mjs`        | `buildPageNaturalUrlRankMap` と `externalSortUrls`                          | `rank-map` / `external-sort`                                |
| `bench-isolated-clusters.mjs`       | `computeIsolatedClusters`                                                   | `default`                                                   |
| `bench-alias-backfill.mjs`          | `backfillAliasOfId`                                                         | `default`                                                   |
| `bench-match-selector.mjs`          | `matchSelector`（単純・子孫結合子・`:nth-child()`）                         | `simple` / `compound` / `nth`                               |
| `bench-search-html.mjs`             | `searchHtml`（リテラル・正規表現 × ヒット多・少）                           | `literal-many` / `literal-few` / `regex-many` / `regex-few` |
| `bench-body-hash.mjs`               | `computeBodyHash` を全 HTML スナップショットに適用（Rust 版と JS 段階実装） | `rust` / `js`                                               |
| `bench-tech-signals.mjs`            | `matchStructuralTechnologySignals` を全 HTML スナップショットに適用         | `default`                                                   |

計測対象のスコープ（何を含め、何を `timeMs` から除くか）と各指標の意味は、各スクリプト冒頭のコメントを参照。ケースの一覧は `bench-lib/bench-cases.mjs` が唯一の正（各スクリプトの `--case` 検証と `bench-suite.mjs` の両方がこれを読む）。ケースを足したらこの表も更新する。

- `body-hash` の `js` は、oracle として残している JS 段階実装を測る。JS 段階実装を削除するとき（#430）にこのケースも削除する

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
- `bench-body-hash.mjs --case js` は、ビルド対象外の JS 段階実装を `src/` から Node の型ストリップで読み込むため、Node 24 以上が必要
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
