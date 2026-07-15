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
           │    │  analyze-* プラグイン │
           │    └── query              │
           │         ↑                 │
           │    mcp-server ← @modelcontextprotocol/sdk
           │    viewer ← @hono/node-server + react + @tanstack/*（外部）
           └── @d-zero/dealer（外部）──┘
```

| パッケージ                        | 責務                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `@nitpicker/crawler`              | クロールオーケストレーション + `.nitpicker` アーカイブ（SQLite）+ スコープ判定 + エラー分類  |
| `@nitpicker/core`                 | analyze プラグインシステム（プラグインごとの長寿命 `WorkerPool`）                            |
| `@nitpicker/query`                | アーカイブへの読み取り専用 SQL API（listPages / getSummary / listLinks 等）                  |
| `@nitpicker/cli`                  | 統合 CLI（crawl / analyze / report / pipeline / query / viewer）                             |
| `@nitpicker/viewer`               | Hono API + React SPA のローカルビューア（backend `src/` + frontend `web/` の単一パッケージ） |
| `@nitpicker/mcp-server`           | query の MCP 露出（stdio、`nitpicker-mcp`）                                                  |
| `@nitpicker/analyze-*`            | axe / lighthouse / markuplint / textlint / main-contents / search の各監査                   |
| `@nitpicker/report-google-sheets` | Google Sheets レポート出力（5 フェーズの `createSheets`）                                    |
| `@nitpicker/types`                | 監査型定義（Report / ConfigJSON）                                                            |
| `packages/test-server`            | E2E 用 Hono サーバー（port 8010、プロダクション非依存）                                      |

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

`.nitpicker` = tar（中身は `db.sqlite` 1 ファイル）。定義の正は `crawler/src/archive/init-schema.ts`。

- **pages**: 基本属性（id / url / redirectDestId / scraped / isTarget / isExternal / status / contentType / source）+ beholder Meta の ~47 flat 列 + `meta_extras` JSON + denormalised 集計（tag_count / jsonld_count / tags_providers_csv）
- **anchors / images / resources / resources-referrers**: リンク・画像・サブリソースとその参照関係
- **page_tags**（Wappalyzer 検出）/ **page_jsonld**（JSON-LD / SpeculationRules）: 1 行 1 検出
- **page_html_blobs / page_html_ref**: HTML スナップショット。SHA-256 hash PK の content-addressable BLOB（WHY は `init-schema.ts` JSDoc）
- **info**: 設定（単一行）。起点とスコープは `roots` 1 本で表現（`baseUrl` = `roots[0]`）
- **page_errors / crawl_errors**: 失敗の 2 系統（スクレイプ経路 / crawler レベル）。kind は保存せず読み取り時に `classifyErrorKind` で導出
- **inventory_runs**: `--inventory` の監査ログ。append-only・UNIQUE 制約なし（同一 sha256 の再適用は 2 行になる。dedupe 判定用に `source_file_sha256` 列だけ確保してある）。`source_file_path` は privacy のため永続化しない
- **リダイレクト**: 独立テーブルなし。`pages.redirectDestId` を常に最終宛先まで pre-flatten し、読み取りは `COALESCE(target.redirectDestId, target.id)` の 1 ホップ（`database.ts` JSDoc）
- **0.13 entity / ref テーブル（reader の読み先）**: reader は entity テーブル（`content_items` / `page_meta` / `resource_items` / `anchor_edges` / `resource_ref_edges` / `image_items`）+ ref テーブル（`url_refs` / `text_refs` / `content_type_refs` / `json_refs` / `blob_refs` / `header_flags`）から読む。**writer は #196 で切り替わるまで legacy テーブル（pages / anchors / …）を更新する一時ズレ**があり、spec は `crawler/src/archive/populate-migration-tables.ts` で吸収する（同 JSDoc が正）
- **viewer read model（`viewer_*` テーブル群）**: `buildViewerReadModel`（`query/src/viewer-read-model/build-viewer-read-model.ts`）が構築する読み取り専用の事前計算層。pages / summary / error-kinds / resources / images / header-checks / duplicates / mismatches / anchor-facts / directory-tree をカバーし、各機能は `get-*-fast-path.ts` で read model（fast path）と legacy SQL の二層 dispatch を行う
- **互換性**: clean-break 方針。`assert-compatible-version.ts` が `info.version >= REQUIRED_FORMAT_VERSION`（現在 0.13.0）を要求し、古い archive は `IncompatibleArchiveError` で拒否。pre-0.13 は `scripts/migrate-to-0.10.mjs` → `scripts/migrate-to-0.13.mjs` の 2 段移行（エラーメッセージが実行順を案内）。v0.x のため breaking 容認
- **read-only 経路**: viewer / MCP / query CLI は `Archive.openCached`（OS-temp タールキャッシュ）または stub ディレクトリ直結（`Archive.connect`）。migration は writer 接続でのみ走る

## 不変条件・負の知識

やってはいけないこと、および理由がコードから読めない制約。各項目の詳細な正は右のファイルの JSDoc。

- **`.nitpicker` アーカイブに `ANALYZE` / `PRAGMA optimize` を絶対に走らせない** — 統計が出ると planner が `idx_pages_listfilter` を JOIN 経路に流用し、`listLinks` / `getLinkGraph` が 15s → 500s（33x）に回帰する（`init-schema.ts`）
- **perf index の一括追加をしない** — index を無計画に足すと ANALYZE 無しの planner heuristics が崩れて別 query が 30-50x 回帰した実績が複数ある。追加時は必ず対象 query と非対象 query の両方を実測すること（`init-schema.ts`）
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
- **`REQUIRED_FORMAT_VERSION` は pkg.version と別値** — crawler が `info.version` に書くのはフォーマット cut であって npm リリース番号ではない。format-breaking な変更はリリース前でも先行 bump し、format cut の無いリリースでは据え置く（`crawler/src/archive/meta/assert-compatible-version.ts`）
- **anchors / images は再スクレイプ時に置き換え、UNIQUE 制約を張らない** — 同一 tuple が 1 ページ内に正当に複数存在しうる（header と footer の同一リンク等）ため行単位 dedup は不可能（`database.ts` の `updatePage`）
- **viewer は `process.exit` の例外** — 他コマンドはバッチ型で `cli.ts` 末尾の `process.exit` に到達するが、viewer は SIGINT/SIGTERM まで resolve しない常駐サーバ。シャットダウンは必ず `ArchiveManager.closeAll()` を通す
- **`Promise.race` の負け側 timer は必ず `clearTimeout`** — 放置すると event loop を握って CLI の自然終了をブロックする。`delay()` は signal を取らないので race に使わない（実例: `fetch-destination.ts`、`close-browser-safely.ts`）
- **decorator を使わない（legacy / Stage 3 とも）** — Vite 8 内蔵の oxc が transform せず素通しし、Vitest 4.1 でテストが全滅する。retry は `retryCall`、error 発火は `emitError` / `emitErrorAndRetry` の HOF で書く
- **Playwright E2E（`viewer/e2e/`）をルート `vitest.config.ts` の `exclude` から外さない** — Vitest 非互換で `yarn test` が落ちる
- **`--retry-failed` の収束は `PERMANENT_ERROR_KINDS` 除外が担保** — 永続失敗（NXDOMAIN / 期限切れ証明書等）を reset 対象から外さないとリトライ対象が減らない（`crawler/src/permanent-error-kinds.ts`、`database.ts` の `resetFailedPages`）
- **DNS burn は session-success guard 付きでのみ行う** — resolver flip 事故でセッション全体が degenerate completion に陥るのを防ぐ（`crawler/src/crawler/should-burn-host.ts`）
- **inventory の source 優先度は `crawled > inventory-seed > inventory-discovered`** — crawled 経由で到達可能なページは inventory 由来と見なさない。ingestion（pre-insert + audit 行 + `.bak` 削除）は 1 セットの原子的操作で、失敗時は `.bak` 復元で全て巻き戻る（`database.ts`、`crawler-orchestrator.ts` の `ingestionComplete`）
- **Archive への書き込みは `WriteQueue` で直列化** — 複数イベントハンドラからの SQLite 書き込みロック競合を防ぐ。`crawlEnd` で `drain()` 必須（`crawler/src/write-queue.ts`）
- **タールキャッシュは誰も evict しない** — read-only open の展開先 `<os.tmpdir>/nitpicker/cache/` の寿命は OS の temp cleanup に委ねる設計。手動削除は `rm -rf` で安全（`archive.ts` の `openCached`）
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

1. `crawler/src/archive/init-schema.ts`（テーブル定義 + perf index。ANALYZE 禁止の不変条件を先に読む）
2. `crawler/src/archive/database.ts`（INSERT/SELECT 経路）と `migrate-*.ts`（既存アーカイブ後付け。read-only では走らない）
3. `crawler/src/archive/meta/assert-compatible-version.ts`（互換ガード）と `meta/derive-flat-from-meta.ts`（Meta 展開列）
4. 読み取り影響: `query/src/`（`get-summary.ts` / `list-pages.ts` / `content-type-rules.ts`）
5. 既存アーカイブ適用スクリプト: リポジトリルート `scripts/`

### Content-Type カテゴリ追加（3 箇所は CI が強制・2 箇所は手動）

`query/src/types.ts`（union）→ `query/src/content-type-rules.ts`（順序 = 優先度）→ `viewer/web/i18n/translations.ts` → `viewer/web/styles.css`（`.bar-segment-<cat>`）→ `cli/src/commands/query.ts` の desc + `mcp-server/src/tool-definitions.ts` の enum。前 3 者は spec（rules / css 網羅 / i18n 網羅）が CI で落とす。後 2 者は手動レビュー。

## テストと CLI 契約

- ユニット: `yarn test`（Vitest 4、1関数1ファイルにユニットテスト必須）
- E2E: `yarn vitest run --config vitest.e2e.config.ts`（maxWorkers: 1、test-server は port 8010、**外部リンクは `127.0.0.1` でシミュレート**（`localhost` と別ホスト名扱い））
- viewer E2E: `yarn workspace @nitpicker/viewer test:e2e`（Playwright、fixture 生成 → 実 CLI 起動 → ブラウザ検証）
- CLI 終了コード: `0` = 成功 / `1` = 致命的（スコープ内エラー含む）/ `2` = 警告（外部リンクエラーのみ。`--strict` で 1 に昇格）
