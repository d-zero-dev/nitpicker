# Viewer DB Redesign Specification

<!-- cspell:ignore dbstat pageid resourceid hrefid indegree -->

## 目的

40万コンテンツ級の `.nitpicker` アーカイブで、viewer の Hono API が秒単位で遅くなる問題を DB 構造から解決する。

Node.js / Hono / React 側のキャッシュや描画最適化は最後の最後とし、DB の write model と viewer read model を分離する。作業は新しいスキーマを作り直す前提で進め、既存 archive からの migration script は最後に作る。

## 設計判断基準

実装時間はいくらかかってもよい前提で、理想スキーマを設計する。判断優先順位は次の通り。

```text
1. 既存のデータ量・性質を破壊しない
2. migrationすれば現行DB相当の情報を復元できる
3. crawling時のwrite性能とviewerのread性能を最優先する
4. 可能であればファイルサイズを下げる
```

この優先順位により、サイズ削減のために観測事実を捨てない。保存用write modelは既存archiveの情報を復元可能にする。viewer read modelは全て再生成可能な派生データとする。

### データ保持の原則

- URL、text、JSON、header、blob は参照化しても元値を完全復元できること。
- redirect解決、broken判定、referrer count、summary、duplicate group、isolated component は派生情報としてviewer read modelに置く。
- 派生情報はmigrationやbuild stepで再生成できること。
- crawl中のwrite pathに重い集計更新を入れないこと。
- viewer GETで巨大な生テーブルを走査しないこと。
- `sourceCode` は保存HTML + `dom_path` から復元する。migration時に復元一致を検証する。

### 目標

- `/api/summary`, `/api/error-kinds`: 1行または小規模集計テーブルSELECT
- `/api/pages`, `/api/resources`, `/api/images`: read model上でfilter/sort/page決定、URL/textはlimit後JOIN
- `/api/links`, `/api/page-links`, `/api/graph`: redirect解決済みfact/statを読む
- `/api/headers`: `header_flags` を読む
- `/api/duplicates`, `/api/mismatches`, `/api/isolated-*`: 完了後build済み診断テーブルを読む
- crawl中: URL lookup / page/resource upsert / edge insert を軽く保つ

## 調査対象

実測に使った大規模 archive:

```text
large production-scale archive sample
```

tar 内訳:

```text
archive total: 11GB
db.sqlite:     11,371,929,600 bytes
db.sqlite-wal: 0 bytes
error.log:     1,644 bytes
```

SQLite:

```text
page_size:      4096
page_count:     2,776,350
freelist_count: 89
```

freelist がほぼ無いため、read model 追加分はほぼそのままファイルサイズ増加になる。

## 現状の行数

```text
pages:                470,873
anchors:           12,999,495
images:             9,110,919
resources:          1,079,321
resources-referrers:10,472,109
page_html_ref:        353,133
page_html_blobs:      105,628
page_tags:            405,775
page_jsonld:                0
page_errors:              226
crawl_errors:           1,854
```

HTML BLOB:

```text
compressed stored: 870,250,869 bytes
raw total:       10,157,192,048 bytes
blob count:          105,628
```

HTML 本文は圧縮後 870MB 程度で、11GB の主因ではない。

## 現状のテーブル・INDEXサイズ

`dbstat` による主要サイズ:

```text
images                              3.25GB
resources                           1.38GB
idx_images_covering                 1.23GB
page_html_blobs                     1.04GB
pages                               0.96GB
anchors                             0.68GB
resources_url_unique                0.65GB
idx_resources_internal_url          0.60GB
anchors_pageid_index                0.18GB
resources_referrers_resourceid_pageid_unique 0.17GB
resources-referrers                 0.16GB
anchors_hrefid_index                0.16GB
pages_url_unique                    0.16GB
resources_referrers_pageid_index    0.15GB
idx_pages_listfilter                0.15GB
resources_referrers_resourceid_index 0.13GB
images_pageid_index                 0.12GB
```

肥大化の主因は `images`, `resources`, URL系INDEX, 画像covering index, anchors/resource refs である。

## 重複・粒度の問題

`anchors` は同一ページ内の同一リンク先を instance 粒度で保存している。

```text
anchors rows:                            12,999,495
distinct(pageId, hrefId, hash, text):    11,249,747
distinct(pageId, hrefId):                 9,746,369
duplicate extra by pageId+hrefId:         3,253,126
max duplicate per same pageId+hrefId:         1,738
```

`resources` 本体は URL unique なので、同じリクエストをそのまま `resources` 行にしているわけではない。

```text
resources rows:                       1,079,321
resources-referrers rows:            10,472,109
distinct(resourceId, pageId):        10,472,109
distinct(resourceId):                 1,059,780
```

`resources-referrers` は `(resourceId, pageId)` unique なので、同一ページから同一resourceへの重複は抑えられている。ただし viewer に必要な多くの用途では edge 全件ではなく `referrer_count` と `is_unused` があれば足りる。

`images` はbase64/data URLだけが主因ではない。調査対象DBではdata URLは少ない。

```text
src data:        429 rows / 260,882 chars
currentSrc data: 429 rows / 260,882 chars
sourceCode data:429 rows / 282,786 chars
```

一方で、画像系文字列全体は巨大で、かつ重複率が非常に高い。

```text
src total chars:        719,880,103
currentSrc total chars: 719,862,813
sourceCode total chars: 948,412,658
total:                2,388,155,574 chars

distinct src:             29,802 / 3,203,348 chars
distinct currentSrc:      29,989 / 3,217,312 chars
distinct sourceCode:      30,952 / 4,279,937 chars
distinct alt:              8,473 /   184,385 chars
```

つまり `images` 肥大化の中心は「少数の巨大base64」ではなく、約911万行に同じURL/sourceCode文字列を繰り返し保存していること。URL参照化と、`sourceCode` のDOM path化の効果が大きい。

画像以外にもref化できる文字列がある。

```text
anchors.textContent total:        216,193,085 chars
anchors.textContent distinct:       5,333,627 chars / 108,493 values

pages.meta_extras total:          301,790,907 chars
pages.meta_extras distinct:        50,490,443 chars / 27,126 values

pages.responseHeaders total:      174,129,312 chars
pages.responseHeaders distinct:   173,109,707 chars / 435,535 values

resources.responseHeaders total:  619,224,701 chars
resources.responseHeaders distinct:424,506,694 chars / 723,327 values

pages.title total:                  7,235,491 chars
pages.title distinct:               1,950,821 chars / 26,269 values
```

`anchors.textContent` は `text_refs` 化で効果が大きい。`responseHeaders` は単純なJSON文字列辞書だけでは削減幅が限定的なので、header set / header name / header value へ分解する。`meta_extras` はJSON blobとしてsha辞書化する。

## Viewer GET Needs

viewer の GET は次の種類に分けられる。

| 種別               | Endpoint                                                                           | 必要データ                                             | 現状の問題                                   |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| 全体集計           | `/api/summary`, `/api/error-kinds`                                                 | status/content-type/meta/error 集計                    | 毎回 `pages` / errors を集計                 |
| 一覧               | `/api/pages`, `/api/resources`, `/api/images`, `/api/page-links`, `/api/headers`   | filter/sort/page/count 済みの行                        | 毎回 `COUNT`, JOIN, JSON parse, 相関subquery |
| ディレクトリツリー | `/api/directory-tree`, `/api/directory-tree/children`, `/api/directory-tree/pages` | URL path tree、子数、配下ページ数                      | 毎回URL文字列をsplit/prefix集計              |
| リンク診断         | `/api/links`, `/api/graph`, `/api/page-links`, page detail inbound/outbound        | redirect解決済みリンク、broken/external判定、in-degree | 毎回 `anchors -> pages -> canonical` JOIN    |
| メタ診断           | `/api/duplicates`, `/api/mismatches`                                               | duplicate group, canonical/OG差分                      | 毎回 GROUP BY / 条件走査                     |
| 孤立/未使用        | `/api/isolated-*`, `/api/unused-resources`                                         | connected component, referrer count 0                  | 毎回 graph構築 / 反存在JOIN                  |

## Viewerの理想Read Path

viewerは「archiveを読むブラウザUI」であり、crawl engineではない。理想状態では、viewerのGETは巨大な生テーブルを探索しない。すべての画面は、事前構築されたread modelを読む。

原則:

- GETで全表集計しない。
- GETでredirect chainを解決しない。
- GETでconnected componentを作らない。
- GETでduplicate groupを作らない。
- GETでresponseHeaders JSONを大量parseしない。
- GETで1000万行級テーブルに対する相関subqueryを実行しない。
- GETで返却対象100件を決める前にURL文字列JOINを広げない。
- 一覧の `total` は、可能な限りread model側の事前集計または軽いcovering indexで返す。

Endpoint別の理想:

| Endpoint                                    | 理想read path                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/api/summary`                              | `viewer_summary` 1行SELECT                                                                  |
| `/api/error-kinds`                          | `viewer_error_kind_groups` / `viewer_error_kind_hosts` / `viewer_error_kind_samples` SELECT |
| `/api/pages`                                | `viewer_pages` でfilter/sort/page決定後、必要に応じて `url_refs` をlimit後JOIN              |
| `/api/directory-tree`                       | `viewer_directory_nodes` で初期3depthを読む。子数・配下ページ数は計算済み                   |
| `/api/directory-tree/children`              | `viewer_directory_nodes where parent_node_id = ?` で未展開ノードの直下だけ読む              |
| `/api/directory-tree/pages`                 | `viewer_directory_pages where node_id = ?` でディレクトリ直下ページをcursor pagination      |
| `/api/page-links`                           | `viewer_pages` + `viewer_page_stats`。referrer/redirect countは計算済み                     |
| `/api/links?type=broken`                    | `viewer_anchor_facts where is_broken = 1` でedgeをpageし、limit後にURL JOIN                 |
| `/api/links?type=external`                  | `viewer_anchor_facts where is_external_link = 1` でedgeをpageし、limit後にURL JOIN          |
| `/api/graph`                                | `viewer_graph_nodes` / `viewer_graph_edges` を読む。GET時に全anchorをdistinctしない         |
| `/api/resources`                            | `viewer_resources` + `viewer_resource_stats`。referrer countは計算済み                      |
| `/api/resources/referrers`                  | `resource_ref_edges` をresource_idで引き、limit後にpage URL JOIN                            |
| `/api/unused-resources`                     | `viewer_resource_stats where is_unused = 1` を起点にする                                    |
| `/api/images`                               | `viewer_images` / `viewer_image_flags` を起点にし、URL/textはlimit後JOIN                    |
| `/api/headers`                              | `viewer_header_checks` を読む。GET時にheaders JSONをparseしない                             |
| `/api/duplicates`                           | `viewer_duplicate_groups` と `viewer_duplicate_group_pages` を読む                          |
| `/api/mismatches`                           | `viewer_mismatches` を読む                                                                  |
| `/api/isolated-pages`                       | `viewer_isolated_components where size = 1` を読む                                          |
| `/api/isolated-clusters`                    | `viewer_isolated_components where size >= 2` を読む                                         |
| `/api/isolated-clusters/:representativeUrl` | representativeからcomponent_idを引き、membersを読む                                         |
| `/api/pages/detail`                         | `content_items` / `page_meta` / stats / edge tables をpage_id起点で読む                     |
| `/api/pages/html`                           | `page_html_ref` -> `page_html_blobs` を読む                                                 |
| `/api/violations`                           | JSON fileではなく `analysis_violations` テーブルを読む                                      |

この理想では、viewer GETは「作ってあるものを読む」だけになる。重い処理はcrawl完了後のbuild stepへ寄せる。

## 設計方針

write model と viewer read model を分離する。

ただし、さらにサイズを詰めるなら2層では足りない。次の3層に分ける。

```text
1. Crawl中の一時テーブル
   - crawl process が高速にINSERT/lookupするための作業領域
   - URL文字列やネットワーク観測を一時的に持ってよい
   - archive保存時には捨てる、または保存用write modelへ畳み込む

2. 保存用 write model テーブル
   - archiveの正本
   - できるだけID/ref中心
   - HTML BLOBやmetaなど、再計算不能な観測結果はここに保存
   - viewerに都合の良い集計は持たない

3. 保存用 viewer read model テーブル
   - viewer GETのための派生結果
   - crawl完了時に一括構築
   - 10分程度の構築時間は許容する
   - URL文字列を1000万行級テーブルへ複製しない
```

40万コンテンツのcrawlが1週間級であることを考えると、crawl完了後に10分程度のDB内ビルドを走らせるのは妥当。むしろcrawl中の per event write を軽くし、完了後にまとめて正規化・集計する方が正しい。

## 3層モデル詳細

### 1. Crawl中の一時テーブル

crawl中は、write amplificationを避けるために「最終保存形にこだわりすぎない」。一時テーブルは `TEMP` テーブルでもよいし、stub viewerで進捗表示したいなら `crawl_*` prefix の通常テーブルでもよい。

一時テーブル定義:

```sql
crawl_url_seen (
  url text primary key,
  url_id integer,
  first_seen_at integer not null
);

crawl_resource_seen (
  url text primary key,
  resource_id integer,
  first_seen_at integer not null
);

crawl_page_events (
  id integer primary key,
  url text not null,
  event_kind text not null,
  payload_json text,
  created_at integer not null
);

crawl_anchor_observations (
  page_url text not null,
  href_url text not null,
  hash text,
  text_content text
);

crawl_resource_observations (
  page_url text not null,
  resource_url text not null
);
```

一時テーブルではURL文字列をそのまま持ってよい。理由は、ここは保存サイズではなくcrawl中の処理単純性を優先する層だから。crawl完了時に保存用write modelへ畳み込み、不要なら削除する。

stub viewerでcrawl途中の閲覧を維持する場合は、一時テーブルを完全に捨てるのではなく、最低限の `pages` 相当だけ保存用write modelへ逐次反映する。anchor/resourceの正規化は完了時に遅延してよい。

### 採用するテーブル群

保存用write model:

```text
url_refs
content_type_refs
header_sets
header_name_refs
header_value_refs
header_set_entries
header_flags
text_refs
json_refs
blob_refs
content_items
resource_items
page_meta
anchor_edges
resource_ref_edges
image_items
page_html_blobs
page_html_ref
page_tags
page_jsonld
page_errors
crawl_errors
analysis_violations
```

保存用viewer read model:

```text
viewer_summary
viewer_error_kind_groups
viewer_error_kind_hosts
viewer_error_kind_samples
viewer_pages
viewer_anchor_facts
viewer_page_stats
viewer_resource_stats
viewer_image_flags
viewer_graph_nodes
viewer_graph_edges
viewer_header_checks
viewer_mismatches
viewer_duplicate_groups
viewer_duplicate_group_pages
viewer_isolated_components
viewer_isolated_component_pages
```

一時/ビルド用:

```text
crawl_url_seen
crawl_resource_seen
crawl_page_events
crawl_anchor_observations
crawl_resource_observations
viewer_build_state
```

### 2. 保存用 write model のref設計

保存用write modelは、文字列を強くref化する。特に `url`, `content_type`, `headers`, `anchor_text`, `image_url`, `image_alt` が対象。

#### URL辞書

全URLを1つの辞書に寄せる。

```sql
url_refs (
  id integer primary key,
  url text not null unique,
  scheme text,
  host text,
  port integer,
  path text,
  query_hash blob,
  fragment text
);
```

`pages.url`, `resources.url`, `images.src`, `images.currentSrc`, `anchors.href` のURL文字列は原則ここを参照する。

注意:

- `url` unique index は大きいが、現状は `pages_url_unique` と `resources_url_unique` だけで約0.81GBある。
- `images.src/currentSrc` は現状 `images` 本体に文字列として入っており、最大の肥大化要因である可能性が高い。
- URL辞書化により、共通CSS/JS/image、同一URLリンク、OG画像、canonicalなどの重複をまとめられる。

#### Content-Type辞書

```sql
content_type_refs (
  id integer primary key,
  raw text not null unique,
  normalized text not null,
  category text not null
);
```

`pages.contentType` と `resources.contentType` は `content_type_id` にする。raw文字列の重複削減より、category filterを安定させる目的が大きい。

#### Header辞書

response headers はJSON文字列のまま各page/resourceに持つと重い。さらに、丸ごとJSONをhash化しても `date`, `etag`, `last-modified`, CDN系ID, request ID などが揺れてdistinctが増える。

ヘッダは「name/value ref」「stable/volatile分類」「viewer用flags」の3つに分ける。

```sql
header_sets (
  id integer primary key,
  raw_hash blob not null,
  stable_hash blob not null,
  volatile_hash blob,
  entry_count integer not null,
  stable_entry_count integer not null
);

header_name_refs (
  id integer primary key,
  name text not null unique
);

header_value_refs (
  id integer primary key,
  hash blob not null,
  value text not null,
  unique(hash, value)
);

header_set_entries (
  header_set_id integer not null references header_sets(id),
  name_id integer not null references header_name_refs(id),
  value_id integer not null references header_value_refs(id),
  is_volatile integer not null,
  primary key(header_set_id, name_id)
);

header_flags (
  header_set_id integer primary key,
  has_csp integer not null,
  has_x_frame_options integer not null,
  has_x_content_type_options integer not null,
  has_hsts integer not null,
  has_referrer_policy integer not null,
  has_permissions_policy integer not null,
  has_set_cookie integer not null,
  cache_policy text
);
```

`content_items.header_set_id`, `resource_items.header_set_id` から参照する。viewerの `/api/headers` は `header_flags` だけを読む。詳細表示やexportだけ `header_set_entries` を復元する。

`stable_hash` は揺れやすいヘッダを除外して作る。`raw_hash` は完全な生ヘッダ復元用、`volatile_hash` は揺れやすいヘッダだけの把握用。

stable扱いの例:

```text
content-type
content-length
cache-control
content-security-policy
x-frame-options
x-content-type-options
strict-transport-security
referrer-policy
permissions-policy
server
vary
```

volatile扱いの例:

```text
date
expires
last-modified
etag
age
via
x-cache
cf-ray
x-request-id
set-cookie
server-timing
```

単純な `headers_json` 辞書ではなく、`header_name_refs` / `header_value_refs` / `header_set_entries` へ分解することで、timestampやrequest IDの揺れでset全体が別物になる問題を抑える。

#### Text辞書

anchor text, alt, meta系文字列のうち、1000万行級テーブルで繰り返されるものをref化する。

```sql
text_refs (
  id integer primary key,
  hash blob not null,
  text text not null,
  unique(hash, text)
);
```

対象:

- `anchors.textContent`
- `images.alt`
- `dom_path`
- analysis violation `message`
- analysis violation `code`

対象外または慎重:

- `pages.title`, `description`, `keywords`
- `og_title`, `og_description`

page meta は47万行なので、ref化の複雑さに対して削減効果が限定的。ref化対象は1000万行級テーブルの文字列を優先する。

#### JSON辞書

`meta_extras` や、大きく揺れにくいJSON payloadはsha + compressed blobで保存する。

```sql
json_refs (
  id integer primary key,
  hash blob not null unique,
  json_text blob not null,
  codec text not null,
  size_raw integer not null,
  size_stored integer not null
);
```

用途:

- `page_meta.meta_extras`
- JSON-LD parsed body
- 将来の構造化extras

`meta_extras` は今回DBで約302MBあり、distinct化後でも約50MBまで落ちる。`page_meta` に直書きせず `meta_extras_json_id` で参照する。

#### Blob辞書

data URLのように、URL文字列として持つには大きく、同一値が繰り返されるものはsha + blobで保存する。

```sql
blob_refs (
  id integer primary key,
  hash blob not null unique,
  body blob not null,
  codec text not null,
  size_raw integer not null,
  size_stored integer not null
);
```

用途:

- `data:image/*;base64,...`
- URLエンコードされた `data:image/svg+xml,...`
- 将来の大きなinline payload

短い通常文字列は `text_refs`、大きいpayloadは `blob_refs` に分ける。閾値は実装時に固定する。例: 512 bytes以上は `blob_refs`。

`blob_refs` は `page_html_blobs` と同じ思想で、content-addressable storageにする。HTML BLOBと統合するかは実装都合で決めるが、理想DB上は「shaで重複排除されたpayload辞書」として扱う。

#### Resource URL と content item の統合

`pages` と `resources` は別概念だが、URL辞書は共有する。

```sql
content_items (
  id integer primary key,
  url_id integer not null unique references url_refs(id),
  is_external integer not null,
  scraped integer not null,
  is_target integer not null,
  status integer,
  status_text text,
  content_type_id integer references content_type_refs(id),
  content_length integer,
  header_set_id integer references header_sets(id),
  redirect_dest_id integer,
  source text not null,
  first_crawled_at integer,
  last_crawled_at integer,
  crawl_order integer
);

resource_items (
  id integer primary key,
  url_id integer not null unique references url_refs(id),
  is_external integer not null,
  status integer,
  status_text text,
  content_type_id integer references content_type_refs(id),
  content_length integer,
  header_set_id integer references header_sets(id),
  compress text,
  cdn text,
  source text not null
);
```

`content_items` と `resource_items` を完全統合する案もあるが、crawler上の意味が違うため最初は分ける。ただし `url_refs` は必ず共有する。

#### Page meta保存

ページ固有のmetaは `content_items` から分離する。URL形の値は `url_refs`、大きいJSONは `json_refs`、重複しやすい短文は `text_refs` を参照する。

```sql
page_meta (
  page_id integer primary key references content_items(id),
  title_text_id integer references text_refs(id),
  description_text_id integer references text_refs(id),
  keywords_text_id integer references text_refs(id),
  lang text,
  dir text,
  charset text,
  canonical_url_id integer references url_refs(id),
  amphtml_url_id integer references url_refs(id),
  manifest_url_id integer references url_refs(id),
  icon_url_id integer references url_refs(id),
  apple_touch_icon_url_id integer references url_refs(id),
  robots_raw_text_id integer references text_refs(id),
  robots_noindex integer,
  robots_nofollow integer,
  robots_noarchive integer,
  robots_noimageindex integer,
  og_type text,
  og_title_text_id integer references text_refs(id),
  og_description_text_id integer references text_refs(id),
  og_url_id integer references url_refs(id),
  og_image_url_id integer references url_refs(id),
  twitter_card text,
  twitter_title_text_id integer references text_refs(id),
  twitter_description_text_id integer references text_refs(id),
  twitter_image_url_id integer references url_refs(id),
  tag_count integer,
  jsonld_count integer,
  tags_providers_csv text,
  meta_extras_json_id integer references json_refs(id)
);
```

page metaは47万行なので、全列を無理にref化しなくてもよいが、URL形の値と `meta_extras` はref化する。`title` は今回DBでtotal約7.2MB、distinct約2.0MBなので容量目的の優先度は低いが、viewer/APIのDTO統一のため `text_refs` に寄せる。

#### Anchor edge保存

保存用write modelでは、DOM instanceではなく edge を正本にする。

```sql
anchor_edges (
  id integer primary key,
  page_id integer not null references content_items(id),
  href_page_id integer not null references content_items(id),
  count integer not null,
  first_hash text,
  first_text_id integer references text_refs(id),
  unique(page_id, href_page_id)
);
```

現状の `anchors` は1299万行。`distinct(pageId, hrefId)` は974万行。この正規化だけで約25%削れる。

#### Resource ref保存

現状の `resources-referrers` はすでに `(resourceId, pageId)` unique。保存用write modelとしてはよい。ただし `count` を持てる形にする。

```sql
resource_ref_edges (
  resource_id integer not null references resource_items(id),
  page_id integer not null references content_items(id),
  count integer not null default 1,
  primary key(resource_id, page_id)
);
```

crawl中に同一ページ同一resourceの複数観測を数えるなら `count` を増やす。viewer上は `count` をほぼ使わないが、ネットワーク観測の情報を失わずにinstance行を避けられる。

#### Image保存

`images` は最大テーブルなので、ここは理想スキーマの必須対象。

`src` と `currentSrc` は両方保持する。`src` はHTML属性上の参照、`currentSrc` はBlinkが `srcset`, `sizes`, `<picture><source>...<img>` を評価した後に実際に選んだ画像URLであり、監査上の意味が違う。

`sourceCode` は保存しない。保存HTMLはBlinkがparseしたDOMのスナップショットであり、後でparseしてもDOM treeの対応が取れる前提に置く。証拠表示が必要な時は `dom_path` で該当 `<img>` を再特定し、保存HTMLから `outerHTML` を復元する。

```sql
image_items (
  id integer primary key,
  page_id integer not null references content_items(id),
  src_url_id integer references url_refs(id),
  current_src_url_id integer references url_refs(id),
  src_blob_id integer references blob_refs(id),
  current_src_blob_id integer references blob_refs(id),
  alt_text_id integer references text_refs(id),
  width real,
  height real,
  natural_width integer,
  natural_height integer,
  is_lazy integer,
  viewport_width integer,
  dom_path_text_id integer not null references text_refs(id)
);
```

`dom_path` は `text_refs` に保存する。CSS selectorそのものではなく、DOM tree上の安定した位置を表す。例:

```text
html/body[1]/main[1]/section[2]/picture[1]/img[1]
html/body[1]/header[1]/a[1]/img[1]
```

同一親内の同名要素ordinalを使う。classやidに依存しないため、属性変更に影響されない。保存HTMLから再構築したDOMに対して同じpathを辿れば、`outerHTML` を再取得できる。

`dom_path` はテンプレートサイトで強く重複するため、`image_items` に直書きしない。専用辞書は作らず、既存の `text_refs` に統合する。

現状 `images` は3.25GB、`idx_images_covering` は1.23GB。`src/currentSrc/alt` の参照化と、`sourceCode` の非保存化により、DB全体への効果が大きい。

理想形では `src/currentSrc` を `url_refs` / `blob_refs` に分配する。通常URLは `url_refs`、data URLや長いinline payloadは `blob_refs` に置く。`alt` は `text_refs` に置く。

`idx_images_covering` のようなwide covering indexはread model導入後に削除対象とする。

### 3. 保存用 viewer read model

viewer read modelは「保存用write modelから10分程度かけて作る」前提にする。ここでもURL文字列の大量複製はしない。

```sql
viewer_anchor_facts (
  edge_id integer primary key,
  page_id integer not null,
  href_page_id integer not null,
  resolved_href_page_id integer not null,
  count integer not null,
  is_broken integer not null,
  is_external_link integer not null
);

viewer_page_stats (
  page_id integer primary key,
  redirect_from_count integer not null,
  referrer_count integer not null,
  outbound_count integer not null,
  internal_indegree integer not null,
  external_out_count integer not null,
  broken_out_count integer not null
);

viewer_resource_stats (
  resource_id integer primary key,
  referrer_count integer not null,
  is_unused integer not null
);

viewer_image_flags (
  image_id integer primary key,
  page_id integer not null,
  missing_alt integer not null,
  missing_dimensions integer not null,
  oversized_1000 integer not null
);

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

viewer_directory_pages (
  node_id integer not null,
  page_id integer not null,
  page_url_sort_key text not null,
  primary key(node_id, page_id)
);

viewer_summary (
  id integer primary key check (id = 1),
  total_pages integer not null,
  internal_pages integer not null,
  external_pages integer not null,
  internal_contents integer not null,
  external_contents integer not null,
  status_json text not null,
  content_type_json text not null,
  metadata_json text not null,
  built_at integer not null,
  source_revision integer not null
);

viewer_error_kind_groups (
  kind text primary key,
  count integer not null
);

viewer_error_kind_hosts (
  kind text not null,
  host text not null,
  count integer not null,
  primary key(kind, host)
);

viewer_error_kind_samples (
  kind text not null,
  url_id integer not null,
  rank integer not null,
  primary key(kind, rank)
);

viewer_graph_nodes (
  page_id integer primary key,
  indegree integer not null,
  outdegree integer not null,
  status integer
);

viewer_graph_edges (
  source_page_id integer not null,
  target_page_id integer not null,
  count integer not null,
  primary key(source_page_id, target_page_id)
);

viewer_header_checks (
  page_id integer primary key,
  has_csp integer not null,
  has_x_frame_options integer not null,
  has_x_content_type_options integer not null,
  has_hsts integer not null,
  missing_count integer not null
);

viewer_mismatches (
  id integer primary key,
  type text not null,
  page_id integer not null,
  actual_text_id integer,
  expected_text_id integer,
  actual_url_id integer,
  expected_url_id integer
);

viewer_duplicate_groups (
  id integer primary key,
  field text not null,
  value_text_id integer not null,
  count integer not null
);

viewer_duplicate_group_pages (
  group_id integer not null,
  page_id integer not null,
  primary key(group_id, page_id)
);

viewer_isolated_components (
  component_id integer primary key,
  representative_page_id integer not null,
  size integer not null
);

viewer_isolated_component_pages (
  component_id integer not null,
  page_id integer not null,
  primary key(component_id, page_id)
);

analysis_violations (
  id integer primary key,
  page_id integer not null,
  validator text not null,
  severity text not null,
  rule text not null,
  message_text_id integer not null,
  code_text_id integer
);
```

URL表示は返却時に `url_refs` へJOINする。JOIN対象はlimit後の100件に寄せる。

ディレクトリツリーは、URL pathをGET時にsplitしない。read model build時に `content_items -> url_refs` からpath segmentを切り出し、host/scopeごとに `viewer_directory_nodes` を作る。初期表示は `depth <= 3` を読むだけにし、未展開ディレクトリには `child_count = direct_child_dir_count + direct_page_count` を表示する。配下規模の表示には `descendant_page_count` を使う。

`viewer_directory_pages` は「そのディレクトリ直下のページ」だけを保持する。配下全ページ一覧が必要な場合は、nodeの `path_prefix_text_id` から `viewer_pages` のprefix profileへ接続する。ツリー展開そのものでは配下全ページを読まない。

例:

```sql
with ids as (
  select edge_id
  from viewer_anchor_facts
  where is_broken = 1
  order by page_id
  limit 100 offset 0
)
select
  source_url.url as source_url,
  dest_url.url as dest_url,
  d.status,
  e.count
from ids
join viewer_anchor_facts e on e.edge_id = ids.edge_id
join content_items s on s.id = e.page_id
join url_refs source_url on source_url.id = s.url_id
join content_items d on d.id = e.resolved_href_page_id
join url_refs dest_url on dest_url.id = d.url_id;
```

この形なら1000万行級のfactにURL文字列を複製しない。

### Write Model

crawl中に書く生データ層。重い派生集計はしない。

方針:

- URL重複判定に必要な unique index は維持する。
- crawl中の per-page write で summary や counts を更新しない。
- redirect解決、broken判定、in-degree、duplicate group、isolated component は crawl完了後にまとめて作る。
- 既存の巨大covering indexは、viewer read modelで置き換えて削除対象にする。

### Viewer Read Model

viewer の GET に直接効く派生テーブル。crawl完了後、append完了後、retry完了後に一括再構築する。

方針:

- 文字列を大量複製しない。
- 1000万行級テーブルでは ID と small flags / counts のみを持つ。
- URL, title, text などは返却する100件だけ生テーブルにJOINして取得する。
- wide table ではなく narrow fact/stat table にする。

## 構築タイミング

crawl中に viewer read model を逐次更新しない。

構築フロー:

1. crawl中は一時テーブルと保存用write modelだけを書く。
2. crawl終了時に `crawl_*` の一時観測を保存用write modelへ畳み込む。
3. `viewer_build_state(status='building')` を書く。
4. `viewer_*` テーブルを一括再構築する。
5. 成功時だけ `viewer_build_state(status='ready', source_revision=N)` にする。
6. append / retry-failed 後も全再構築する。

```sql
viewer_build_state (
  id integer primary key check (id = 1),
  status text not null,
  source_revision integer not null,
  built_at integer,
  error text
);
```

## 復元性仕様

新スキーマは、migration後に現行DB相当の情報を復元できることを要求する。

### URL / text / JSON / blob

- `url_refs.url` から現行のURL文字列を完全復元できる。
- `text_refs.text` から現行の短文文字列を完全復元できる。
- `json_refs` はdecode後に現行JSON文字列を完全復元できる。
- `blob_refs` はdecode後にdata URLなどのpayloadを完全復元できる。
- hashはlookup高速化と重複排除用であり、元値の代替ではない。元値本体を必ず保持する。

### Header

- `header_set_entries` から現行の `responseHeaders` JSON相当を復元できる。
- `stable_hash` は最適化用であり、復元単位には使わない。
- volatile headerも捨てずに `header_set_entries` に保持する。
- `header_flags` はviewer用派生情報なので、`header_set_entries` から再生成できる。

### Images

- `src` と `currentSrc` は別々に復元できる。
- `src` はHTML属性上の参照、`currentSrc` はBlinkが `srcset`, `sizes`, `<picture><source>...<img>` を評価した後に実際に選んだURLとして保持する。
- `sourceCode` は保存HTML + `dom_path_text_id` から復元する。
- migrationでは、既存 `images.sourceCode` と `dom_path` 復元 `outerHTML` の一致率を検証する。
- 復元不一致がある場合は、原因を分類する。スキーマ仕様は `dom_path` 復元を正とし、移行script側で不一致レポートを出す。

### Anchors

- `anchor_edges.count` は同一 `(page_id, href_page_id)` の観測数を保持する。
- `first_text_id` は代表表示用であり、viewerのリンク一覧で使う。
- 現行DBと完全同一のanchor instance列挙が必要な用途がある場合は、migration検証で差分を明示する。viewer仕様としてはedge/count/read modelを正とする。

### Viewer Read Model

- `viewer_*` はすべて派生テーブルであり、保存用write modelから再生成できる。
- `viewer_*` の再構築はarchive内容を破壊しない。
- build失敗時は `viewer_build_state(status='failed')` とし、保存用write modelは利用可能なまま残す。

## サイズ予算

許容ライン:

```text
+1GB前後: 良い
+2GB台: 性能改善と引き換えなら許容可能
+5GB以上: 設計ミス寄り
```

read model の予算感:

```text
viewer_summary:                         < 1MB
viewer_page_stats:                      50-150MB
viewer_resource_stats:                  50-200MB
viewer_anchor_facts + partial indexes:  0.8-1.8GB
duplicate/mismatch/isolation results:   10-300MB
```

合計目標:

```text
+1.0GB から +2.5GB
```

3層ref化を入れた場合は、read model追加だけを見るのではなく、既存write modelの削減も同時に見る。

削減期待:

```text
anchor_edges化:
  anchors 12.99M rows -> 9.75M edges
  row数で約25%削減

image URL/text ref化:
  images table 3.25GB と idx_images_covering 1.23GB が最大削減対象
  src/currentSrc/alt の参照化とsourceCode非保存で効果が大きい

header_sets:
  responseHeaders JSON の重複を削減
  /api/headers は header_flags だけで応答可能

content_type_refs:
  サイズ効果は小さいが filter/index を安定化

url_refs共有:
  pages/resources/images/anchors/meta URL列を統合
  unique URL indexの重複を避ける
```

ただし、read model導入で既存の巨大INDEXを削れるなら純増は下げられる。

削除対象:

```text
idx_images_covering:        1.23GB
idx_resources_internal_url: 0.60GB
一部 anchors/resource refs 用 index
```

## 実装フェーズ案

これは「重ければやる」順ではなく、理想DBを安全に作るための切り出し順である。最終形では全Phaseを実施する。

### Phase 0: ref化効果の確定計測

- `images.src`, `images.currentSrc`, `images.alt` のdistinct数と平均長を計測する。
- `sourceCode` は保存HTML + `dom_path` から復元できることをfixtureで検証する。
- `responseHeaders` のdistinct数と平均長を `pages` / `resources` で計測する。
- `contentType` のdistinct数を計測する。
- `anchors.textContent` のdistinct数と平均長を計測する。
- URL全体の重複を `pages.url`, `resources.url`, `images.src/currentSrc`, `anchors.hrefId` 経由で見積もる。
- 計測は設計の棄却条件ではなく、容量見積もりとINDEX予算を確定するために行う。

### Phase 1: 計測基盤

- 実DBに対して endpoint 別に SQL / EXPLAIN / 実行時間を出せる bench script を作る。
- `ANALYZE` は実行しない。
- `COUNT` と data fetch を分けて計測する。

### Phase 2: crawl一時層とURL辞書

- `crawl_url_seen` / `crawl_resource_seen` を導入する。
- `url_refs` を保存用write modelの中心に置く。
- `pages` / `resources` 相当のテーブルは `url_id` を参照する形にする。
- 既存コードからの移行は最後にし、新規crawlで正しいwrite pathを先に作る。
- `content_type_refs`, `header_sets`, `text_refs` もこの段階で作る。

### Phase 3: anchor/resource edge化

- `anchor_edges` を保存正本にする。
- `resource_ref_edges(count)` を保存正本にする。
- `viewer_anchor_facts`, `viewer_page_stats`, `viewer_resource_stats` を完了後ビルドで作る。
- `/api/page-links`, `/api/links`, `/api/unused-resources` を置き換える。

リンク・参照・未使用判定は、GET時に生edgeを探索しない。

### Phase 4: summary

- `viewer_summary`
- `viewer_error_kind_groups`
- `viewer_error_kind_hosts`
- `viewer_error_kind_samples`
- `/api/summary`, `/api/error-kinds` を置き換える

GETはほぼ1行SELECTになる。

### Phase 5: pages list

- `viewer_pages`
- `viewer_header_checks`
- `viewer_mismatches`
- `viewer_duplicate_groups`
- `viewer_duplicate_group_pages`
- `/api/pages`, `/api/headers`, `/api/mismatches`, `/api/duplicates` を置き換える

`idx_pages_listfilter` はviewer pages用の主indexではなくなる。残す場合はcrawler/resume/CLI query用途を根拠にする。

### 0.13 migration: isolated / graph

- `viewer_isolated_components`
- `viewer_isolated_component_pages`
- `viewer_graph_nodes`
- `viewer_graph_edges`
- `/api/isolated-pages`, `/api/isolated-clusters`, `/api/graph` を置き換える

connected component と graph edge は完了後ビルドで固定する。GETごとに再計算しない。

### Phase 7: images

- `image_items` の `src_url_id`, `current_src_url_id`, `alt_text_id`, `dom_path_text_id` 化を実施する。
- `viewer_image_flags` を導入する。
- `/api/images` を置き換える。
- `idx_images_covering` は削除対象にする。

`images` は最大テーブルなので、理想DBでは必ず対象に含める。

### Phase 8: analysis violations

- `analysis/violations` JSON file を `analysis_violations` テーブルへ移す。
- `message` と `code` は `text_refs` を参照する。
- `/api/violations` を置き換える。

## 注意点

- `viewer_anchor_facts` に URL文字列を入れない。1300万行級でURLを複製すると +5GB 以上になり得る。
- `viewer_images` に `page_url` を複製しない。911万行級なので危険。
- read modelは crawl中に逐次更新しない。write amplification と正しさの問題が大きい。
- 最初から差分更新を狙わない。全再構築で正しさと計測を優先する。
- 既存archive向け migration script は最後に作る。

## 結論

現在のDBは、crawlerの保存モデルとviewerの参照モデルを同じ正規化テーブルで兼用している。さらに、`anchors` や `images` にはDOM / resource観測のinstance粒度データが多く、40万コンテンツ級では保存サイズとviewer GET時の復元コストが同時に効いてくる。

作り直すなら、中心方針は次の3層。

```text
1. crawl中の一時テーブル
   - URL文字列や観測eventを扱いやすい形で一時保存

2. 保存用write model
   - url_refs / text_refs / header_sets などで強くref化
   - anchors/images/resourcesはinstanceではなくedge/ref中心に畳み込む

3. 保存用viewer read model
   - summary / stats / facts / diagnosticsを完了後ビルド
   - viewer GETを単純SELECT中心にする
```

40万コンテンツのcrawlが1週間かかる前提なら、crawl完了時に10分程度のread model構築を走らせるのは十分許容できる。その時間を使って、redirect解決、referrer count、resource unused判定、summary、duplicates、isolated componentsをまとめて作る。

この構造なら、read model追加分を管理しつつ、`anchor_edges` 化・image URL/text ref化・巨大covering index削減で純増を抑えられる。`/api/summary`, `/api/page-links`, `/api/links`, `/api/unused-resources` のような重いGETは単純SELECT中心にできる。
