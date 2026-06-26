# Viewer DB Implementation Plan

## Goal

40万コンテンツ級 archive で viewer API を100ms級に近づけるため、まず既存DBの上に viewer read model を追加し、実測で効果を確認する。その後、保存用write modelの参照化へ進む。

## Implementation Order

### Phase 1: Read Model Infrastructure

最初に `@nitpicker/query` に viewer read model の生成・検出・読み取り基盤を作る。

追加する責務:

```text
ensureViewerReadModel(accessor)
hasViewerReadModel(accessor)
buildViewerReadModel(accessor)
dropViewerReadModel(accessor)
getViewerReadModelVersion(accessor)
```

置き場所:

```text
packages/@nitpicker/query/src/viewer-read-model/
```

最初に作るテーブル:

```text
viewer_read_model_meta
viewer_query_profiles
viewer_count_buckets
viewer_pages
viewer_page_anchors
```

この段階では既存の `pages` テーブルから `viewer_pages` を作る。既存write modelは変更しない。

完了条件:

```text
1. 小さいfixtureでread modelを作れる
2. 既存DBを壊さず再生成できる
3. build済みかどうか判定できる
4. schema version不一致時に再buildできる
5. viewer起動時にread modelを利用できる
```

### Phase 2: `/api/pages` Cursor Read

次に `/api/pages` をread model経由へ切り替える。ここが一覧APIの基本形になる。

実装内容:

```text
listViewerPages(accessor, options)
cursor encode/decode
initial queryとcursor queryを分離
totalはviewer_query_profilesから返す
URL/text JOINはlimit後
```

viewer route:

```text
packages/@nitpicker/viewer/src/routes/register-pages-route.ts
```

query package:

```text
packages/@nitpicker/query/src/list-viewer-pages.ts
```

完了条件:

```text
1. 既存 `/api/pages` のレスポンス互換を保つ
2. offset pagination依存をcursorへ置き換えられる
3. 40万DBで default list / common filters が100ms目標に近づく
4. virtual scroll が連続cursorロードできる
```

### Phase 3: Directory Tree

新機能としてディレクトリツリーを実装する。これはread modelの価値を確認しやすく、既存APIとの競合が少ない。

追加テーブル:

```text
viewer_directory_nodes
viewer_directory_pages
```

追加query:

```text
getDirectoryTree(accessor, { rootKey, depth })
listDirectoryChildren(accessor, { nodeId })
listDirectoryPages(accessor, { nodeId, cursor, limit })
```

追加viewer routes:

```text
GET /api/directory-tree
GET /api/directory-tree/children
GET /api/directory-tree/pages
```

完了条件:

```text
1. 初期3depthをSELECT一発で返す
2. 未展開ノードのchildrenをSELECT一発で返す
3. child_count / descendant_page_count が事前計算済み
4. 直下ページ一覧はcursor paginationで返す
```

### Phase 4: Heavy Existing Endpoints

read model builderの形が固まったら、遅い既存endpointを順番に置き換える。

優先順:

```text
1. /api/summary
2. /api/error-kinds
3. /api/page-links
4. /api/resources / /api/resources/referrers / /api/unused-resources
5. /api/images
6. /api/links?type=broken / /api/links?type=external
7. /api/headers
8. /api/duplicates / /api/mismatches
9. /api/isolated-* / /api/graph
10. /api/violations
```

判断基準:

```text
1. 現在1000ms以上のendpoint
2. GROUP BY / COUNT / correlated subquery をGET時に持つendpoint
3. viewer UIで頻繁に呼ばれるendpoint
4. read model化でSQLが単純SELECTになるendpoint
```

### Phase 5: Build Timing

read model buildをどのタイミングで走らせるかを実装する。

read modelは2種類に分ける。

```text
1. Persistent read model
   - .nitpicker 本体の db.sqlite に保存する
   - crawl完了時、または明示CLIで作る
   - 配布・再open後も残る

2. Viewer cache read model
   - viewer の展開/cache領域に作る
   - 元の .nitpicker は変更しない
   - 既存archiveに対する検証・段階導入に使う
```

現行viewer open経路は通常read-onlyである。stub modeはユーザーの一時ディレクトリを絶対に変更しない。したがって、viewer起動時にread modelを作る場合でも、stubの `db.sqlite` や元の `.nitpicker` 本体へ直接書かない。

候補:

```text
1. crawl完了時にPersistent read modelをbuild
2. 明示CLI `nitpicker viewer-build <archive>` でPersistent read modelをbuild
3. viewer起動時に未生成ならViewer cache read modelをbuild
```

初期実装は viewer起動時のViewer cache read modelでよい。既存archiveに対して検証しやすく、migration scriptなしで試せる。ただし本採用では crawl完了時にPersistent read modelを作る。

40万DBではbuildに数分から10分程度かかってよい。build中は進捗をstderrへ出す。

推奨する最終形:

```text
crawl完了:
  write modelを保存
  viewer read modelをbuild
  db.sqliteごと .nitpicker にtar

viewer起動:
  read model versionを確認
  有効ならそのまま読む
  無効/未生成ならcache read modelを作るか、ユーザーにbuildを促す

stub viewer:
  live/interrupted crawlのtmpDirは変更しない
  必要なら別sidecar cacheにread modelを作る
```

### Phase 6: Write Model Refactor

viewer read modelが実測で固まってから、保存用write modelを参照化する。

対象:

```text
url_refs
text_refs
json_refs
blob_refs
header_sets
content_items
resource_items
anchor_edges
image_items
```

この段階で既存DBから新write modelへ復元可能なmigrationを作る。

## First Pull Request Scope

最初のPRは小さく切る。

含めるもの:

```text
viewer_read_model_meta
viewer_pages
viewer_query_profiles
viewer_count_buckets
viewer_page_anchors
buildViewerReadModel()
listViewerPages()
/api/pages のread model利用
unit tests
```

含める検証:

```text
yarn test
yarn build
40万DBで /api/pages の cold/warm 実測
EXPLAIN QUERY PLAN の確認
```

## Second Pull Request Scope

ディレクトリツリーを追加する。

含めるもの:

```text
viewer_directory_nodes
viewer_directory_pages
directory tree builder
GET /api/directory-tree
GET /api/directory-tree/children
GET /api/directory-tree/pages
frontend route
unit tests
viewer e2e smoke
```

## Benchmark Contract

各endpoint置き換え時に、次を記録する。

```text
archive size
row counts
read model build time
read model added bytes
endpoint cold time
endpoint warm p50
endpoint warm p95
EXPLAIN QUERY PLAN
```

100ms目標の評価は warm p95 を重視する。coldはSQLite page cacheやtar extractionの影響を分けて見る。

## Recommended Starting Point

最初に着手するファイル:

```text
packages/@nitpicker/query/src/viewer-read-model/types.ts
packages/@nitpicker/query/src/viewer-read-model/ensure-viewer-read-model.ts
packages/@nitpicker/query/src/viewer-read-model/build-viewer-read-model.ts
packages/@nitpicker/query/src/list-viewer-pages.ts
packages/@nitpicker/viewer/src/routes/register-pages-route.ts
```

最初の実装は `/api/pages` だけを縦に通す。これでread model build、cursor pagination、query profile、viewer route、frontend virtual scrollの接続点を一度に検証できる。
