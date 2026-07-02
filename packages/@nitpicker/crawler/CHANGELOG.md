# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
