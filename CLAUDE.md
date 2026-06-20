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
npx @nitpicker/cli -v | --version                       # `@nitpicker/cli` のバージョンを出力して exit 0
```

> **Multi-root クロール**: 位置引数で複数 URL を渡すと、それぞれが「再帰クロールの起点」かつ「scope エントリ」として扱われ、1 つの `.nitpicker` に集約される。例: `crawl https://www.example.com/blog/ https://www.example.com/news/` → 両配下が internal として記録される。`(hostname, port, path)` トリプルで scope 一致を判定するため、`localhost:3000` と `localhost:8080` は別 scope として分離される（auth が混入しない）。

> **`--append <URL>`**: 位置引数で指定された既存 `.nitpicker` を開き、`--append` の URL を新しい起点として追加クロールする（`--append` は繰り返し指定で複数 URL 可）。新スコープに該当する旧 external ページは internal として再スクレイプされる。失敗時は `<archive>.bak` から自動復元、成功時は `.bak` 削除。`--resume` / `--diff` / `--output` / `--list` / `--list-file` / `--single` との同時指定は不可。

> **`--inventory <urls.txt>`**: 位置引数で指定された既存 `.nitpicker` を開き、URL リストファイル中の **アーカイブにまだ無い URL だけ** を取り込む。**HEAD pre-flight は orchestrator 段では行わない** — `isLikelyHtmlUrl(url)` の拡張子ヒューリスティクスで HTML / 非 HTML を同期分類する（サーバの doc-root `ls` 由来のリストでは拡張子が真の content-type を反映するという前提）。HTML 判定された URL は **Crawler の通常 dealer 経路（HEAD + puppeteer render + 再帰クロール）** に流し、非 HTML 判定された URL は `setResources` で `status` / `contentType` / `contentLength` 全て null の薄い行として直接登録する（後の `query unused-resources` で referrer 0 件として浮上させる目的）。新規 page/resource の `source` 列は `'inventory-seed'`（リストに明示記載された URL）または `'inventory-discovered'`（inventory-seed page の render 中に anchor / subresource として発見された URL）でラベリングされる。**source 優先度は `'crawled' > 'inventory-seed' > 'inventory-discovered'`**（`#insertPage` の CASE WHEN UPDATE と `#getIdByUrl` の SELECT 経路 downgrade で実装）— inventory は「離れ小島の発見」が目的なので、crawled chain 経由で到達可能なら inventory 由来でなく crawled 扱いとなり、既存 `'inventory-*'` 行も crawled anchor から到達された瞬間に `'crawled'` に降格する。スコープ外 URL は警告 skip。失敗時は `<archive>.bak` から自動復元、成功時 `.bak` 削除。`query isolated-pages` / `query unused-resources` の入力データを増やすのが主用途。**pending guard demote**: 開いたアーカイブに pending URL（後述の strict 定義）が残っていても hard reject せず `console.warn` で続行する — strict 定義は in-scope + anchor 参照あり + scraped=0 に絞っているので、ここに来る pending は本物の中断中作業の証拠。crawled-wins UPDATE が label 整合性を保つので進行可。なお `Database.getCrawlingState` の pending は `scraped=0 AND isExternal=0 AND EXISTS(anchors.hrefId=pages.id)` で計算する（predicted-discard leak / external anomaly などの placeholder ゴミを reader 段で除外）。`--append` / `--retry-failed` / `--resume` / `--diff` / `--output` / `--list` / `--list-file` / `--single` との同時指定は不可。
>
> **`--retry-failed`**: 位置引数で指定された既存 `.nitpicker` を開き、前回クロールで失敗したページだけを pending に戻して再取得する。失敗の定義は `status = -1`（ハード失敗 sentinel）/ `status IS NULL` / `contentType IS NULL` / `status` が 5xx（4xx は確定応答なので対象外）。internal/external 両方が対象で、external は scope 判定により metadata-only として再取得される。実装は append と同じ「再オープン+`.bak`+`Crawler.resume()`+`crawling()`」フローだが、新起点を足す代わりに `Archive.resetFailedPages()`（→ `Database.resetFailedPages`）で失敗ページを `scraped=0` に戻し、archived roots を seed にして失敗ページを resumedPending 経由で処理する（external 失敗ページを scope へ誤登録しないため）。**recursive はフラグ値（デフォルト true）が優先され、アーカイブ作成時の recursive 設定は継承しない**（`crawling(list, { recursive })` で明示注入）。それ以外の設定（scope/excludes/userAgent 等）は archived 設定を流用し、明示指定したフラグのみ上書き。`--resume` / `--append` / `--diff` / `--output` / `--list` / `--list-file` / `--single` との同時指定は不可。
>
> **Note**: 全ページが失敗していた（reset 後に `scraped=1` が 0 件になる）アーカイブでも取りこぼさないよう、`Crawler.start()` の resume 判定は `#resumedScraped` だけでなく `#resumedPending` も見る。`#resumedScraped` のみを見ると「全ページ失敗 retry」や「1ページもスクレイプせず中断した resume」を fresh crawl と誤判定し、pending を全部捨ててしまう。

> **Stub mode viewer**: `viewer` は `.nitpicker` ファイルだけでなく、`crawl` を強制停止した時に残る `._nitpicker-*` ディレクトリ（"stub"）も直接受け付ける。`crawl --resume` と同じ mental model で同じパスを渡せる。stub オープンは `Archive.connect(tmpDir)` 経由の **read-only** 接続で、`Database.connect({readOnly: true})` により `initSchema` / `migrateInfoRoots` は **走らない**（user の tmpDir を絶対に書き換えない）。HTML スナップショットは SQLite BLOB なので `getHtmlOfPage` は単純 SELECT で済み、read-only 接続でもそのまま動く（旧 zip 展開ロジックは廃止）。close 時には `db.destroy()` だけが呼ばれ、tar 化も tmpDir 削除も発生しないため、その後の `crawl --resume` が安全に走る。viewer footer は `/api/info.crawlerPid` に応じて "Live crawl in progress (PID xxx)" / "Interrupted crawl stub" のバッジを出し分ける（`peekArchiveLockHolder` で `<tmpDir>.lock/pid.txt` を probe）。`Archive.releaseHandle()` は writer の DB ハンドルと lock を解放するが tmpDir は残す書き戻し無しの exit hatch — fixture スクリプトと一部テストが使う。

> **HTML スナップショット格納の WHY（#75）**: SQLite BLOB に切り替えた目的は (1) `--append` 時の zip 再圧縮コストを消して 100 万ページ規模を現実化する、(2) `hash PK` の content-addressable shape を #23（git ライク世代管理）の cross-generation dedup に直接乗せるための先取り、(3) tar の中身が `db.sqlite` 1 ファイルだけになり tar 化の per-file syscall も激減する。実装詳細・テーブル定義・codec の運用・migration の二段構え（runtime テーブル自動作成 + データ移行スクリプト）は `init-schema.ts` / `migrate-html-blob-tables.ts` / `database.ts` の JSDoc を正とする。v0.10 で archive フォーマットが clean-break で更新された。pre-0.10 archive を新 CLI で開くと `assertCompatibleVersion` が拒否するので、`node scripts/migrate-to-0.10.mjs <path>` を 1 回走らせる (Step A: HTML→BLOB / Step B: meta schema upgrade を状態検知で必要分だけ実行 + Step C: 保存済み BLOB を jsdom + beholder 3.1.0 の `extractMetaFromDocument` で再パースして 0.10 列 / `meta_extras` / `page_tags` / `page_jsonld` を crawl 時と同等に充填 + `info.version` を `0.10.0` に bump、npm パッケージに含まれないので `git clone` + `yarn build` 経由)。

> **Stub mode の HTML 読み出し caveat**: pre-#75 の `._nitpicker-*` stub を新 CLI の stub viewer に渡すと、read-only 経路では `migrateHtmlBlobTables` が走らず `page_html_*` テーブル不在で `getHtmlOfPageById` が落ちる。古い stub は捨ててから使うこと。

> **0.10 format (beholder 3.0.0)**: pages テーブルは beholder 3.0.0 の nested Meta を ~47 flat 列に展開、`canonical` / `og_url` / `og_image` などの URL 列は `<base href>` + ページ URL を基準に絶対化済み（find_mismatches の `canonical != url` 比較が正しく動く）。`page_tags`（Wappalyzer 検出）と `page_jsonld`（JSON-LD / SpeculationRules）は独立テーブル、`tag_count` / `jsonld_count` / `tags_providers_csv` は denormalised 集計を pages に持つ（Sheets / page-detail での GROUP BY 不要）。pre-0.10 archive は `assertCompatibleVersion` が `info.version < 0.10.0` を見て `IncompatibleArchiveError` で拒否する（clean-break、移行は `scripts/migrate-to-0.10.mjs`）。詳細は ARCHITECTURE.md の「pages テーブル (0.10)」を正とする。

> **Note**: `-v` / `--version` は `argv[0]` の位置でのみ判定する。`crawl -v` のようにサブコマンドの後ろに置いた場合はそのコマンドのフラグとして解釈される（`@d-zero/roar` の仕様）。

> **エラー原因分類（`query error-kinds` / viewer Errors ビュー）**: kind 集合の正は `@nitpicker/crawler` の `ErrorKind` union（`packages/@nitpicker/crawler/src/types.ts`）。**kind は保存せず読み取り時に `classifyErrorKind(message)`（`@nitpicker/crawler` 経由）で導出**するため、この機能より前のアーカイブもそのまま分類できる（分類ロジックが 1 箇所に集約され、capture 時と read 時で必ず一致する）。`PERMANENT_ERROR_KINDS`（`permanent-error-kinds.ts`）と `PUPPETEER_FALLBACK_KINDS`（`is-puppeteer-fallback-candidate.ts` 内部）は **kind union から派生する派生定数** — kind を増やしたら両方の見直しが要る（前者は `--retry-failed` の収束契約、後者は HEAD/GET 失敗時に puppeteer リトライをかける kind の判定）。失敗は 2 系統: スクレイプ経路は `page_errors`、crawler レベルの `error` チャネル（DNS/接続/TLS）は構造化テーブル **`crawl_errors`**（`Archive.addError` が `error.log` と両方へ記録、`migrateCrawlErrors` で既存アーカイブに**テーブルだけ**後付け、back-fill はしない）。`getErrorKinds` は `crawl_errors` に行があればそれを、無ければ（テーブル不在 **または空**）`error.log` をパースしてフォールバックする（空フォールバックが無いと、migration で空テーブルだけ作られた legacy アーカイブのエラーが読まれず消える）。`crawl_errors` は read-only 接続では `migrateCrawlErrors` が走らないため作られない（stub viewer は error.log フォールバックで分類）。

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

## AI 操作プロトコル

- **修正前にスキャン**: コード変更を行う前に、対象パッケージの構造・依存関係・exports を確認してから修正を開始する
- **exports を壊さない**: package.json の `exports` フィールドを変更する場合は差分のみ追記し、既存のエクスポートパスを削除しない
- **アーキテクチャガード**: 変更後にディレクトリ・構造ルール（1ファイル1エクスポート、index.ts 禁止、型の集約）に違反していないかセルフチェックする
