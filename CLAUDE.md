# Nitpicker - AI Agent Guide

## 概要

Nitpicker は Web サイト全体のデータを取得するクローラー＋監査ツール。ヘッドレスブラウザで各ページをレンダリングし、メタデータ・リンク構造・ネットワークリソース・HTML スナップショットを `.nitpicker` アーカイブ（tar 形式）に保存する。さらに、保存したアーカイブに対して各種 analyze プラグインを実行し、Google Sheets にレポートを出力できる。

Lerna + Yarn Workspaces のモノレポ構成で、`@nitpicker` スコープ配下の全パッケージ + E2E テストサーバーから成る。

## パッケージ構成

```
packages/
├── @nitpicker/
│   ├── cli/                       # 統合 CLI (bin: nitpicker)
│   ├── crawler/                   # クローラーエンジン（オーケストレーター + アーカイブ + ユーティリティ）
│   ├── core/                      # 監査エンジン（Nitpicker クラス + プラグインごとの WorkerPool による並列処理）
│   ├── types/                     # 監査型定義（Report, ConfigJSON）
│   ├── query/                     # アーカイブクエリ API（SQL レベルのフィルタ・集計）
│   ├── mcp-server/                # MCP サーバー（AI アシスタント連携、bin: nitpicker-mcp）
│   ├── analyze-axe/               # アクセシビリティ監査
│   ├── analyze-lighthouse/        # Lighthouse 監査
│   ├── analyze-main-contents/     # メインコンテンツ検出
│   ├── analyze-markuplint/        # マークアップ検証
│   ├── analyze-search/            # キーワード検索
│   ├── analyze-textlint/          # テキスト校正
│   ├── report-google-sheets/      # Google Sheets レポーター
│   └── viewer/                    # ローカルブラウザビューア（Hono API + React SPA、CLI: nitpicker viewer）
└── test-server/                   # E2E テスト用 Hono サーバー
```

### 依存グラフ

```
@d-zero/beholder（外部）
      ↑
      └── crawler ── @nitpicker/cli ← @d-zero/roar（外部）
           ↑    ↑       ↑  ↑    ↑
           │    │       core │  report-google-sheets
           │    │        ↑   │
           │    │  analyze-* プラグイン
           │    └── query
           │         ↑   ↑
           │         │   mcp-server ← @modelcontextprotocol/sdk（外部）
           │         └── viewer ← @hono/node-server + react + @tanstack/*（外部）
           └── @d-zero/dealer（外部）
```

> **Note**: CLI は analyze プラグインに直接依存する（`npx` 実行時のモジュール解決のため）。新規 analyze プラグイン追加時は `@nitpicker/cli/package.json` の `dependencies` にも追加すること。

> **Note**: `viewer` は Hono バックエンド（`@nitpicker/query` を再利用）+ React SPA（Vite ビルド）の単一パッケージ。CLI に `viewer` サブコマンドとして統合され、`@nitpicker/cli/package.json` の `dependencies` に含まれる。他コマンドがバッチ型（実行→完了→`process.exit`）なのに対し、viewer だけは常駐サーバなので `cli.ts` 末尾の `process.exit` を回避する例外扱いになる（`startViewer` は SIGINT/SIGTERM まで resolve しない）。ビルドは `tsc`（backend）+ `vite build`（frontend）の 2 段。

> **Note (viewer 高速化用 index 群)**: `init-schema.ts` 末尾で複数の perf index を貼っている。428k 行 archive 計測値:
>
> - `idx_pages_listfilter`: listPages 15s → 45ms (368x)。**column 順は `(isExternal, scraped, redirectDestId, url, contentType)`** — PR #96 で `scraped` 先頭の 4 列で出したら paginate-query の COUNT が `isExternal=0` フィルタで `pages_isexternal_index` に倒れて 8.7s かかる事案が出たので、本 PR で `isExternal` 先頭の 5 列に張り替え (264x for COUNT)
> - `idx_resources_internal_url`: listUnusedResources 66s → 7.5s (8.8x)
> - `idx_images_covering`: listImages 32s → 16s (2.0x)
>
> 加えて `find-duplicates` を N+1 SQL から `GROUP_CONCAT` 一発に書換 (414s → 8s, 49.6x)、`get-link-graph` を Promise.all parallel に。**重要: `.nitpicker` archive に `ANALYZE` を絶対に走らせない** — 統計が出ると planner が `idx_pages_listfilter` を JOIN paths にも流用して `listLinks` / `getLinkGraph` を 15s → 500s に回帰させる (33x worse)。既存 archive 適用は `scripts/add-perf-indexes.mjs` (PR #96 の `add-pages-listfilter-index.mjs` をリネーム + 拡張、3 index 一括)。詳細は ARCHITECTURE.md の「設計注意 (ANALYZE を走らせない)」を正とする。

> **Note (viewer プロセス側 precompute cache)**: 10 GB scale archive で **isolated-\* (20-30s)** を schema 不変で詰めた経路。実 HTTP 計測値:
>
> - `packages/@nitpicker/viewer/src/isolated-clusters-cache.ts` が `computeIsolatedClusters` 結果を archive 単位で memoise、3 つの isolated-\* endpoint が共有して **初回 25s (cache miss、union-find は速くなっていない) → 2 回目以降 1-7 ms** — この PR の最大の実効果
>
> in-process `app.request()` bench (`scripts/bench-viewer-endpoints.mjs`) の数字は SQLite page cache が異常 warm な環境の数字なので実運用との乖離あり、信用しない。実 HTTP curl で再現できる数字だけを正とする。max 4 entry LRU、Promise 単位 cache で concurrent 初回 request 共有、rejected promise は cache から落として retry 可能に。query API には `precomputedComponents` option を追加し、viewer route が cache から供給する。CLI / MCP は option を渡さず従来の SQL 経路を使う（一回呼び切りで precompute payback できないため意図通り）。
>
> （旧 `referrer-count-cache.ts` / `/api/page-links` は「ページリンク」ビューの廃止に伴い削除。per-page の被リンク数・リダイレクト元数は Page Detail ビューの inbound/outbound/redirectedFrom セクションで個別ページ単位に確認する。）

> **Note (`getSummary` viewer プロセス cache + perf indexes)**: 10 GB archive 計測で **/api/summary cold 45s → 14s / warm 24s → 1 ms (13800x)** を達成。viewer は read-only / archive 不変なので `getSummary` 結果を archive 単位で memoise すれば SQLite に再入する必要がない (`packages/@nitpicker/viewer/src/summary-cache.ts` で `createPromiseLru` を共有)。stub mode (live crawl) は cache を bypass (writer が pages 列を追記中なので snapshot は永久 stale になる)。
>
> cold first-hit の 14 s は SQLite 側の I/O bound 残コスト。`init-schema.ts` に 2 個の perf index も追加して cold/uncached の場合の disk read を減らしている:
>
> - `idx_pages_summary_contenttype ON pages(scraped, redirectDestId, contentType, isExternal, isSkipped)` — Q2 (metadata count) + Q3 (content-type histogram) を **COVERING INDEX** で satisfy。Q1 (status histogram) の seek にも使われるが GROUP BY 列 (isExternal, status) と index 列 (contentType, isExternal) の順序不一致のため Q1 は `USE TEMP B-TREE FOR GROUP BY` が残る — これでも 38% 改善できるのは Q2+Q3 が covering 化される効果。
> - `idx_pages_summary_failed ON pages(scraped, status, redirectDestId)` — Q4 (failed page id lookup) — 5113ms → 14ms (365x)。`(scraped, status)` 2-col seek で status=-1 の希少 slice に直接当てる。
>
> **却下した候補**: `idx_pages_summary_status (scraped, redirectDestId, isExternal, status)` を ANALYZE 抜きで加えると planner が Q1 の plan を変えて regression (1.1 s → 4.6-10 s)。PR #96 教訓「bulk index 追加で planner heuristic が崩れる」の再現。`scripts/bench-summary-configs.mjs` の 4-config matrix で確認。
>
> **scope-out**: `/api/links?type=broken` 20s / `/api/duplicates` 12s / `/api/images` 14s は本 PR で改善せず accept、denorm 列 (`canonicalId` / pre-aggregate) 無しでは詰まらない別 issue 候補。`/api/summary` cold 26s も I/O bound (10GB DB に対して 64MB cache)、index でこれ以上は詰まらない。

> **Note (viewer 起動時 URL ソートの外部マージソート化)**: 11 GB / 約 157 万 URL 規模のアーカイブで viewer 起動時に JS ヒープ不足クラッシュ（起動時ソートが全 URL を `ExURL` としてメモリ展開していたことが原因）。`packages/@nitpicker/query/src/external-url-sort.ts` の外部マージソート（`pages`/`resources` を id キーセットページネーションでチャンク読み込み → チャンクごとに軽量な `UrlSortKey` へパース・ソートし一時ファイルへ spill → K-way マージで統合）に置き換え、ピークメモリをチャンクサイズに抑える（処理時間は伸びるがメモリを優先）。K-way マージの重複排除が `original` 文字列の完全一致を使う理由（`compareUrlSortKeys(...) === 0` ではない — 別 URL でも 0 を返しうる natural-sort comparator の特性で誤って握り潰すため）と、`viewer_url_sort_keys` への INSERT が `onConflict('url').ignore()` を使う理由（同 comparator が推移律を保証しないことへの fail-safe）は `merge-sorted-url-chunks.ts` / `url-sort-temp-table.ts` の JSDoc を正とする。
>
> ソート結果は archive の tar-cache ディレクトリ配下 `precomputed/url-sort-ranks.jsonl` に JSON Lines でストリーミング永続化し、Ctrl-C / viewer 再起動後の再ソートを避ける（`packages/@nitpicker/viewer/src/url-sort-cache.ts`）。既存の `getOrComputeOnDisk`（一括 JSON 化、summary / isolated-clusters cache が使用）を流用しない理由（157 万件規模では読み書き時に再度全展開しメモリ効率化の意味が薄れるため専用にストリーミング実装）、stub mode での bypass 方針は同ファイルの JSDoc を正とする。起動時進捗は `@d-zero/dealer` の `Lanes` で表示し、`pages`+`resources` の総行数を事前 `COUNT(*)` して読み込み・マージ両フェーズで % 表示する。

> **Note (ページネーションモード)**: リスト系ビューは MPA ページネーション（`PagedTable` + `?page=` + `?pageSize=`、デフォルト）と仮想スクロール（`VirtualTable` + `useInfiniteQuery`、opt-in）の 2 モードを TopBar のトグルで切替えられる。`DataTable` がモードに応じて dispatch し、`usePagedQuery` / `use-*-infinite` を `enabled` フラグで切替えるため backend は無改修。**page と pageSize は URL クエリが正**（deep-link / 共有が成立するため両方が URL に乗らないと意味がない、`?pageSize=` 無しで `?page=5` を共有しても受け手の窓サイズが違うと別の行が見える）。デフォルト値（page=1, pageSize=100）は URL から省略してクリーンに保つ。localStorage は `nitpicker-pagination-mode`（モード本体）と `nitpicker-page-size`（**新規タブ初回の hint**）のみ。MPA がデフォルトな理由は deep-link / URL 共有 / 戻る進むが効くため。仮想スクロールは 10 万行規模の探索性が要るとき opt-in。詳細は ARCHITECTURE.md の `@nitpicker/viewer` 節「設計注意（ページネーション...）」を正とする。

> **Note (`/api/pages` の viewer_pages fast path)**: `/api/pages` は `urlPattern`/`directory` 未指定 かつ `viewer_pages` read model が最新の場合のみ `listViewerPages`（narrow indexed read model + keyset cursor）を使い、それ以外は従来の `listPages`（wide table + offset）にフォールバックする。read model のビルドタイミング（issue #112、issue #177 で3経路→2経路に是正）は2経路: (1) crawl完了時（`CrawlerOrchestrator.write()` 直前、CLI層の `ensureViewerReadModelQuietly` 経由）に persistent read model を自動ビルド、(2) `nitpicker viewer-build <archive> [--force]` による明示ビルド（既存アーカイブの事前永続化用）。旧(3) `Archive.openCached` 経由の read-only open 時の on-open opportunistic build は、実アーカイブでの検証で read クエリが20分以上ブロックされる・disk逼迫時にタールキャッシュを破損させる等の実害が判明し issue #177 で削除した——read-only open は書き込み・ビルドを一切行わず、read model が無い/古いアーカイブは明示的な `viewer-build` を実行するまで恒久的に legacy 経路のまま。stub mode は常にビルド対象外。legacy 経路も offset を素の文字列 cursor として返すことで、フロントの `nextCursor`-only 継続契約（仮想スクロール）をどちらの経路でも満たす。詳細は ARCHITECTURE.md の `@nitpicker/viewer` 節「設計注意（`/api/pages` の viewer_pages fast path...）」を正とする。

> **Note (ディレクトリツリー read model、issue #107)**: `viewer_directory_nodes` / `viewer_directory_pages` は `viewer_pages` を返す `sourceRows` を再利用し `buildDirectoryTreeRows` が純粋関数としてメモリ上に構築する。**root_key はホスト単位、ただし internal ページを 1 件も持たないホストは除外**（外部リンク先ドメインの無意味な 1 ページツリーを防ぐ）。**ディレクトリ/ページ境界は末尾スラッシュで判定**（`/blog/2024/post-1` と `/blog/2024/` は同じ `/blog/2024/` ノードに着地）。**`has_children` は `direct_child_dir_count > 0` のみ**（`direct_page_count` を含めると構築ロジック上絶対に `false` にならないため、UI の展開矢印が意味を持つよう子ディレクトリの有無だけを見る）。この機能に legacy フォールバックは存在しないため、3関数（`getDirectoryTree`/`listDirectoryChildren`/`listDirectoryPages`）とも `hasViewerReadModel` ではなく `isViewerReadModelCurrent` を guard に使う。詳細は ARCHITECTURE.md の `@nitpicker/viewer` 節「設計注意（ディレクトリツリー read model...）」を正とする。

> **Note (viewer_anchor_facts read model、issue #114)**: `listExternalLinks`（PR #153）は `anchors` の JOIN + `COALESCE` 計算列での `GROUP BY` + `COUNT(DISTINCT source.id)` を、`listLinks(type:'broken')` はfast pathなしの13-16秒級anchorスキャン+offsetページネーションのまま、それぞれ抱えていた。issue #114 は broken/external 両方を `viewer_anchor_facts` に載せる設計を提示していたが、実装は「read/write/storageのいずれも妥協しない」基準で再検討し、ドキュメント通りのref-table（`url_refs`/`content_items`、issue #139）方式は採用しなかった（#139はまだ未着手で `#103` の実行順序上も `#114` より後）。代わりに `source_url_sort_key`/`dest_url_sort_key` を `viewer_pages.url_sort_key` と同じ発想でインライン複製するのみに絞った。`viewer_anchor_facts`（`edge_id` PK、`(source_page_id, dest_page_id)` ペア単位でdedupし`count`で重複anchorを吸収、`is_broken`/`is_external_link`フラグ、`status_sort_key`/`status_desc_key`）は `compute-anchor-fact-rows.ts` が `anchors` を`source.id`の範囲ごとにchunk化してスキャンして構築する（大規模アーカイブでの全件一括ロードによるOOMを避けるため。詳細は同ファイルのJSDoc）。`viewer_external_links` はchunkごとのスキャン結果から `derive-external-link-summary-rows.ts`（純粋関数、DBアクセス無し、chunkごとに独立集計）が導出するよう変更、chunk跨ぎの`referrer_count`合算はJS側で持ち回らずSQLite側の`ON CONFLICT ... DO UPDATE SET referrer_count = referrer_count + excluded.referrer_count`に委譲する（JSでの持ち回りはdistinct外部宛先が多いアーカイブでそれ自体が無制限にメモリを消費し得るため）——旧 `compute-external-link-rows.ts`（独自の2回目の`anchors`スキャン）は廃止。`listViewerBrokenLinks` は `listViewerPages` と同じ4系統cursorページネーションを実装し、`/api/links?type=broken` の応答契約もoffsetのみから `nextCursor`/`prevCursor` 付きに変更した（`#103`の"large OFFSETを使うな"に対応、フロントのUI見た目は無変更）。`register-links-route.ts` は `external`/`broken` 両方で `isViewerReadModelCurrent` による二層dispatchを持つ（`broken`は`urlPattern`/`includeRedirectSources`指定時に強制legacy）。スキーマ変更のため `VIEWER_READ_MODEL_SCHEMA_VERSION` を 5→6 に bump。5万ページ・40万anchor規模の実測で `viewer_anchor_facts` はwarm p50 1.2ms（旧13-16秒から数千倍改善）。詳細は ARCHITECTURE.md の `@nitpicker/viewer` 節「設計注意（viewer_anchor_facts read model、issue #114）」を正とする。

> **Note (`/api/summary` の viewer_summary read model、issue #104)**: `getSummary`（`pages`への3並列SQL集計、428k行規模で~22s）はGETのたびに再計算していたが、`buildViewerReadModel`内で1回計算した結果を単一行テーブル`viewer_summary`にキャッシュするよう変更した。`getSummary`呼び出しは`knex.transaction()`開始**前**に行う（`viewer_anchor_facts`と異なり再利用できる`sourceRows`が無いため、trx内に置く性能上のメリットが無く、失敗時も旧read modelを壊さずに済む）。呼び出し元3〜4箇所（viewer route、CLI `query summary`、MCP `get_summary`/`open_archive`）は共有ヘルパー`getSummaryFastPath`（`isViewerReadModelCurrent`ガード+`getViewerSummary`/`getSummary`二択）経由でdispatchする。**stub modeは`getSummaryFastPath`を使わず常に`getSummary`を直接呼ぶ**——`crawl --resume`/`--append`/`--retry-failed`が再オープンするtmpDirは既に一度crawl完了しread modelを持つ場合があり、`isViewerReadModelCurrent`はスキーマバージョン一致のみで判定するため、writerが追記中のライブ集計ではなく再開前の古いスナップショットを誤って返しかねない。スキーマ変更のため`VIEWER_READ_MODEL_SCHEMA_VERSION`を6→7にbump。40万ページ規模の実測で直接呼び出し比較 `getSummary` 約345ms → `getViewerSummary` 約1.4ms。詳細は ARCHITECTURE.md の `@nitpicker/viewer` 節「設計注意（`/api/summary` の viewer_summary read model、issue #104）」を正とする。

> **Note (`/api/error-kinds` の viewer*error_kind*\* read model、issue #118)**: `getErrorKinds`（`page_errors`+`crawl_errors`/`error.log`を読み`classifyErrorKind`で毎回分類・集計、host×kindペア単位に正規化した1行=`ErrorKindEntry`を`host`/`kind`フィルタ・`sortBy`/`sortOrder`ソート・`limit`/`offset`ページネーション付きで返す——この正規化自体は#118と並行してdevに入った別の破壊的変更で、旧`{total, channelSource, groups}`形状から現行`{items, total, facets}`形状に変わった）はGETのたびに再計算していたが、`buildViewerReadModel`内で1回計算した結果を2テーブル（`viewer_error_kind_entries`/`_meta`）に正規化して書き込むよう変更した。`getErrorKinds`呼び出しは`viewer_summary`と同じ理由（再利用できる`sourceRows`が無い）で`knex.transaction()`開始**前**に`getSummary`と`Promise.all`実行し、常にオプション無し（＝フィルタ無し・全件・count降順）で呼ぶ。**分類ロジックは重複させない**——`classifyErrorKind`は`getErrorKinds`内で1回だけ呼ばれ、`computeErrorKindInsertRows`は既に分類済みの`ErrorKindsResult.items`を`viewer_error_kind_entries`用の行配列に正規化するだけの純粋関数。`viewer_error_kind_entries.sample_urls_json`は`JSON.stringify`した配列（`viewer_summary`と同じJSON列規約）——samplesは常に所属rowと一緒に読まれ独立にフィルタ/ソートされないため、別テーブルに正規化する意味がない。`viewer_error_kind_meta`（`total_records`/`channel_source`）は`viewer_summary`と同じ単一行パターン。**indexは`count`用の1本のみ**——host×kindの行数はdistinct(host)×distinct(kind)に収まり実質数千行程度が上限のため、host/kindのテキストソートはフルスキャンでも十分高速という判断（過剰indexを避けた根拠は#106の「先にベンチマーク」原則を踏襲）。同じ理由で`host_sort_key`/`kind_sort_key`のような別列も持たない（`viewer_pages.url_sort_key`と違い、host/kindはこのコードベースのどこでもcase-foldingされないため、base列を直接`ORDER BY`すれば十分）。`getViewerErrorKinds`は`host`/`kind`フィルタ・`sortBy`/`sortOrder`・`limit`/`offset`をすべてSQL側で処理し、legacy `getErrorKinds`と同じoptions契約を実装する。呼び出し元は共有ヘルパー`getErrorKindsFastPath`（`isViewerReadModelCurrent`ガード+`getViewerErrorKinds`/`getErrorKinds`二択、optionsをそのまま透過）経由でdispatchし、viewer routeは`error-kinds-cache.ts`を追加で挟む——**このキャッシュはoptions非依存の「全件スナップショット」だけをarchiveId単位でLRU/ディスクキャッシュし、host/kind/sortBy/sortOrder/limit/offsetは`applyErrorKindsOptions`でリクエストごとにJS側で適用する**（options込みでキャッシュすると異なるクエリパラメータの組み合わせごとに再計算が必要になり、legacyパスの高コストな分類走査を再度払うことになるため）。**sortBy検証とtie-breakは`resolveErrorKindsSort`/`sortArrayItems`（`@nitpicker/query`から公開）に一本化**——`getErrorKinds`・`getViewerErrorKinds`・`error-kinds-cache.ts`の3箇所が独立に「未検証の`sortBy`から`sortOrder`のデフォルトを算出する」ロジックとソート処理を持っていたことが原因で、`xhigh`コードレビューで「不正な`sortBy`だとデフォルト方向が反転/no-opになる」「JS側キャッシュ層に`host`/`kind`ソート時のtie-breakが無くSQL側と順序が食い違う」という2件の実バグが見つかった（`resolveErrorKindsSort`は`sortBy`をclampした**後**に`sortOrder`のデフォルトを決めることでこれを解消、`error-kinds-cache.ts`の`sortErrorKindEntries`は`sortArrayItems`を3回（kind→host→本命の`sortBy`）安定ソートすることでSQL側と同じ`host`/`kind` ascのtie-breakを再現）。**tie-break順が未規定なのはlegacy(`getErrorKinds`)とread model間のみ**——`getErrorKinds`はJSの`Map`挿入順、read model系（`getViewerErrorKinds`とその出力を包む`error-kinds-cache.ts`）はどちらも`host`/`kind` ascで揃っており、read model系2つの間でのtie-break不一致は無い。スキーマ変更のため`VIEWER_READ_MODEL_SCHEMA_VERSION`を8→9にbump（旧`groups/hosts/samples/meta`4テーブル時代の7→8のbumpを経て、dev側の破壊的変更への追従でさらに reshape）。40万件規模の合成データ実測で直接呼び出し比較 `getErrorKinds` 約542ms → `getViewerErrorKinds` 約1.6ms（約340倍）、`/api/error-kinds` HTTP cold 約602ms → 約4.8ms。詳細は ARCHITECTURE.md の `@nitpicker/viewer` 節「設計注意（`/api/error-kinds` の viewer*error_kind*\* read model、issue #118）」を正とする。

> **Note (`/api/resources`・`/api/unused-resources` の viewer_resources/viewer_resource_stats read model、issue #110)**: `listResources`（`resources`への行ごとcorrelated subqueryで`referrerCount`計算）と`listUnusedResources`（`resources`→`resources-referrers`へのrequest-time anti-join、COUNT用とデータ取得用で2回）はGETのたびに再計算していたが、`buildViewerReadModel`内で`resources`+`resources-referrers`を`resources.id`のkeysetでchunk化してスキャンする`computeResourceInsertRows`（`viewer_anchor_facts`と同じ「chunk化したスキャンから複数read modelテーブルを作る」パターン、ただし`computeAnchorFactRows`はGROUP BYが複合キーのためid範囲パーティショニング、こちらは`GROUP BY resources.id`が主キーそのものなので単純なkeysetページネーションで済む）で`viewer_resources`（`resource_id`単位のfilter/sort列）と`viewer_resource_stats`（`referrer_count`）に事前計算するよう変更した。**`viewer_resource_stats`をテーブルとして分離したのはissueのTO-BE本文の命名を踏襲したため**——機能的には`viewer_resources`への1列追加でも足りるが、`referrer_count`を単独で`resource_id`後joinする用途に絞っているので実害はない。`is_unused`は`viewer_resources`に複製（`/api/unused-resources`のpre-limitフィルタに必須、`viewer_anchor_facts.is_broken`と同型）。`content_category`列は**あえて持たない**——`viewer_pages`と違いresourcesのfilter/sortオプションにcontent-type-category相当のものが無く（`ListResourcesOptions.contentType`は分類前の生MIME prefixで別物、fast pathは対応せずlegacyにfallback）、`classifyContentType`を呼んでも参照者がゼロの死んだ列になるだけなので追加しなかった。`/api/resources`と`/api/unused-resources`は`viewer_pages`/`viewer_anchor_facts`と同じ4系統keyset cursorページネーション（initial/forward/backward/offset-jump、`viewer-resources-cursor/`・`viewer-unused-resources-cursor/`に完全独立した2モジュールとして実装——`viewer_resources`という同一テーブルに対する2つの異なる固定ベース述語（フィルタ無し vs `is_unused=1`固定）を持つため、`viewer_pages`型の「1テーブル1cursorモジュールで全filter組み合わせを吸収」ではなく`viewer_anchor_facts`→`listViewerBrokenLinks`型の「専用cursorモジュールを都度作る」前例を踏襲）。fast pathがサポートする`sortBy`は`url`/`status`（`/api/resources`）・`url`/`status`/`source`（`/api/unused-resources`）のみで、`urlPattern`/`contentType`フィルタや非対応`sortBy`はviewer route側で`legacy`に強制fallbackする（`register-pages-route.ts`の`usesWideTableOnlyFilter`と同型の判定）。**`/api/resources/referrers`はread model非依存**——`resources-referrers`は既存の`unique(resourceId, pageId)`複合indexで`WHERE resourceId=? AND pageId>? ORDER BY pageId`のcursor読み取りと`total`用`COUNT(*)`の両方が常にindex-coveredなため、`get-resource-referrers.ts`はどのarchiveに対しても直接bounded/cursor化して常時有効にした（MCP `get_resource_referrers`・CLI `query resource-referrers`含め全呼び出し元で`limit`/`cursor`対応、v0.x のため破壊的変更として許容）。**index設計は実測ベースで確定**——`is_external`を先頭に持つ複合index（`vr_default`等）だけを用意した初版は、`isExternal`未指定のデフォルト表示（最も一般的な呼び出し形）で`SCAN … | USE TEMP B-TREE FOR ORDER BY`に落ち（40万件実測で読み取り側が26-30msとlegacyの13-26msより遅く**退行**していた）、`viewer_pages`が常に`content_category IN ('html','unknown')`という暗黙デフォルトフィルタを持つおかげでこの問題を回避できているのに対し、resourcesの`isExternal`はデフォルト値の無い純粋optionalフィルタなのでインデックス先頭列が絶えず未拘束になり得ることが原因と判明。`is_external`非先頭の`vr_url_order`/`vr_status_order`/`vr_status_desc_order`を追加してplannerに両選択肢を持たせることで解消（`isExternal`指定時は引き続き`vr_default`等をSEARCHで使う）。40万件の合成データ実測（`scripts/bench-viewer-resources-read-model.mjs`）で `/api/resources` 直接呼び出し比較 `listResources` 約34ms → `listViewerResources` 約6ms（約5.5倍）、HTTP cold 約13ms → 約6ms、`/api/unused-resources` 直接呼び出し比較 `listUnusedResources` 約77ms → `listViewerUnusedResources` 約4ms（約20倍）、HTTP cold 約57ms → 約4ms。詳細は ARCHITECTURE.md の `@nitpicker/viewer` 節「設計注意（`/api/resources`・`/api/unused-resources` の viewer_resources/viewer_resource_stats read model、issue #110）」を正とする。

> **Note (`buildViewerReadModel`の大規模アーカイブOOM修正 + インデックス後付け化)**: `computeAnchorFactRows`/`computeResourceInsertRows`は元々`anchors`/`resources`全件を1回のSELECTでJS配列に展開してから挿入していたが、実11GB級アーカイブでJSヒープ上限に達しクラッシュすることを確認し、両関数を`AsyncGenerator`化してchunk単位で読み込むよう変更した（resources側は`GROUP BY resources.id`が主キーそのものなのでkeysetページネーション、anchors側は`GROUP BY (source.id, destId)`が複合キーで出力行をLIMITページネーションするとグループが分断され得るため集約前入力を`source.id`範囲でパーティショニング）。`viewer_external_links`のchunk跨ぎ`referrer_count`合算もJSの`Map`持ち回りだと同様に無制限にメモリを消費する欠陥がありxhighレビューで検出、`upsert-external-link-rows.ts`の`ON CONFLICT ... DO UPDATE SET referrer_count = referrer_count + excluded.referrer_count`でSQLite側に委譲する設計にした。**この過程でより大きな問題が判明**: chunk化後もanchor_factsフェーズが実11GBアーカイブで29分経過しても完走しなかった。原因は`create-viewer-read-model-tables.ts`が全14テーブルの索引をデータ投入**前**に作成しており、`viewer_anchor_facts`（6 index）のような索引本数の多いテーブルへ数百万行挿入する際にB-tree維持コストがテーブル成長とともに劣化していたため（実測: 1行14.6µs→24.1µs→31.4µsと増加）。索引をデータ投入**後**にまとめて構築する方式に変えたところ、合計コストが定数的な7.3µs/行に収まり、推定所要時間が29分超（未完走）→2分未満に短縮された。`createViewerReadModelTables`（テーブルのみ）と`createViewerReadModelIndexes`（索引のみ、`buildViewerReadModel`終盤で全テーブルのデータ投入完了後に1回呼ぶ）に分割——`viewer_anchor_facts`に限らず#103epicの全read modelテーブルに適用される。主キー・UNIQUE制約・`WITHOUT ROWID`はテーブル定義に残したまま（`.onConflict()`が使う一意性制約はこれらに依存するため後付けの対象は非必須の二次索引のみ）。詳細は ARCHITECTURE.md の `@nitpicker/viewer` 節「設計注意（`buildViewerReadModel`の大規模アーカイブOOM修正 + インデックス後付け化）」を正とする。

> **Note (`/api/images` の viewer_images read model、issue #113)**: `listImages`（このコードベース最大の write-model テーブル`images`をGETのたびに再スキャン）を`viewer_images`（`image_id`単位のfilter/sort列のみ、`src`/`currentSrc`/`alt`/`sourceCode`は一切複製せずlimit後にjoin）に置き換えた。**`page_url_rank`（整数サロゲート）はこのread modelファミリー内で唯一`url_sort_key`テキストを複製しない設計**——`docs/viewer-db-redesign-plan.md`が911万行規模での`page_url`複製を名指しで危険と警告しているため、`viewer_pages.url_sort_key`順の密な整数ランクを`buildPageUrlRankMap`がbuild時に一度だけ計算して複製する（SQLiteのBINARY照合＝UTF-8バイト列比較に合わせた`compareUrlBinary`を使用、素朴なJS文字列比較は補助面文字で順序が食い違う）。`oversizedThreshold`は固定閾値のbool事前計算ではなく`natural_width`/`natural_height`の生値保持+実行時OR評価（任意px数を受け取る既存契約を維持するため）。**`missingAlt`/`missingDimensions`はlegacy `listImages`も含めtri-state化**——fast pathを`listResources.isExternal`と同じ`!= null`規約で実装したところ、legacy側の旧truthy判定（`false`=省略扱い）との不一致をxhighレビューで検出、legacy側を揃えて修正した。CLI/MCP/viewer routeは`getImagesFastPath`（`getErrorKindsFastPath`と同型の統一ディスパッチヘルパー）経由に一本化。40万件合成データ実測で直接呼び出し比較`listImages`約17.9ms→`listViewerImages`約2.2ms（約8倍）。**この過程で`viewer-cursor-kit/`共有モジュールを新設**——xhighレビューが検出した`list-viewer-images.ts`と`list-viewer-resources.ts`の重複を解消するため、pages/resources/unused-resources/anchor-facts/imagesの5モジュールが共有するkeyset pagination基盤（`applyKeysetPredicate`/`readKeysetWindow`/`extractKeysetSortValues`/`buildFilterKey`/`encodeCursorEnvelope`/`decodeCursorEnvelope`）に移行した（`directory-pages-cursor`は別設計のため対象外）。詳細は ARCHITECTURE.md の `@nitpicker/viewer` 節「設計注意（`/api/images` の viewer_images read model、issue #113）」を正とする。

> **Note (`/api/headers` の viewer_header_checks read model、issue #119)**: `checkHeaders`（`pages.responseHeaders`へのLIKEスキャン、offset-onlyページネーション）を`viewer_header_checks`（`page_id`主キー、`url_sort_key`/`has_csp`/`has_x_frame_options`/`has_x_content_type_options`/`has_hsts`/`missing_count`）に置き換えた。**viewerに`/api/headers`ルートは元々存在せず**（ヘッダーチェックは`/api/pages`のフィルタとして統合済み）、新設した`registerHeaderChecksRoute`は既存の`register-pages-route.ts`のヘッダーフィルタ時legacy fallback（`viewer_pages`にheader presence列が無いための意図的な制約）には触れず現状維持——read-model横断の複合filterを`viewer_pages`にJOINで持ち込むのは#119単体のスコープ超過と判断した。`docs/viewer-sql-query-plan.md`の`/api/headers`SQL例が前提とする`header_sets`/`content_items`/`url_refs`ref-tableモデル（issue #139範疇）も同様に不採用（#119のDon't「Do not mix this issue with full write model migration」に整合）。`url_sort_key`は`viewer_pages.url_sort_key`と同じ「`url`をverbatim複製」規約のため、`viewer_anchor_facts`同様JOINなしで直接表示値としても使える（`listViewerHeaderChecks`は`listViewerBrokenLinks`と同じno-join構造）。CLI `query headers`・MCP `check_headers`・viewer `/api/headers`の3経路を`getHeaderChecksFastPath`（`getImagesFastPath`と同型のディスパッチヘルパー）に統一。索引は`vh_missing`/`vh_default`の2本のみ（#106/#118のevidence-before-indexing原則、個別ヘッダーフラグでのsortはfast path非対応でlegacyへ強制フォールバック）。**`vh_missing`は`missing_count`（範囲述語）ではなく`is_missing`（bool）を先頭列に持つ**——xhighレビューで、範囲述語を先頭列にした索引は`ORDER BY url_sort_key`を満たせず常に`vh_default`にフォールバックしていた（`missingOnly`が高速化されない）ことが`EXPLAIN QUERY PLAN`実測で判明、`viewer_pages.has_title`と同じ「bool値を先頭列に」の設計に揃えて修正した。**`getHeaderChecksFastPath`は明示的な`sortBy`が1つでもあれば常にlegacyへフォールバック**——初期実装は`sortBy: 'url'`を「未指定」と同一視してfast pathに流していたが、legacy `checkHeaders`は明示的な`'url'`を自然順ソート要求として扱うのに対しfast pathは常にBINARY照合の単純ソートしか提供できず、read modelの鮮度でソート順がサイレントに変わる不具合をxhighレビューで検出、修正した。`VIEWER_READ_MODEL_SCHEMA_VERSION`を11→12にbump。詳細は ARCHITECTURE.md の `@nitpicker/viewer` 節「設計注意（`/api/headers` の viewer_header_checks read model、issue #119）」を正とする。

> **Note (`/api/duplicates`・`/api/mismatches` の viewer diagnostic tables、issue #115)**: `findDuplicates`（`GROUP_CONCAT`一発だが完全メンバー一覧を1文字列に詰める設計、offsetなし）と`findMismatches`（`pages`への都度WHERE、offset-onlyページネーション）を、それぞれ`viewer_duplicate_groups`/`viewer_duplicate_group_pages`（group-level/member-page tableの2分割、`viewer_resources`/`viewer_resource_stats`・`viewer_directory_nodes`/`viewer_directory_pages`と同型の"one narrow table per grain"）と`viewer_mismatches`（`page_id`単位1行）に置き換えた。**ビルドは2フェーズ**——`computeDuplicateGroupRows`が`title`/`description`両フィールドの`GROUP BY ... HAVING COUNT(*) > 1`を1回ずつ実行して`group_id`をJS側で連番採番（`title`グループが先、`viewer_directory_nodes.node_id`と同じ「後続テーブルが参照するIDは先に確定させる」理由）、続く`computeDuplicateGroupPageRows`が`pages`を再スキャンして各行を`groupIdByValue`マップで対応グループへ紐付ける——legacyの`GROUP_CONCAT(url, ...)`を採用しなかったのは、read model側は`/api/duplicates/:groupId/pages`用に完全メンバー一覧を独立テーブルの行として持つ必要があり、1カラムの区切り文字列に詰めても再展開が要るだけで意味がないため。`viewer_mismatches.mismatch_id`は逆に`viewer_anchor_facts.edge_id`と同じくSQLite側`AUTOINCREMENT`任せ（他テーブルがinsert前にidを参照する必要がない）。**エンドポイントは2分割**——`/api/duplicates`（group一覧、`pagesLimit`件までのinlineメンバーサンプル付き）と`/api/duplicates/:groupId/pages`（1グループの完全メンバー一覧をカーソルページネーション）——`viewer_directory_nodes`/`viewer_directory_pages`の「親を安く一覧、フルメンバーは別エンドポイント」分割を踏襲。inlineサンプルの取得は`fetchDuplicateGroupPageSamples`が`ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY url_sort_key, page_id)`のwindow関数で複数グループ分を1クエリにまとめており、単純な`LIMIT groupIds.length * pagesLimit`を使わない理由は、大きいグループのメンバー行が後続グループの取り分を食い潰し得るため（`PARTITION BY`でグループごとの公平な上限を保証）——これがフェーズ1(データ層)で解消済みのN+1回避策。**索引は`vdg_field_count (field, count_desc_key, group_id)`・`vm_type_url (type, url_sort_key, mismatch_id)`・`vdgp_group_url (group_id, url_sort_key, page_id)`の3本**（#106/#118のevidence-before-indexing原則、"equality-then-sort-key"の同型で`vh_default`を踏襲）——`vdgp_group_url`は当初「`(group_id, page_id)`複合PKがclustering keyとしてすでに機能するので専用index不要」と判断していたが、xhighレビューで`EXPLAIN QUERY PLAN`実測により誤りと判明（このPKは`page_id`順クラスタリングであり実際の読み取り順`(url_sort_key, page_id)`は満たさず、大規模グループで毎回`TEMP B-TREE`ソートが発生する）ため追加した。**`getDuplicatesFastPath`はfindDuplicatesにsortBy/urlPatternの概念が無いため、read modelが有効な限り常にfast pathを優先**（`getHeaderChecksFastPath`/`getMismatchesFastPath`のような「特定条件で強制legacy」分岐が無い唯一のfast path）。**`getMismatchesFastPath`は明示的な`sortBy`または`urlPattern`のいずれかでlegacyへ強制フォールバック**——`viewer_mismatches`は`(type, url_sort_key, mismatch_id)`しか索引していないため。CLI `query duplicates`/`query mismatches`・MCP `find_duplicates`/`find_mismatches`・viewer `/api/duplicates`/`/api/mismatches`の3経路を統一ディスパッチヘルパーに一本化した結果、**CLI/MCPの応答形状が破壊的変更**——`findDuplicates`の素の配列・`findMismatches`の位置引数オーバーロードが返す素の配列が、いずれも`{items, total, limit, offset, nextCursor, prevCursor}`のcursor付きオブジェクトになった（v0.x方針により互換性維持は行わない）。**このタスク中に`findMismatches`自体の潜在バグを発見・修正**——`canonical`タイプで明示的な`sortBy`を指定すると`expected`列が無条件に自然URL順ソート（`type: 'url'`）を要求するが、`findMismatches`は一度も`ensureUrlSortTempTable`を呼ばず`viewer_url_sort_keys` TEMP TABLEが存在しないまま`no such table`でクラッシュしていた——`listPages`/`listExternalLinks`と異なりURL sort tableを一度も準備していなかったのが原因。`useUrlSort`（＝明示的な`sortBy`指定の有無）が真の時だけ`ensureUrlSortTempTable`を呼ぶよう修正し、`find-mismatches.spec.ts`に回帰テストを追加した（デフォルト＝`sortBy`未指定の高頻度パスは従来通りTEMP TABLE準備コストを払わない）。**xhighレビューで`getDuplicatesFastPath`のlegacy fallbackに3件の実バグを検出・修正**——(1) `total`が`limit`切り詰め後の件数のままだった（`findDuplicates`と同じ述語を`COUNT(*)`でラップする新規`countDuplicateGroups`で解消）、(2) `offset`が無視されていた（`findDuplicates`に`offset`引数を追加）、(3) `DEFAULT_LIMIT`(50)がlegacy分岐にしか効かずfast path分岐は`listViewerDuplicateGroups`自身のデフォルト(100)が漏れていた。あわせてlegacy分岐が採番する`groupId`（`index+1`の正整数）が実`viewer_duplicate_groups.group_id`と衝突しうるバグも検出・修正し、非正の整数sentinel（`-(index+1)`、`pages`は切り詰めず全件返す）に変更、viewer routeに`groupId <= 0`即404ガードを追加した。MCP `find_duplicates`/`find_mismatches`も同様に、初期実装が`omit(args, ...)`で`limit`/`offset`等を無検証のまま渡していたバグを`optionalNumber`/`optionalString`検証で修正し、`find_duplicates`のtool定義に`offset`/`pagesLimit`、`find_mismatches`のtool定義に`urlPattern`/`sortBy`/`sortOrder`を追加した。`/api/duplicates/:groupId/pages`はread modelが無い/古い場合、または`groupId`が非正の場合に404を返す。`VIEWER_READ_MODEL_SCHEMA_VERSION`を12→13にbump。40万件合成データ実測（`scripts/bench-viewer-duplicates-mismatches-read-model.mjs`）で`/api/duplicates`約195.7ms→約14.0ms（約14倍）、`/api/mismatches`約75.5ms→約3.2ms（約24倍）。詳細は ARCHITECTURE.md の `@nitpicker/viewer` 節「設計注意（viewer diagnostic tables、issue #115）」を正とする。

## CLI コマンド

```sh
npx @nitpicker/cli crawl <URL> [<URL>...] [options]     # Web サイトをクロールして .nitpicker ファイルを生成（複数 URL で multi-root）
npx @nitpicker/cli crawl <archive> --append <URL> [--append <URL>...]  # 既存アーカイブに新しい起点 URL を追加クロール
npx @nitpicker/cli crawl <archive> --retry-failed [--no-recursive]  # 既存アーカイブの失敗ページ（status -1/NULL・content-type NULL・5xx）を再取得
npx @nitpicker/cli crawl <archive> --inventory <urls.txt>           # URL リストファイルと既存アーカイブを突合、新規 URL のみ取り込み（孤立ページ・未使用ファイル発見用）
npx @nitpicker/cli analyze <file> [options]             # .nitpicker ファイルに対して analyze プラグインを実行
npx @nitpicker/cli report <file> [options]              # .nitpicker ファイルから Google Sheets レポートを生成
npx @nitpicker/cli pipeline <URL> [options]             # crawl → analyze → report を直列実行
npx @nitpicker/cli query <file> <sub-command> [options] # .nitpicker ファイルに対してクエリを実行し JSON 出力
npx @nitpicker/cli viewer <file-or-stub-dir> [options]  # ローカルブラウザビューアを起動（.nitpicker ファイル / stub tmpDir の両方を受け付ける、Ctrl-C で停止）
npx @nitpicker/cli viewer-build <archive> [--force]     # 永続 viewer read model を明示的に(再)ビルド（issue #112、既存アーカイブの事前永続化用）
npx @nitpicker/cli -v | --version                       # `@nitpicker/cli` のバージョンを出力して exit 0
```

> **Multi-root クロール**: 位置引数で複数 URL を渡すと、それぞれが「再帰クロールの起点」かつ「scope エントリ」として扱われ、1 つの `.nitpicker` に集約される。例: `crawl https://www.example.com/blog/ https://www.example.com/news/` → 両配下が internal として記録される。`(hostname, port, path)` トリプルで scope 一致を判定するため、`localhost:3000` と `localhost:8080` は別 scope として分離される（auth が混入しない）。

> **`--append <URL>`**: 位置引数で指定された既存 `.nitpicker` を開き、`--append` の URL を新しい起点として追加クロールする（`--append` は繰り返し指定で複数 URL 可）。新スコープに該当する旧 external ページは internal として再スクレイプされる。失敗時は `<archive>.bak` から自動復元、成功時は `.bak` 削除。`--resume` / `--diff` / `--output` / `--list` / `--list-file` / `--single` との同時指定は不可。

> **`--inventory <urls.txt>`**: 位置引数で指定された既存 `.nitpicker` を開き、URL リストファイル中の **アーカイブにまだ無い URL だけ** を取り込む。**HEAD pre-flight は orchestrator 段では行わない** — `isLikelyHtmlUrl(url)` の拡張子ヒューリスティクスで HTML / 非 HTML を同期分類する（サーバの doc-root `ls` 由来のリストでは拡張子が真の content-type を反映するという前提）。HTML 判定された URL は **`archive.insertInventorySeeds(htmlSeeds)` で `pages` に `scraped=0, source='inventory-seed'` の placeholder 行として chunked bulk insert され、scrape フェーズで dealer 経路（HEAD + puppeteer render + 再帰クロール）に流す**（issue #121: pre-insert で Ctrl+C 耐性確保。dealer pick と `setPage` の間で中断しても archive に痕跡が残り、`crawl --resume` で復活）。非 HTML 判定された URL は `archive.insertInventoryResources(nonHtmlSeeds)` で `resources` に `status` / `contentType` / `contentLength` 全て null の薄い行として chunked bulk insert される（旧実装は per-URL await ループで数万 URL では分単位の I/O が `.bak` window 内に乗っていた）。後の `query unused-resources` で referrer 0 件として浮上させる目的は変わらず。新規 page/resource の `source` 列は `'inventory-seed'`（リストに明示記載された URL）または `'inventory-discovered'`（inventory-seed page の render 中に anchor / subresource として発見された URL）でラベリングされる。**source 優先度は `'crawled' > 'inventory-seed' > 'inventory-discovered'`**（`#insertPage` の CASE WHEN UPDATE と `#getIdByUrl` の SELECT 経路 downgrade で実装）— inventory は「離れ小島の発見」が目的なので、crawled chain 経由で到達可能なら inventory 由来でなく crawled 扱いとなり、既存 `'inventory-*'` 行も crawled anchor から到達された瞬間に `'crawled'` に降格する。スコープ外 URL は警告 skip。**`.bak` 復元の境界 (issue #121)**: pre-insert + 非HTML resources insert + audit 行 + `.bak` 削除を1セットの "ingestion フェーズ" として扱い、いずれかが失敗すれば `.bak` 復元で全て巻き戻る。`.bak` 削除後の scrape フェーズで失敗した場合は archive はそのまま残り (`archive.write()` で tmpDir を `.nitpicker` に persist する経路を orchestrator が踏む)、operator は `crawl --resume <archive>` で残りを scrape できる。`ingestionComplete` フラグが境界を表すので、scrape 失敗で `.bak` を巻き戻す古い挙動には戻らない。`query isolated-pages` / `query unused-resources` の入力データを増やすのが主用途。**pending guard demote**: 開いたアーカイブに pending URL（後述の strict 定義）が残っていても hard reject せず `console.warn` で続行する — strict 定義は in-scope + anchor 参照あり + scraped=0 に絞っているので、ここに来る pending は本物の中断中作業の証拠。crawled-wins UPDATE が label 整合性を保つので進行可。なお `Database.getCrawlingState` の pending は `scraped=0 AND isExternal=0 AND EXISTS(anchors.hrefId=pages.id)` で計算する（predicted-discard leak / external anomaly などの placeholder ゴミを reader 段で除外）。`--append` / `--retry-failed` / `--resume` / `--diff` / `--output` / `--list` / `--list-file` / `--single` との同時指定は不可。**inventory_runs audit log (Phase 1)**: `--inventory` 成功 path で `inventory_runs` テーブルに 1 行追加され、`ran_at` / `list_label` (= 未指定なら `inventory-${ran_at}` 自動) / `source_file_sha256` (stream hash で O(1) メモリ) / `total_lines` / `new_pages` / `new_resources` / `scope_skipped` が記録される。**`source_file_path` は永続化しない** (privacy; 詳細は ARCHITECTURE.md の `inventory_runs` 節)。クライアント/ディレクター対応の「いつ反映したか」「同じリスト 2 度かけてないか」を archive 単独で答えるための監査ログ。ingestion フェーズ内 (`.bak` 保護下) で INSERT するので失敗時は run 行も巻き戻る (`#writeInventoryRunRow` の旧 try/catch swallow は issue #121 で削除。audit 失敗 → throw → `.bak` 復元の "ingestion 原子性" を担保する)。**noop early-return path (`novelUrls.length === 0`) は `.bak` を作らない設計なので run 行を書かない** — 全 URL が既存だった run の audit は console log でしか残らない (Phase 2 候補)。append-only / UNIQUE 制約なし — 同じ sha256 で 2 回 apply すれば 2 行できる (重複検知は Phase 3 領域)。読み出しは `nitpicker query <archive> inventory-runs` で `ran_at DESC`。Phase 1 deploy 前の archive は `migrateInventoryRuns` 経由でテーブル作成、read-only 接続では migration 走らないので `hasTable` フォールバックで空配列が返る。
>
> **`--retry-failed`**: 位置引数で指定された既存 `.nitpicker` を開き、前回クロールで失敗したページだけを pending に戻して再取得する。失敗の定義は `status = -1`（ハード失敗 sentinel）/ `status IS NULL` / `contentType IS NULL` / `status` が 5xx（4xx は確定応答なので対象外）。internal/external 両方が対象で、external は scope 判定により metadata-only として再取得される。実装は append と同じ「再オープン+`.bak`+`Crawler.resume()`+`crawling()`」フローだが、新起点を足す代わりに `Archive.resetFailedPages()`（→ `Database.resetFailedPages`）で失敗ページを `scraped=0` に戻し、archived roots を seed にして失敗ページを resumedPending 経由で処理する（external 失敗ページを scope へ誤登録しないため）。**recursive はフラグ値（デフォルト true）が優先され、アーカイブ作成時の recursive 設定は継承しない**（`crawling(list, { recursive })` で明示注入）。それ以外の設定（scope/excludes/userAgent 等）は archived 設定を流用し、明示指定したフラグのみ上書き。`--resume` / `--append` / `--diff` / `--output` / `--list` / `--list-file` / `--single` との同時指定は不可。
>
> **Note**: 全ページが失敗していた（reset 後に `scraped=1` が 0 件になる）アーカイブでも取りこぼさないよう、`Crawler.start()` の resume 判定は `#resumedScraped` だけでなく `#resumedPending` も見る。`#resumedScraped` のみを見ると「全ページ失敗 retry」や「1ページもスクレイプせず中断した resume」を fresh crawl と誤判定し、pending を全部捨ててしまう。

> **Read-only viewer / MCP / query CLI open**: read-only 経路は **`Archive.openCached`** を通る (writer 経路 `Archive.open` は `crawl --append` / `--retry-failed` 専用)。`.nitpicker` を OS-temp スコープの **タールキャッシュ** (`<os.tmpdir>/nitpicker/cache/<key>-<basename>/`) に展開し、二回目以降の open はそのまま読む (cold ~10 s untar → warm 0 ms)。キャッシュキーは `size + mtimeNs + ctimeNs + 先頭 64 KiB sha256 + 末尾 64 KiB sha256` で、FAT/exFAT/NFSv3 の低解像 mtime / 小さい in-place 上書きにも反応する。キャッシュ寿命は **誰も evict しない**: OS の temp cleanup (macOS reboot / Linux `systemd-tmpfiles` / Windows Disk Cleanup) に委ねる。READY marker は `.nitpicker-cache-ready` (内部実装) で、これが無い cacheDir は次回 open 時に `.corrupt.<pid>.<n>` にリネームして避ける (rm in-place しない理由は、リーダーが fd 保持中の可能性があるため)。post-extract で再 stat → key 不一致なら同時 writer 検出として abort して cacheDir 削除する。同プロセス内 race は `inFlightByCacheDir` Map で dedup、同 path への concurrent `ArchiveManager.open()` は `#openInflight` で dedup する。**env**: `NITPICKER_TAR_CACHE_DIR` で配置 override (sentinel-like な `0`/`false`/`null` はリジェクト)、`NITPICKER_DISABLE_TAR_CACHE=1` (or `true`/`yes`/`on`) で旧 writer 経路にフォールバック。**libsql 0.5.x caveat**: `readonly: true` を libsql に渡しても SQL 層では強制されない (no-op)。read-only 安全性は (1) `#init` が migration をスキップ + (2) `ArchiveAccessor.setData` の namespace ガード + (3) `accessor.getKnex()` への内部 review の 3 層で担保している。
>
> **Stub mode viewer**: `viewer` は `.nitpicker` ファイルだけでなく、`crawl` を強制停止した時に残る `._nitpicker-*` ディレクトリ（"stub"）も直接受け付ける。`crawl --resume` と同じ mental model で同じパスを渡せる。stub オープンは `Archive.connect(tmpDir)` 経由の **read-only** 接続で、`Database.connect({readOnly: true})` により `initSchema` / `migrateInfoRoots` は **走らない**（user の tmpDir を絶対に書き換えない）。HTML スナップショットは SQLite BLOB なので `getHtmlOfPage` は単純 SELECT で済み、read-only 接続でもそのまま動く（旧 zip 展開ロジックは廃止）。close 時には `db.destroy()` だけが呼ばれ、tar 化も tmpDir 削除も発生しないため、その後の `crawl --resume` が安全に走る。stub mode は cache を**経由しない** — user が指定した tmpDir を直接読む。viewer footer は `/api/info.crawlerPid` に応じて "Live crawl in progress (PID xxx)" / "Interrupted crawl stub" のバッジを出し分ける（`peekArchiveLockHolder` で `<tmpDir>.lock/pid.txt` を probe）。`Archive.releaseHandle()` は writer の DB ハンドルと lock を解放するが tmpDir は残す書き戻し無しの exit hatch — fixture スクリプトと一部テストが使う。

> **HTML スナップショット格納の WHY（#75）**: SQLite BLOB に切り替えた目的は (1) `--append` 時の zip 再圧縮コストを消して 100 万ページ規模を現実化する、(2) `hash PK` の content-addressable shape を #23（git ライク世代管理）の cross-generation dedup に直接乗せるための先取り、(3) tar の中身が `db.sqlite` 1 ファイルだけになり tar 化の per-file syscall も激減する。実装詳細・テーブル定義・codec の運用・migration の二段構え（runtime テーブル自動作成 + データ移行スクリプト）は `init-schema.ts` / `migrate-html-blob-tables.ts` / `database.ts` の JSDoc を正とする。v0.10 で archive フォーマットが clean-break で更新された。pre-0.10 archive を新 CLI で開くと `assertCompatibleVersion` が拒否するので、`node scripts/migrate-to-0.10.mjs <path>` を 1 回走らせる (Step A: HTML→BLOB / Step B: meta schema upgrade を状態検知で必要分だけ実行 + Step C: 保存済み BLOB を jsdom + beholder 3.1.0 の `extractMetaFromDocument` で再パースして 0.10 列 / `meta_extras` / `page_tags` / `page_jsonld` を crawl 時と同等に充填 + `info.version` を `0.10.0` に bump、npm パッケージに含まれないので `git clone` + `yarn build` 経由)。

> **Stub mode の HTML 読み出し caveat**: pre-#75 の `._nitpicker-*` stub を新 CLI の stub viewer に渡すと、read-only 経路では `migrateHtmlBlobTables` が走らず `page_html_*` テーブル不在で `getHtmlOfPageById` が落ちる。古い stub は捨ててから使うこと。

> **0.10 format (beholder 3.0.0)**: pages テーブルは beholder 3.0.0 の nested Meta を ~47 flat 列に展開、`canonical` / `og_url` / `og_image` などの URL 列は `<base href>` + ページ URL を基準に絶対化済み（find_mismatches の `canonical != url` 比較が正しく動く）。`page_tags`（Wappalyzer 検出）と `page_jsonld`（JSON-LD / SpeculationRules）は独立テーブル、`tag_count` / `jsonld_count` / `tags_providers_csv` は denormalised 集計を pages に持つ（Sheets / page-detail での GROUP BY 不要）。pre-0.10 archive は `assertCompatibleVersion` が `info.version < 0.10.0` を見て `IncompatibleArchiveError` で拒否する（clean-break、移行は `scripts/migrate-to-0.10.mjs`）。詳細は ARCHITECTURE.md の「pages テーブル (0.10)」を正とする。

> **Note**: `-v` / `--version` は `argv[0]` の位置でのみ判定する。`crawl -v` のようにサブコマンドの後ろに置いた場合はそのコマンドのフラグとして解釈される（`@d-zero/roar` の仕様）。

> **エラー原因分類（`query error-kinds` / viewer 接続障害ビュー）**: kind 集合の正は `@nitpicker/crawler` の `ErrorKind` union（`packages/@nitpicker/crawler/src/types.ts`）。**kind は保存せず読み取り時に `classifyErrorKind(message)`（`@nitpicker/crawler` 経由）で導出**するため、この機能より前のアーカイブもそのまま分類できる（分類ロジックが 1 箇所に集約され、capture 時と read 時で必ず一致する）。`PERMANENT_ERROR_KINDS`（`permanent-error-kinds.ts`）と `PUPPETEER_FALLBACK_KINDS`（`is-puppeteer-fallback-candidate.ts` 内部）は **kind union から派生する派生定数** — kind を増やしたら両方の見直しが要る（前者は `--retry-failed` の収束契約、後者は HEAD/GET 失敗時に puppeteer リトライをかける kind の判定）。失敗は 2 系統: スクレイプ経路は `page_errors`、crawler レベルの `error` チャネル（DNS/接続/TLS）は構造化テーブル **`crawl_errors`**（`Archive.addError` が `error.log` と両方へ記録、`migrateCrawlErrors` で既存アーカイブに**テーブルだけ**後付け、back-fill はしない）。`getErrorKinds` は `crawl_errors` に行があればそれを、無ければ（テーブル不在 **または空**）`error.log` をパースしてフォールバックする（空フォールバックが無いと、migration で空テーブルだけ作られた legacy アーカイブのエラーが読まれず消える）。`crawl_errors` は read-only 接続では `migrateCrawlErrors` が走らないため作られない（stub viewer は error.log フォールバックで分類）。

> **`--retry-failed` の収束**: `Database.resetFailedPages` は SQL の粗いフィルタ（status=-1 / NULL / contentType NULL / 5xx）で候補を取得した後、`getFailedPageMessages` 経由で `page_errors` + `crawl_errors` から最新メッセージを引き、`classifyErrorKind(message)` が `PERMANENT_ERROR_KINDS` に属する候補だけは **reset せずスキップ**する。永続失敗（NXDOMAIN / 期限切れ証明書 / `ERR_BLOCKED_BY_CLIENT` / HTTP パースエラー / ECONNREFUSED）は何度試しても同じ結果なので、これを除外しないと `--retry-failed` を繰り返してもリトライ対象が減らない（収束しない）。**known limitation**: pre-`crawl_errors`-era の archive で失敗が `error.log` だけに残っているケースは、`getFailedPageMessages` が message を解決できず `unknown` に倒れる → reset 対象に居続ける。`@nitpicker/query` の `resolveFailedPageMessages` は error.log まで読むが、依存方向（query → crawler）の制約で writer 経路では再利用できない。

> **HEAD pre-flight の救済**: `Crawler.#sendHeadRequest` は (1) retry ごとに 10s/30s/60s の段階タイムアウト、(2) `fetchDestination` 内で HEAD が timeout / connection-reset / parse-error なら **GET fallback**、(3) それでも HEAD/GET 両方失敗で URL が HTML 形 (`isLikelyHtmlUrl`) かつ エラー kind が `timeout` / `connection-reset` / `parse-error`（`isPuppeteerFallbackCandidate`）なら **puppeteer fallback** を 1 回だけ起動する。`metadataOnly` 経路と `dns` / `tls` / `client-blocked` / `connection-refused` / `connection-timeout` / `local-network` / `unknown` などは fallback の対象外（puppeteer でも同じ結果が出る、または cost が見合わない）。fallback 成功時は `markBrowserScrape` 通過 + `#scrapedDestinations` に登録、fallback 自体が skipped（excludeKeywords）を返したら skipped を尊重、それ以外で fallback も死んだら `Unreachable (fallback failed)` を lane 表示に出して HEAD のエラーを `crawl_errors` に記録する（puppeteer の noisier wrapper ではなく HEAD のメッセージが root cause として残るほうが運用上有用）。

> **JS-redirect rescue**: puppeteer が `page.goto returned null` で throw した時、`page.url()` を読んで navigation 後の URL を救出し redirect-edge として記録する。これは `<head>` 内 inline script や `<body onload>` の `window.location.replace(...)` / `<meta http-equiv="refresh">` のように **HTTP 層では 200 を返すが JS で別 URL に飛ぶ** パターンへの対応。`Page.goto returned null` は `classifyErrorKind` で `protocol` に倒れるが `protocol` は `PERMANENT_ERROR_KINDS` にも `PUPPETEER_FALLBACK_KINDS` にも属さない → 通常は `--retry-failed` で **無限ループ** (毎回 reset され、毎回同じ puppeteer 失敗を再生する)。rescue を入れることでループから抜ける。trigger は `isJsRedirectErrorShape(message)` (= 文字列 `Page.goto returned null` の部分一致、`[Retried N times]` / `Scraper.#fetchData: gave up after N retries —` ラッパーも吸収する) と `deriveJsRedirectTarget(originalUrl, postNavigationUrl)` (= WHATWG canonical 比較で identity / case / trailing slash / default port / credentials を除外、`about:blank` / `chrome-error://` / `data:` / `file:` / `javascript:` を除外) の AND。発火点は (a) HEAD-success → puppeteer throw の末尾 (`#scrapePage` 内、`headCheckResult` を spread した PageData で redirect-edge を作る → HEAD-derived `status=200` が `linkList.done.dest.status` に残る) と (b) HEAD-fail → puppeteer fallback → fallback も throw (`#sendHeadRequest` 内、`linkToPageData` で `status=-1` プレースホルダーを作る → `#linkRedirectSources` が NULL/-1 を 301 に flip して source 行を `Moved Permanently` 化する) の 2 箇所、いずれも `buildJsRedirectEdge(...)` ヘルパに集約。**source 行が 200 → 301 に化ける既知挙動**: HEAD-fail 経路では HTTP 真値 200 が失われ source 行は 301 として記録される (HEAD-success 経路では HEAD-derived status が保たれる)。これは `status=-1` 無限ループに比べれば strictly better だが完全に正しくはない。0.x で deferred、本格修正は別 issue 級 (source 行を `setPage` 経由で先に commit してから `setRedirect` を呼ぶ経路に lift する)。**E2E ギャップ**: puppeteer のバージョンによって `<script>window.location.replace()</script>` が throw するかどうかが変わる。現リポジトリの puppeteer は **throw せず redirect を follow して成功**するため `js-redirect.e2e.ts` は rescue path を踏まず beholder の通常 redirect 経路で同じ archive shape (source=301, dest=200) を観測している。rescue 本体は `derive-js-redirect-target.spec.ts` / `is-js-redirect-error-shape.spec.ts` / `build-js-redirect-edge.spec.ts` の unit で pin。puppeteer をバンプしたら `--retry-failed` が想定外に膨らんでいないか手動 smoke 確認すること。実装の正は `build-js-redirect-edge.ts` / `derive-js-redirect-target.ts` / `is-js-redirect-error-shape.ts` の JSDoc。

## 主要アーキテクチャ

### データフロー（crawl）

```
CrawlerOrchestrator.crawling(urls, options)
  → Archive.create()（SQLite DB を tmpDir に作成）
  → Crawler → deal()（@d-zero/dealer で並列制御）
    → 各 URL: HEAD プリフライト（fetchDestination, trackRedirects で最終到達先を解決）→ puppeteer.launch() → Scraper.scrapeStart(page, ...)
      → ScrapeResult を戻り値で返却
      → リダイレクト先が既に描画済み（#scrapedDestinations にキャッシュ）なら描画せず redirect-edge を返す（#73 多対一リダイレクトの再レンダリング抑止）
    → LinkList.done() + WriteQueue 経由で Archive にページデータ保存（redirect-edge は setRedirect で辺だけ記録）
    → 発見した新 URL を動的にキューに追加（HTML らしい URL は unshift で先頭へ優先、それ以外は push で末尾へ。判定は URL の拡張子ヒューリスティック isLikelyHtmlUrl）
  → crawlEnd 時に WriteQueue.drain() で未完了の書き込みを待機
  → CrawlerOrchestrator.write()（tmpDir を .nitpicker tar に圧縮）
```

### データフロー（analyze）

```
Nitpicker.analyze(archivePath, plugins)
  → Archive.connect() → ArchiveAccessor
  → getPagesWithRefs() で全ページ取得
  → プラグインを順次処理。プラグインごとに専用 WorkerPool を生成
    → new WorkerPool({ size: plugin.concurrency ?? os.cpus().length })
    → 長寿命 Worker N 個をプール起動時にまとめて spawn
    → 各ページ: pool.run() でタスクをキュー投入 → 空き Worker が処理
    → Lanes（@d-zero/dealer）が進捗表示を担当（プラグイン内の console.log は不要）
    → プラグイン終了時に pool.terminate()
  → レポートファイル書き出し
```

### データフロー（report）

```
report({ filePath, sheetUrl, dedupeResources, ... })
  → Archive.connect() → ArchiveAccessor
  → loadConfig() → analyze プラグインから生成された Report[] を読み込み
  → 対話プロンプト（または --all）で出力するシートを選択
  → createSheets() を 5 フェーズで実行
    Phase 1: シート作成 + ヘッダー設定（全シート並列）
    Phase 2: getPagesWithRefs() でページ反復
             → preEachPage で状態蓄積 → eachPage で行生成
             → sheet.appendRow(...) でストリーミング送信
    Phase 3: getResources() でリソース反復
             → Phase 3 入り口で URL の自然順（Pool strnatcmp 移植の on-the-fly 比較、sortResourcesByUrl）にソート
             → eachResource で行生成 → sheet.appendRow(...)
             → finalizeResources hook（任意）を per-resource ループ完了後に 1 度呼び、
                集約行を一括 emit（dedupe Resources シートが利用）
    Phase 4: addRows でプラグインデータ送信（Phase 2/3 と並列実行）
    Phase 5: updateSheet でフォーマット適用（凍結行・条件付き書式・列非表示）
```

> **`--dedupe-resources`**: Resources シートを **canonical URL**（クエリ値を捨て、キーを sort + unique）で集約する。`finalizeResources` hook を使って Phase 3 終端で集約行を一括 emit。広告/解析タグ（Google Ads conversion, Facebook Pixel, Yahoo, Bing UET, LINE Tag 等）で per-request unique なクエリ付き URL が爆発するサイトで、Google Sheets 1 ドキュメント **10,000,000 セル上限**を回避するために使う。実例: 1.6M raw → 63K 行（96% 削減）。実装は `packages/@nitpicker/report-google-sheets/src/data/create-resources.ts`、canonical 化規則は `utils/canonicalize-url.ts`。

> **dedupe モードの追加列**: raw 6 列（URL / Status Code / Status Text / Content Type / Content Length / Referrers）に加え、末尾に **Count**（その canonical group に集約された raw レコード数）と **Query Pattern**（各クエリキーの観測ユニーク値数を `key=N` 形式で並べる、例: `auid=27, capi=1, crd=25`）が付く。Query Pattern はキーごとに最大 `MAX_PARAM_VALUE_SAMPLES`（=100）まで sample set に保持し、cap 後の観測は `overflowedCount` で数える。`overflowedCount > 0` の時のみ `key=100+` を付け、100 ジャストでは `key=100` のまま（cap=hit と overflow=発生を区別する）。値そのものは記録しない（プライバシー / メモリ）。実装は `formatQueryPattern` / `recordParamValue`。

> **新規シート実装時の Hook 選択**:
>
> - **per-page / per-resource で逐次行を返す** → `eachPage` / `eachResource` をそのまま使う（自然な実装）
> - **per-resource を反復しつつ集約して 1 回だけ大量に emit したい** → `eachResource` 内で Map に蓄積、`finalizeResources` で flush（dedupe 集約モードの基本パターン）。**`eachResource` 内で「最後の resource か」を判定して emit する書き方は脆いので禁止**（Phase 3 が将来並列化されると壊れる）
> - **プラグインデータなど反復不要・単発で送りたい** → `addRows`（Phase 2/3 と並列実行される）

> **Resources の出力順**: Phase 3 入り口で `sortResourcesByUrl()`（`utils/sort-resources-by-url.ts`）により URL の自然順にソートされる。実装は **Martin Pool `strnatcmp.c` の JS 移植版**（Stuart Cheshire 1996 由来）で、`charCodeAt` ベースの on-the-fly 比較。Pool の `compare_left` / `compare_right` の 2 path 分岐をそのまま踏襲（数値ランのどちらかが `'0'` で始まれば fractional 解釈で左から即決、それ以外は length-first で bias 同点解消）。**派生文字列を一切生成しない**ためメモリ追加は O(1) per compare、O(N) の auxiliary（TimSort buffer）のみ。`image-2.jpg < image-10.jpg` の数値順、ASCII 大文字小文字は同値扱い、stable sort 保証。raw / dedupe 両モードで同じ並び順になる。
>
> **以下の sort 実装は採用してはならない**:
>
> - `Intl.Collator.compare` の per-compare 呼び出し: 1 比較あたり ICU の重みテーブル lookup が走り、N log N で累積して数分単位のブロックになる。長時間ブロック中に Google Sheets API への HTTPS keep-alive が server 側 timeout で切られ、後続 send が `EPIPE` になる。
> - 固定幅ゼロパディングで sort key を事前生成する Schwartzian: 1.6M 件 × URL 平均長 × 数値部 padding で key 配列だけで数百 MB のヒープを要し、`getResources()` の 1〜1.5 GB と合わせて Node デフォルトヒープ 4 GB を突破する。
> - 比較関数内で `toLowerCase()` / `replaceAll()` 等の派生文字列を作る: V8 は 1 比較ごとに新規 SeqString を allocate するため、N log N 回の allocation が GC を圧迫する。
>
> sort 実装は **派生文字列を 1 つも作らない** ことが鉄則。`charCodeAt` / `codePointAt` の比較のみで完結させる。

### @d-zero/shared 統合

以下の機能は `@d-zero/shared` から提供されており、独自実装は不要:

- `detectCompress` / `detectCDN` — beholder から re-export
- `parseUrl` — `@d-zero/shared/parse-url`
- `delay` — `@d-zero/shared/delay`
- `isError` — beholder/is-error.ts に集約、crawler は re-export

### deal() / 並列処理の利用箇所

- **crawler**: `deal()`（@d-zero/dealer）による URL スクレイピングの並列制御
- **core（analyze）**: プラグインごとの `WorkerPool`（長寿命 Worker N 個 / プラグイン）。並列度はプラグインの `concurrency` 宣言、未指定時は `os.cpus().length`。`Lanes`（@d-zero/dealer）で進捗表示
- **report-google-sheets**: Phase 1 / 4 / 5 は `Promise.all` で全シート並列。Phase 2 / 3 は per-resource ループは逐次（dedupe 集約と `appendRow` の順序保証のため）、ただしシート間は並列。`Lanes` でフェーズ進捗とシート別状況を表示

## テスト

```sh
yarn test                                          # ユニットテスト
yarn vitest run --config vitest.e2e.config.ts      # E2E テスト（maxWorkers: 1）
yarn workspace @nitpicker/viewer test:e2e          # Viewer の Playwright E2E（fixture 生成 → 実 CLI 起動 → ブラウザ検証）
yarn build                                         # 全パッケージビルド
yarn lint                                          # lint + cspell
```

- E2E テストサーバー: Hono on port 8010（`test-server/src/__tests__/e2e/global-setup.ts`）
- 外部リンクのシミュレーション: `127.0.0.1`（`localhost` と異なるホスト名で外部判定）
- **1関数1ファイルにはユニットテスト必須**: エクスポートされた関数ごとにユニットテストを必ず作成する
- **課題が明確な場合はテストファースト**: バグ修正や仕様が明確な機能追加では、実装より先にテストを書く

## コマンド制約

- **yarn のみ使用**: npm 厳禁。すべてのコマンドは `yarn` 経由で実行する
- **パッケージディレクトリに cd しない**: 個別パッケージディレクトリに移動してコマンドを実行しない。常にリポジトリルートから `yarn build` 等を実行する
- **ビルドは `yarn build` のみ**: `npx tsc`, `yarn tsc`, `npx nx`, `yarn dlx tsc` 等は禁止
- **対象を限定した操作**: ビルド検証は `yarn build` で全パッケージ一括実行
- **コマンドの連続実行禁止**: `&&`、`;`、改行によるコマンド連結をしない。1回の Bash 呼び出しで1コマンドのみ実行する。連結されたコマンドは settings.json の permissions allow/deny でパターンマッチできず、毎回ユーザーの手動承認が必要になり効率が大幅に低下する

## ディレクトリ・構造ルール

- **1ファイル1エクスポート**: エクスポートする関数/クラスは1つのみ。同居可能なのはファイルスコープに閉じた非エクスポートの内部関数のみ
- **index.ts 禁止**: `index.ts` を作成しない。モジュールの公開はすべて package.json の `exports` フィールドで行う
- **型は types.ts に集約**: ドメインごとに専用 `types.ts` を作成する

## 必読ドキュメント

| ドキュメント      | 内容                                                  | 対象読者           |
| ----------------- | ----------------------------------------------------- | ------------------ |
| `README.md`       | CLI の使い方・オプション・出力形式                    | API ユーザー       |
| `ARCHITECTURE.md` | パッケージ構成・データフロー・DB スキーマ・テスト構成 | コントリビューター |

ドキュメントと実装に矛盾がある場合は、**実装が正**とし、ドキュメントを修正すること。

## セキュリティ

### 機密情報の取り扱い

- `.env`、`.env.*` 等の機密ファイルを読み取り・編集・コミットしない（機密ファイルの判断は `.gitignore` を参考にすること）
- コミット前に `git diff --staged` で機密情報（API キー、トークン、パスワード、企業名、顧客情報）が含まれていないか確認する
- 環境変数やシークレットをコード内にハードコードしない

### サプライチェーン保護

- **yarn dlx は完全禁止**: ローカルパッケージを使わずリモートから直接実行するため、サプライチェーン攻撃に脆弱
- **npx は原則使わない**: package.json の scripts で定義されたコマンドを `yarn <script>` で実行すること
- 新しい依存パッケージの追加は慎重に。既存の依存で解決できないか先に確認する
- `yarn add` する前にパッケージの信頼性（ダウンロード数、メンテナンス状況、既知の脆弱性）を確認する
- `yarn add` する場合はバージョンを固定する（例: `yarn add foo@1.2.3`）
- lockfile（yarn.lock）の手動編集は禁止

## スキル

タスクに応じて `.claude/skills/` 配下のスキルを参照すること。

| スキル          | パス                                      | 用途                                                                        |
| --------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| Product Manager | `.claude/skills/product-manager/SKILL.md` | リポジトリ分析、ドキュメント生成・レビュー、アーキテクチャ評価、PR レビュー |
| QA Engineer     | `.claude/skills/qa-engineer/SKILL.md`     | コードレビュー、テスト品質チェック、カバレッジ改善、リファクタリング提案    |
| Impl            | `.claude/skills/impl/SKILL.md`            | 合意済み計画の実装・検証・PR 作成までのオーケストレーション                 |
| Grill me        | `.claude/skills/grill-me/SKILL.md`        | 計画や設計の前提を掘り下げ、依存関係を順に解いて合意形成する                |
| Doc             | `.claude/skills/doc/SKILL.md`             | 実装を正としてドキュメントの不足・矛盾を洗い出し、更新方針を適用する        |
| Git             | `.claude/skills/git/SKILL.md`             | リポジトリのコミット規約に従って差分確認・ステージング・コミットを進める    |
| PR              | `.claude/skills/pr/SKILL.md`              | プリフライトチェック後に PR 作成と CI 監視まで進める                        |

## コーディング規約

- `import { describe, it, expect } from 'vitest'` を明示的に記述（Vitest 4 の要件）
- `@d-zero/shared` はサブパスエクスポート（`@d-zero/shared/delay` 形式）
- analyze プラグインでは `console.log` を使わない（`Lanes` が進捗表示を担当）
- **JSDoc 必須**: すべての関数、クラス、クラスメンバー変数、クラスメンバー関数（private 含む）、interface、interface プロパティ、type、type オブジェクトリテラルプロパティ、関数型、トップレベル定数に JSDoc を記述する
- **interface 優先**: `type` はユニオン型・交差型・マップ型など `type` でしか定義できない場合のみ使用する
- **公開 API はオブジェクトコンテキスト**: パラメータ3つ以上の関数は名前付きオブジェクトにまとめる
- **Options は Partial**: オプショナル設定は `Partial<OptionsType>` パターンを使用する
- **exports で公開 API を厳選**: package.json の `exports` フィールドにサブパスを明示的に定義し、公開 API を限定する。モノレポ内パッケージ間でも exports 経由でのみアクセスする
- **`Promise.race` の負け側 timer は必ずキャンセル**: タイムアウト実装で `Promise.race([work, delay(N)])` を書く場合、勝者が決まった後も負け側の `setTimeout` は発火するまで event loop を握り続け、CLI プロセス終了をブロックする。`setTimeout`/`clearTimeout` を直接使い、`.finally()` で確実に clear すること（`delay()` は signal を取らないので race には使わない）。実例: `packages/@nitpicker/crawler/src/crawler/fetch-destination.ts`（HEAD 10s）、`packages/@nitpicker/crawler/src/crawler/close-browser-safely.ts`（ブラウザクローズ 30s + SIGKILL フォールバック）
- **CLI 末尾は明示的に `process.exit`**: `packages/@nitpicker/cli/src/cli.ts` の末尾で `process.exit(process.exitCode ?? ExitCode.Success)` を呼ぶ。外部依存（特に `@d-zero/beholder` の `dom-evaluation.js#getProp`）に同じ「`Promise.race` + `setTimeout` の負け側 timer 残留」パターンがあり、自然終了をブロックするため。await 済み work 完了後の defensive measure であり、内部の cleanup は順番に await した上で呼ぶこと
- **集約系シートは `finalizeResources` を使う**: Phase 3 で per-resource ループを反復しつつ集約結果を 1 度だけ送信したい場合（dedupe Resources のような実装）、`eachResource` で `num`/`total` を見て「最後だから emit」する設計は禁止。`CreateSheetSetting.finalizeResources` hook を使い、accumulate と emit を分離すること。Phase 3 の実装詳細（逐次 / 並列、num/total の意味）から切り離されるため、将来 Phase 3 が並列化されても集約ロジックが壊れない。実例: `packages/@nitpicker/report-google-sheets/src/data/create-resources.ts` の dedupe モード
- **巨大集合のユニーク値カウントは「sample set + overflowedCount」パターン**: トラッカー URL の per-request unique 値のように、1 グループ内で数十万件のユニーク値が出る可能性がある場合は、`Set<string>` を上限 N（例 `MAX_PARAM_VALUE_SAMPLES = 100`）で打ち切り、cap 到達後の観測は別カウンタ `overflowedCount` に増やす。出力時に `overflowedCount > 0` の時のみ `+` 等の overflow マークを付与し、cap ジャスト（=N unique、overflow なし）は **マークなし** で表示する。これにより「cap に達した」と「実際に観測を落とした」を区別でき、ユーザーに `N` ジャストの精度を返せる。実例: `ParamValueTracker` / `formatQueryPattern`
- **decorator は使わない (legacy / Stage 3 とも)**: Vite 8 で内部 bundler が esbuild → Rolldown + oxc に置き換わり、oxc は TypeScript の `@` decorator syntax を transform せず素通しする。Vitest 4.1（Vite 8 内蔵）で decorator 付きファイルを import すると Node が `SyntaxError: Invalid or unexpected token` を投げてテスト全滅する。retry は `retryCall`、error 発火 wrap は `emitError` / `emitErrorAndRetry` の HOF で書く。実例: `packages/@nitpicker/crawler/src/archive/database.ts`（旧 `@ErrorEmitter()` + `@retry(retrySetting)` の 68 site を HOF 化）、`packages/@nitpicker/crawler/src/utils/error/emit-error.ts`

## AI 操作プロトコル

- **修正前にスキャン**: コード変更を行う前に、対象パッケージの構造・依存関係・exports を確認してから修正を開始する
- **exports を壊さない**: package.json の `exports` フィールドを変更する場合は差分のみ追記し、既存のエクスポートパスを削除しない
- **アーキテクチャガード**: 変更後にディレクトリ・構造ルール（1ファイル1エクスポート、index.ts 禁止、型の集約）に違反していないかセルフチェックする
