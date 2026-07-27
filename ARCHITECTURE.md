# Nitpicker アーキテクチャ索引

この文書は**索引**であって保存庫ではない。目的はコードを読む範囲と順序の圧縮（探索の枝刈り）であり、実装の再説明ではない。実装詳細の正は各ソースファイルの JSDoc。この文書と実装に矛盾を見つけたら、どちらが正か調査してこの文書を更新すること（PR ごとの `/product-manager` チェックが検出ゲート）。

## 全体地図

```
@d-zero/beholder（外部）
      ↑
      └── crawler ── @nitpicker/cli ← @d-zero/roar（外部）
           ↑    ↑       ↑  ↑    ↑
           │    │       core │  report-google-sheets ← @d-zero/google-sheets（外部）
           │    │        ↑   │         ↑
           │    │        ├── @d-zero/page-cluster（外部）
           │    │  analyze-* プラグイン │
           │    └── query              │
           │         ↑                 │
           │    mcp-server ← @modelcontextprotocol/sdk
           │    viewer ← @hono/node-server + react + @tanstack/*（外部）
           └── @d-zero/dealer（外部）──┘
```

| パッケージ                        | 責務                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nitpicker/crawler`              | クロールオーケストレーション + `.nitpicker` アーカイブ（SQLite）+ スコープ判定 + エラー分類                                                                                                     |
| `@nitpicker/core`                 | analyze プラグインシステム（プラグインごとの長寿命 `WorkerPool`）+ テンプレート分類（`template-classification/`、`@d-zero/page-cluster` によるDOM構造クラスタリング、`--templates` オプトイン） |
| `@nitpicker/query`                | アーカイブへの読み取り専用 SQL API（listPages / getSummary / listLinks 等）                                                                                                                     |
| `@nitpicker/cli`                  | 統合 CLI（crawl / analyze / report / pipeline / query / viewer / viewer-build / cache）                                                                                                         |
| `@nitpicker/viewer`               | Hono API + React SPA のローカルビューア（backend `src/` + frontend `web/` の単一パッケージ）                                                                                                    |
| `@nitpicker/mcp-server`           | query の MCP 露出（stdio、`nitpicker-mcp`）                                                                                                                                                     |
| `@nitpicker/analyze-*`            | axe / lighthouse / markuplint / textlint / search の各監査                                                                                                                                      |
| `@nitpicker/report-google-sheets` | Google Sheets レポート出力（5 フェーズの `createSheets`）                                                                                                                                       |
| `@nitpicker/types`                | 監査型定義（Report / ConfigJSON）                                                                                                                                                               |
| `packages/test-server`            | E2E 用 Hono サーバー（OS割り当ての動的ポート、プロダクション非依存）                                                                                                                            |

## 境界と所有権

- **スクレイプ実行は `@d-zero/beholder`（外部）**: `Scraper.scrapeStart()` が `ScrapeResult` を返す。ブラウザ（Puppeteer）の起動・クローズは crawler 側の責務。メタ抽出は beholder、**URL 列の絶対化（canonical / og_url 等）は nitpicker 側**（`crawler/src/archive/meta/derive-flat-from-meta.ts`）
- **共有ユーティリティは `@d-zero/shared`**: `parseUrl` / `delay` / `isError` / `detectCompress` / `detectCDN` はサブパスエクスポートから使う。独自実装しない
- **エラー分類（`classifyErrorKind` / `ErrorKind` union）の源泉は crawler**（`crawler/src/classify-error-kind.ts`, `types.ts`）。query は re-export のみ。kind を増やしたら `permanent-error-kinds.ts`（retry 収束）と `is-puppeteer-fallback-candidate.ts`（fallback 判定）の両派生定数を見直す
- **Content-Type カテゴリ判定の源泉は `query/src/content-type-rules.ts` の 1 表**。JS classifier（`classifyContentType`）と SQL マッチャ（`applyCategoryFilter`）は両方ここから派生し、Summary の件数と Pages のフィルタ結果が構造的に一致する
- **並列処理**: crawler = `deal()`（@d-zero/dealer）、core = プラグインごとの `WorkerPool`（並列度は `AnalyzePlugin.concurrency`、既定 `os.cpus().length`）、report = Phase 1/4/5 が全シート並列・Phase 2/3 はシート内逐次。進捗表示はすべて `Lanes`（analyze プラグイン内で `console.log` を使わない）
- **Sheets 送信バッファは `@d-zero/google-sheets` の `Sheet`**（2500 行チャンク自動 flush・遅延セル検出）。集約シートは `finalizeResources` hook（`report-google-sheets/src/sheets/run-finalize-resources.ts`）

## 依存方向ルール

- `crawler → query` は**禁止**（query → crawler の一方向。writer 経路が error.log を読めないのはこの制約による意図的なトレードオフ）
- **CLI は全 analyze プラグインに直接依存する**（`npx` 実行時の動的 `import()` 解決のため）。新規プラグイン追加時は `@nitpicker/cli/package.json` の `dependencies` にも追加すること
- viewer / mcp-server は query 経由でのみアーカイブに触れる（read-only）
- `@d-zero/dealer` は crawler（`deal()`）のほか cli / core / report-google-sheets（`Lanes` 型）も依存。**crawler は dealer 1.9.0 で追加された `deal()` setup 第 6 引数 `unshift` に依存しており、1.9.0 未満へのダウングレード不可**

## アーカイブ（DB スキーマ概要）

`.nitpicker` = tar（中身は `db.sqlite` 1 ファイル）。定義の正は `crawler/src/archive/init-schema.ts`（`info` + DDL 関数のオーケストレーション）と `create-ref-tables.ts` / `create-entity-tables.ts` / `create-adjunct-tables.ts`（各テーブル群の DDL 本体。initSchema と `scripts/migrate-to-0.13.mjs` が同じ関数を呼ぶことで fresh / migrated の DDL 乖離を構造的に防ぐ）。

- **content_items / page_meta / resource_items / anchor_edges / resource_ref_edges / image_items（0.13 entity テーブル、正本）**: crawler の writer がクロール中に直接書く対象。URL・テキスト・content-type・JSON・BLOB・ヘッダは ref テーブル（`url_refs` / `text_refs` / `content_type_refs` / `json_refs` / `blob_refs` / `header_sets` 系）への FK で正規化する。書き込み primitive は `db-ops/_shared/`（`resolveContentItemId` / `upsert-*.ts`）
- **pages / anchors / images / resources / resources-referrers（legacy、現行アーカイブには存在しない）**: fresh archive には作られず（E2E `crawl-write-entity-tables.e2e.ts` が pin）、pre-0.13 アーカイブの中にのみ存在する。`scripts/migrate-to-0.13.mjs` が populate 元として読んだ後、同スクリプトが adjunct テーブルの FK を `content_items(id)` へ張り替え（`retarget-legacy-fk-tables.ts`）、legacy 5 テーブルを DROP する（`drop-legacy-tables.ts`。`pages.redirectDestId` の自己 FK があるため enforcement OFF で実行 — WHY は同ファイル JSDoc）。テスト用の legacy DDL は `archive/test-utils/setup-legacy-fk-db.ts` が唯一の供給源
- **page_tags**（Wappalyzer 検出）/ **page_jsonld**（JSON-LD / SpeculationRules）: 1 行 1 検出。FK は `content_items(id)` を参照
- **page_meta の main-content 系 17 列（beholder の `MainContentsData` / `ScrollHeightData`）**: 検出したメインコンテンツ要素の識別情報（`main_content_node_name` / `id` / `role` / `selector` / `class_list`）と集計値（`main_content_word_count` / `body_word_count` / 8 種の `*_count`、`scroll_height_desktop` / `mobile`）。`tag_count` / `jsonld_count` と同じ denormalised aggregate パターン（`archive/meta/compute-main-contents-denormalized.ts`）。未レンダリングのページは全列 `null`
- **page_main_content_headings / images / tables / buttons / iframes / videos / audios / canvases**: 上記の main-content 要素配下にある子要素の明細（1 行 1 要素、DOM 順）。`page_tags` / `page_jsonld` と同じ camelCase `pageId` FK（`content_items(id)` 参照）。集計値のみで足りる一覧系クエリは page_meta の列だけを見て、明細が要る場合だけ `getPageMainContents` 経由でこれらを読む
- **page_html_blobs / page_html_ref**: HTML スナップショット。SHA-256 hash PK の content-addressable BLOB（WHY は `create-adjunct-tables.ts` JSDoc）
- **page_meta.body_hash**: `<body>` 内部のみを対象に URL/パス表記ゆれ（`/index.{ext}` → `/`）と動的 ID（`/[a-z0-9]{8,}/i` から純数字・純アルファベットを除いたトークン）をマスクした上での SHA-256（`crawler/src/archive/body-hash/compute-body-hash.ts`）。`page_html_blobs.hash` が全文 HTML の完全一致ハッシュ（ストレージ dedup 目的）であるのに対し、こちらは意味的な内容重複の検知が目的で別物。マスク済み文字列自体は保存せずハッシュのみ保持する（元 HTML 全文は `page_html_blobs` から復元可能なため）。書き込みは `update-page.ts` が `page_html_ref` と同じ gate（`writeHtml && html.length > 0`）で行い、コンテンツタイプが非 HTML に確定した際は `page_html_ref` 削除と同時に `null` へ戻す。既存アーカイブへの列追加は `migrate-page-meta-body-hash.ts`（`initSchema` 経由で自動）、値の backfill は `viewer-build`（`backfillBodyHashFromHtmlBlobs`）が担う。読み取りは `query/src/find-duplicate-bodies.ts`（`find-duplicates.ts` のtitle/description版とは判定軸が別、read model 非経由のアーカイブ全体ライブ集計）
- **info**: 設定（単一行）。起点とスコープは `roots` 1 本で表現（`baseUrl` = `roots[0]`）
- **page_errors / crawl_errors**: 失敗の 2 系統（スクレイプ経路 / crawler レベル）。kind は保存せず読み取り時に `classifyErrorKind` で導出
- **inventory_runs**: `--inventory` の監査ログ。append-only・UNIQUE 制約なし（同一 sha256 の再適用は 2 行になる。dedupe 判定用に `source_file_sha256` 列だけ確保してある）。`source_file_path` は privacy のため永続化しない
- **network_outages**: オペレータ側ネットワーク断（と疑われた区間）の append-only 履歴。`started_at`（検出ウィンドウ内の最古エラーまで遡及）/ `detected_at` / `ended_at`（復旧まで NULL）/ `probe_host` / `trigger_error_count` / `trigger_host_count`。索引なし（1 クロールあたり数件、消費側は全行をメモリに読んで `isWithinOutageWindow` で判定する）。`ended_at` は復旧確定 or 次回 writer open 時の打ち切りで一度だけ UPDATE される（`crawler/src/is-within-outage-window.ts`、`archive/db-ops/outages/`）
- **リダイレクト**: 独立テーブルなし。`content_items.redirect_dest_id` を書き込み時（`linkRedirectSources`）に常に最終宛先まで pre-flatten し、読み取りは `COALESCE(target.redirect_dest_id, target.id)` の 1 ホップ（read 時に chain-walk しない）
- **content_items.alias_of_id**: URL 正規化で同一ページとみなせる行同士を統合する自己参照 FK（`redirect_dest_id` と同形、`DEFERRABLE INITIALLY DEFERRED`）。実際の 3xx を要件としない点で redirect と異なる。判定は 2 階層とも `page_meta.title_text_id` 一致が AND 条件: Tier A（`computeTierAAliasKey` — scheme 等価・host 大文字小文字・`/index.{ext}` 表記ゆれ、URL 文字列のみで決定的）と Tier B（`computeTierBAliasKey` — さらに末尾スラッシュ差異のみ、`page_meta.body_hash` 一致も必須）。両ティアは決定的キー関数の完全一致でグルーピングするため各ティア単体は推移的だが、2 種の関係の合成は自動では推移的にならず、Union-Find（`viewer-read-model/backfill-alias-of-id.ts`）で連結成分の閉包を取る（`compareUrlSortKeys` のペア比較が推移律を保証しないのとは別の理由・別の設計）。代表選定は「グループ内の他メンバーを指す canonical 数最多」→「最短 URL」→「文字列昇順」。列自体は `body_hash` と同じ自己修復マイグレーション（`migrate-content-items-alias-of-id.ts`、索引は DDL でなくマイグレーション側で作成 — 理由は body_hash の索引バグと同じ）で追加されるが、値の計算は backfill ではなく `viewer-build` 実行毎のフルリコンピュート（`backfillAliasOfId`、`body_hash` backfill の直後 — Tier B が計算済み body_hash に依存するため）。read-only 接続では列追加が走らないため、read-only 経路からも呼ばれる全クエリ（`get-summary.ts` / `list-pages.ts` / `get-link-graph.ts` / `get-page-detail.ts` / `find-duplicates.ts` / `find-mismatches.ts` / `check-headers.ts` / `list-links.ts` / `compute-isolated-clusters.ts`）が冒頭で `requireAliasOfIdColumn` を呼び、列が無ければ `viewer-build` 実行を促すエラーを投げる。`build-viewer-read-model.ts` / `compute-anchor-fact-rows.ts` はこのガードを呼ばない — 書き込み可能接続（`ensureViewerReadModel` 経由）でのみ実行され、その時点で `migrateContentItemsAliasOfId` 適用済みが保証されるため不要。適用パターンは箇所ごとに `redirect_dest_id` の既存方針を踏襲: 除外専用の `get-link-graph.ts` / `compute-isolated-clusters.ts` の候補集合は drop、`list-links.ts` / `compute-anchor-fact-rows.ts` の宛先解決は `COALESCE` で resolve。`list-pages.ts` の `urlPattern` フィルターと `get-page-detail.ts` の URL 検索は、redirect 元 URL・alias メンバー URL のどちらで検索してもヒットするよう、`redirect_dest_id` と `alias_of_id` を対等に解決する（`list-pages.ts` は各カラムを個別 `IN` サブクエリにしてから `UNION ALL` で束ねる — 1 つの `OR` に畳むとフルスキャンに落ちる負の知識は前述のとおり）。両者は別の関係（redirect は実観測の 3xx、alias は本文/URL 形状からの推論）だが「このURLの実体は別の行」という意味では同じ扱いにする。
  - **多段解決が必要な理由**: `backfillAliasOfId` の候補選定は redirect _元_（`redirect_dest_id IS NOT NULL`）だけを候補から除外し、redirect _先_ は除外しない。そのため「A が B に redirect し、B 自身が C の alias メンバー」という 2 段の連鎖が起こりうる（`redirect_dest_id` 自体は書き込み時に最終宛先まで pre-flatten 済みなので、追加で辿る必要があるのは `alias_of_id` の 1 ホップのみ）。単発行の `get-page-detail.ts` は `resolveAliasAndRedirectChain`（`query/src/resolve-alias-and-redirect-chain.ts`）で `redirect_dest_id`/`alias_of_id` を交互に 1 ホップずつ辿る（サイクル検出付き、DB 往復は許容 — 1 ページ分のみ）。`anchor_edges` を一括処理する `list-links.ts` / `compute-anchor-fact-rows.ts` は DB 往復を増やせないため、`canonical`（redirect 先）自身の `alias_of_id` を解決するもう 1 段の JOIN（`canonical_alias`）を追加し、`COALESCE(canonical_alias.*, canonical.*, alias_canonical.*, dest.*)` で優先順位を表現する（`compute-isolated-clusters.ts` は元々 `redirectMap` を Union-Find 前に `resolveRedirectChain` で辿り切る設計だったため、この多段化の影響を受けない）
- **reader / writer の対称性**: reader も writer も同じ 0.13 entity / ref テーブルを使う（issue #196 で writer 切替済み、ズレなし）。読み取りは flat な `DB_Page` / `DB_Resource` 形状を join で再構築する（`db-ops/pages/read/build-page-query.ts` + `reconstruct-page-rows.ts`、`db-ops/resources/` の対応ファイル）。fresh / migrated アーカイブの FK 宣言は `content_items(id)` に統一済み（migrated 側は `migrate-to-0.13.mjs` の rename-copy-drop が保証、`PRAGMA foreign_key_check` 0 件を `verify-migration/check-foreign-key-integrity.ts` が最終検証する）
- **viewer read model（`viewer_*` テーブル群）**: `buildViewerReadModel`（`query/src/viewer-read-model/build-viewer-read-model.ts`）が構築する読み取り専用の事前計算層。pages / summary / error-kinds / resources / images / header-checks / duplicates / mismatches / anchor-facts / directory-tree をカバーし、各機能は `get-*-fast-path.ts` で read model（fast path）と legacy SQL の二層 dispatch を行う
- **互換性**: clean-break 方針。`assert-compatible-version.ts` が `info.version >= REQUIRED_FORMAT_VERSION`（現在 0.13.0）を要求し、古い archive は `IncompatibleArchiveError` で拒否。pre-0.13 は `scripts/migrate-to-0.10.mjs` → `scripts/migrate-to-0.13.mjs` の 2 段移行（エラーメッセージが実行順を案内）。v0.x のため breaking 容認
- **read-only 経路**: viewer / MCP / query CLI は `Archive.openCached`（OS-temp タールキャッシュ）または stub ディレクトリ直結（`Archive.connect`）。migration は writer 接続でのみ走る

## 不変条件・負の知識

やってはいけないこと、および理由がコードから読めない制約。各項目の詳細な正は右のファイルの JSDoc。

- **`.nitpicker` アーカイブに `ANALYZE` / `PRAGMA optimize` を絶対に走らせない** — クエリ最適化は全て「統計なしの planner heuristics」を前提に実測で確定しており、統計が出ると planner がインデックスを別クエリの JOIN 経路に流用して大幅回帰する（legacy スキーマ時代の実測: `idx_pages_listfilter` の流用で `listLinks` / `getLinkGraph` が 15s → 500s、33x）
- **perf index の一括追加をしない** — index を無計画に足すと ANALYZE 無しの planner heuristics が崩れて別 query が 30-50x 回帰した実績が複数ある。追加時は必ず対象 query と非対象 query の両方を実測すること
- **`redirectPaths` の `slice(1)` を外さない** — follow-redirects の `res.redirects[0]` はクエリ落ちした元 URL であり、外すとクエリ違いの別ページが同一視され消失する（`crawler/src/crawler/fetch-destination.ts`。E2E: `/query-distinct/`）
- **「ページか」は content-type で判定する。`isTarget` で判定しない** — `isTarget` は「in-scope なクロール対象か」であり、in-scope な PDF も `isTarget=1`（`crawler/src/archive/normalize-content-type.ts`、`query/src/list-pages.ts`）
- **被リンクは redirect 透過解決するが、発リンクは解決しない** — 発リンク側の raw な指し先は「古い URL にリンクしている」という監査シグナル。この非対称性を「統一」しないこと（`database.ts`）
- **被リンク系の集約粒度は referrer 単位で揃える** — `getPageDetail.inboundLinks`（referrer で GROUP BY）と `listExternalLinks.referrerCount`（`COUNT(DISTINCT source.id)`）は同一粒度。片方だけ anchor 単位に変えると外部リンク一覧の参照元数と Page Detail の被リンク件数が食い違う（`query/src/list-external-links.ts`、`get-page-detail.ts`）
- **URL natural-sort comparator は推移律を保証しない** — 重複排除は `compareUrlSortKeys(...) === 0` ではなく `original` 文字列の完全一致で行い、`viewer_url_sort_keys` への INSERT は `onConflict('url').ignore()` を fail-safe に使う。viewer 起動時ソートは外部マージソート（メモリよりチャンクサイズ優先）で、結果は tar-cache 配下に JSONL ストリーミング永続化（`query/src/external-url-sort.ts`、`merge-sorted-url-chunks.ts`、`url-sort-temp-table.ts`、`viewer/src/url-sort-cache.ts`）
- **`listPages` 系は `scraped = 1` 前提（受容済みギャップ）** — 除外されて一度も取得されていない URL を一括列挙する手段は意図的に無い（旧 `listPageLinks` の廃止に伴う）。URL 既知なら `getPageDetail`（`isSkipped` / `skipReason` を返す）、一括把握は `query error-kinds` か `pages` テーブル直クエリで行う
- **read-only open は viewer read model を一切 build しない** — on-open opportunistic build は read クエリの長時間ブロックとタールキャッシュ破損の実害があり削除済み（#177）。build 経路は **crawl 完了時（`CrawlerOrchestrator.write()` 直前、`cli/src/crawl/ensure-viewer-read-model-quietly.ts`）と `viewer-build` コマンドの 2 経路のみ**。read model が無い / 古い archive は明示 `viewer-build` まで恒久的に legacy 経路（`query/src/viewer-read-model/is-viewer-read-model-current.ts`）
- **stub mode（live crawl）は常に fast path 禁止** — `isViewerReadModelCurrent` はスキーマバージョンしか見ないため、writer 追記中の tmpDir では再開前の古いスナップショットを返しうる。`getSummaryFastPath` 等を経由せず legacy を直呼びする（`viewer/src/summary-cache.ts`、`error-kinds-cache.ts`）
- **legacy fallback が無い機能の guard は `hasViewerReadModel` でなく `isViewerReadModelCurrent`** — 旧スキーマの read model を掴むと `no such table` で 500 になる（directory-tree 3 関数。`query/src/get-directory-tree.ts`）
- **read model の二次索引はデータ全投入後に構築する（index-after-load）** — 投入前に張ると B-tree 維持コストがテーブル成長とともに悪化し、大規模 archive でビルドが完走しない。PK / UNIQUE / `WITHOUT ROWID` は `.onConflict()` が依存するためテーブル定義に残す（`query/src/viewer-read-model/create-viewer-read-model-indexes.ts` / `create-viewer-read-model-tables.ts`）
- **evidence-before-indexing** — read model の index は憶測で積まず `EXPLAIN QUERY PLAN` と実測で確定する。既知の落とし穴: 範囲述語（`missing_count > 0`）を先頭列にした index は `ORDER BY url_sort_key` を満たせない（bool 列を先頭に）。default view の `content_category IN ('html','unknown')` が生む TEMP B-TREE は index 追加で解消できない（`list-viewer-header-checks.ts`、`apply-viewer-pages-filters.ts`）
- **anchors（0.13: `anchor_edges`）の全走査は `compute-anchor-fact-rows.ts` のみに許す** — build は id 範囲パーティションの `AsyncGenerator` で chunk 化し、chunk 跨ぎの `referrer_count` 合算は JS の Map で持ち回らず SQLite の `ON CONFLICT ... DO UPDATE` に委譲する（どちらも大規模 archive の OOM 回避。`derive-external-link-summary-rows.ts`、`upsert-external-link-rows.ts`）
- **`page_url_rank` は URL テキストを複製しない** — read model ファミリーで唯一の例外（`viewer_images` は数百万行規模になりうるため）。順位比較は SQLite BINARY 照合に合わせた `compareUrlBinary` を使う（素朴な JS 文字列比較は補助面文字で食い違う。`query/src/viewer-read-model/build-page-url-rank-map.ts`）
- **fast path の強制 legacy 条件は関数ごとに異なる** — pages/resources は `urlPattern`/`directory`、broken links は `urlPattern`/`includeRedirectSources`、headers/mismatches は明示 `sortBy`、duplicates のみ強制 legacy なし。各 `get-*-fast-path.ts` の JSDoc が正。duplicates の legacy 経路は実 `group_id` と衝突しない負の sentinel `-(index+1)` を採番し、route は `groupId <= 0` を 404 にする
- **既存アーカイブへの列追加は通常 version-gated migration script の役割だが、書き込みパスが単一で nullable な追加列に限り自己修復してよい**
- **`content_items` の異なる2つの nullable 列を `OR` で束ねるとフルスキャンに落ちる** — `redirect_dest_id IS NOT NULL OR alias_of_id IS NOT NULL` は各列に専用 index（`idx_content_items_redirect_dest_id` / `idx_content_items_alias_of_id`）があっても SQLite が `SCAN content_items`（実 179k ページ / 486k 行アーカイブで実測）に倒す。実測で発見済み（`compute-isolated-clusters.ts`）。各列を個別クエリにして `UNION ALL`（SQLite は括弧で囲んだサブクエリの union をサポートしないため knex の `wrap` 引数は使わない）で束ねると両方が専用 index の covering scan に戻る。列が排他的（同一行が両方セットされることはない）なら `UNION`（重複排除）ではなく `UNION ALL` で十分
- **`REQUIRED_FORMAT_VERSION` は pkg.version と別値** — crawler が `info.version` に書くのはフォーマット cut であって npm リリース番号ではない。format-breaking な変更はリリース前でも先行 bump し、format cut の無いリリースでは据え置く（`crawler/src/archive/meta/assert-compatible-version.ts`）
- **anchor_edges は `UNIQUE(page_id, href_page_id)` で dedup し、first-wins で集約する** — 同一宛先への複数アンカー（header と footer の同一リンク等）は 1 行に集約され、`count` が観測数・`first_hash` / `first_text_id` が最初の 1 件の識別を持つ。2 件目以降の textContent はスキーマ上保持されない（意図的な設計。`create-entity-tables.ts`）。**per-instance のアンカー明細を前提にする consumer（Sheets の Discrepancies 等）は first-wins の 1 行しか受け取れない**点に注意。`image_items` は逆に UNIQUE 制約なし（1 出現 = 1 行）で再スクレイプ時に置き換える
- **テーブルは「鮮度をどう保証するか」で 4 種に分類できる** — 再クロール（`--append` / `--retry-failed` / `--inventory`）後にどこまで鮮度が保証されるかはこの分類だけで決まる。各項目は「これは何か（言い換え）→ 鮮度の保ち方（特性）→ なぜその設計か（理由）」の順で読む。最初の 3 種はいずれも「1 エンティティ = 1 行を再クロール時にどう最新化するか」が軸で、4 種目の Append-Only Journal Table だけは軸が異なる（再クロールでの最新化という概念自体が無い）
  - **Raw Data Table = クロールが観測した値そのものを持つ実体行（1 エンティティ = 1 行）。** 特性: 書き込みのたびに、対象の 1 行だけを直接 UPDATE して最新化する（テーブル全体には触れない）。差分マージは不要で、常にその 1 行を今回の観測値で上書きする。理由: この行自体が一次情報源であり、他のテーブルから計算して復元できる値ではないため、UPDATE 以外に鮮度を保つ手段がない。例: `content_items` / `page_meta`（`db-ops/pages/write/update-page.ts`）。**`resource_items` は本来この分類に属するが、現状 `insert-resource.ts` が `ON CONFLICT IGNORE` の first-write-wins で書かれており、既知リソースを再取得してもその行の status / content-type / headers が更新されない（既知の逸脱）**
  - **Scoped-Replace Table = 派生行を「書き込み単位（ページ）ごとに」丸ごと置き換えるテーブル（テーブル全体を作り直すわけではない）。** 特性: 今回書き込まれたページに紐づく既存行だけを全 DELETE してから今回分を INSERT し直す（個々の行を UPDATE しない）。書き込まれていない他のページの行には一切触れない — `--inventory` / `--append` / `--retry-failed` で今回スコープ外のページの行はそのまま残り、新規ページは単純 INSERT のみで既存行の削除は発生しない。**この置換がページ単位に閉じているからこそ、通常運用でテーブルが壊れることはない。** 理由: 元になる生入力（1 ページ分のアンカー一覧・画像一覧）はどこにも永続化されない一過性データで、しかも dedup / 集約（同一宛先への複数アンカーを 1 行にまとめる等）を伴うため、部分 UPDATE では再現できず「そのページだけ毎回作り直す」以外に鮮度を保つ手段がない。ページ単位の置換さえ正しく機能していれば変更のあったページだけが最新化されれば十分なので、テーブル全体を生データから一括再構築する必要自体が生じない（raw が残らないのはこの前提の裏返しであって欠落ではない）。万一置換ロジック自体にバグがあった場合の是正は「該当ページを再クロールし直す」ことで行う。これは限界ではなく、この設計における妥当な回復経路である。例: `anchor_edges` / `image_items`（`replaceAnchorEdges` / `replaceImageItems`、`update-page.ts`）。`resource_ref_edges` も同じ分類に属する — `update-page.ts` がページ単位で既存 edge を全 DELETE し、直後に `Crawler#handleResources`（`insertResourceReferrers`、同じ WriteQueue で直列化）が今回分を INSERT し直す。ただし DELETE と INSERT は別トランザクションのため、その一瞬の窓で同一アーカイブを読んでいる読み取り専用接続（viewer / MCP）がそのページのリソースを一時的に「未使用」と観測しうる（自己修復する表示上のズレであり、恒久的なデータ欠損ではない）
  - **Computed Readonly Table = 一次情報を持たず、他の永続化テーブルの集計・整形結果だけを持つキャッシュ層。** 特性: 他のテーブル（Raw Data Table / Scoped-Replace Table）から、テーブル全体をいつでも計算しなおせる。書き込み API を持たず、鮮度はテーブルを丸ごと「破棄 → 一括再構築」することで保つ（Scoped-Replace Table と異なり、行単位の部分更新は行わない）。理由: reader 側の性能のために事前計算しておく必要があるが、一次情報を持たないぶんテーブル全体をいつ再構築しても正しさが保証されるので、鮮度管理は「テーブル全体を再構築するか否かの判定」だけで済む。例: viewer read model（`viewer_*` テーブル群、`buildViewerReadModel`）。**append / retry-failed / inventory 後もこのテーブル群を再構築するかどうかは `is-viewer-read-model-current.ts` の `schema_version` 一致判定のみで決まり、データが変わっただけではテーブル群は再構築されない**（80 行目の build 経路トリガー自体とは別軸の問題。既知の逸脱）
  - **Append-Only Journal Table = 行が不変の履歴的事実であり、UPDATE も再構築もしない台帳。** 特性: 新しい行は常に INSERT のみで追加され、既存行は原則書き換えない（1 行 = 1 回の出来事の記録）。再クロールで「最新化」されるという概念自体が無い — 古い行が古いという理由で消えたり書き換わったりしない。理由: 各行はそれ自体が起きた出来事の証跡であり、後続のクロールが新しい事実を追加することはあっても過去の事実を覆すことはない。例: `inventory_runs`（`--inventory` の監査ログ、UNIQUE 制約なし）。`network_outages` もこの分類に属するが、**唯一の例外として `ended_at` 列だけは復旧確定時（または次回 writer open 時の打ち切り）に一度だけ UPDATE される** — 「断がいつ終わったか」は開始時点では未知の事実であり、確定した時点で追記するのが自然な代わりに、この 1 列に限り append 後の書き換えを許容している（他の列は INSERT 時の値から変わらない）
- **viewer は `process.exit` の例外** — 他コマンドはバッチ型で `cli.ts` 末尾の `process.exit` に到達するが、viewer は SIGINT/SIGTERM まで resolve しない常駐サーバ。シャットダウンは必ず `ArchiveManager.closeAll()` を通す
- **`Promise.race` の負け側 timer は必ず `clearTimeout`** — 放置すると event loop を握って CLI の自然終了をブロックする。`delay()` は signal を取らないので race に使わない（実例: `fetch-destination.ts`、`close-browser-safely.ts`）
- **decorator を使わない（legacy / Stage 3 とも）** — Vite 8 内蔵の oxc が transform せず素通しし、Vitest 4.1 でテストが全滅する。retry は `retryCall`、error 発火は `emitError` / `emitErrorAndRetry` の HOF で書く
- **Playwright E2E（`viewer/e2e/`）をルート `vitest.config.ts` の `exclude` から外さない** — Vitest 非互換で `yarn test` が落ちる
- **`--retry-failed` の収束は `PERMANENT_ERROR_KINDS` 除外が担保** — 永続失敗（NXDOMAIN / 期限切れ証明書等）を reset 対象から外さないとリトライ対象が減らない（`crawler/src/permanent-error-kinds.ts`、`database.ts` の `resetFailedPages`）
- **DNS burn は session-success guard 付きでのみ行う** — resolver flip 事故でセッション全体が degenerate completion に陥るのを防ぐ（`crawler/src/crawler/should-burn-host.ts`）。加えて、断区間中に session-learned burn されたホストはゲート再開時に自動で un-burn される（`evict-outage-tainted-dns-burns.ts`）。preload-seeded burn（前セッション由来の確定死亡判定）はこの巻き戻しの対象外 — session-learned burn だけを区別するために `dns-burned-host-burn-timestamps.ts` が burn 時刻を別途記録する。次セッションへの持ち越し判定（`list-dns-burned-host-candidates.ts`）も、最新 DNS エラーの `createdAt` が断区間内なら候補から除外する
- **inventory の source 優先度は `crawled > inventory-seed > inventory-discovered`** — crawled 経由で到達可能なページは inventory 由来と見なさない。ingestion（pre-insert + audit 行 + `.bak` 削除）は 1 セットの原子的操作で、失敗時は `.bak` 復元で全て巻き戻る（`database.ts`、`crawler-orchestrator.ts` の `ingestionComplete`）
- **Archive への書き込みは `WriteQueue` で直列化** — 複数イベントハンドラからの SQLite 書き込みロック競合を防ぐ。`crawlEnd` で `drain()` 必須（`crawler/src/write-queue.ts`）
- **タールキャッシュは誰も evict しない** — read-only open の展開先 `<os.tmpdir>/nitpicker/cache/` の寿命は OS の temp cleanup に委ねる設計。手動削除は `rm -rf` で安全（`archive.ts` の `openCached`）。`nitpicker cache list` / `cache clear` は同じ場所（tar 展開キャッシュ + analyze の `table` キャッシュ）を一覧・削除する診断用 CLI で、確認プロンプト無しの即時削除という設計思想も踏襲する（`cli/src/commands/cache.ts`）
- **libsql 0.5.x の `readonly: true` は SQL 層で no-op** — read-only 安全性は migration スキップ + `setData` namespace ガード + 内部 review の 3 層で担保（`database.ts`）
- **report の resources sort は派生文字列を 1 つも作らない** — `Intl.Collator` per-compare（分単位ブロック → Sheets keep-alive 切断）、ゼロパディング sort key 事前生成（数百 MB ヒープ）、比較関数内 `toLowerCase()`（GC 圧迫）はすべて実測で却下済み。`charCodeAt` 比較のみで書く（`report-google-sheets/src/utils/sort-resources-by-url.ts`）
- **集約シートは `finalizeResources` hook を使う** — `eachResource` 内で「最後の resource か」を判定して emit する書き方は Phase 3 の並列化で壊れるため禁止（`sheets/run-finalize-resources.ts`。V8 引数上限 ~65k の既知の制約も同 JSDoc）
- **巨大集合のユニーク値カウントは sample set + overflowedCount** — cap 到達と観測落ちを区別する（`report-google-sheets/src/data/create-resources.ts` の `ParamValueTracker`）
- **`-v` / `--version` は `argv[0]` の位置でのみ判定**（@d-zero/roar の仕様）。`crawl -v` はサブコマンドのフラグ扱い
- **pre-BLOB 時代の `._nitpicker-*` stub は捨てる** — read-only 経路では `page_html_*` テーブルの migration が走らず HTML 読み出しが落ちる
- **beholder バンプ時は `--retry-failed` の手動 smoke を行う** — JS-redirect rescue（`build-js-redirect-edge.ts`）の発火条件が puppeteer のバージョンで変わり、E2E は rescue path を踏んでいない

## Reading paths

代表的な変更の読み順。パスは `packages/@nitpicker/` 起点。

### crawler の挙動変更

1. `cli/src/commands/crawl.ts`（入口・start/resume/append/inventory 分岐）
2. `crawler/src/crawler-orchestrator.ts`（イベント配線・WriteQueue・abort）
3. `crawler/src/crawler/crawler.ts`（`#runDeal` / `#scrapePage` / `#sendHeadRequest`）
4. `crawler/src/crawler/link-list.ts`（キュー状態機械）と `fetch-destination.ts`（HEAD/GET）
5. 分岐次第: スコープ（`find-scope-entry.ts`）/ キュー優先度（`is-likely-html-url.ts`）/ エラー分類（`classify-error-kind.ts`, `should-burn-host.ts`）/ JS redirect（`build-js-redirect-edge.ts` 系）/ ブラウザクローズ（`close-browser-safely.ts`, `kill-process-tree.ts`）
6. 保存: `crawler/src/archive/database.ts`（updatePage / recordRedirect / insertPage）

### analyze プラグイン追加

1. `core/src/types.ts`（`AnalyzePlugin` インターフェース・`concurrency`）
2. 参考実装: `analyze-search/src/search-plugin.ts`
3. `core/src/nitpicker.ts` と `core/src/worker/worker-pool.ts`（実行モデル）
4. `cli/src/commands/analyze.ts` + **`cli/package.json` の `dependencies` に追加**（依存方向ルール参照）

### テンプレート分類機能の変更

DOM構造類似性によるページのテンプレート分類（`--templates` オプトイン）。全ページ横断のバッチ計算であり `AnalyzePlugin`（`eachPage`/`eachUrl`、1ページ独立処理専用）には乗らないため、`AnalyzePlugin` システムとは別の専用経路として `core` に直接実装されている。命名は外部ライブラリの `clusterKey` ではなく `templateKey`（`@nitpicker/query` の無関係な「isolated cluster」＝リンク到達性によるグラフクラスタとの用語衝突を避けるため）。分類結果は `analysis/report`・`Table` を経由せず、専用の `page_templates` SQL テーブル（`analysis_violations` と同じ「専用テーブル＋ライブクエリ、read model 非経由」方式）にのみ書き込む。

1. `core/src/template-classification/collect-page-stylesheet-urls.ts`（`resource_ref_edges` + `content_type_refs.category='css'` からページ→CSS参照を取得。`@nitpicker/query` を経由せず `Archive.getKnex()` を直接使う — `core → query` という依存辺は存在しないため）
2. `core/src/template-classification/create-page-cluster-factory.ts`（`@d-zero/page-cluster` の `PageFactory` 契約: 逐次・複数周回・同一順序を守る）
3. `core/src/template-classification/classify-page-templates.ts`（`resolvePageClusterKeys` 呼び出し・`clusterKey`→`templateKey`読み替え・アーカイブ path+size+mtime+ページ数キーの永続キャッシュ）
4. `crawler/src/archive/create-adjunct-tables.ts`（`page_templates` テーブルの DDL。`page_id` PK 1:1、`WITHOUT ROWID`）と `crawler/src/archive/db-ops/analysis/replace-page-templates.ts`（全置換書き込み。URL が `content_items` に解決できないページは `replaceAnalysisViolations` と異なりエラーにせずスキップ）+ `archive.ts` / `database.ts` のファサードメソッド
5. `core/src/nitpicker.ts`（`analyze()` の Phase 3。`getPagesWithRefs` のバッチコールバック内ではなく、全バッチ蓄積後に1回だけ実行する — バッチ境界を跨いだテンプレートキーの一貫性を保つため。分類結果は `archive.replacePageTemplates()` で直接 SQL に書き込み、`Table`/`Report` には一切乗らない）
6. `cli/src/commands/analyze.ts`（`--templates` フラグ、プラグイン0件時のガードのバイパス）
7. 読み取り: `query/src/list-pages.ts` ほか `PAGE_LIST_SELECT_COLUMNS` を共有する全クエリ（`list-pages-by-tag.ts` / `list-pages-by-jsonld-type.ts` / `join-viewer-page-ids-to-list-items.ts`）と `get-page-detail.ts` が `page_templates` を `LEFT JOIN` して `templateKey` を返す。ソート対応なし（`viewer_pages` read model 側のスキーマ変更が必要になるため意図的に未対応）
8. viewer 表示（Pages 列）: `viewer/web/routes/pages-view.tsx` の Pages 一覧に列を1つ追加するのみ
9. クラスタ分析: `query/src/list-page-template-clusters.ts`（`templateKey` ごとのページ数・共通ディレクトリ（`compute-common-directory.ts`）・共通CSS積集合（`compute-css-intersection.ts` + `collect-page-stylesheet-urls-by-page-id.ts`）をクラスタの実メンバーページから再計算する。`templateKey` 文字列自体は `@d-zero/page-cluster` のブロッキングキーで、`css:` 以下は SHA-256 ハッシュのため人間には読めない — これがクラスタ単位の再計算が必要な理由。共通CSSの積集合は `@d-zero/page-cluster` が実際にハッシュ化前に行う first-party フィルタ・文書頻度90%フィルタ（非公開実装）を通していない簡易版であり、サイト全体で共通するCSSも含まれうる、と `compute-css-intersection.ts` の JSDoc に明記。`page_templates` はどのアーカイブにも `createAdjunctTables` で常時作成されるため、`hasClassification`（`--templates` 実行済みか）はテーブル有無ではなく行数0件で判定する）
10. viewer 表示（クラスタ分析画面）: `viewer/src/routes/register-template-clusters-route.ts`（`GET /api/template-clusters` 一発取得。`page_templates` は read model 非経由のためキャッシュは `viewer/src/template-clusters-cache.ts` のメモリ LRU のみ、stub mode はbypass）+ `viewer/web/routes/template-clusters-view.tsx`（`templateKey` ごとに `<details>` セクション表示、見出しは共通CSSファイル名優先・無ければ共通ディレクトリにフォールバック、Pages 一覧への `templateKey` フィルタ付きリンク）。MCP 専用ツール・CLI サブコマンドは意図的に未実装

### viewer のビュー / API 追加

1. `viewer/src/create-app.ts`（ルート登録）と `viewer/src/routes/register-*-route.ts`（query 1:1）
2. query 関数本体（`query/src/*.ts`）— backend は基本無改修で query に足す
3. frontend: `viewer/web/routes/*.tsx`（ビュー）、`viewer/web/components/data-table.tsx`（PagedTable / VirtualTable dispatch）、`viewer/web/i18n/translations.ts`（en/ja 必須）
4. キャッシュが要るなら `viewer/src/*-cache.ts` + `promise-lru.ts`（stub mode は bypass — live crawl 中は snapshot が永久 stale になるため）
5. **frontend の consumer 探索は `src/` だけでなく `web/` も grep すること**

### viewer read model の変更

1. `query/src/viewer-read-model/create-viewer-read-model-tables.ts`（テーブル定義）と `create-viewer-read-model-indexes.ts`（二次索引。index-after-load と evidence-before-indexing の不変条件を先に読む）
2. `query/src/viewer-read-model/build-viewer-read-model.ts`（ビルドオーケストレーション）→ `compute-*-rows.ts`（各テーブルの行生成。chunk 化パターンは `compute-anchor-fact-rows.ts` が正）
3. 読み取り: `query/src/list-viewer-*.ts` / `get-viewer-*.ts` + cursor モジュール（`viewer-cursor-kit/` が共有基盤、`viewer-*-cursor/` が機能別）
4. dispatch: `query/src/get-*-fast-path.ts`（fast path / legacy の二層。強制 legacy 条件は関数ごとに異なる）→ viewer route（`viewer/src/routes/register-*-route.ts`）
5. スキーマを変えたら `VIEWER_READ_MODEL_SCHEMA_VERSION` を bump（旧 read model は `isViewerReadModelCurrent` で自動的に legacy へ落ちる）

### report シート追加

1. `report-google-sheets/src/sheets/types.ts`（`CreateSheetSetting`・hook 選択）
2. 参考実装: `data/create-page-list.ts`（遅延セル）/ `data/create-resources.ts`（dedupe 集約 + `finalizeResources`）
3. `sheets/create-sheets.ts`（Phase 1-5 オーケストレーション）

### DB スキーマ変更

1. `crawler/src/archive/init-schema.ts`（`info` + DDL オーケストレーション。ANALYZE 禁止の不変条件を先に読む）と `create-ref-tables.ts` / `create-entity-tables.ts` / `create-adjunct-tables.ts`（各テーブル群の DDL と設計 WHY）
2. 書き込み経路: `crawler/src/archive/db-ops/pages/write/`・`db-ops/resources/`（op 本体）と `db-ops/_shared/`（`resolveContentItemId` / `upsert-url-ref.ts` 等の ref/entity id 解決 primitive + 書き込みキャッシュ）
3. 読み取り経路: `db-ops/pages/read/build-page-query.ts` + `reconstruct-page-rows.ts`（flat 形状の再構築）と `db-ops/_shared/load-response-headers-by-set-ids.ts` / `decode-json-ref.ts`（ヘッダ / json_refs の復元 primitive、query パッケージも共用）
4. `crawler/src/archive/meta/assert-compatible-version.ts`（互換ガード）と `meta/derive-flat-from-meta.ts`（Meta 展開列）
5. 読み取り影響: `query/src/`（`get-summary.ts` / `list-pages.ts` / `content-type-rules.ts`）
6. 既存アーカイブ適用スクリプト: リポジトリルート `scripts/`（`migrate-to-0.13.mjs` は legacy テーブルからの populate → adjunct FK retarget（`retarget-legacy-fk-tables.ts`）→ legacy drop（`drop-legacy-tables.ts`）→ `foreign_key_check`（`verify-migration/check-foreign-key-integrity.ts`）の一括実行。SIGKILL 耐性あり — work dir を決定的パスで管理し、途中終了しても次回実行で完了済みフェーズをスキップして再開する（詳細はスクリプト冒頭の RESUMING AFTER A KILL 節）。schema catch-up 用の `migrate-ref-tables.ts` / `migrate-entity-tables.ts` はこのスクリプト専用で、archive open 時には走らない。テスト用の pre-0.13 fixture は `scripts/generate-pre-0.13-fixture.mjs`（`archive/test-utils/setup-legacy-fk-db.ts` 経由）が単一の生成元）

### Content-Type カテゴリ追加（3 箇所は CI が強制・2 箇所は手動）

`query/src/types.ts`（union）→ `query/src/content-type-rules.ts`（順序 = 優先度）→ `viewer/web/i18n/translations.ts` → `viewer/web/styles.css`（`.bar-segment-<cat>`）→ `cli/src/commands/query.ts` の desc + `mcp-server/src/tool-definitions.ts` の enum。前 3 者は spec（rules / css 網羅 / i18n 網羅）が CI で落とす。後 2 者は手動レビュー。

## テストと CLI 契約

- ユニット: `yarn test`（Vitest 4、1関数1ファイルにユニットテスト必須）
- E2E: `yarn vitest run --config vitest.e2e.config.ts`（maxWorkers: 1、test-server はOS割り当ての動的ポート（並行worktree/セッション間の `EADDRINUSE` を回避、#162）、**外部リンクは `127.0.0.1` でシミュレート**（`localhost` と別ホスト名扱い））
- viewer E2E: `yarn workspace @nitpicker/viewer test:e2e`（Playwright、fixture 生成 → 実 CLI 起動 → ブラウザ検証）
- CLI 終了コード: `0` = 成功 / `1` = 致命的（スコープ内エラー含む）/ `2` = 警告（外部リンクエラーのみ。`--strict` で 1 に昇格）
