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
npx @nitpicker/cli analyze <file> [options]             # .nitpicker ファイルに対して analyze プラグインを実行
npx @nitpicker/cli report <file> [options]              # .nitpicker ファイルから Google Sheets レポートを生成
npx @nitpicker/cli pipeline <URL> [options]             # crawl → analyze → report を直列実行
npx @nitpicker/cli query <file> <sub-command> [options] # .nitpicker ファイルに対してクエリを実行し JSON 出力
npx @nitpicker/cli viewer <file-or-stub-dir> [options]  # ローカルブラウザビューアを起動（.nitpicker ファイル / stub tmpDir の両方を受け付ける、Ctrl-C で停止）
npx @nitpicker/cli -v | --version                       # `@nitpicker/cli` のバージョンを出力して exit 0
```

> **Multi-root クロール**: 位置引数で複数 URL を渡すと、それぞれが「再帰クロールの起点」かつ「scope エントリ」として扱われ、1 つの `.nitpicker` に集約される。例: `crawl https://www.example.com/blog/ https://www.example.com/news/` → 両配下が internal として記録される。`(hostname, port, path)` トリプルで scope 一致を判定するため、`localhost:3000` と `localhost:8080` は別 scope として分離される（auth が混入しない）。

> **`--append <URL>`**: 位置引数で指定された既存 `.nitpicker` を開き、`--append` の URL を新しい起点として追加クロールする（`--append` は繰り返し指定で複数 URL 可）。新スコープに該当する旧 external ページは internal として再スクレイプされる。失敗時は `<archive>.bak` から自動復元、成功時は `.bak` 削除。`--resume` / `--diff` / `--output` / `--list` / `--list-file` / `--single` との同時指定は不可。

> **Stub mode viewer**: `viewer` は `.nitpicker` ファイルだけでなく、`crawl` を強制停止した時に残る `._nitpicker-*` ディレクトリ（"stub"）も直接受け付ける。`crawl --resume` と同じ mental model で同じパスを渡せる。stub オープンは `Archive.connect(tmpDir)` 経由の **read-only** 接続で、`Database.connect({readOnly: true})` により `initSchema` / `migrateInfoRoots` は **走らない**（user の tmpDir を絶対に書き換えない）。`getHtmlOfPage` も読み取り専用なら zip を tmpDir 内に展開しない（single-entry 抽出）。close 時には `db.destroy()` だけが呼ばれ、tar 化も tmpDir 削除も発生しないため、その後の `crawl --resume` が安全に走る。viewer footer は `/api/info.crawlerPid` に応じて "Live crawl in progress (PID xxx)" / "Interrupted crawl stub" のバッジを出し分ける（`peekArchiveLockHolder` で `<tmpDir>.lock/pid.txt` を probe）。`Archive.releaseHandle()` は writer の DB ハンドルと lock を解放するが tmpDir は残す書き戻し無しの exit hatch — fixture スクリプトと一部テストが使う。

> **Note**: `-v` / `--version` は `argv[0]` の位置でのみ判定する。`crawl -v` のようにサブコマンドの後ろに置いた場合はそのコマンドのフラグとして解釈される（`@d-zero/roar` の仕様）。

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
