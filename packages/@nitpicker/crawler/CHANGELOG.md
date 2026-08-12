# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.18.1](https://github.com/d-zero-dev/nitpicker/compare/v0.18.0...v0.18.1) (2026-08-12)

### Bug Fixes

- **crawler:** close two more demotion sites the /code-review pass on bf75031 found ([69c3597](https://github.com/d-zero-dev/nitpicker/commit/69c35978d1b749a8b56db86704405dacc5beb12f))
- **crawler:** guard is_external against demotion on an already-scraped internal page ([bf75031](https://github.com/d-zero-dev/nitpicker/commit/bf75031e4ce66056e1241ba39940dca2e68c8034))
- **query:** exclude out-of-scope pages from the directory tree ([56a2c6b](https://github.com/d-zero-dev/nitpicker/commit/56a2c6b8fc83965165f76848a7221d754d63b5e8))

# [0.18.0](https://github.com/d-zero-dev/nitpicker/compare/v0.17.0...v0.18.0) (2026-08-11)

**Note:** Version bump only for package @nitpicker/crawler

# [0.17.0](https://github.com/d-zero-dev/nitpicker/compare/v0.16.0...v0.17.0) (2026-08-09)

### Bug Fixes

- **crawler:** normalize maxExcludedDepth to 0 when NULL in the info table ([e4501ce](https://github.com/d-zero-dev/nitpicker/commit/e4501ce56677fca54ba98f1c2343d1d0f5b23361))
- **crawler:** provision adjunct tables in insert-inventory-content-items.spec.ts ([4e769dd](https://github.com/d-zero-dev/nitpicker/commit/4e769dd37850ba73d4931e02b93a2cfee9fb129c))
- **crawler:** record exclude-matched inventory URLs as skipped pages ([6c9f30b](https://github.com/d-zero-dev/nitpicker/commit/6c9f30b4e5f154173097d13b4f0ba03d8b124104)), closes [#260](https://github.com/d-zero-dev/nitpicker/issues/260)

### Features

- **crawler:** add content_items.dedupe_cap_event_id for post-hoc trap marking ([b59fb17](https://github.com/d-zero-dev/nitpicker/commit/b59fb1720a61d741459e581a30035db66cacc957))

# [0.16.0](https://github.com/d-zero-dev/nitpicker/compare/v0.15.0...v0.16.0) (2026-08-07)

### Bug Fixes

- **crawler:** decode percent-encoded basic auth credentials before forwarding ([d4cc182](https://github.com/d-zero-dev/nitpicker/commit/d4cc1828cffd6ce9fe23bcd217740a23d1944754))
- **crawler:** fix rejected_count finalization gap, stale body_hash comparison, and gate inconsistency ([e8dcf76](https://github.com/d-zero-dev/nitpicker/commit/e8dcf76cd7b7afe1610ef4ce3dbcb3725b2376f7)), closes [#208](https://github.com/d-zero-dev/nitpicker/issues/208)

### Features

- **crawler:** add assertChromeIsInstalled preflight check ([2462172](https://github.com/d-zero-dev/nitpicker/commit/2462172f7b1a03b157a3e14e405b8e76a72b99b0))
- **crawler:** classify redirect loops as a distinct error kind ([72d044d](https://github.com/d-zero-dev/nitpicker/commit/72d044dcbf02c544bb9ccb991224882ffbaddcc5))
- **crawler:** fix self-generating pagination URLs and add dedupe-cap soft cap ([f3d9fb8](https://github.com/d-zero-dev/nitpicker/commit/f3d9fb8cb0edece62177f168f797382ab9e3d540)), closes [#208](https://github.com/d-zero-dev/nitpicker/issues/208)

# [0.15.0](https://github.com/d-zero-dev/nitpicker/compare/v0.14.0...v0.15.0) (2026-07-30)

### Bug Fixes

- **crawler:** use decimals in output-binary.spec.ts to fix CI lint ([fdfc25a](https://github.com/d-zero-dev/nitpicker/commit/fdfc25a589a8a264f7d7feeafabd00b87943cb6f))

### Features

- **crawler:** add cache-root list/clear utilities and export them ([c05aa04](https://github.com/d-zero-dev/nitpicker/commit/c05aa049e1a397e529139b81b1d9cb3969ffc29a))
- **crawler:** add content_items.alias_of_id self-referencing column ([d7e44b2](https://github.com/d-zero-dev/nitpicker/commit/d7e44b232d82f8357c47de2d43f8076ef8e56745))
- **crawler:** capture and persist console log entries per page ([31ba317](https://github.com/d-zero-dev/nitpicker/commit/31ba317bd12a36ac884bd99dcf729e52c984ee5f))
- **crawler:** compute page_meta.body_hash from masked <body> content ([c3cdbb3](https://github.com/d-zero-dev/nitpicker/commit/c3cdbb38f2cb97e4fece5526d4be893cd185bffe))
- **crawler:** detect operator network outages and pause the crawl gate ([d6f2d32](https://github.com/d-zero-dev/nitpicker/commit/d6f2d32c36e8f8b267328929c02e00ee29758c80))
- **crawler:** persist page-cluster's cluster-selection reason ([f7c72b6](https://github.com/d-zero-dev/nitpicker/commit/f7c72b68ef821003f34661636940238b780d1c18))
- **crawler:** persist page-cluster's ClusterReason per template cluster ([8054165](https://github.com/d-zero-dev/nitpicker/commit/80541658a1548a483a01f2ca2c43ef71bb1077be))
- **crawler:** warn-and-skip inventory sources, archive them, fix tar drop bug ([376bf43](https://github.com/d-zero-dev/nitpicker/commit/376bf435a54656a4dd53cc7a822e5f95efdf74e4))

# [0.14.0](https://github.com/d-zero-dev/nitpicker/compare/v0.13.0...v0.14.0) (2026-07-24)

- feat(crawler)!: extract beholder main-content data into core schema ([4864b8a](https://github.com/d-zero-dev/nitpicker/commit/4864b8a10453867204a23ecba3b0601726cb914b))

### Features

- **crawler:** add page_templates SQL table for --templates classification ([a2a5772](https://github.com/d-zero-dev/nitpicker/commit/a2a5772267446aa4e80f830bc1159b33415a3c89))

### BREAKING CHANGES

- page_meta gains 17 new columns and 8 new adjunct
  tables are created on next archive open; existing archives are
  migrated additively (no REQUIRED_FORMAT_VERSION change).

# [0.13.0](https://github.com/d-zero-dev/nitpicker/compare/v0.12.0...v0.13.0) (2026-07-21)

### Bug Fixes

- chain populate-migration into crawler write path and reader spec ordering ([e9cc84e](https://github.com/d-zero-dev/nitpicker/commit/e9cc84e6054cb5596fc63db0a6ebb83af78eb95a)), closes [#196](https://github.com/d-zero-dev/nitpicker/issues/196)
- **crawler:** clear a page's resource_ref_edges on every re-scrape ([4c851b0](https://github.com/d-zero-dev/nitpicker/commit/4c851b0ed399859f7564f47e22b696543c888ecb))
- **crawler:** drop hex literal letters from phase 6-b sources to satisfy CI lint ([5934a2e](https://github.com/d-zero-dev/nitpicker/commit/5934a2e9015c39e8ee46509a0dd3c4a0a63a35b4))
- **crawler:** fix 3 real-data migration bugs and add resource blob routing ([eab6e6b](https://github.com/d-zero-dev/nitpicker/commit/eab6e6b40e012a28407fa580def527f31457a13d)), closes [#197](https://github.com/d-zero-dev/nitpicker/issues/197) [#116](https://github.com/d-zero-dev/nitpicker/issues/116)
- **crawler:** fix review findings in the entity-table write/read paths ([c0591ae](https://github.com/d-zero-dev/nitpicker/commit/c0591ae19a97c34cfb37d0d7f9c1c7a28f3fe4c4))
- **crawler:** heal previously-failed resources on a later successful fetch ([fb8531d](https://github.com/d-zero-dev/nitpicker/commit/fb8531d8eaf501ac570bd2a6eaba677254fd7f0f))
- **crawler:** repair legacy corrupted violation urls and store line/col ([4c4e1c2](https://github.com/d-zero-dev/nitpicker/commit/4c4e1c24bee918873ee3275ad181653a9a3bdbd7)), closes [#225](https://github.com/d-zero-dev/nitpicker/issues/225)
- **crawler:** resolve unreachable JSDoc {[@link](https://github.com/link)} references ([bc72ac5](https://github.com/d-zero-dev/nitpicker/commit/bc72ac5af0176dc18ccf11c455a23fa609eba493))
- **crawler:** retarget remaining read paths and fix write-path regressions ([ae4ed38](https://github.com/d-zero-dev/nitpicker/commit/ae4ed38ffbb59d0134a5bf4b28fd4f8dc96c8b0f))
- **crawler:** stabilise 0.13 populate against re-crawl, HTML BLOB deadlock, and migrator edge cases ([13f612e](https://github.com/d-zero-dev/nitpicker/commit/13f612e1af8348f92777db15f258c32f8d2f3cea))
- **crawler:** stop assuming a contiguous id range in checkUrlRoundTrip ([6ee5e9f](https://github.com/d-zero-dev/nitpicker/commit/6ee5e9f9da036630f5ea7d4dc1342e9e9535b986))
- **crawler:** tighten assert-phase6-populated types for CI build ([3a3c1f0](https://github.com/d-zero-dev/nitpicker/commit/3a3c1f0888f14e0b7225283ced8ccc57aab19163))
- **deps:** update dependency fs-extra to v11.3.6 ([#134](https://github.com/d-zero-dev/nitpicker/issues/134)) ([f30d42e](https://github.com/d-zero-dev/nitpicker/commit/f30d42ef4242026a8b99e160cd90ac8d21cefc7b))
- **deps:** update dependency knex to v3.3.0 ([#160](https://github.com/d-zero-dev/nitpicker/issues/160)) ([959bf10](https://github.com/d-zero-dev/nitpicker/commit/959bf10129a3a7e72670b600779171567a464772))
- **deps:** update dependency tar to v7.5.17 ([#135](https://github.com/d-zero-dev/nitpicker/issues/135)) ([bf98d5c](https://github.com/d-zero-dev/nitpicker/commit/bf98d5cab1604ca9f2668472428d86aa02bac985))
- **deps:** update dependency tar to v7.5.19 ([#171](https://github.com/d-zero-dev/nitpicker/issues/171)) ([7306b08](https://github.com/d-zero-dev/nitpicker/commit/7306b0804d96eb9c966ed3edec83650eea129941))
- **deps:** update dependency tar to v7.5.20 ([852aa36](https://github.com/d-zero-dev/nitpicker/commit/852aa363219ca213a51716600fd77f71c15c5d3a))
- populate 0.13 tables at every crawl-end site (not just write()) ([8126bde](https://github.com/d-zero-dev/nitpicker/commit/8126bde81c76f023339ad03c7d02f988934fc6da))
- populate 0.13 tables at resume() crawl end ([87fbd42](https://github.com/d-zero-dev/nitpicker/commit/87fbd4265363ff5bdfe6d4ae7d927a7fdc5fbcd9))

- feat(crawler)!: drop legacy write-model tables and unify adjunct FKs on content_items ([c801014](https://github.com/d-zero-dev/nitpicker/commit/c8010147afb42230a797eecbe9929285640e0129))

### Features

- **crawler:** add phase 6-a ref and header staging tables ([f78a5ef](https://github.com/d-zero-dev/nitpicker/commit/f78a5ef9c130b780c3ebf95ee3b821e1fd8fc079)), closes [#190](https://github.com/d-zero-dev/nitpicker/issues/190) [#103](https://github.com/d-zero-dev/nitpicker/issues/103) [#191](https://github.com/d-zero-dev/nitpicker/issues/191) [#192](https://github.com/d-zero-dev/nitpicker/issues/192)
- **crawler:** add phase 6-b ref-table population helpers ([1786bd4](https://github.com/d-zero-dev/nitpicker/commit/1786bd41a830369ffc7486d97b4e8595f6952cee)), closes [#191](https://github.com/d-zero-dev/nitpicker/issues/191) [#103](https://github.com/d-zero-dev/nitpicker/issues/103)
- **crawler:** add phase 6-c entity and edge tables ([c762b08](https://github.com/d-zero-dev/nitpicker/commit/c762b08810e70a604e6cc3d4b13fa0ed118ff79e)), closes [#192](https://github.com/d-zero-dev/nitpicker/issues/192) [#103](https://github.com/d-zero-dev/nitpicker/issues/103) [#193](https://github.com/d-zero-dev/nitpicker/issues/193)
- **crawler:** populate phase 6-d entity and edge tables ([4b11ca8](https://github.com/d-zero-dev/nitpicker/commit/4b11ca85e7f2c947c8e370d25dc69067c595abde))
- **crawler:** report progress from every 0.13 populate step ([3058904](https://github.com/d-zero-dev/nitpicker/commit/305890431ec266d1898562c5ad69edc5c3a1ef11))
- **crawler:** support writable Archive.connect and expose lock primitives ([5f5f6e6](https://github.com/d-zero-dev/nitpicker/commit/5f5f6e696a6486884a2dff6e46949c497d25e5e0)), closes [#112](https://github.com/d-zero-dev/nitpicker/issues/112)
- **crawler:** verify phase 6-e migration invariants ([bab23fd](https://github.com/d-zero-dev/nitpicker/commit/bab23fd9ab5408068cdc65e8d02bc6659ddeff28)), closes [#3](https://github.com/d-zero-dev/nitpicker/issues/3) [#4](https://github.com/d-zero-dev/nitpicker/issues/4) [#8](https://github.com/d-zero-dev/nitpicker/issues/8)
- **crawler:** write directly to 0.13 entity tables ([d0657d0](https://github.com/d-zero-dev/nitpicker/commit/d0657d013e4cd1d052e20fd5d812111cf627733e)), closes [#196](https://github.com/d-zero-dev/nitpicker/issues/196)
- **query:** switch phase 6-f readers to new entity tables ([e5ff302](https://github.com/d-zero-dev/nitpicker/commit/e5ff30234cd52c7bc7c1aa80704f80b0144579f6))
- **repo:** make migrate-to-0.13 resumable across process kills ([65814d4](https://github.com/d-zero-dev/nitpicker/commit/65814d49c179da7896417dd5a5c42a26de333eea))
- **repo:** move analysis violations to sql ([3cec379](https://github.com/d-zero-dev/nitpicker/commit/3cec379d6d79696924a98960368ed30109b41fdb))

### BREAKING CHANGES

- fresh archives no longer contain the legacy `pages` /
  `anchors` / `images` / `resources` / `resources-referrers` tables, and
  `scripts/migrate-to-0.13.mjs` now finishes the format cut: it rebuilds
  `page_html_ref` / `page_tags` / `page_jsonld` / `page_errors` /
  `analysis_violations` so their FK declarations point at
  `content_items(id)` (SQLite has no ALTER TABLE DROP CONSTRAINT), drops
  the legacy tables, and asserts `PRAGMA foreign_key_check` is clean
  before repacking. Archives migrated by an older script revision must be
  re-migrated from their pre-0.13 input.

Details:

- extract the adjunct DDL (page*errors / crawl_errors / page_tags /
  page_jsonld / inventory_runs / analysis*_ / page*html*_) into
  createAdjunctTables, shared by initSchema and the migration script so
  the two provisioning paths can no longer drift — per-table DDL copies
  in the lazy runtime migrations are exactly how migrated archives ended
  up with stale `REFERENCES pages(id)` declarations
- retargetLegacyFkTables stages rows with CREATE TABLE AS SELECT \*,
  recreates each table via createAdjunctTables, and copies rows back
  using the recreated table's own column list (pragma_table_info) so a
  column the canonical DDL has but the input archive lacks fails loudly
  instead of dropping data silently
- dropLegacyTables requires PRAGMA foreign_keys = OFF (asserted at
  runtime): the pages.redirectDestId self-FK makes an enforced DROP's
  implicit DELETE fail nondeterministically on row order, and skipping
  the implicit DELETE truncates whole b-trees instead of deleting rows
  one by one
- ensureLegacySourceColumns (script-local) replaces the deleted
  migratePagesResourcesSource for inputs predating crawl --inventory,
  because the entity populate SELECTs pages.source / resources.source
- fix four reads that still targeted legacy tables and were dead or
  broken since the writer switch: getPageCount, getPageSourceByUrl,
  getResourceUrlList (always empty on fresh archives) and
  replaceAnalysisViolations (threw "could not resolve page URL" for
  every violation, breaking `nitpicker analyze`); URL resolution is now
  chunked to stay under SQLite's bound-parameter limit
- delete the six lazy runtime migrations (page_errors / crawl_errors /
  html-blob / analysis_violations / inventory_runs /
  pages-resources-source): assertCompatibleVersion rejects every archive
  older than the current format before they could run, so their
  hasTable('pages') guards made them permanently unreachable
- initSchema now gates only the one-shot PRAGMAs + info creation on the
  info sentinel and always runs the idempotent ref / entity / adjunct
  DDL groups, so a crash between the groups self-heals on the next
  writer connect instead of bricking the stub with "no such table"
- rename PHASE_6B_CONTENT_TYPE_RULES to CONTENT_TYPE_RULES and replace
  the "0.13-N populate must run first" error labels with the actual
  populate function names

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

# [0.12.0](https://github.com/d-zero-dev/nitpicker/compare/v0.11.0...v0.12.0) (2026-07-01)

### Bug Fixes

- **crawler,query,cli:** drop inventory_runs.source_file_path column ([5514e59](https://github.com/d-zero-dev/nitpicker/commit/5514e5959ac4d33b57a5f45a430c3c58857ceda7))
- **crawler:** avoid requeueing roots on retry-failed ([dcb1702](https://github.com/d-zero-dev/nitpicker/commit/dcb17028d20b43d0846586a7ab5c3cd56e06b870))
- **crawler:** capture page.url() on scrapeStart's error-return path so JS-redirect rescue fires ([7496a1c](https://github.com/d-zero-dev/nitpicker/commit/7496a1cb56faad0b7989e6a83668a148fb9cf9d4))
- **crawler:** include inventory-seed rows in strict pending even without anchors ([82f866a](https://github.com/d-zero-dev/nitpicker/commit/82f866abd8df7463bad219eb8dfdae094c0851d2))
- **crawler:** inventory source labeling and large-list performance ([6c96584](https://github.com/d-zero-dev/nitpicker/commit/6c965845d842c0706e4e91c111837abd8d8222a7))
- **crawler:** keep HEAD-resolved redirect chain when puppeteer goto returns null ([f3c5c91](https://github.com/d-zero-dev/nitpicker/commit/f3c5c91795275490c3c8aabfb36930e0d69c05be))
- **crawler:** make `getCrawlingState` pending strictly in-scope and anchor-referenced ([8f1dc4a](https://github.com/d-zero-dev/nitpicker/commit/8f1dc4ab223108b148993acc30c5b7fbc0e2d971))
- **crawler:** pre-insert --inventory HTML seeds to survive scrape-phase interruption ([#121](https://github.com/d-zero-dev/nitpicker/issues/121)) ([be4e25b](https://github.com/d-zero-dev/nitpicker/commit/be4e25bd9e0de3536daec227973ca0116f3ea8d8))
- **crawler:** preserve 4xx/5xx status when GET fallback returns the same code ([7c358f7](https://github.com/d-zero-dev/nitpicker/commit/7c358f76e3704da53b1aee84f4759dab7d862f99))
- **crawler:** propagate inventory lineage through redirect chain intermediates ([c0f0ea4](https://github.com/d-zero-dev/nitpicker/commit/c0f0ea40b7ee39306068157b7e93734f6a4d0fff))
- **crawler:** put isExternal first in idx_pages_listfilter — fix the COUNT-only 8.7s regression ([e2837fc](https://github.com/d-zero-dev/nitpicker/commit/e2837fcd6b04d62f5f3dde0dbd24f9038cdc5b87)), closes [#96](https://github.com/d-zero-dev/nitpicker/issues/96) [#96](https://github.com/d-zero-dev/nitpicker/issues/96) [#96](https://github.com/d-zero-dev/nitpicker/issues/96)
- **crawler:** recover "certificate has expired" + puppeteer "detached frame" from unknown ([82379ed](https://github.com/d-zero-dev/nitpicker/commit/82379edb6d3a8265c8e4c259cc0a69b82de77ab9))
- **crawler:** register page.authenticate by default to drain native HTTP-auth dialogs ([3310dba](https://github.com/d-zero-dev/nitpicker/commit/3310dba92f4e887c6e2a9689fd5252291a2788df))
- **crawler:** seed inventory pagesScrapedOffset from existing scraped count ([4f2a872](https://github.com/d-zero-dev/nitpicker/commit/4f2a8729562ae24591fe1266502214cc0005d660))
- **crawler:** skip per-URL interval delay for DNS-burned hosts ([f1a7ac0](https://github.com/d-zero-dev/nitpicker/commit/f1a7ac092f84785910a04a885aaae4f91f5069e3))
- **crawler:** strip URL-embedded credentials before scrapeStart to stop cross-origin leak ([abfc15e](https://github.com/d-zero-dev/nitpicker/commit/abfc15e09d0cf216ce5eaf8cd653fabae7201c75))
- **crawler:** suppress DNS burn cascade for hosts proven alive in this session ([8a9d46c](https://github.com/d-zero-dev/nitpicker/commit/8a9d46cd1cd1bb05c89909c2310e9bcf7079ad34)), closes [#91](https://github.com/d-zero-dev/nitpicker/issues/91)
- **crawler:** tighten error-recovery edges flagged by code-review xhigh ([2ef4748](https://github.com/d-zero-dev/nitpicker/commit/2ef47484960430de063084dd34e6b65086c0c42d))

### Features

- **crawler,query,cli:** inventory_runs audit log (Phase 1) ([4fccf41](https://github.com/d-zero-dev/nitpicker/commit/4fccf410c7a60625ad55f39f2d71e5d92b8bffcf))
- **crawler:** add client-blocked kind + tighten tls / timeout regex ([05516c5](https://github.com/d-zero-dev/nitpicker/commit/05516c5126317f5889a322ad67fb707621c8c94b))
- **crawler:** add idx_pages_summary_contenttype + idx_pages_summary_failed for getSummary ([790e9e4](https://github.com/d-zero-dev/nitpicker/commit/790e9e49e821aa0937217c2c34b4a32c09fbdf86)), closes [#96](https://github.com/d-zero-dev/nitpicker/issues/96) [#96](https://github.com/d-zero-dev/nitpicker/issues/96)
- **crawler:** add tar cache for read-only archive opens ([8632a44](https://github.com/d-zero-dev/nitpicker/commit/8632a44be9c840bf3f1aa858fee60135d653f644))
- **crawler:** cache DNS-burned hosts and short-circuit retries ([7d2681e](https://github.com/d-zero-dev/nitpicker/commit/7d2681e1ccfb605add5da4acb97bdd0a41db8abf))
- **crawler:** classify EAI_AGAIN / EREFUSED / local-network / parse-error ([65b1ea5](https://github.com/d-zero-dev/nitpicker/commit/65b1ea59a9553f0ea670806d4f7bcdc6e6955ccc))
- **crawler:** escalate HEAD pre-flight timeout per retry attempt ([ccaa263](https://github.com/d-zero-dev/nitpicker/commit/ccaa263a131618211540caeccafb13a5312671ed))
- **crawler:** exclude permanent failure kinds from --retry-failed reset ([8ab1f21](https://github.com/d-zero-dev/nitpicker/commit/8ab1f21a0f48dad9864428cf97e49f708bbe648b))
- **crawler:** fall back to GET when HEAD response is unusable ([cc8f3e4](https://github.com/d-zero-dev/nitpicker/commit/cc8f3e4e4851b7b5ce70a77796f680ba80860a55))
- **crawler:** puppeteer one-shot fallback when HEAD/GET both die on HTML URL ([ca38053](https://github.com/d-zero-dev/nitpicker/commit/ca38053a099dc8088140fd22ca8997954890911a))
- **crawler:** rescue JS-redirect navigations as redirect edges ([a39a486](https://github.com/d-zero-dev/nitpicker/commit/a39a486722de57dd35d36d7b61c2b484304ae315))

### Performance Improvements

- **crawler:** 368x faster listPages on large archives via composite covering index ([7747f49](https://github.com/d-zero-dev/nitpicker/commit/7747f4907e4e9a25332ca016588e566d7bda7065))
- **crawler:** add covering indexes for listUnusedResources and listImages ([e1b6b95](https://github.com/d-zero-dev/nitpicker/commit/e1b6b95788f7878174cc97ab0a13dce9a204b807)), closes [#96](https://github.com/d-zero-dev/nitpicker/issues/96)

# [0.11.0](https://github.com/d-zero-dev/nitpicker/compare/v0.9.0...v0.11.0) (2026-06-18)

### Bug Fixes

- **crawler:** clear a page's anchors and images before re-insert on re-scrape ([42b3c9a](https://github.com/d-zero-dev/nitpicker/commit/42b3c9a1bd3617e0ad58ae8f27c940965008da83)), closes [#70](https://github.com/d-zero-dev/nitpicker/issues/70)
- **crawler:** force-kill chromium when browser.close() hangs after session loss ([bef710c](https://github.com/d-zero-dev/nitpicker/commit/bef710c071fdaf940f6ed319f9ea1c57c9306d25))
- **crawler:** merge zipped snapshots on write so appended pages keep their HTML ([3e29c17](https://github.com/d-zero-dev/nitpicker/commit/3e29c17d02e1066862ec334fb1cdb412f9864791))
- **crawler:** normalize resources content-type too ([d7d5dc3](https://github.com/d-zero-dev/nitpicker/commit/d7d5dc36b7d52664addb6b626910e7e530e95df3)), closes [#72](https://github.com/d-zero-dev/nitpicker/issues/72)
- **crawler:** normalize stored content-type so page-ness predicates agree ([31d034d](https://github.com/d-zero-dev/nitpicker/commit/31d034d84147304b3d367ada3bf29c1768442b05)), closes [#72](https://github.com/d-zero-dev/nitpicker/issues/72)
- **crawler:** preserve anchors on empty re-scrape and clear redirect-source rows ([4a1176b](https://github.com/d-zero-dev/nitpicker/commit/4a1176bb7e93b2b204194fc22c99edb91dfab885)), closes [#70](https://github.com/d-zero-dev/nitpicker/issues/70)
- **crawler:** reject the crawl when persisting a crawl error fails ([b4ee344](https://github.com/d-zero-dev/nitpicker/commit/b4ee3440bd2d8a8a51caaf85688306fe825cc2f5))
- **crawler:** resolve referrers through redirects and expose through/throughId ([0aa00ec](https://github.com/d-zero-dev/nitpicker/commit/0aa00ec84778cff48cc8977a42995c71ccc53f20))
- **crawler:** stop treating non-HTML resources as HTML pages ([a2aa506](https://github.com/d-zero-dev/nitpicker/commit/a2aa5069d924d887dfc48cb2021a88a28cf3504f)), closes [#72](https://github.com/d-zero-dev/nitpicker/issues/72)
- **crawler:** unify HTML detection and widen the responseHeaders type ([0d74049](https://github.com/d-zero-dev/nitpicker/commit/0d7404987e67af58e8e2f4808e16bf3deadd89e1))
- **crawler:** widen Spawner stdio to SpawnOptions so CI build passes ([0d0d337](https://github.com/d-zero-dev/nitpicker/commit/0d0d337381706cdb695eafbac7d6874a17d37975))

- feat(crawler)!: gate archive opens by info.version and survive .nitpicker renames ([7989e09](https://github.com/d-zero-dev/nitpicker/commit/7989e09f7174b153549fe109dd1d546bcdaee16e))
- feat(crawler)!: store HTML snapshots as zstd BLOBs inside SQLite ([1da73c3](https://github.com/d-zero-dev/nitpicker/commit/1da73c36024cad4d68f4efd744b04e3192e361f1)), closes [#23](https://github.com/d-zero-dev/nitpicker/issues/23) [pre-#75](https://github.com/pre-/issues/75)

### Features

- **crawler:** add CrawlerOrchestrator.inventory() + existing-url helpers ([869e99e](https://github.com/d-zero-dev/nitpicker/commit/869e99e9140e96276ccf7ddbb56739497d7ff75f))
- **crawler:** add read-only mode and live-crawl-aware helpers ([e67ac75](https://github.com/d-zero-dev/nitpicker/commit/e67ac75fded57ab614d39a2a200279f2c23bb0c7))
- **crawler:** add retryFailed to re-fetch failed pages from an archive ([7e20a29](https://github.com/d-zero-dev/nitpicker/commit/7e20a2933f7e8d63d38afef7012a0a9f15f54a9f))
- **crawler:** add source provenance column to pages and resources ([1a78fe1](https://github.com/d-zero-dev/nitpicker/commit/1a78fe12eb786c8f7292bcd8bf5e423aee046178))
- **crawler:** force-kill the entire Chromium process tree on close timeout ([e91c0f2](https://github.com/d-zero-dev/nitpicker/commit/e91c0f256fc49520d02a47f8c55b09a21c4e42a0))
- **crawler:** label crawl progress counts as URLs and add thousands separators ([1ab7418](https://github.com/d-zero-dev/nitpicker/commit/1ab7418a43d044d7c383165ee6432c30ddca7a5e))
- **crawler:** prioritise likely-HTML URLs in the crawl queue ([df73a9f](https://github.com/d-zero-dev/nitpicker/commit/df73a9fcbd2444185f07a02e30877f804d00c869))
- **crawler:** record crawler-level errors to a structured crawl_errors table ([2ebdc08](https://github.com/d-zero-dev/nitpicker/commit/2ebdc089fb1ece9d430e462f6a3834f127dde030))
- **crawler:** record partial scrape failures in the page_errors archive table ([ee3c832](https://github.com/d-zero-dev/nitpicker/commit/ee3c832f0420ccf1e0b03b2e87cd10c5b4aa3c3c))
- **crawler:** reuse captured sub-resource data to skip redundant HEAD pre-flights ([c99144c](https://github.com/d-zero-dev/nitpicker/commit/c99144c446dec8d39ec980acabb179c6cd20240b))
- **crawler:** show rendered HTML page count in crawl progress header ([06cc9d7](https://github.com/d-zero-dev/nitpicker/commit/06cc9d793bef045b4ed5b5c3c05aa8fb3bc7b473))
- **crawler:** skip re-rendering redirect destinations already crawled ([a0bb037](https://github.com/d-zero-dev/nitpicker/commit/a0bb037e3a614a00962ec29bb86b2b3089931a02)), closes [#73](https://github.com/d-zero-dev/nitpicker/issues/73)
- **crawler:** stream snapshot HTML from the zip central directory ([cc87054](https://github.com/d-zero-dev/nitpicker/commit/cc87054f60bd2def104078ae5f1bd8f5e545b8ef))
- **crawler:** thread inventoryMode source label through Crawler → Archive → Database ([109d346](https://github.com/d-zero-dev/nitpicker/commit/109d346503af5ada413bb3fd5a3f5e4a3bacaf36))

### BREAKING CHANGES

- IncompatibleArchiveError(archiveVersion, currentMajor: number)
  became IncompatibleArchiveError(archiveVersion, requiredVersion: string).
  Callers outside this monorepo will need to update construction sites; the
  public crawler API re-export now surfaces the new signature.
- `.nitpicker` archives no longer contain `snapshot-html.zip`. HTML bodies live in two
  new SQLite tables (`page_html_blobs` keyed by SHA-256, `page_html_ref` mapping page id → hash) inside
  the same `db.sqlite` file. The tar payload is effectively a single SQLite file.

`Database.updatePage` now returns just `pageId` and takes `writeHtml: boolean` in place of the legacy
`snapshotDir` argument. `ArchiveAccessor.getHtmlOfPage` now takes a `pageId: number` instead of a
relative file path. `Database.clearHtmlPath` / `getHtmlPathOnPage`, `Archive.SNAPSHOT_HTML_DIR`, and
`DatabaseOption.workingDir` are gone.

Why:

- Eliminates the per-`--append` zip re-compression cost (multi-tens-of-minutes for 100k+ pages),
  unlocking million-page-scale crawls.
- Hash-keyed storage dedups identical bodies within a crawl (404 templates, error pages, …) and

# [0.9.0](https://github.com/d-zero-dev/nitpicker/compare/v0.8.0...v0.9.0) (2026-05-29)

**Note:** Version bump only for package @nitpicker/crawler

# [0.8.0](https://github.com/d-zero-dev/nitpicker/compare/v0.7.0...v0.8.0) (2026-05-16)

### Bug Fixes

- **crawler:** dedupe initial URLs so append-mode does not race on a URL in both resume pending and the new roots ([06aeda7](https://github.com/d-zero-dev/nitpicker/commit/06aeda7924dd57fcbeeed8e61fb41900acc14a46))
- **crawler:** make scope match port-aware ([691e876](https://github.com/d-zero-dev/nitpicker/commit/691e87621e20ebf1194d14a231e53a4551675641))
- **crawler:** release archive lock on every CrawlerOrchestrator.append error path ([d8878d6](https://github.com/d-zero-dev/nitpicker/commit/d8878d68a26506601d17ad236516fd39d639f74d))
- **crawler:** stop swallowing append restore failures and tighten updateConfig safety ([b9405f1](https://github.com/d-zero-dev/nitpicker/commit/b9405f1a5fa9e340923424d09d319d199fec6b3a))

- feat(crawler)!: merge positional roots into info.scope and crawler scope map ([1166b50](https://github.com/d-zero-dev/nitpicker/commit/1166b50a2cd293a8c6a3d42d45a435fc6d379dda))
- refactor(crawler)!: unify Crawler.start and startMultiple into a single multi-root API ([cb700df](https://github.com/d-zero-dev/nitpicker/commit/cb700df977376b81a100cb9ce5dfefeda7846a2b))
- feat(crawler)!: add info.roots column, advisory archive lock, and repromote/updateConfig DB ops ([4545614](https://github.com/d-zero-dev/nitpicker/commit/4545614386f2e5cf1f54ee15e711435c98468d9c))
- refactor(crawler)!: consolidate scope-entry lookup into findScopeEntry ([b2c9766](https://github.com/d-zero-dev/nitpicker/commit/b2c9766cb43078624f93ae0ded2ba7deb432b313))

### Features

- **crawler:** add CrawlerOrchestrator.append for incremental scope expansion ([2a7fdbb](https://github.com/d-zero-dev/nitpicker/commit/2a7fdbbb2d70209d301ab62a1201ac2007243e94))

### BREAKING CHANGES

- `info.scope` now contains the positional root URLs in
  addition to whatever was passed via `options.scope`. Callers that round-trip
  `info.scope` and expect it to be the literal `--scope` value will see the
  roots prepended.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

- `Crawler.start` signature changes from `(url)` to
  `(urls[], opts?)`. `Crawler.startMultiple` is removed; pass
  `{ recursive: false }` to the unified `start` for list-mode behaviour.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

- `Config` now requires `roots: string[]`. `Database.connect` /
  `Archive.create` / `Archive.open` / `Archive.resume` run migrations on every
  call, so a `.nitpicker` opened by this version writes back the new column.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

- `isExternalUrl` adds an optional `options` parameter for
  ParseURLOptions, and `injectScopeAuth` now takes `(url, matchedScope)` instead
  of `(url, scopeMap)`. `findBestMatchingScope` and `isInAnyLowerLayer` are
  removed; call sites should use `findScopeEntry` instead.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

# [0.7.0](https://github.com/d-zero-dev/nitpicker/compare/v0.6.5-alpha.0...v0.7.0) (2026-05-13)

### Bug Fixes

- **crawler:** cancel HEAD request timeout to prevent timer leak ([10f1b7a](https://github.com/d-zero-dev/nitpicker/commit/10f1b7a370943f953aaf7b9c7dec8153864134de))

## [0.6.5-alpha.0](https://github.com/d-zero-dev/nitpicker/compare/v0.6.4...v0.6.5-alpha.0) (2026-04-08)

**Note:** Version bump only for package @nitpicker/crawler

## [0.6.3](https://github.com/d-zero-dev/nitpicker/compare/v0.6.2...v0.6.3) (2026-03-30)

### Bug Fixes

- **cli,crawler,query:** address QA review findings ([0c53d1e](https://github.com/d-zero-dev/nitpicker/commit/0c53d1e8a2b32a0cb1101975232ca3d356f2ad61))
- **crawler:** resolve unhandled abort errors in redirect-table tests ([8e4a31f](https://github.com/d-zero-dev/nitpicker/commit/8e4a31f488103205b95a103bb08750a1c50487a3))

## [0.6.2](https://github.com/d-zero-dev/nitpicker/compare/v0.6.1...v0.6.2) (2026-03-30)

### Bug Fixes

- **crawler:** update @d-zero/beholder to 2.1.1 ([02585f5](https://github.com/d-zero-dev/nitpicker/commit/02585f55fa128fd790f552d25b5a403cbec11df9))
- **crawler:** update @d-zero/beholder to 2.1.2 ([98177f5](https://github.com/d-zero-dev/nitpicker/commit/98177f5f1f8c048b7098b81456d0eda8f7b2eda4))

## [0.6.1](https://github.com/d-zero-dev/nitpicker/compare/v0.6.0...v0.6.1) (2026-03-27)

### Bug Fixes

- **crawler:** add label to openPage phase countdown log ([0e0ffc6](https://github.com/d-zero-dev/nitpicker/commit/0e0ffc6a7f8438b1af715e01223267d47f630495))
- **crawler:** ignore duplicate resource-referrer inserts ([63629f7](https://github.com/d-zero-dev/nitpicker/commit/63629f79c496f54cb03eadb33b3a55de1d6347ec))
- **crawler:** propagate Basic Auth credentials from root scope to subpages ([eb9adf3](https://github.com/d-zero-dev/nitpicker/commit/eb9adf394594c95ae2eced5989cce2b91163868f))
- **crawler:** skip self-redirects to prevent pages from being excluded in reports ([fb7b3b9](https://github.com/d-zero-dev/nitpicker/commit/fb7b3b9aef82291764e7315dd7974cdf6140b2d5))
- **crawler:** split comma-separated --exclude patterns correctly ([99903a2](https://github.com/d-zero-dev/nitpicker/commit/99903a2150121fc0a9a230738de4d6ce79945341))
- **crawler:** use lane-unique countdown IDs in HEAD request retry log ([b839a32](https://github.com/d-zero-dev/nitpicker/commit/b839a3281e5106a026aac267167dc4d79ad41ef7))

# [0.6.0](https://github.com/d-zero-dev/nitpicker/compare/v0.5.1...v0.6.0) (2026-03-16)

**Note:** Version bump only for package @nitpicker/crawler

# [0.5.0](https://github.com/d-zero-dev/nitpicker/compare/v0.4.4...v0.5.0) (2026-03-13)

### Bug Fixes

- **cli,crawler:** map CLI flag names to CrawlConfig properties ([3003025](https://github.com/d-zero-dev/nitpicker/commit/30030251d0c79516795d77ddc65f1eb2c2d657ca)), closes [#1](https://github.com/d-zero-dev/nitpicker/issues/1)
- **cli:** address --output flag QA/PdM review findings ([a36270c](https://github.com/d-zero-dev/nitpicker/commit/a36270ce9177139df6f605dba3a459e9b042013e))
- **crawler:** Archive 書き込みの一貫性を保証する ([7cd3e32](https://github.com/d-zero-dev/nitpicker/commit/7cd3e3299f3129bcc43033d9f9fd011e067a78d7)), closes [#10](https://github.com/d-zero-dev/nitpicker/issues/10)
- **crawler:** clean up partial copy on fallback failure and add missing tests ([4942b11](https://github.com/d-zero-dev/nitpicker/commit/4942b113385c9c4bf3d083e61f0a1bd461353d07))
- **crawler:** fall back to cp+remove when fs.rename throws EPERM or EXDEV ([9702ef8](https://github.com/d-zero-dev/nitpicker/commit/9702ef8ae7ebb155a4d58aaa1aa040a887074801)), closes [#33](https://github.com/d-zero-dev/nitpicker/issues/33)
- **crawler:** improve crawl progress display to show done/found/remaining ([a950208](https://github.com/d-zero-dev/nitpicker/commit/a9502088ad84c521c52cdfb5476ba0e535db3a5f)), closes [#37](https://github.com/d-zero-dev/nitpicker/issues/37)
- **crawler:** QA レビュー指摘事項を修正 ([d5da50f](https://github.com/d-zero-dev/nitpicker/commit/d5da50f271e7f69283927a22c615e5de2fd64259))
- **crawler:** serialize Archive writes with WriteQueue to prevent race condition ([50b61e4](https://github.com/d-zero-dev/nitpicker/commit/50b61e4d75f3ede4cd92b298feec3accb8ed5c0a)), closes [#11](https://github.com/d-zero-dev/nitpicker/issues/11)
- index.ts 禁止ルール違反を解消 ([b5d3cda](https://github.com/d-zero-dev/nitpicker/commit/b5d3cdab633c16fa73cedc4cc92ab18609312940)), closes [#15](https://github.com/d-zero-dev/nitpicker/issues/15)
- QAレビュー指摘事項の一括修正 ([e461a09](https://github.com/d-zero-dev/nitpicker/commit/e461a0991359ddc151a22fbd310b67417c0f693d))
- replace duplicate abort test with meaningful coverage ([22afac4](https://github.com/d-zero-dev/nitpicker/commit/22afac42086c896c5fd5074aea592cac3d27ddb5))
- **repo:** track **mock** directory to include mock.sqlite in CI ([7d5d629](https://github.com/d-zero-dev/nitpicker/commit/7d5d62998ba61bf3eb3bb6b4722d1065d412b3fc))

### Features

- **cli:** add --output (-o) flag to crawl command ([fcbebc8](https://github.com/d-zero-dev/nitpicker/commit/fcbebc8b91e04f0e1b89d4ed02a18f259c76925a)), closes [#5](https://github.com/d-zero-dev/nitpicker/issues/5)
- **cli:** improve exit code granularity for CI/CD pipelines ([57d67cb](https://github.com/d-zero-dev/nitpicker/commit/57d67cb4c6077b0a4c535fddccb7717acd05385d)), closes [#36](https://github.com/d-zero-dev/nitpicker/issues/36)
- implement .nitpicker archive query MCP server ([#21](https://github.com/d-zero-dev/nitpicker/issues/21)) ([9f0f407](https://github.com/d-zero-dev/nitpicker/commit/9f0f4079219c97990724a75cd04fcf41ca1ac82d))

## [0.4.4](https://github.com/d-zero-dev/nitpicker/compare/v0.4.3...v0.4.4) (2026-03-02)

### Bug Fixes

- **crawler:** add missing userAgent and ignoreRobots columns to info table schema ([e62776d](https://github.com/d-zero-dev/nitpicker/commit/e62776dea5945ae58e9d547aa3bfc49fc63bae13))

## [0.4.3](https://github.com/d-zero-dev/nitpicker/compare/v0.4.2...v0.4.3) (2026-03-02)

### Bug Fixes

- add files field to all package.json to explicitly include lib/ in npm packages ([d1a7625](https://github.com/d-zero-dev/nitpicker/commit/d1a76255dc5af5f6a12cdef275e473ab637e1cbb)), closes [#20](https://github.com/d-zero-dev/nitpicker/issues/20)

## [0.4.2](https://github.com/d-zero-dev/nitpicker/compare/v0.4.1...v0.4.2) (2026-02-27)

**Note:** Version bump only for package @nitpicker/crawler

## [0.4.1](https://github.com/d-zero-dev/nitpicker/compare/v0.4.0...v0.4.1) (2026-02-27)

**Note:** Version bump only for package @nitpicker/crawler
