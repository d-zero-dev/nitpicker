# Write Model Refactor Plan (Phase 6)

<!-- cspell:ignore dbstat pageid resourceid hrefid textcontent sourceCode outerhtml jsdom blake3 unscraped -->

## Purpose and Scope

Phase 6 refactors the write model — the permanent per-archive storage tables
(`pages`, `anchors`, `images`, `resources`, `resources-referrers`) — from a
flat, URL-as-string schema into a normalised, ref-table-based schema. This
eliminates the major sources of DB bloat identified in
`docs/viewer-db-redesign-plan.md` while preserving every observable fact
recorded during a crawl.

**This plan must not be executed until the viewer read model is stable in
production**, as defined by the Phase 1–5 acceptance criteria in
`docs/viewer-implementation-plan.md`. Phase 6 touches the write model that
the viewer read model builder reads from, and a stable read model test suite is
required as a correctness regression harness.

## Prerequisites

Before starting Phase 6:

1. All Phase 1–5 sub-issues are merged into `feature/impl-new-db`.
2. `buildViewerReadModel` passes its full test suite against a "real large
   archive" — defined as an archive with ≥ 100,000 pages and ≥ 5 GB total DB
   size (matching the scale of the reference archive documented in
   `docs/viewer-db-redesign-plan.md`).
3. Benchmark contract numbers (from `docs/viewer-implementation-plan.md`
   §Benchmark Contract) are recorded for all endpoint replacements.
4. The viewer read model schema version is frozen at its final Phase 5 value
   (no schema bumps during Phase 6).

## Current Write Model Inventory

Tables that Phase 6 restructures (source data):

| Table                 | Rows (real archive) |    Size | Notes                                                       |
| --------------------- | ------------------: | ------: | ----------------------------------------------------------- |
| `pages`               |             470,873 | 0.96 GB | 47 flat meta columns + `responseHeaders` JSON               |
| `anchors`             |          12,999,495 | 0.68 GB | instance-granularity; `distinct(pageId,hrefId)` = 9,746,369 |
| `images`              |           9,110,919 | 3.25 GB | `src`/`currentSrc`/`sourceCode` inline text                 |
| `resources`           |           1,079,321 | 1.38 GB | `url` text + `responseHeaders` JSON                         |
| `resources-referrers` |          10,472,109 | 0.16 GB | already `(resourceId,pageId)` unique                        |

Tables with no row-level data migration (FK declarations may still change in Phase 6-H):

| Table                 | Reason                                                        |
| --------------------- | ------------------------------------------------------------- |
| `info`                | Crawl config; no normalisation benefit                        |
| `page_errors`         | Scrape-failure log; `pageId` FK kept as-is                    |
| `crawl_errors`        | Crawler-level error log; no FK to pages                       |
| `page_tags`           | Wappalyzer data; `pageId` FK kept as-is                       |
| `page_jsonld`         | Raw JSON-LD payloads; `pageId` FK kept as-is                  |
| `inventory_runs`      | Audit log; no FK to pages                                     |
| `analysis_text_refs`  | Already ref-based; no change                                  |
| `analysis_violations` | Already ref-based; no change                                  |
| `page_html_blobs`     | Already content-addressable blob store                        |
| `page_html_ref`       | FK is `pages.id` → becomes `content_items.id` (same PK value) |

## Target Write Model Schema

The following tables replace the "source data" tables listed above. All
tables are created via `raw()` (same pattern as `page_html_blobs` in
`init-schema.ts`).

### Ref Tables

#### `url_refs` — Unified URL dictionary

```sql
url_refs (
  id      integer primary key,
  url     text not null unique,
  scheme  text,
  host    text,
  port    integer,
  path    text,
  query_hash blob,
  fragment   text
);
```

**Covers**: `pages.url`, `resources.url`, `images.src`, `images.currentSrc`,
`anchors` href resolution, and all URL-shaped meta columns (`canonical`,
`og_url`, `og_image`, `icon_href`, etc.).

`query_hash` is a 32-byte BLAKE3 of the raw query string. Storing query
strings inline would break the dedup goal for tracker URLs.

#### `content_type_refs` — Content-type dictionary

```sql
content_type_refs (
  id         integer primary key,
  raw        text not null unique,
  normalized text not null,
  category   text not null
);
```

**Covers**: `pages.contentType`, `resources.contentType`.

#### `text_refs` — Short text dictionary

```sql
text_refs (
  id   integer primary key,
  hash blob not null,
  text text not null,
  unique(hash, text)
);
```

`hash` is a 32-byte BLAKE3 of `text`.

**Covers**:

- `anchors.textContent` (216 MB total / 5.3 MB distinct → 97.5 % reduction)
- `images.alt`
- `dom_path` strings for `image_items`
- `page_meta` text-shaped columns (`title`, `description`, `keywords`,
  `robots_raw`, `og_title`, `og_description`, `twitter_title`,
  `twitter_description`)

`analysis_violations.message_text_id` / `.code_text_id` reference the
**separate** `analysis_text_refs` table (see §Tables with No Change); those are
**not** merged into `text_refs`. The two dictionaries use the same `(hash, text)`
shape but different ID sequences — merging them would require re-keying all
existing `analysis_violations` rows, which is out of scope.

Strings **not** ref-paged: `pages.lang`, `pages.dir`, `pages.charset`,
`pages.og_type`, `pages.twitter_card`, `pages.statusText` — these are
low-cardinality enums already under 20 bytes per row, so ref-table overhead
exceeds savings.

#### `json_refs` — Large JSON payload dictionary

```sql
json_refs (
  id         integer primary key,
  hash       blob not null unique,
  json_text  blob not null,
  codec      text not null,
  size_raw   integer not null,
  size_stored integer not null
);
```

`hash` is BLAKE3 of the raw (pre-compression) JSON bytes. `codec` is
`'zstd'` or `'none'`.

**Covers**: `pages.meta_extras` (302 MB total / 50 MB distinct → ~83 %
reduction after dedup + compression).

`page_jsonld.raw` is **not** moved here — JSON-LD payloads are already
stored per-page without dedup expectation, and the table FK pattern is
different (one `page_jsonld` row per script tag, not one per page).

#### `blob_refs` — Large binary payload dictionary

```sql
blob_refs (
  id         integer primary key,
  hash       blob not null unique,
  body       blob not null,
  codec      text not null,
  size_raw   integer not null,
  size_stored integer not null
);
```

Note: unlike `page_html_blobs` (which uses `WITHOUT ROWID` with `hash` as PK),
`blob_refs` uses a regular integer `id` PK so that `image_items.src_blob_id` /
`image_items.current_src_blob_id` can hold a plain FK integer. `WITHOUT ROWID`
is incompatible with auto-increment — the PK value would have to be supplied on
every INSERT — so a regular rowid table with a `unique` hash index is simpler.

**Covers**: `images.src` / `images.currentSrc` values that are `data:` URIs
(base64 or percent-encoded SVG). For the real archive, only 429 data-URL
images exist, but each is ~600 bytes; grouping them here avoids bloating
`url_refs` with non-URL payloads.

Threshold: strings whose `length > 512` **and** that begin with `data:` are
stored in `blob_refs`; everything else uses `url_refs`. 512 was chosen because
well-formed HTTP/HTTPS URLs virtually never exceed 512 characters in practice,
while the data URIs observed in the real archive average ~600 bytes — so 512
reliably routes all data URIs to `blob_refs` without misclassifying any URL.

### Header Tables

`responseHeaders` JSON is decomposed into five tables. This sidesteps the
per-row uniqueness problem: `Date`, `ETag`, `CF-Ray`, and similar volatile
headers prevent a raw-JSON hash dictionary from achieving meaningful dedup
(distinct ratio ≈ 99.4 % on the real archive). Decomposing by name/value
with a `stable_hash` ignoring volatile headers unlocks much higher dedup.

#### `header_name_refs`

```sql
header_name_refs (
  id   integer primary key,
  name text not null unique
);
```

#### `header_value_refs`

```sql
header_value_refs (
  id    integer primary key,
  hash  blob not null,
  value text not null,
  unique(hash, value)
);
```

`hash` is BLAKE3 of `value`.

#### `header_sets`

```sql
header_sets (
  id                   integer primary key,
  raw_json_hash        blob not null unique,
  raw_hash             blob not null unique,
  stable_hash          blob not null,
  volatile_hash        blob,
  entry_count          integer not null,
  stable_entry_count   integer not null
);
CREATE INDEX idx_header_sets_stable ON header_sets(stable_hash);
```

`raw_json_hash` is BLAKE3 of the **raw `responseHeaders` JSON string** exactly as
stored in `pages.responseHeaders` / `resources.responseHeaders`. This column
exists solely to look up the correct `header_sets.id` from the old tables during
migration (see §6-D-1), without calling any SQL function. It is not useful after
Phase 6-H and may be dropped in a later cleanup migration.
**TODO**: open a follow-up issue titled "drop `header_sets.raw_json_hash` after
Phase 6-H" after Phase 6-H is merged to `feature/impl-new-db`.

`raw_hash` is BLAKE3 of the sorted `name=value` pairs of **all** headers
(stable + volatile). Both `raw_hash` and `raw_json_hash` must be `unique` so
that a JS-side `UPSERT` can guarantee dedup (duplicate raw JSON strings produce
the same row, same PK).

`stable_hash` is BLAKE3 of the sorted `name=value` pairs of **stable**
headers only (see §Stable / Volatile Classification below).

#### `header_set_entries`

```sql
header_set_entries (
  header_set_id integer not null references header_sets(id),
  name_id       integer not null references header_name_refs(id),
  occurrence    integer not null,
  value_id      integer not null references header_value_refs(id),
  is_volatile   integer not null,
  primary key(header_set_id, name_id, occurrence)
) WITHOUT ROWID;
```

`occurrence` is the 1-based index among all entries sharing the same
`(header_set_id, name_id)` pair. HTTP allows a header name to appear multiple
times in one response (e.g., multiple `Set-Cookie` lines); the composite PK
`(header_set_id, name_id, occurrence)` preserves all values without truncation.

#### `header_flags`

```sql
header_flags (
  header_set_id              integer primary key,
  has_csp                    integer not null,
  has_x_frame_options        integer not null,
  has_x_content_type_options integer not null,
  has_hsts                   integer not null,
  has_referrer_policy        integer not null,
  has_permissions_policy     integer not null,
  has_set_cookie             integer not null,
  cache_policy               text
);
```

`has_*` flags are computed from the `LIKE` expressions already used by
`checkHeaders` / `headerPresenceExpression`, so the flag logic is not
duplicated.

##### Stable / Volatile Classification

**Stable** (included in `stable_hash`):

```
content-type, content-length, cache-control, content-security-policy,
x-frame-options, x-content-type-options, strict-transport-security,
referrer-policy, permissions-policy, server, vary, location
```

**Volatile** (excluded from `stable_hash`):

```
date, expires, last-modified, etag, age, via, x-cache, cf-ray,
x-request-id, set-cookie, server-timing, x-amz-request-id
```

All other headers not in either list are treated as stable.

### Core Entity Tables

#### `content_items` — Replaces `pages`

```sql
content_items (
  id               integer primary key,
  url_id           integer not null unique references url_refs(id),
  is_external      integer not null,
  scraped          integer not null,
  is_target        integer not null,
  status           integer,
  status_text      text,
  content_type_id  integer references content_type_refs(id),
  content_length   integer,
  header_set_id    integer references header_sets(id),
  redirect_dest_id integer references content_items(id),
  source           text not null,
  first_crawled_at integer,
  last_crawled_at  integer,
  crawl_order      integer,
  is_skipped       integer,
  skip_reason      text
);
CREATE INDEX idx_content_items_url ON content_items(url_id);
CREATE INDEX idx_content_items_external ON content_items(is_external);
CREATE INDEX idx_content_items_scraped ON content_items(scraped);
```

`content_items.id` uses the **same PK values** as `pages.id` — the migration
inserts rows with explicit IDs, not autoincrement. This preserves all existing
FK references in `page_errors`, `page_tags`, `page_jsonld`, and `page_html_ref`
without any FK update.

#### `page_meta` — Page-specific metadata (split from `pages`)

```sql
page_meta (
  page_id                   integer primary key references content_items(id),
  lang                      text,
  dir                       text,
  charset                   text,
  base_href                 text,
  viewport_raw              text,
  theme_color               text,
  application_name          text,
  author                    text,
  generator                 text,
  publisher                 text,
  title_text_id             integer references text_refs(id),
  description_text_id       integer references text_refs(id),
  keywords_text_id          integer references text_refs(id),
  robots_raw_text_id        integer references text_refs(id),
  robots_noindex            integer,
  robots_nofollow           integer,
  robots_noarchive          integer,
  robots_noimageindex       integer,
  googlebot                 text,
  canonical_url_id          integer references url_refs(id),
  amphtml_url_id            integer references url_refs(id),
  manifest_url_id           integer references url_refs(id),
  icon_url_id               integer references url_refs(id),
  apple_touch_icon_url_id   integer references url_refs(id),
  og_type                   text,
  og_title_text_id          integer references text_refs(id),
  og_description_text_id    integer references text_refs(id),
  og_url_id                 integer references url_refs(id),
  og_image_url_id           integer references url_refs(id),
  og_site_name              text,
  og_image_alt              text,
  og_image_width            text,
  og_image_height           text,
  og_locale                 text,
  og_article_published_time text,
  og_article_modified_time  text,
  twitter_card              text,
  twitter_site              text,
  twitter_creator           text,
  twitter_title_text_id     integer references text_refs(id),
  twitter_description_text_id integer references text_refs(id),
  twitter_image_url_id      integer references url_refs(id),
  fb_app_id                 text,
  verification_google       text,
  format_detection_telephone integer,
  tag_count                 integer,
  jsonld_count              integer,
  tags_providers_csv        text,
  meta_extras_json_id       integer references json_refs(id)
);
```

Denormalised aggregates (`tag_count`, `jsonld_count`, `tags_providers_csv`)
are preserved on `page_meta` unchanged — they are written at crawl time by
`compute-page-denormalized.ts` and must remain quickly accessible for
`viewer_pages` build and Sheets reports.

#### `resource_items` — Replaces `resources`

```sql
resource_items (
  id               integer primary key,
  url_id           integer not null unique references url_refs(id),
  is_external      integer not null,
  status           integer,
  status_text      text,
  content_type_id  integer references content_type_refs(id),
  content_length   integer,
  header_set_id    integer references header_sets(id),
  compress         text,
  cdn              text,
  source           text not null
);
```

`resource_items.id` uses the **same PK values** as `resources.id` —
preserving FKs in `resources-referrers` (→ `resource_ref_edges`) and the
`viewer_resource_stats` build path.

### Edge Tables

#### `anchor_edges` — Normalised `anchors`

```sql
anchor_edges (
  id              integer primary key,
  page_id         integer not null references content_items(id),
  href_page_id    integer not null references content_items(id),
  count           integer not null,
  first_hash      text,
  first_text_id   integer references text_refs(id),
  unique(page_id, href_page_id)
);
CREATE INDEX idx_anchor_edges_page ON anchor_edges(page_id);
CREATE INDEX idx_anchor_edges_href ON anchor_edges(href_page_id);
```

**Dedup strategy**: all `anchors` rows sharing the same `(pageId, hrefId)` pair
are collapsed into one `anchor_edges` row. `count` records how many instances
were observed. `first_hash` and `first_text_id` capture the hash/textContent
of the **first** instance encountered (lowest `anchors.id` for that pair).
This reduces 12,999,495 rows → 9,746,369 rows (≈ 25 % reduction).

#### `resource_ref_edges` — Replaces `resources-referrers`

```sql
resource_ref_edges (
  resource_id integer not null references resource_items(id),
  page_id     integer not null references content_items(id),
  count       integer not null default 1,
  primary key(resource_id, page_id)
) WITHOUT ROWID;
```

`resources-referrers` is already `(resourceId, pageId)` unique, so this is a
structural rename with an added `count` column.

### `image_items` — Replaces `images`

```sql
image_items (
  id                  integer primary key,
  page_id             integer not null references content_items(id),
  src_url_id          integer references url_refs(id),
  current_src_url_id  integer references url_refs(id),
  src_blob_id         integer references blob_refs(id),
  current_src_blob_id integer references blob_refs(id),
  alt_text_id         integer references text_refs(id),
  width               real,
  height              real,
  natural_width       integer,
  natural_height      integer,
  is_lazy             integer,
  viewport_width      integer,
  dom_path_text_id    integer not null references text_refs(id)
);
CREATE INDEX idx_image_items_page ON image_items(page_id);
```

`image_items.id` uses the **same PK values** as `images.id`.

---

## Data Preservation

### Column-by-Column Mapping

#### `pages` → `content_items` + `page_meta`

| `pages` column              | Target                                                  |
| --------------------------- | ------------------------------------------------------- |
| `id`                        | `content_items.id` (same value)                         |
| `url`                       | `content_items.url_id` → `url_refs`                     |
| `redirectDestId`            | `content_items.redirect_dest_id`                        |
| `scraped`                   | `content_items.scraped`                                 |
| `isTarget`                  | `content_items.is_target`                               |
| `isExternal`                | `content_items.is_external`                             |
| `status`                    | `content_items.status`                                  |
| `statusText`                | `content_items.status_text`                             |
| `contentType`               | `content_items.content_type_id` → `content_type_refs`   |
| `contentLength`             | `content_items.content_length`                          |
| `responseHeaders`           | `content_items.header_set_id` → `header_sets` + entries |
| `firstCrawledAt`            | `content_items.first_crawled_at`                        |
| `lastCrawledAt`             | `content_items.last_crawled_at`                         |
| `order`                     | `content_items.crawl_order`                             |
| `isSkipped`                 | `content_items.is_skipped`                              |
| `skipReason`                | `content_items.skip_reason`                             |
| `source`                    | `content_items.source`                                  |
| `lang`                      | `page_meta.lang`                                        |
| `dir`                       | `page_meta.dir`                                         |
| `charset`                   | `page_meta.charset`                                     |
| `baseHref`                  | `page_meta.base_href`                                   |
| `viewport_raw`              | `page_meta.viewport_raw`                                |
| `themeColor`                | `page_meta.theme_color`                                 |
| `applicationName`           | `page_meta.application_name`                            |
| `author`                    | `page_meta.author`                                      |
| `generator`                 | `page_meta.generator`                                   |
| `publisher`                 | `page_meta.publisher`                                   |
| `title`                     | `page_meta.title_text_id` → `text_refs`                 |
| `description`               | `page_meta.description_text_id` → `text_refs`           |
| `keywords`                  | `page_meta.keywords_text_id` → `text_refs`              |
| `robots_raw`                | `page_meta.robots_raw_text_id` → `text_refs`            |
| `robots_noindex`            | `page_meta.robots_noindex`                              |
| `robots_nofollow`           | `page_meta.robots_nofollow`                             |
| `robots_noarchive`          | `page_meta.robots_noarchive`                            |
| `robots_noimageindex`       | `page_meta.robots_noimageindex`                         |
| `googlebot`                 | `page_meta.googlebot`                                   |
| `canonical`                 | `page_meta.canonical_url_id` → `url_refs`               |
| `amphtml`                   | `page_meta.amphtml_url_id` → `url_refs`                 |
| `manifest`                  | `page_meta.manifest_url_id` → `url_refs`                |
| `icon_href`                 | `page_meta.icon_url_id` → `url_refs`                    |
| `appleTouchIcon_href`       | `page_meta.apple_touch_icon_url_id` → `url_refs`        |
| `og_type`                   | `page_meta.og_type`                                     |
| `og_title`                  | `page_meta.og_title_text_id` → `text_refs`              |
| `og_description`            | `page_meta.og_description_text_id` → `text_refs`        |
| `og_url`                    | `page_meta.og_url_id` → `url_refs`                      |
| `og_site_name`              | `page_meta.og_site_name`                                |
| `og_image`                  | `page_meta.og_image_url_id` → `url_refs`                |
| `og_image_alt`              | `page_meta.og_image_alt`                                |
| `og_image_width`            | `page_meta.og_image_width`                              |
| `og_image_height`           | `page_meta.og_image_height`                             |
| `og_locale`                 | `page_meta.og_locale`                                   |
| `og_article_published_time` | `page_meta.og_article_published_time`                   |
| `og_article_modified_time`  | `page_meta.og_article_modified_time`                    |
| `twitter_card`              | `page_meta.twitter_card`                                |
| `twitter_site`              | `page_meta.twitter_site`                                |
| `twitter_creator`           | `page_meta.twitter_creator`                             |
| `twitter_title`             | `page_meta.twitter_title_text_id` → `text_refs`         |
| `twitter_description`       | `page_meta.twitter_description_text_id` → `text_refs`   |
| `twitter_image`             | `page_meta.twitter_image_url_id` → `url_refs`           |
| `fb_app_id`                 | `page_meta.fb_app_id`                                   |
| `verification_google`       | `page_meta.verification_google`                         |
| `formatDetection_telephone` | `page_meta.format_detection_telephone`                  |
| `tag_count`                 | `page_meta.tag_count`                                   |
| `jsonld_count`              | `page_meta.jsonld_count`                                |
| `tags_providers_csv`        | `page_meta.tags_providers_csv`                          |
| `meta_extras`               | `page_meta.meta_extras_json_id` → `json_refs`           |

#### `anchors` → `anchor_edges`

| `anchors` column   | Target                                                               |
| ------------------ | -------------------------------------------------------------------- |
| `pageId`           | `anchor_edges.page_id`                                               |
| `hrefId`           | `anchor_edges.href_page_id`                                          |
| `hash`             | `anchor_edges.first_hash` (first instance per pair)                  |
| `textContent`      | `anchor_edges.first_text_id` → `text_refs` (first instance per pair) |
| _(instance count)_ | `anchor_edges.count` (aggregated)                                    |

Duplicate instances (same `pageId+hrefId`, different `hash`/`textContent`) are
collapsed. The `count` and `first_*` fields allow reconstruction of the most
important observable fact (how many times a link appeared and what text it used
on first occurrence) without preserving every redundant row.

#### `images` → `image_items`

| `images` column         | Target                                          |
| ----------------------- | ----------------------------------------------- |
| `id`                    | `image_items.id` (same value)                   |
| `pageId`                | `image_items.page_id`                           |
| `src` (URL)             | `image_items.src_url_id` → `url_refs`           |
| `src` (data URI)        | `image_items.src_blob_id` → `blob_refs`         |
| `currentSrc` (URL)      | `image_items.current_src_url_id` → `url_refs`   |
| `currentSrc` (data URI) | `image_items.current_src_blob_id` → `blob_refs` |
| `alt`                   | `image_items.alt_text_id` → `text_refs`         |
| `width`                 | `image_items.width`                             |
| `height`                | `image_items.height`                            |
| `naturalWidth`          | `image_items.natural_width`                     |
| `naturalHeight`         | `image_items.natural_height`                    |
| `isLazy`                | `image_items.is_lazy`                           |
| `viewportWidth`         | `image_items.viewport_width`                    |
| `sourceCode`            | _not preserved — see §dom_path Derivation_      |

#### `resources` → `resource_items`

| `resources` column | Target                                                   |
| ------------------ | -------------------------------------------------------- |
| `id`               | `resource_items.id` (same value)                         |
| `url`              | `resource_items.url_id` → `url_refs`                     |
| `isExternal`       | `resource_items.is_external`                             |
| `status`           | `resource_items.status`                                  |
| `statusText`       | `resource_items.status_text`                             |
| `contentType`      | `resource_items.content_type_id` → `content_type_refs`   |
| `contentLength`    | `resource_items.content_length`                          |
| `responseHeaders`  | `resource_items.header_set_id` → `header_sets` + entries |
| `compress`         | `resource_items.compress`                                |
| `cdn`              | `resource_items.cdn`                                     |
| `source`           | `resource_items.source`                                  |

#### `resources-referrers` → `resource_ref_edges`

| `resources-referrers` column | Target                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `resourceId`                 | `resource_ref_edges.resource_id`                                                 |
| `pageId`                     | `resource_ref_edges.page_id`                                                     |
| _(count = 1)_                | `resource_ref_edges.count` (always 1 on migration; future crawls may accumulate) |

---

## Special Migration Cases

### image `src` / `currentSrc` — URL vs `blob_refs` Routing

Classification rule (deterministic, applied at migration time and in the new
crawl write path):

```
if value.startsWith('data:') and value.length > 512:
  → blob_refs  (src_blob_id / current_src_blob_id)
else:
  → url_refs   (src_url_id / current_src_url_id)
```

A value cannot occupy both slots simultaneously. Either `*_url_id` or
`*_blob_id` is non-null for a given image; the other is null.

For the real archive, only 429 data-URL images exist, so almost all rows will
use `url_refs`.

### `dom_path` Derivation from `sourceCode`

`images.sourceCode` stores the `outerHTML` of the `<img>` element (e.g.
`<img src="…" alt="…" loading="lazy">`). The new `image_items` schema
replaces this with `dom_path_text_id` — a reference to a stable DOM position
string such as `html/body[1]/main[1]/section[2]/picture[1]/img[1]`.

#### New Crawl Path

During Phase 6, `@d-zero/beholder` must be updated (or wrapped) to capture
`dom_path` alongside each image record. The `dom_path` computation walks
the DOM ancestor chain from the `<img>` element to `<html>`, outputting each
element's tag name and 1-based sibling ordinal (same-tag siblings only, no
class or id dependency).

**beholder update vs wrapper decision**: prefer an upstream beholder PR that
adds `dom_path` to the image metadata object. If the upstream PR is not merged
by the time Phase 6-G implementation begins, implement a thin wrapper in
`@nitpicker/crawler` that computes `dom_path` by re-traversing the DOM after
`beholder.scrape()` returns. Record the chosen path in the Phase 6-G PR
description.

`sourceCode` is **not stored** in `image_items`. To reconstruct the outerHTML
of any image for display, callers use `dom_path` to re-locate the `<img>` in
the archived HTML snapshot via jsdom or a similar DOM parser.

#### Migration of Existing Archives

For existing `.nitpicker` archives, `dom_path` must be reconstructed
from `images.sourceCode` and the HTML snapshot (`page_html_blobs`):

1. For each page with images, decompress and parse the HTML blob with jsdom.
2. Collect all `<img>` elements in document order; compute each one's
   `dom_path` string.
3. Match each `images` row (same `pageId`) to a `<img>` element by comparing
   `images.sourceCode` (outerHTML) to `element.outerHTML`.
4. If exactly one match: assign its `dom_path`.
5. If multiple matches (identical outerHTML on the same page): assign
   `dom_path` values in the order the images rows appear by `images.id`
   (crawler insertion order is expected to correspond to DOM order).
6. If no match (sourceCode is null, or HTML blob is absent): assign a
   synthetic `dom_path` of the form `unknown/<images.id>`.

**Limitation**: step 5 is a best-effort heuristic. Mismatches can occur if
the crawler's insertion order diverges from DOM order. This is acceptable
under the v0.x breaking-change policy.

The migration script must record a warning log for every `unknown/*` fallback
so operators can audit reconstruction fidelity.

### Header Set Decomposition

`pages.responseHeaders` and `resources.responseHeaders` are stored as
`JSON.stringify`d `Record<string, string>` objects.

Migration algorithm per row:

1. Parse the JSON string. If null or `'{}'`, set `header_set_id = null`.
2. Separate entries into stable and volatile using the classification list
   above.
3. Compute `stable_hash = BLAKE3(sorted_stable_entries)` and
   `raw_hash = BLAKE3(sorted_all_entries)`.
4. Upsert into `header_sets` on `raw_hash`; if already present, reuse the
   existing `id`.
5. For each header name: upsert into `header_name_refs`; get `name_id`.
6. For each header value: compute `value_hash = BLAKE3(value)`; upsert into
   `header_value_refs` on `(hash, value)`; get `value_id`.
7. Insert into `header_set_entries` for each `(header_set_id, name_id,
value_id, is_volatile)` — skip if `header_set_id` already has entries (the
   upsert in step 4 may return an existing id).
8. Compute `has_*` flags using the same `LIKE` predicates `checkHeaders`
   uses; insert into `header_flags`.

The `pages.responseHeaders` distinct-to-total ratio is very low (99.4 %
distinct), meaning almost every row has a unique raw JSON string. After
volatile-header exclusion, the `stable_hash` dedup ratio is expected to
improve significantly for CDN-served pages (consistent `content-type`,
`cache-control`, `x-frame-options` etc. across all assets).

### Anchor Normalization

`anchor_edges` is populated in a **single JS keyset scan** over `anchors ORDER
BY pageId, hrefId, id`. The scan groups consecutive rows with the same
`(pageId, hrefId)` in JS memory, using the **first row encountered** (lowest
`anchors.id`) as the source of `first_hash` and `first_text_id`.

This is important: `min(hash) GROUP BY pageId, hrefId` would select the
lexicographically smallest BLAKE3 hex string, which is uniformly distributed
and will almost never correspond to the first-inserted row. The JS scan avoids
this by relying on the sort order `ORDER BY pageId, hrefId, id`.

Pseudocode:

```
current_pair = null
current_count = 0
current_first = null

FOR EACH anchor row (ordered by pageId, hrefId, id):
  pair = (pageId, hrefId)
  IF pair != current_pair:
    IF current_pair != null:
      EMIT anchor_edge(current_pair, current_count, current_first)
    current_pair = pair
    current_count = 1
    current_first = { hash, textContent }
  ELSE:
    current_count += 1

EMIT last anchor_edge

-- Resolve first_text_id from text_refs for each emitted first_textContent
```

After all groups are emitted, `first_text_id` is resolved by batch-looking up
`text_refs.id WHERE text_refs.text = first_textContent` for each edge row
(using the existing `(hash, text)` UNIQUE index — **not** the `unique(hash, text)`
composite's trailing column, which would cause a full scan; the JS code provides
the hash to enable a prefix-seek).

`anchor_edges.id` is assigned in JS as a sequential counter (same pattern as
`viewer_directory_nodes.node_id` in the viewer read model builder).

---

## Migration Strategy

Migration is performed by a standalone script `scripts/migrate-to-phase6.mjs`,
analogous to `scripts/migrate-to-0.10.mjs`. The `.nitpicker` archive is
first extracted (or opened in-place against a writable connection), then
all steps run in a single long WAL transaction. A `.bak` copy is created
before any writes begin; on failure the `.bak` is restored automatically.

### Phase 6-A: Add Ref Tables (additive, non-breaking)

Create all ref tables and header tables without touching existing tables.
After this step, both old and new tables coexist. Existing readers are
unaffected.

**Tables created**: `url_refs`, `content_type_refs`, `text_refs`, `json_refs`,
`blob_refs`, `header_name_refs`, `header_value_refs`, `header_sets`,
`header_set_entries`, `header_flags`.

### Phase 6-B: Populate Ref Tables

#### 6-B-0: Populate `content_type_refs`

```sql
INSERT OR IGNORE INTO content_type_refs(raw, normalized, category)
SELECT DISTINCT contentType, ..., ... FROM pages WHERE contentType IS NOT NULL
UNION
SELECT DISTINCT contentType, ..., ... FROM resources WHERE contentType IS NOT NULL;
```

`normalized` and `category` are derived from `contentType` using the same
`classifyContentType` logic already used by the viewer read model builder.
This step must run before 6-D-1 and 6-D-3 (which JOIN `content_type_refs`).

#### 6-B-1: Populate `url_refs`

```sql
INSERT OR IGNORE INTO url_refs(url)
SELECT url FROM pages
UNION ALL
SELECT url FROM resources
UNION ALL
SELECT src FROM images WHERE src NOT LIKE 'data:%' OR length(src) <= 512
UNION ALL
SELECT currentSrc FROM images
  WHERE currentSrc IS NOT NULL
    AND (currentSrc NOT LIKE 'data:%' OR length(currentSrc) <= 512)
-- plus URL meta columns from pages (canonical, og_url, og_image, icon_href, etc.)
UNION ALL
SELECT canonical FROM pages WHERE canonical IS NOT NULL
UNION ALL
SELECT og_url FROM pages WHERE og_url IS NOT NULL
UNION ALL
SELECT og_image FROM pages WHERE og_image IS NOT NULL
UNION ALL
SELECT icon_href FROM pages WHERE icon_href IS NOT NULL
UNION ALL
SELECT appleTouchIcon_href FROM pages WHERE appleTouchIcon_href IS NOT NULL
UNION ALL
SELECT amphtml FROM pages WHERE amphtml IS NOT NULL
UNION ALL
SELECT manifest FROM pages WHERE manifest IS NOT NULL
UNION ALL
SELECT twitter_image FROM pages WHERE twitter_image IS NOT NULL;
```

`scheme`, `host`, `port`, `path`, `fragment` are extracted in JS from each
`url` value using `new URL(url)` and bulk-updated after the URL insert.

#### 6-B-2: Populate `text_refs`

Anchor text, image alt, and page meta text columns are harvested and inserted
(BLAKE3 hash, text) with dedup:

```sql
INSERT OR IGNORE INTO text_refs(hash, text) SELECT ...; -- anchors.textContent
INSERT OR IGNORE INTO text_refs(hash, text) SELECT ...; -- images.alt
INSERT OR IGNORE INTO text_refs(hash, text) SELECT ...; -- pages.title, description, etc.
```

All implemented as chunked JS inserts (same keyset pagination pattern as
`computeAnchorFactRows`'s chunk strategy in PR #172).

#### 6-B-3: Populate `json_refs`

```sql
INSERT OR IGNORE INTO json_refs(hash, json_text, codec, size_raw, size_stored)
SELECT ... FROM pages WHERE meta_extras IS NOT NULL;
```

Each `meta_extras` value is BLAKE3-hashed and zstd-compressed; dedup by hash.

#### 6-B-4: Populate `blob_refs`

```sql
INSERT OR IGNORE INTO blob_refs(hash, body, codec, size_raw, size_stored)
SELECT ... FROM images
WHERE (src LIKE 'data:%' AND length(src) > 512)
   OR (currentSrc LIKE 'data:%' AND length(currentSrc) > 512);
```

Each data URI is stripped of the `data:…;base64,` prefix, decoded, and
stored as a zstd-compressed BLOB.

#### 6-B-5: Populate Header Tables

Process all `pages.responseHeaders` and `resources.responseHeaders` rows using
the decomposition algorithm from §Header Set Decomposition.

All hash values (`raw_json_hash`, `raw_hash`, `stable_hash`, value hashes) are
computed in **JS** (via a BLAKE3 library) before any SQL INSERT — SQLite has no
built-in BLAKE3 function. The migration script maintains an in-process
`Map<rawJsonString, headerSetId>` so that each unique raw JSON string triggers
at most one INSERT per unique set. The `raw_json_hash` column stores the BLAKE3
of the raw `responseHeaders` JSON string exactly as stored in the old table,
enabling the Phase 6-D-1 lookup without any SQL function call.

### Phase 6-C: Add New Entity Tables

Create `content_items`, `page_meta`, `resource_items`, `anchor_edges`,
`resource_ref_edges`, `image_items`.

### Phase 6-D: Populate New Entity Tables

#### 6-D-1: Populate `content_items` from `pages`

This step is implemented as a **chunked JS keyset scan** over `pages` (same
pattern as `computeAnchorFactRows` in PR #172). For each page chunk, JS:

1. Looks up `url_refs.id` and `content_type_refs.id` via batch SELECTs.
2. Looks up `header_sets.id` via `header_sets.raw_json_hash`, which was
   stored in Phase 6-B-5 as `BLAKE3(p.responseHeaders_json_string)`. The
   hash is re-computed in JS (not in SQL) before the lookup.
3. Bulk-INSERTs the assembled rows into `content_items`.

No `blake3()` SQL function is called — SQLite has no such built-in. All BLAKE3
computation happens in JS using a BLAKE3 library (e.g. `@noble/hashes/blake3`)
before any SQL statement is issued.

```
-- Conceptual structure (implemented in JS, not as a single SQL statement):
FOR EACH chunk of pages (keyset paginated by id):
  resolve url_refs.id batch
  resolve content_type_refs.id batch
  resolve header_sets.id via BLAKE3(responseHeaders) → raw_json_hash lookup
  INSERT INTO content_items (id, url_id, ..., header_set_id, ...) VALUES (...)
```

#### 6-D-2: Populate `page_meta` from `pages`

Chunked keyset scan over `pages WHERE scraped = 1` only — unscraped pages
have no metadata to populate. For each chunk, resolve text_ref IDs and
url_ref IDs via batch joins, then bulk INSERT into `page_meta`. Phase 6-E
check #2 verifies the resulting `page_meta` row count equals
`pages WHERE scraped = 1`.

#### 6-D-3: Populate `resource_items` from `resources`

Analogous to `content_items` population.

#### 6-D-4: Populate `anchor_edges` from `anchors`

Single-pass `GROUP BY pageId, hrefId`; back-fill `first_text_id` in second
pass (see §Anchor Normalization).

#### 6-D-5: Populate `resource_ref_edges` from `resources-referrers`

```sql
INSERT INTO resource_ref_edges(resource_id, page_id, count)
SELECT resourceId, pageId, 1
FROM "resources-referrers";
```

#### 6-D-6: Populate `image_items` from `images`

Chunked keyset scan. For each image, route `src`/`currentSrc` to `url_refs`
or `blob_refs` per the data-URI threshold rule. `dom_path_text_id` is
resolved via the dom_path derivation algorithm (see §dom_path Derivation).

### Phase 6-E: Data Verification

Before dropping old tables, verify row counts and spot-check key invariants:

1. `SELECT count(*) FROM content_items` = `SELECT count(*) FROM pages`
2. `SELECT count(*) FROM page_meta WHERE page_id IN (SELECT id FROM content_items)`
   = `SELECT count(*) FROM pages WHERE scraped = 1`
   (all scraped pages must have a corresponding `page_meta` row)
3. `SELECT count(*) FROM anchor_edges` must be greater than 0
   AND less than `SELECT count(*) FROM anchors`
   (dedup must reduce, not eliminate)
4. `SELECT SUM(count) FROM anchor_edges` = `SELECT count(*) FROM anchors`
5. `SELECT count(*) FROM image_items` = `SELECT count(*) FROM images`
6. `SELECT count(*) FROM resource_items` = `SELECT count(*) FROM resources`
7. `SELECT count(*) FROM content_items WHERE content_type_id IS NULL AND contentType IS NOT NULL` = 0
   (no page should lose its content type; join against old `pages` to cross-check)
8. Round-trip check: re-derive `pages.url` from `content_items.url_id` and
   compare against a random 1,000-row sample of `pages`. This is a **smoke
   test**, not statistical coverage: 1,000 samples from ~470 K rows covers only
   ~0.2 %, but URL normalisation bugs tend to be systematic (all rows with a
   particular scheme or host), so a random sample of this size catches them
   reliably. If a stricter guarantee is required, increase the sample or run a
   full table scan before Phase 6-H.

Any mismatch aborts the migration and triggers `.bak` restore.

### Phase 6-F: Update Reader Code

Update all consumer code paths to read from new tables **before** dropping old
tables. This allows A/B verification by comparing old-table vs new-table
results.

Affected packages (read paths only — no format changes to outputs):

| Package                                        | Reads from                                                       | Change                                                                                                                                                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nitpicker/query`                             | `pages`, `anchors`, `images`, `resources`, `resources-referrers` | Replace all reads with joins through ref tables                                                                                                                                                                                 |
| `@nitpicker/query` (viewer read model builder) | Same                                                             | `compute-anchor-fact-rows.ts`, `compute-resource-rows.ts`, `compute-image-insert-rows.ts`, `build-directory-tree-rows.ts`, `compute-header-check-insert-rows.ts`, `compute-duplicate-group-rows.ts`, `compute-mismatch-rows.ts` |
| `@nitpicker/query` — `get-violations.ts`       | `pages` (via JOIN for `p.url`)                                   | Replace `JOIN pages as p` with `JOIN content_items as p JOIN url_refs as ur ON ur.id = p.url_id`                                                                                                                                |
| `@nitpicker/query` — `read-page-errors.ts`     | `pages` (for `pageId` FK)                                        | Update any `pages`-alias JOINs to `content_items`                                                                                                                                                                               |
| `@nitpicker/query` — `header-presence-sql.ts`  | Hardcoded `"pages"."responseHeaders"` string                     | Parameterise the table/column alias so callers can pass `content_items` + `header_set_id`; after Phase 6-H `responseHeaders` no longer exists and `header_flags` pre-computed booleans should be used instead                   |
| `@nitpicker/crawler` (archive reader)          | `pages`, `anchors`, `images`, `resources`, `resources-referrers` | `database.ts` query helpers                                                                                                                                                                                                     |
| `@nitpicker/mcp-server`                        | via `@nitpicker/query`                                           | No direct SQL; inherits changes                                                                                                                                                                                                 |
| `@nitpicker/cli`                               | via `@nitpicker/query`                                           | No direct SQL                                                                                                                                                                                                                   |
| `@nitpicker/viewer`                            | via `@nitpicker/query`                                           | No direct SQL                                                                                                                                                                                                                   |

**Viewer read model output tables are not changed** (`viewer_pages`,
`viewer_anchor_facts`, etc.). The viewer frontend is unaffected.

### Phase 6-G: Update Crawler Write Path

Once all reader paths are verified against new tables, update the crawler's
write path (`@nitpicker/crawler`) to write directly to the new tables instead
of the old ones. This is the final behavioural change:

- `archive/database.ts` — replace `setPage`, `setAnchor`, `setImage`,
  `setResource`, `setResourceRef` to target new tables.
- During crawl, URL strings are inserted into `url_refs` on every page
  encounter; the `id` is cached in-process to avoid repeated lookups.
- `dom_path` is captured directly from `@d-zero/beholder`'s image metadata
  (requires beholder API change).
- Header decomposition runs per-response (not deferred to crawl-end) to
  populate `header_sets` incrementally.

### Phase 6-H: Drop Old Tables and Update FK References

Five tables have FK columns pointing at `pages(id)` that **must** be
re-created with `REFERENCES content_items(id)` before `pages` is dropped.
SQLite does not support `ALTER TABLE … DROP CONSTRAINT`, so re-creation uses
the rename-copy-drop pattern:

| Table                 | Column                                           | Action                                                         |
| --------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `page_html_ref`       | `page_id REFERENCES pages(id) ON DELETE CASCADE` | Recreate with `REFERENCES content_items(id) ON DELETE CASCADE` |
| `page_tags`           | `pageId REFERENCES pages.id`                     | Recreate with `REFERENCES content_items(id)`                   |
| `page_jsonld`         | `pageId REFERENCES pages.id`                     | Recreate with `REFERENCES content_items(id)`                   |
| `page_errors`         | `pageId REFERENCES pages(id)`                    | Recreate with `REFERENCES content_items(id)`                   |
| `analysis_violations` | `page_id REFERENCES pages(id)`                   | Recreate with `REFERENCES content_items(id)`                   |

Each table is re-created by:

1. `CREATE TABLE <tbl>_new (…) WITH REFERENCES content_items(id)`
2. `INSERT INTO <tbl>_new SELECT * FROM <tbl>`
3. `DROP TABLE <tbl>`
4. `ALTER TABLE <tbl>_new RENAME TO <tbl>`

All five re-creations run inside the same transaction as the DROP TABLE
statements. After this step:

```sql
DROP TABLE images;
DROP TABLE anchors;
DROP TABLE "resources-referrers";
DROP TABLE resources;
DROP TABLE pages;
```

`PRAGMA foreign_keys = ON` (applied by `applyConnectionPragmas`) will then
enforce the correct FKs on all future writes.

Additionally, add `info.phase6_completed_at` (ISO string) to the `info` row so
`assertCompatibleVersion` can emit a helpful error when a pre-Phase-6 CLI
opens a Phase-6 archive.

---

## Crawl Write Performance Analysis

### Concern

Phase 6 adds per-entity ref-table lookups to the write path. Every page, anchor,
image, and resource insertion requires at least one `url_refs` upsert before the
main row INSERT.

### Mitigation: In-Process ID Cache

The crawler's `Database` class maintains an in-process `Map<url, urlRefId>` cache
populated during the crawl. On a cache hit (the URL was seen before), no SQL is
issued. On a cache miss, the following upsert pattern must be used:

```sql
INSERT INTO url_refs(url) VALUES (?)
ON CONFLICT(url) DO UPDATE SET url = url
RETURNING id;
```

`DO UPDATE SET url = url` is a no-op update that causes `RETURNING id` to return
the existing row's `id` even on conflict. `INSERT OR IGNORE ... RETURNING id`
**must not** be used: `RETURNING` returns zero rows when the insert is ignored,
leaving the cache with no id and the FK column as null on the next INSERT.

Expected cache hit rate is very high for `anchor_edges` (many pages link to the
same URL) and for `images` (CDN-hosted assets repeat across thousands of pages).
For `pages.url` the hit rate is 100 % (each URL is processed exactly once).

### Header Table Write Cost

Header set decomposition is the most write-intensive addition: each scraped page
or resource emits potentially N header rows. However:

- Headers are not written per anchor or per image — only once per page/resource.
- `header_name_refs` has very low cardinality (fewer than 200 known HTTP header names).
- `header_value_refs` dedup by BLAKE3 hash avoids duplicate large values.
- WAL mode handles concurrent readers during crawl without blocking.

### Anchor Write Path

`anchor_edges` uses a plain upsert per anchor, no separate count query needed:

```sql
INSERT INTO anchor_edges(page_id, href_page_id, count, first_hash, first_text_id)
VALUES (?, ?, 1, ?, ?)
ON CONFLICT(page_id, href_page_id) DO UPDATE SET count = count + 1;
```

Note: `INSERT OR IGNORE ... ON CONFLICT ... DO UPDATE` is **invalid SQLite
syntax** — the `upsert-clause` is only allowed on plain `INSERT`, not
`INSERT OR IGNORE`. The above plain `INSERT … ON CONFLICT` form is correct.

### Benchmark Target

On a 10,000-page crawl, Phase 6 write overhead must not exceed 20 % compared
to the current write path. Crawl runtime is dominated by network I/O and
puppeteer render time; at typical broadband latencies, the DB write share of
total crawl duration is roughly 5–10 %. A 20 % overhead on that share
translates to ≤ 2 % end-to-end regression — below observable user impact.
Measure with `scripts/bench-crawl-write.mjs` (to be written as part of Phase 6
implementation).

---

## File Size Impact (Estimated)

Estimates from the real 11 GB archive (see `docs/viewer-db-redesign-plan.md`
§Current Table / INDEX Sizes):

| Table / Index                          |    Current | Estimated New | Notes                                                      |
| -------------------------------------- | ---------: | ------------: | ---------------------------------------------------------- |
| `images` (3.25 GB)                     |    3.25 GB |      ~0.45 GB | `src`/`currentSrc` → `url_refs` refs; `sourceCode` removed |
| `idx_images_covering`                  |    1.23 GB |   0 (dropped) | Covered by read-model `viewer_images`                      |
| `anchors` (0.68 GB)                    |    0.68 GB |      ~0.51 GB | 25 % row reduction; `textContent` → `text_refs`            |
| `pages.meta_extras` (in pages 0.96 GB) |   ~0.30 GB |      ~0.05 GB | json_refs dedup + compression (83 %)                       |
| `pages.responseHeaders`                |   ~0.17 GB |      ~0.05 GB | header_set decomposition; stable_hash dedup                |
| `resources.responseHeaders`            |   ~0.62 GB |      ~0.15 GB | Same decomposition                                         |
| `url_refs`                             |          0 |      ~0.12 GB | New; consolidates all URL strings                          |
| `text_refs`                            |          0 |      ~0.02 GB | anchor text, alt, dom_path                                 |
| `anchor_edges`                         |          0 |      ~0.47 GB | Replaces anchors                                           |
| `image_items`                          |          0 |      ~0.20 GB | Replaces images                                            |
| `anchor_edges idx`                     |          0 |      ~0.10 GB | Two indexes                                                |
| **DB total**                           | **~11 GB** |   **~6–7 GB** | Estimated 35–45 % reduction                                |

Actual savings depend on the header stable-hash dedup ratio and the `dom_path`
text_refs hit rate. A benchmark script must confirm estimates against the real
archive before Phase 6-H (table drop).

---

## Rollback Strategy

### Before Migration

1. Create `.bak` copy of the `.nitpicker` archive: `cp archive.nitpicker archive.nitpicker.bak`.
2. Keep `.bak` until Phase 6-H (table drop) is confirmed stable in production.

### On Migration Failure

`migrate-to-phase6.mjs` uses a single WAL transaction for all write steps.
On any SQL error or verification failure, the transaction is rolled back. The
`.nitpicker` is restored from `.bak` automatically.

### On Post-Migration Issue

If an issue is found after migration completes but before Phase 6-H:

- Old tables still exist; reader code can be reverted to read from them.
- No data has been lost.

### On Post-Drop Issue (Phase 6-H and later)

After old tables are dropped, rollback requires restoring from the `.bak` or
re-running the migration from the original `.nitpicker`. For production
archives, operators should retain the `.bak` for at least 30 days after Phase
6-H. 30 days corresponds to a typical incident detection window: if a latent
data integrity issue surfaces in production reports (crawl diffs, Sheets audits,
client reviews), 30 days provides enough headroom to diagnose and restore without
re-crawling the site.

An `info.phase6_completed_at` column is added during Phase 6-H to indicate
the migration state; this is checked by `assertCompatibleVersion` to produce a
helpful error if an operator opens a Phase 6 archive with a pre-Phase 6 CLI.

---

## Viewer Read Model Consistency

The viewer read model's **output** tables (`viewer_pages`, `viewer_anchor_facts`,
`viewer_images`, etc.) do not change — the viewer frontend is fully compatible.

The **build path** (functions in `@nitpicker/query/src/viewer-read-model/`)
changes as follows:

| Builder function               | Old input                               | New input                                                                                                |
| ------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `computeAnchorFactRows`        | `anchors` JOIN `pages`                  | `anchor_edges` JOIN `url_refs` via `content_items`                                                       |
| `computeResourceInsertRows`    | `resources` + `resources-referrers`     | `resource_items` + `resource_ref_edges`                                                                  |
| `computeImageInsertRows`       | `images` JOIN `pages`                   | `image_items` JOIN `url_refs` + `blob_refs` + `text_refs` (blob_refs needed for data-URI src/currentSrc) |
| `computeHeaderCheckInsertRows` | `pages.responseHeaders` LIKE            | `header_flags` (pre-computed flags)                                                                      |
| `computeDuplicateGroupRows`    | `pages.title`, `pages.description`      | `page_meta.title_text_id`, `page_meta.description_text_id` JOIN `text_refs`                              |
| `computeMismatchInsertRows`    | `pages.canonical`, `pages.og_url`, etc. | `page_meta.*_url_id` JOIN `url_refs`, `page_meta.*_text_id` JOIN `text_refs`                             |
| `buildDirectoryTreeRows`       | `pages.url`                             | `content_items.url_id` JOIN `url_refs`                                                                   |
| `getSummary` (internal)        | `pages.contentType`                     | `content_items.content_type_id` JOIN `content_type_refs`                                                 |

After Phase 6-F, the builder must produce byte-identical results compared to
the old code path. Verification: rebuild from both old and new tables on the
same archive and diff all `viewer_*` table contents.

---

## Implementation Order Within Phase 6

Recommended sub-issue / PR order:

1. **6-A + 6-B**: Ref table creation + population script (migration only — no
   crawler change). No reader update yet.
2. **6-C + 6-D**: New entity table creation + population. Data still in both
   old and new tables.
3. **6-E**: Verification script (`migrate-to-phase6.mjs` with verification step).
4. **6-F**: Reader code update + viewer read model builder update. Dual-read
   period: compare old vs new results.
5. **6-G**: Crawler write path update (new crawl writes to new tables only).
6. **6-H**: Drop old tables. Update `assertCompatibleVersion`.

Each step is a separate PR into `feature/impl-new-db`.

---

## Testing Strategy

### Unit Tests

- `url-refs-population.spec.ts` — correct routing of regular vs data-URI src/currentSrc.
- `url-refs-upsert.spec.ts` — verifies that `INSERT INTO url_refs ON CONFLICT DO UPDATE SET url=url RETURNING id`
  returns the existing row's `id` on conflict (not zero rows as `INSERT OR IGNORE … RETURNING` would do),
  locking in the FK-correctness invariant for the in-process cache miss path.
- `header-set-decomposition.spec.ts` — stable/volatile split, `stable_hash` reproducibility, flag
  computation, and **multiple same-name headers** (e.g., two `Set-Cookie` lines → two entries with
  `occurrence=1` and `occurrence=2` respectively).
- `anchor-edge-normalization.spec.ts` — correct `count`, `first_hash`, `first_text_id` after `GROUP BY`.
- `dom-path-derivation.spec.ts` — three cases:
  (a) single match: round-trip insert HTML blob → derive dom_path → recover img outerHTML;
  (b) multiple identical outerHTML on the same page → dom_path assigned in `images.id` insertion order;
  (c) null `sourceCode` or absent HTML blob → synthetic `unknown/<images.id>` assigned and warning logged.
- `text-refs-dedup.spec.ts` — same text inserted twice → same `text_refs.id`.
- `json-refs-dedup.spec.ts` — same `meta_extras` JSON inserted twice → same `json_refs.id`; round-trip
  zstd compress → store → decompress → verify identity; `codec` field matches stored value.
- `header-flags-computation.spec.ts` — given a known response header set, verify each `has_*` flag
  (`has_csp`, `has_x_frame_options`, etc.) is set correctly; also verify absence when header is missing.

### Migration Verification Tests

- `migrate-to-phase6.spec.ts` — run migration on a fixture archive; verify all
  row counts and round-trip spot-checks (see §Phase 6-E). **Also cover failure paths**:
  inject a verification failure (e.g., delete one `content_items` row after Phase 6-D) and assert
  the migration aborts and restores `.bak`, leaving the archive unchanged.
- `assert-compatible-version-phase6.spec.ts` — verify that `assertCompatibleVersion` throws a helpful
  error (not a generic SQLite error) when a pre-Phase-6 CLI opens an archive whose `info` row has
  `phase6_completed_at` set.

### Viewer Read Model Regression Tests

- Rebuild `viewer_*` tables from both old-schema and new-schema archives using
  the same fixture. Assert all output tables are identical.
- **Per-query-function dual-read verification**: for each query function updated in Phase 6-F
  (`listPages`, `listLinks`, `listImages`, `listResources`, `checkHeaders`, `findDuplicates`,
  `findMismatches`, `getViolations`), run the function against both the old-table and new-table
  code paths on the same fixture archive and assert the results are byte-identical. This catches
  regressions in functions consumed by CLI and MCP that are not covered by the viewer E2E alone.

### E2E Tests

- `viewer-phase6.e2e.ts` — launch viewer against a Phase 6 archive; verify
  `/api/pages`, `/api/links`, `/api/images`, `/api/headers` return correct
  results.
- `crawl-write-phase6.e2e.ts` — run `crawl` against the test server with the Phase 6 write path
  active; after crawl completes, open the archive and assert:
  (a) `anchor_edges` row count matches distinct `(pageId, hrefId)` pairs from a reference crawl;
  (b) `image_items` has entries with non-null `src_url_id` or `src_blob_id` for each crawled page;
  (c) `content_items` count equals `pages` count from a pre-Phase-6 reference crawl of the same site.
  This is the only test that exercises `database.ts`'s new write path end-to-end.
