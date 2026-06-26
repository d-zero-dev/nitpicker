# Viewer SQL Query Plan

<!-- cspell:ignore Ijoi indegree vicp -->

## Goal

40万コンテンツ級 archive でも、viewer の1リクエストを原則100ms以下に収める。

優先順位:

```text
1. SQLで解決する
2. viewer read modelを最大限使う
3. JOINはlimit後に行う
4. COUNTは事前集計または軽いindexだけで返す
5. untar時JSON生成やprocess cacheは最後の補助策
```

この計画は `docs/viewer-db-redesign-plan.md` の新DBスキーマを前提にする。

## Query Principles

### Golden Rules

- 生の `anchors`, `images`, `resources-referrers` 相当の巨大テーブルをviewer GETで走査しない。
- GET時に `GROUP BY`, connected component, duplicate group, redirect解決をしない。
- URLやtextのJOINは、必ず対象IDを `limit` で確定してから行う。連続ロードはkeyset cursor、任意ページジャンプはpage anchorを使う。
- `COUNT(*)` は毎回巨大範囲を数えない。通常の一覧totalは `viewer_query_profiles.total`、facet/補助集計は `viewer_count_buckets`、個別statsは専用statsから返す。
- default sortはread modelのindex順に合わせる。
- 任意sortを増やす場合は、対応indexも同時に持つ。
- `LIKE '%foo%'` を100ms対象にしない。必要なら別途FTS/検索indexを設計する。
- SQLite `ANALYZE` / `PRAGMA optimize` は既存知見により禁止を継続する。新スキーマでも実測で安全確認するまで使わない。

### Query Shape

大規模一覧は必ず2段階にする。

```sql
with ids as (
  select primary_id
  from viewer_table
  where ...
  order by ...
  limit :limit
)
select ...
from ids
join viewer_table v on v.primary_id = ids.primary_id
join small_or_ref_tables ...
order by ...
```

狙い:

- sort/filterはcovering indexで処理する。
- URL/text/headerなどのref JOINは100件程度に限定する。
- wide rowをsortしない。

## Pagination / Filter / Sort Contract

ページネーション、フィルター、ソートはviewerの当然のニーズとして扱う。100ms目標の対象に含める。

ただし、無制限な任意SQL条件を高速保証するのではなく、viewer UIが提供するフィルター・ソートを `query profile` として定義し、profileごとにindex/count/page anchorを用意する。

### Pagination Modes

viewerは2種類のpaginationをサポートする。バーチャルスクロールの連続ロードは必ずkeyset paginationを使う。page number paginationは「URLでpageを復元する」「一覧の特定ページへジャンプする」ための補助経路として使う。

```text
1. keyset pagination
   - next/previous
   - 最速
   - cursor = sort_key + stable_id
   - virtual scrollの主経路
   - DBはOFFSETで捨て読みしない

2. page number pagination
   - page=123 のようなジャンプ
   - 大きなページジャンプを許可する
   - viewer_page_anchors で近傍anchorまでseekしてから、残りの局所行だけ読む
```

`OFFSET :large_number` を巨大indexの先頭から毎回読む形にはしない。

### Virtual Scroll Load Path

バーチャルスクロールは「下へ進む」「上へ戻る」「同じ条件で再読込する」が高頻度に起こるため、page番号ではなくopaque cursorを主APIにする。

```http
GET /api/pages?profile=pages:is_external=0:category=html:sort=url:asc&limit=100
GET /api/pages?profile=...&limit=100&cursor=eyJrIjoiLi4uIn0
```

cursorには次を含める。

```text
profile_key
sort_key
sort_order
direction
last_sort_text_key / last_sort_number_key
last_id
```

cursorはimmutableにする。同じcursorを何度読んでも同じページを返せるため、フロントエンドの重複リクエスト、キャンセル、リトライに強い。

初回ロードとcursorロードはSQLを分ける。`(:cursor is null OR ...)` のようなnullable条件はindex利用を鈍らせる可能性があるため使わない。

下方向:

```sql
select page_id
from viewer_pages
where ...profile filters...
  and (url_sort_key, page_id) > (:last_sort_key, :last_id)
order by url_sort_key, page_id
limit :limit;
```

上方向:

```sql
with ids as (
  select page_id, url_sort_key
  from viewer_pages
  where ...profile filters...
    and (url_sort_key, page_id) < (:first_sort_key, :first_id)
  order by url_sort_key desc, page_id desc
  limit :limit
)
select ...
from ids
join viewer_pages v on v.page_id = ids.page_id
order by ids.url_sort_key asc, ids.page_id asc;
```

この経路では `OFFSET` を使わない。40万件でも、B-tree上のcursor位置から `limit` 件だけ読む。

### Stable Ordering

すべての一覧sortはstable tie-breakerを持つ。

```text
url asc:       url_sort_key asc, id asc
url desc:      url_sort_key desc, id desc
status asc:    status asc, url_sort_key asc, id asc
status desc:   status desc, url_sort_key asc, id asc
title asc:     title_sort_key asc, url_sort_key asc, id asc
count desc:    count desc, url_sort_key asc, id asc
```

`id` は対象テーブルの安定ID。`url_sort_key` / `title_sort_key` はread model build時に作る。

降順sortはcursor比較を単純化するため、read modelに昇順化したsort keyを持つ。

```text
count desc -> count_desc_key = -count
size desc  -> size_desc_key = -size
status desc -> status_desc_key = -status
```

cursor SQLは常に `(sort_key..., id) > (:cursor_sort_key..., :cursor_id)` の昇順タプル比較に統一する。混合方向の `order by count desc, id asc` に対して `(count, id) < (...)` のような条件を書かない。

### Query Profiles

各endpointは高速保証するfilter/sortの組をprofileとして持つ。

```sql
viewer_query_profiles (
  scope text not null,
  profile_key text not null,
  sort_key text not null,
  sort_order text not null,
  total integer not null,
  primary key(scope, profile_key)
) without rowid;
```

`profile_key` はfilter条件を正規化した文字列。例:

```text
pages:is_external=0:category=html:sort=url:asc
pages:is_external=0:category=html:missing_title=1:sort=url:asc
images:missing_alt=1:sort=page_url:asc
links:type=broken:sort=source_url:asc
resources:is_external=0:category=image:sort=url:asc
```

`total` はこのprofileの件数。通常の一覧totalは `viewer_query_profiles.total` から返す。

### Page Anchors

page number paginationを100msに近づけるため、build時にprofileごとのpage anchorを作る。これは大きなページジャンプを可能にするための仕組みであり、ジャンプを禁止するものではない。

```sql
viewer_page_anchors (
  scope text not null,
  profile_key text not null,
  page_size integer not null,
  page_index integer not null,
  anchor_text_key text,
  anchor_number_key integer,
  anchor_id integer not null,
  row_offset integer not null,
  primary key(scope, profile_key, page_size, page_index)
) without rowid;
```

使い方:

```text
requested page = 123
page_size = 100
anchor interval = 10 pages

nearest anchor = page 120
anchor row_offset = 12000
local rows to skip = 300
```

「小さなoffset」とは、この `local rows to skip` のこと。巨大indexの先頭から12,300行を捨てるのではなく、page 120のanchor keyへB-tree seekしてから300行だけ進める。たとえばanchor intervalを10 pages、page_sizeを100に固定すれば、任意ページジャンプ時でも局所skipは最大999行程度に抑えられる。

```sql
with anchor as (
  select anchor_text_key, anchor_id
  from viewer_page_anchors
  where scope = :scope
    and profile_key = :profile_key
    and page_size = :page_size
    and page_index = :anchor_page
),
ids as (
  select page_id
  from viewer_pages, anchor
  where (url_sort_key, page_id) >= (anchor.anchor_text_key, anchor.anchor_id)
    and ...profile filters...
  order by url_sort_key, page_id
  limit :read_limit
)
select ...
```

実装では `read_limit = local_rows_to_skip + limit` で取り、アプリ側または外側CTEで先頭 `local_rows_to_skip` 件を落とす。SQLiteの巨大OFFSETを避けるのが目的なので、`local_rows_to_skip` はanchor intervalで上限を持たせる。

Anchor intervalはbuild時に決める。40万行なら10ページ単位でもanchor数は小さい。page_size=100、40万行、10ページ間隔ならprofileあたり約400 anchors。

### Large Page Jump

大きなページジャンプは次の手順で処理する。

```text
requested page = 3500
page_size = 100
anchor interval = 10

anchor page = floor(3500 / 10) * 10 = 3500
local rows to skip = 0
```

```text
requested page = 3507
page_size = 100
anchor interval = 10

anchor page = 3500
local rows to skip = 700
```

このため、`page=3507` でもDBが350,700行を先頭から読むことはない。anchor keyへseekし、そこから最大999行程度だけ進む。

### Keyset Cursor

next/previousとバーチャルスクロールはpage anchorを使わずkeysetで読む。

```sql
select page_id
from viewer_pages
where ...profile filters...
  and (url_sort_key, page_id) > (:cursor_sort_key, :cursor_id)
order by url_sort_key, page_id
limit :limit;
```

レスポンスは次を返す。

```json
{
	"items": [],
	"total": 12345,
	"limit": 100,
	"nextCursor": "...",
	"prevCursor": "...",
	"pageJump": {
		"pageSize": 100,
		"currentApproxPage": 3,
		"totalPages": 124
	}
}
```

`pageJump` はUI表示用であり、連続ロードのstateには使わない。連続ロードの正はcursor。

### Filter Rules

100ms保証するfilterは次の形に限定する。

```text
equality:      is_external = 0, category = html, status = 200
boolean flag:  missing_alt = 1, is_broken = 1
bounded range: status between 400 and 599
prefix:        url path prefix
profile enum:  type = broken/external, field = title/description
```

次は別設計にする。

```text
contains search:   LIKE '%foo%'
regex
arbitrary SQL-like filter builder
unbounded multi-column ad-hoc sort
```

URLのprefix検索は `url_refs` またはviewer tableに `url_sort_key` / `path_sort_key` を持たせてrange scanにする。

```sql
where path_sort_key >= :prefix
  and path_sort_key < :prefix_upper_bound
```

### Sort Rules

sortを増やす時は、次を同時に追加する。

```text
1. viewer tableのsort key列
2. 対応index
3. query profile
4. count
5. page anchors
6. 100ms benchmark
```

sortだけをAPIに追加してindexを追加しない変更は禁止する。

## Common Read Model Tables

### `viewer_count_buckets`

facetやsummary補助値を100ms以下で返すための共通集計。通常の一覧totalは `viewer_query_profiles.total` を使う。

```sql
viewer_count_buckets (
  scope text not null,
  key text not null,
  value text not null,
  count integer not null,
  primary key(scope, key, value)
) without rowid;
```

例:

```text
scope=pages, key=default:is_external=0:content_category=html, value=total
scope=pages, key=status:is_external=0:content_category=html, value=200
scope=images, key=missing_alt, value=true
scope=links, key=broken, value=true
scope=resources, key=unused, value=true
scope=directory-tree, key=root, value=www.example.com
```

完全に任意の複合filterのtotalは事前計算しない。UIで提供するfilter組み合わせを固定し、その組み合わせだけ `viewer_query_profiles` と必要なbucketに入れる。

### `viewer_url_display`

URL表示JOINを軽くするための補助view/table。実体tableでもよい。

```sql
viewer_url_display (
  url_id integer primary key,
  url text not null,
  host text,
  path text
);
```

`url_refs` が十分軽ければ不要。URL joinが重ければ、untar/build時にこの薄い表示用テーブルを作る。

### `viewer_directory_nodes`

ディレクトリツリー専用のread model。URL pathをGET時にsplitしない。

```sql
viewer_directory_nodes (
  node_id integer primary key,
  parent_node_id integer,
  root_key text not null,
  depth integer not null,
  name_text_id integer not null,
  path_text_id integer not null,
  path_prefix_text_id integer not null,
  name_sort_key text not null,
  path_sort_key text not null,
  direct_child_dir_count integer not null,
  direct_page_count integer not null,
  descendant_page_count integer not null,
  internal_descendant_page_count integer not null,
  external_descendant_page_count integer not null,
  representative_page_id integer,
  has_children integer not null,
  unique(root_key, path_text_id)
);
```

`root_key` はhostまたはscope rootを正規化したキー。multi-root archiveではrootごとにツリーを分ける。`path_text_id` は表示用パス、`path_prefix_text_id` はpages filterへ接続するためのprefix。

### `viewer_directory_pages`

ディレクトリ直下ページだけを持つ。配下全ページをツリー展開時に読まない。

```sql
viewer_directory_pages (
  node_id integer not null,
  page_id integer not null,
  page_url_sort_key text not null,
  primary key(node_id, page_id)
);
```

## Endpoint Plans

## `/api/summary`

Target: 1-5ms.

Read:

```sql
select
  total_pages,
  internal_pages,
  external_pages,
  internal_contents,
  external_contents,
  status_json,
  content_type_json,
  metadata_json
from viewer_summary
where id = 1;
```

Index:

```sql
primary key(id)
```

Notes:

- JSONは小さい集計結果のみ。
- 生 `content_items` は読まない。

## `/api/error-kinds`

Target: 5-20ms.

Read:

```sql
select kind, count
from viewer_error_kind_groups
order by count desc;
```

```sql
select h.kind, h.host, h.count
from viewer_error_kind_hosts h
join viewer_error_kind_groups g on g.kind = h.kind
order by g.count desc, h.count desc;
```

```sql
select s.kind, u.url
from viewer_error_kind_samples s
join url_refs u on u.id = s.url_id
order by s.kind, s.rank;
```

Indexes:

```sql
create index vei_error_groups_count on viewer_error_kind_groups(count desc);
create index vei_error_hosts_kind_count on viewer_error_kind_hosts(kind, count desc);
create index vei_error_samples_kind_rank on viewer_error_kind_samples(kind, rank);
```

## `/api/pages`

Target: 20-80ms.

Supported fast filters:

```text
is_external
content_category
status
missing title
missing description
noindex
source
sort=url/status/title
```

Read:

```sql
with ids as (
  select page_id
  from viewer_pages
  where is_external = :is_external
    and content_category = :content_category
    and (url_sort_key, page_id) > (:cursor_url_sort_key, :cursor_page_id)
  order by url_sort_key asc
  limit :limit
)
select
  p.page_id,
  u.url,
  title.text as title,
  p.status,
  p.content_category,
  p.has_title,
  p.has_description,
  p.has_og_title,
  p.robots_noindex,
  p.tag_count,
  p.jsonld_count
from ids
join viewer_pages p on p.page_id = ids.page_id
join content_items c on c.id = p.page_id
join url_refs u on u.id = c.url_id
left join text_refs title on title.id = p.title_text_id
order by p.url_sort_key asc;
```

Indexes:

```sql
create index vp_default on viewer_pages(
  is_external,
  content_category,
  url_sort_key,
  page_id
);

create index vp_status on viewer_pages(
  is_external,
  content_category,
  status,
  url_sort_key,
  page_id
);

create index vp_title on viewer_pages(
  is_external,
  content_category,
  title_sort_key,
  url_sort_key,
  page_id
);

create index vp_missing_title on viewer_pages(
  is_external,
  content_category,
  has_title,
  url_sort_key,
  page_id
);

create index vp_noindex on viewer_pages(
  is_external,
  content_category,
  robots_noindex,
  url_sort_key,
  page_id
);
```

Count:

```sql
select count
from viewer_count_buckets
where scope = 'pages'
  and key = :normalized_filter_key
  and value = 'total';
```

Notes:

- `urlPattern` の任意LIKEは100ms保証外。必要なら `url_search` FTSを別設計する。
- `directory` filterは `viewer_directory_nodes.path_prefix_text_id` からprefixを取り、`viewer_pages.path_sort_key` のrange scanで対応する。

## `/api/directory-tree`

Target: 10-50ms.

初期表示は3depthまで展開する。返すのはディレクトリノードのみで、各ノードに直下ディレクトリ数、直下ページ数、配下ページ数を含める。

Read initial tree:

```sql
select
  n.node_id,
  n.parent_node_id,
  name.text as name,
  path.text as path,
  n.depth,
  n.direct_child_dir_count,
  n.direct_page_count,
  n.direct_child_dir_count + n.direct_page_count as child_count,
  n.descendant_page_count,
  n.internal_descendant_page_count,
  n.external_descendant_page_count,
  n.has_children
from viewer_directory_nodes n
join text_refs name on name.id = n.name_text_id
join text_refs path on path.id = n.path_text_id
where n.root_key = :root_key
  and n.depth <= 3
order by n.path_sort_key;
```

Indexes:

```sql
create index vdn_root_depth_path on viewer_directory_nodes(
  root_key,
  depth,
  path_sort_key,
  node_id
);

create index vdn_parent_name on viewer_directory_nodes(
  parent_node_id,
  name_sort_key,
  node_id
);

create unique index vdn_root_path on viewer_directory_nodes(root_key, path_text_id);
```

Notes:

- 初期3depthは固定仕様。UIがさらに深い初期展開を要求する場合も、`depth <= :initial_depth` の上限付きSELECTにする。
- 未展開ノードのバッジは `child_count = direct_child_dir_count + direct_page_count` を表示する。内訳が必要なUIでは `direct_child_dir_count` と `direct_page_count` もそのまま使う。
- `descendant_page_count` は「このディレクトリ配下に何ページあるか」を示す。展開可否の判定にprefix countを実行しない。
- root一覧が必要な場合は `parent_node_id is null` を読む。

## `/api/directory-tree/children`

Target: 5-30ms.

深いツリーは未展開ノードをクリックした時だけ、直下ディレクトリを読む。

```sql
select
  n.node_id,
  n.parent_node_id,
  name.text as name,
  path.text as path,
  n.depth,
  n.direct_child_dir_count,
  n.direct_page_count,
  n.direct_child_dir_count + n.direct_page_count as child_count,
  n.descendant_page_count,
  n.internal_descendant_page_count,
  n.external_descendant_page_count,
  n.has_children
from viewer_directory_nodes n
join text_refs name on name.id = n.name_text_id
join text_refs path on path.id = n.path_text_id
where n.parent_node_id = :node_id
order by n.name_sort_key, n.node_id
limit :limit;
```

Index: `vdn_parent_name` を使う。

Notes:

- 直下childrenだけを読む。recursive CTEで深い配下を探索しない。
- `limit` は防御用。通常は1ディレクトリ直下の子ディレクトリ数だけを返す。

## `/api/directory-tree/pages`

Target: 10-50ms.

ディレクトリ直下のページ一覧をcursor paginationで読む。

```sql
with ids as (
  select page_id
  from viewer_directory_pages
  where node_id = :node_id
    and (page_url_sort_key, page_id) > (:cursor_page_url_sort_key, :cursor_page_id)
  order by page_url_sort_key, page_id
  limit :limit
)
select
  p.page_id,
  u.url,
  title.text as title,
  p.status,
  p.content_category
from ids
join viewer_pages p on p.page_id = ids.page_id
join content_items c on c.id = p.page_id
join url_refs u on u.id = c.url_id
left join text_refs title on title.id = p.title_text_id
order by p.url_sort_key, p.page_id;
```

Index:

```sql
create index vdp_node_url on viewer_directory_pages(node_id, page_url_sort_key, page_id);
```

Count:

```sql
select direct_page_count
from viewer_directory_nodes
where node_id = :node_id;
```

Notes:

- このendpointは直下ページだけを返す。
- 配下全ページ一覧は `/api/pages` のdirectory profileとして扱い、`path_sort_key` prefix range + keyset cursorで読む。

## `/api/page-links`

Target: 20-80ms.

Read:

```sql
with ids as (
  select p.page_id
  from viewer_pages p
  where p.is_external = :is_external
    and (p.url_sort_key, p.page_id) > (:cursor_url_sort_key, :cursor_page_id)
  order by p.url_sort_key
  limit :limit
)
select
  u.url,
  title.text as title,
  p.status,
  p.content_category,
  s.redirect_from_count,
  s.referrer_count,
  s.outbound_count,
  s.broken_out_count,
  s.external_out_count,
  p.has_response_headers,
  p.skip_reason_text_id
from ids
join viewer_pages p on p.page_id = ids.page_id
join viewer_page_stats s on s.page_id = p.page_id
join content_items c on c.id = p.page_id
join url_refs u on u.id = c.url_id
left join text_refs title on title.id = p.title_text_id
order by p.url_sort_key;
```

Indexes:

```sql
create index vps_referrer on viewer_page_stats(referrer_count desc, page_id);
```

`viewer_pages` indexes from `/api/pages` are reused.

## `/api/links?type=broken|external`

Target: 20-80ms.

Read broken:

```sql
with ids as (
  select edge_id
  from viewer_anchor_facts
  where is_broken = 1
    and (source_url_sort_key, edge_id) > (:cursor_source_url_sort_key, :cursor_edge_id)
  order by source_url_sort_key, edge_id
  limit :limit
)
select
  su.url as source_url,
  du.url as dest_url,
  d.status as status,
  f.count,
  txt.text as text_content
from ids
join viewer_anchor_facts f on f.edge_id = ids.edge_id
join content_items s on s.id = f.page_id
join url_refs su on su.id = s.url_id
join content_items d on d.id = f.resolved_href_page_id
join url_refs du on du.id = d.url_id
left join text_refs txt on txt.id = f.first_text_id
order by f.source_url_sort_key, f.edge_id;
```

Read external:

```sql
with ids as (
  select edge_id
  from viewer_anchor_facts
  where is_external_link = 1
    and (source_url_sort_key, edge_id) > (:cursor_source_url_sort_key, :cursor_edge_id)
  order by source_url_sort_key, edge_id
  limit :limit
)
select ...
```

Indexes:

```sql
create index vaf_broken on viewer_anchor_facts(
  is_broken,
  source_url_sort_key,
  edge_id
);

create index vaf_external on viewer_anchor_facts(
  is_external_link,
  source_url_sort_key,
  edge_id
);

create index vaf_source on viewer_anchor_facts(page_id, edge_id);
create index vaf_dest on viewer_anchor_facts(resolved_href_page_id, edge_id);
```

Count:

```sql
select count
from viewer_count_buckets
where scope = 'links'
  and key = :type
  and value = 'total';
```

Notes:

- No redirect resolution in GET.
- No COALESCE over joined pages in GET.
- No scan of `anchor_edges` in GET.

## `/api/graph`

Target: 20-100ms depending on limit.

Read nodes:

```sql
with nodes as (
  select page_id
  from viewer_graph_nodes
  order by indegree desc, page_id
  limit :limit
)
select
  n.page_id,
  u.url,
  g.indegree,
  g.outdegree,
  g.status
from nodes n
join viewer_graph_nodes g on g.page_id = n.page_id
join content_items c on c.id = n.page_id
join url_refs u on u.id = c.url_id
order by g.indegree desc, n.page_id;
```

Read edges:

```sql
with nodes as (
  select page_id
  from viewer_graph_nodes
  order by indegree desc, page_id
  limit :limit
)
select e.source_page_id, e.target_page_id, e.count
from viewer_graph_edges e
join nodes s on s.page_id = e.source_page_id
join nodes t on t.page_id = e.target_page_id;
```

Indexes:

```sql
create index vgn_indegree on viewer_graph_nodes(indegree desc, page_id);
create index vge_source_target on viewer_graph_edges(source_page_id, target_page_id);
create index vge_target_source on viewer_graph_edges(target_page_id, source_page_id);
```

Notes:

- `viewer_graph_edges` is built from resolved internal links.
- GET never does `distinct anchors`.

## `/api/resources`

Target: 20-80ms.

Read:

```sql
with ids as (
  select r.resource_id
  from viewer_resources r
  where r.is_external = :is_external
    and r.content_category = :content_category
    and (r.url_sort_key, r.resource_id) > (:cursor_url_sort_key, :cursor_resource_id)
  order by r.url_sort_key
  limit :limit
)
select
  u.url,
  r.status,
  r.content_category,
  r.content_length,
  r.compress,
  r.cdn,
  s.referrer_count,
  s.is_unused
from ids
join viewer_resources r on r.resource_id = ids.resource_id
join resource_items ri on ri.id = r.resource_id
join url_refs u on u.id = ri.url_id
join viewer_resource_stats s on s.resource_id = r.resource_id
order by r.url_sort_key;
```

Indexes:

```sql
create index vr_default on viewer_resources(
  is_external,
  content_category,
  url_sort_key,
  resource_id
);

create index vrs_unused on viewer_resource_stats(is_unused, resource_id);
```

Count:

```sql
select count
from viewer_count_buckets
where scope = 'resources'
  and key = :normalized_filter_key
  and value = 'total';
```

## `/api/resources/referrers`

Target: 20-80ms.

Read:

```sql
with refs as (
  select page_id
  from resource_ref_edges
  where resource_id = :resource_id
    and page_id > :cursor_page_id
  order by page_id
  limit :limit
)
select u.url
from refs
join content_items c on c.id = refs.page_id
join url_refs u on u.id = c.url_id
order by refs.page_id;
```

Index:

```sql
primary key(resource_id, page_id)
```

Count:

`viewer_resource_stats.referrer_count`.

## `/api/unused-resources`

Target: 20-80ms.

Read:

```sql
with ids as (
  select s.resource_id
  from viewer_resource_stats s
  join viewer_resources r on r.resource_id = s.resource_id
  where s.is_unused = 1
    and (r.url_sort_key, r.resource_id) > (:cursor_url_sort_key, :cursor_resource_id)
  order by r.url_sort_key
  limit :limit
)
select
  u.url,
  r.status,
  r.content_category,
  r.content_length,
  r.source
from ids
join viewer_resources r on r.resource_id = ids.resource_id
join resource_items ri on ri.id = r.resource_id
join url_refs u on u.id = ri.url_id
order by r.url_sort_key;
```

Indexes:

```sql
create index vr_unused_order on viewer_resources(is_unused, url_sort_key, resource_id);
```

`is_unused` may be duplicated into `viewer_resources` to avoid join before limit.

## `/api/images`

Target: 20-80ms.

Fast filters:

```text
missing_alt
missing_dimensions
oversized
url prefix/category
page ordering
```

Read:

```sql
with ids as (
  select image_id
  from viewer_images
  where missing_alt = :missing_alt
    and (page_url_sort_key, image_id) > (:cursor_page_url_sort_key, :cursor_image_id)
  order by page_url_sort_key, image_id
  limit :limit
)
select
  pu.url as page_url,
  coalesce(src_url.url, src_blob.body) as src,
  alt.text as alt,
  i.width,
  i.height,
  i.natural_width,
  i.natural_height,
  i.is_lazy
from ids
join viewer_images i on i.image_id = ids.image_id
join content_items p on p.id = i.page_id
join url_refs pu on pu.id = p.url_id
left join url_refs src_url on src_url.id = i.src_url_id
left join blob_refs src_blob on src_blob.id = i.src_blob_id
left join text_refs alt on alt.id = i.alt_text_id
order by i.page_url_sort_key, i.image_id;
```

Indexes:

```sql
create index vi_default on viewer_images(
  page_url_sort_key,
  image_id
);

create index vi_missing_alt on viewer_images(
  missing_alt,
  page_url_sort_key,
  image_id
);

create index vi_missing_dimensions on viewer_images(
  missing_dimensions,
  page_url_sort_key,
  image_id
);

create index vi_oversized on viewer_images(
  oversized_1000,
  page_url_sort_key,
  image_id
);

create index vi_src_url on viewer_images(src_url_id, image_id);
create index vi_current_src_url on viewer_images(current_src_url_id, image_id);
```

Count:

`viewer_count_buckets(scope='images', key=...)`.

Notes:

- `sourceCode` is reconstructed lazily from stored HTML + `dom_path_text_id`.
- `/api/images` list does not reconstruct `sourceCode`.
- `src` and `currentSrc` remain separate for `srcset`, `sizes`, and `picture/source`.

## `/api/headers`

Target: 20-80ms.

Read:

```sql
with ids as (
  select page_id
  from viewer_header_checks
  where missing_count > 0
    and (url_sort_key, page_id) > (:cursor_url_sort_key, :cursor_page_id)
  order by url_sort_key
  limit :limit
)
select
  u.url,
  h.has_csp,
  h.has_x_frame_options,
  h.has_x_content_type_options,
  h.has_hsts,
  h.has_referrer_policy,
  h.has_permissions_policy,
  h.cache_policy
from ids
join viewer_header_checks h on h.page_id = ids.page_id
join content_items c on c.id = h.page_id
join url_refs u on u.id = c.url_id
order by h.url_sort_key;
```

Indexes:

```sql
create index vh_missing on viewer_header_checks(missing_count, url_sort_key, page_id);
create index vh_default on viewer_header_checks(url_sort_key, page_id);
```

Notes:

- No JSON parse in GET.
- Header detail endpoint may reconstruct entries from `header_set_entries`.

## `/api/duplicates`

Target: 5-50ms.

Read:

```sql
select
  g.id,
  g.field,
  txt.text as value,
  g.count
from viewer_duplicate_groups g
join text_refs txt on txt.id = g.value_text_id
where g.field = :field
  and (g.count_desc_key, g.id) > (:cursor_count_desc_key, :cursor_id)
order by g.count_desc_key, g.id
limit :limit;
```

For group pages:

```sql
with ids as (
  select page_id
  from viewer_duplicate_group_pages
  where group_id = :group_id
    and page_id > :cursor_page_id
  order by page_id
  limit :limit
)
select u.url
from ids
join content_items c on c.id = ids.page_id
join url_refs u on u.id = c.url_id;
```

Indexes:

```sql
create index vdg_field_count on viewer_duplicate_groups(field, count_desc_key, id);
```

## `/api/mismatches`

Target: 5-50ms.

Read:

```sql
with ids as (
  select id
  from viewer_mismatches
  where type = :type
    and (url_sort_key, id) > (:cursor_url_sort_key, :cursor_id)
  order by url_sort_key
  limit :limit
)
select
  u.url,
  m.type,
  actual_text.text as actual,
  expected_text.text as expected,
  actual_url.url as actual_url,
  expected_url.url as expected_url
from ids
join viewer_mismatches m on m.id = ids.id
join content_items c on c.id = m.page_id
join url_refs u on u.id = c.url_id
left join text_refs actual_text on actual_text.id = m.actual_text_id
left join text_refs expected_text on expected_text.id = m.expected_text_id
left join url_refs actual_url on actual_url.id = m.actual_url_id
left join url_refs expected_url on expected_url.id = m.expected_url_id
order by m.url_sort_key;
```

Index:

```sql
create index vm_type_url on viewer_mismatches(type, url_sort_key, id);
```

## `/api/isolated-pages`

Target: 20-80ms.

Read:

```sql
with ids as (
  select component_id
  from viewer_isolated_components
  where size = 1
    and (representative_url_sort_key, component_id) > (:cursor_representative_url_sort_key, :cursor_component_id)
  order by representative_url_sort_key
  limit :limit
)
select
  u.url,
  title.text as title,
  p.status,
  p.source
from ids
join viewer_isolated_components cpt on cpt.component_id = ids.component_id
join viewer_isolated_component_pages cp on cp.component_id = cpt.component_id
join viewer_pages p on p.page_id = cp.page_id
join content_items c on c.id = p.page_id
join url_refs u on u.id = c.url_id
left join text_refs title on title.id = p.title_text_id
order by cpt.representative_url_sort_key;
```

Index:

```sql
create index vic_size_url on viewer_isolated_components(size, representative_url_sort_key, component_id);
```

## `/api/isolated-clusters`

Target: 20-80ms.

Read:

```sql
select
  c.component_id,
  u.url as representative_url,
  title.text as representative_title,
  p.status as representative_status,
  c.size
from viewer_isolated_components c
join viewer_pages p on p.page_id = c.representative_page_id
join content_items ci on ci.id = p.page_id
join url_refs u on u.id = ci.url_id
left join text_refs title on title.id = p.title_text_id
where c.size >= 2
  and (c.size_desc_key, c.representative_url_sort_key, c.component_id) > (:cursor_size_desc_key, :cursor_representative_url_sort_key, :cursor_component_id)
order by c.size_desc_key, c.representative_url_sort_key
limit :limit;
```

Index:

```sql
create index vic_cluster_order on viewer_isolated_components(size_desc_key, representative_url_sort_key, component_id);
```

## `/api/isolated-clusters/:representativeUrl`

Target: 20-80ms.

Read:

```sql
with component as (
  select component_id
  from viewer_isolated_components
  where representative_page_id = :page_id
)
select
  u.url,
  title.text as title,
  p.status,
  p.source
from viewer_isolated_component_pages cp
join component c on c.component_id = cp.component_id
join viewer_pages p on p.page_id = cp.page_id
join content_items ci on ci.id = p.page_id
join url_refs u on u.id = ci.url_id
left join text_refs title on title.id = p.title_text_id
order by p.url_sort_key;
```

Indexes:

```sql
create unique index vic_representative on viewer_isolated_components(representative_page_id);
create index vicp_component_page on viewer_isolated_component_pages(component_id, page_id);
```

## `/api/pages/detail`

Target: 20-80ms for normal pages.

Reads:

```sql
select ...
from content_items c
join page_meta m on m.page_id = c.id
join viewer_page_stats s on s.page_id = c.id
where c.url_id = :url_id;
```

Outbound links:

```sql
with ids as (
  select edge_id
  from viewer_anchor_facts
  where page_id = :page_id
  order by edge_id
  limit :limit
)
select ...
```

Inbound links:

```sql
with ids as (
  select edge_id
  from viewer_anchor_facts
  where resolved_href_page_id = :page_id
  order by edge_id
  limit :limit
)
select ...
```

Indexes:

```sql
create unique index ci_url on content_items(url_id);
create index vaf_page_edge on viewer_anchor_facts(page_id, edge_id);
create index vaf_resolved_edge on viewer_anchor_facts(resolved_href_page_id, edge_id);
```

Notes:

- Do not return unbounded inbound/outbound arrays.
- Detail endpoint should paginate link sections or cap samples.

## `/api/pages/html`

Target: dominated by BLOB decompression.

Read:

```sql
select b.body, b.codec, b.size_raw
from page_html_ref r
join page_html_blobs b on b.hash = r.hash
where r.page_id = :page_id;
```

Indexes:

```sql
primary key(page_id)
primary key(hash)
```

## `/api/violations`

Target: 20-80ms.

Read:

```sql
with ids as (
  select id
  from analysis_violations
  where validator = :validator
    and severity = :severity
    and (page_url_sort_key, id) > (:cursor_page_url_sort_key, :cursor_id)
  order by page_url_sort_key, id
  limit :limit
)
select
  u.url,
  v.validator,
  v.severity,
  v.rule,
  msg.text as message,
  code.text as code
from ids
join analysis_violations v on v.id = ids.id
join content_items c on c.id = v.page_id
join url_refs u on u.id = c.url_id
join text_refs msg on msg.id = v.message_text_id
left join text_refs code on code.id = v.code_text_id
order by v.page_url_sort_key, v.id;
```

Indexes:

```sql
create index av_filter on analysis_violations(
  validator,
  severity,
  rule,
  page_url_sort_key,
  id
);

create index av_page on analysis_violations(page_id, id);
```

Count:

`viewer_count_buckets(scope='violations', key=normalized_filter_key)`.

## Build-Time Responsibilities

The build step after crawl/append/retry must populate:

```text
viewer_count_buckets
viewer_summary
viewer_error_kind_*
viewer_pages
viewer_anchor_facts
viewer_page_stats
viewer_resources
viewer_resource_stats
viewer_images
viewer_image_flags
viewer_graph_nodes
viewer_graph_edges
viewer_header_checks
viewer_mismatches
viewer_duplicate_*
viewer_isolated_*
analysis_violations
```

Build step may take minutes. It must be transactional at table-swap granularity:

```text
1. build viewer_*_next tables
2. validate row counts and required indexes
3. swap/drop old viewer_* tables
4. mark viewer_build_state ready
```

## Index Budget

Indexes are part of the product surface for 100ms reads. Every supported viewer filter/sort combination must have a corresponding index or precomputed bucket.

Avoid:

- wide covering indexes containing long text
- indexes over raw URL strings in huge tables
- indexes that exist only for unsupported ad-hoc filters

Prefer:

- sort keys stored as compact text/integer refs
- `(filter columns..., sort key, id)` indexes
- small duplicated flags in viewer tables to avoid joins before limit

## 100ms Acceptance Tests

On a 40万コンテンツ archive:

```text
/api/summary                         < 100ms
/api/error-kinds                     < 100ms
/api/pages default                   < 100ms
/api/pages common filters            < 100ms
/api/page-links default              < 100ms
/api/links?type=broken               < 100ms
/api/links?type=external             < 100ms
/api/resources default               < 100ms
/api/unused-resources                < 100ms
/api/images default                  < 100ms
/api/images missing-alt              < 100ms
/api/headers missing-only            < 100ms
/api/duplicates                      < 100ms
/api/mismatches                      < 100ms
/api/isolated-pages                  < 100ms
/api/isolated-clusters               < 100ms
/api/violations common filters       < 100ms
```

Measure server timing only. Browser rendering is out of scope for this SQL plan.

## Non-SQL Fallbacks

SQL is the primary solution. These are allowed only after SQL plan is implemented:

- Generate small JSON files at untar/open time for `summary`, `error-kinds`, and nav badges.
- Process-level cache for immutable `viewer_summary`.
- Prepared statements for hot endpoints.
- Keep archive cache directory warm between viewer sessions.

These must not replace the SQL read model. They are optional latency polish.
