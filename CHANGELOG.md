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
- **github:** key build cache by github.sha to avoid hashFiles drift ([b3ca194](https://github.com/d-zero-dev/nitpicker/commit/b3ca19417b8a6b63f7c02182746fc12d81f0dc75))
- **github:** use grep instead of awk in verify-shards to survive yaml reformatting ([7d2037b](https://github.com/d-zero-dev/nitpicker/commit/7d2037bd90ccbde03c9e766849e73cc6f54176fc))
- **query:** exclude excludes-pattern pages from summary distributions ([0284b5e](https://github.com/d-zero-dev/nitpicker/commit/0284b5ec76290c6460976943b60e9da0756fd7dc))
- **repo:** add-perf-indexes — survive WAL/SHM teardown race when re-tarring ([9256b5a](https://github.com/d-zero-dev/nitpicker/commit/9256b5a61d0b2880994dcf920255619698dcffbc))
- **viewer:** default-cap /api/graph + persist result so large archives stop returning Invalid string length ([6196051](https://github.com/d-zero-dev/nitpicker/commit/619605105f72c6f01c01830a0008ce58e6529813))
- **viewer:** promote pageSize to a first-class URL query (parity with page) ([a1b3f9e](https://github.com/d-zero-dev/nitpicker/commit/a1b3f9ef9fd12f779634cb59f27f4129af2b175e))
- **viewer:** show refetch feedback so Pager clicks feel immediate ([2c71a4a](https://github.com/d-zero-dev/nitpicker/commit/2c71a4a5ab6f787fed2c6a5a0573610aa9a75774))

- feat(viewer)!: switch list views to MPA pagination by default, virtual scroll opt-in ([7fd00db](https://github.com/d-zero-dev/nitpicker/commit/7fd00db3e4f0ee16ebbb9e68b931bc45c19dee46))

### Features

- **cli:** isolated-clusters / get-isolated-cluster subcommands + --include-redirect-sources ([4867d35](https://github.com/d-zero-dev/nitpicker/commit/4867d35b08a55aaf3c5e3c72be10e030f63e40a5))
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
- **mcp-server:** list_isolated_clusters / get_isolated_cluster + redirect-resolved list_links ([b89a577](https://github.com/d-zero-dev/nitpicker/commit/b89a5779837f19125f36fda683e502f6655c623b))
- **query,viewer:** subdivide status=-1 by errorKind in Summary ([cd9a85b](https://github.com/d-zero-dev/nitpicker/commit/cd9a85bc4ac0c168f6c5760e18d92f4a64b022a7))
- **query:** accept precomputed components / referrer-count map on isolated-\* and page-links ([bf610fd](https://github.com/d-zero-dev/nitpicker/commit/bf610fd61be379816403996e74e14774841440f3))
- **query:** isolated-clusters + source-based isolated-pages + redirect-resolved listLinks ([48d3e77](https://github.com/d-zero-dev/nitpicker/commit/48d3e77e6796583e307f79968eb062ccb30db190))
- **query:** route ArchiveManager open through Archive.openCached ([f607cfd](https://github.com/d-zero-dev/nitpicker/commit/f607cfd5fb4b1989279b3af98384493124ab864c))
- **viewer:** isolated-clusters view + infinite-scroll isolated-pages + retire orphaned chip ([711e434](https://github.com/d-zero-dev/nitpicker/commit/711e43441707c3267b309366c38a4a9295dff6ca))
- **viewer:** per-archive precompute caches drop isolated-\* / page-links to single-digit-ms ([096bd29](https://github.com/d-zero-dev/nitpicker/commit/096bd29dcb4cdc50435859ee10a71ea0205d08b7))
- **viewer:** per-archive process cache for getSummary — warm hits return in ms ([fc453d7](https://github.com/d-zero-dev/nitpicker/commit/fc453d792979e068f811473b89162dbd9a69d5f3))
- **viewer:** persist precomputed caches to disk across restarts ([101e6ae](https://github.com/d-zero-dev/nitpicker/commit/101e6aeb59f7ffc2e5f1d6c327b2806f6d360019)), closes [#98](https://github.com/d-zero-dev/nitpicker/issues/98)
- **viewer:** translate client-blocked error kind label ([8262caf](https://github.com/d-zero-dev/nitpicker/commit/8262caf54883b8b17d2544a035b0af7a6465cdf8))
- **viewer:** translate new ErrorKind buckets for the Errors view ([c2a9e03](https://github.com/d-zero-dev/nitpicker/commit/c2a9e031ea402838ff625910e229ed6ef961ec26))

### Performance Improvements

- **crawler:** 368x faster listPages on large archives via composite covering index ([7747f49](https://github.com/d-zero-dev/nitpicker/commit/7747f4907e4e9a25332ca016588e566d7bda7065))
- **crawler:** add covering indexes for listUnusedResources and listImages ([e1b6b95](https://github.com/d-zero-dev/nitpicker/commit/e1b6b95788f7878174cc97ab0a13dce9a204b807)), closes [#96](https://github.com/d-zero-dev/nitpicker/issues/96)
- **github:** shard e2e suite across 4 matrix jobs to cut wall-clock ([ae8bbe5](https://github.com/d-zero-dev/nitpicker/commit/ae8bbe5002e29f7d8fb492990a50473842be6d01))
- **query:** SQL-first sweep — N+1 → GROUP_CONCAT, parallelise graph fetch, document accepted costs ([508f4b8](https://github.com/d-zero-dev/nitpicker/commit/508f4b8c28f6a2e82bfc1b5051bc7e2176da669b))

### BREAKING CHANGES

- the viewer's default list-mode is now MPA pagination
  instead of infinite scroll. Operators can revert per-tab via the TopBar
  mode toggle; the preference persists in localStorage
  (`nitpicker-pagination-mode`, `nitpicker-page-size`). 0.x semver — no
  migration guide required.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

# [0.11.0](https://github.com/d-zero-dev/nitpicker/compare/v0.9.0...v0.11.0) (2026-06-18)

### Bug Fixes

- **analyze-main-contents:** report zero counts when no main content is found ([9c946c4](https://github.com/d-zero-dev/nitpicker/commit/9c946c4b3fbc1d9fb82ed185b56e1b1a39b1ad0f))
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
- **query:** exclude non-HTML resources (not errored pages) from page list and summary ([354e0b7](https://github.com/d-zero-dev/nitpicker/commit/354e0b7fd861f7e44e80cf0f1da15a70b68ac15d)), closes [#72](https://github.com/d-zero-dev/nitpicker/issues/72)
- **query:** resolve inbound links and referrer counts through redirects ([f39b4b4](https://github.com/d-zero-dev/nitpicker/commit/f39b4b4c5ca66bc64640a34cbeb503a82b3d4ac0)), closes [#71](https://github.com/d-zero-dev/nitpicker/issues/71)

- feat(crawler)!: gate archive opens by info.version and survive .nitpicker renames ([7989e09](https://github.com/d-zero-dev/nitpicker/commit/7989e09f7174b153549fe109dd1d546bcdaee16e))
- feat(crawler)!: store HTML snapshots as zstd BLOBs inside SQLite ([1da73c3](https://github.com/d-zero-dev/nitpicker/commit/1da73c36024cad4d68f4efd744b04e3192e361f1)), closes [#23](https://github.com/d-zero-dev/nitpicker/issues/23) [pre-#75](https://github.com/pre-/issues/75)

### Features

- **cli,mcp:** expose isolated-pages / unused-resources via query CLI and MCP tools ([e0c0c5c](https://github.com/d-zero-dev/nitpicker/commit/e0c0c5c6180afb4b5f7f720c8df4553408c42f30))
- **cli:** accept a stub directory as `viewer` positional arg ([cbab270](https://github.com/d-zero-dev/nitpicker/commit/cbab270a735a253a9d2a317838ceb9e4d9e50872))
- **cli:** add --contentTypeCategory flag to pages sub-command ([27f10cb](https://github.com/d-zero-dev/nitpicker/commit/27f10cb2c99ef6f0cd571c7d7da7f8548ec2deae))
- **cli:** add --retry-failed flag to the crawl command ([89485d4](https://github.com/d-zero-dev/nitpicker/commit/89485d424aa3a83caa0d9be3eb21f67b60052bed))
- **cli:** add the error-kinds query sub-command ([7657d57](https://github.com/d-zero-dev/nitpicker/commit/7657d571a9cbf84b5e7c3fc4c792444515d68cae))
- **cli:** add viewer subcommand ([c386949](https://github.com/d-zero-dev/nitpicker/commit/c3869499804be1817543170db0fee5a2015353f5))
- **cli:** wire up crawl --inventory flag and dispatch ([61b9054](https://github.com/d-zero-dev/nitpicker/commit/61b905484dbf3e016c472dc6b246e28b6da5d0c1))
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
- **mcp-server:** advertise contentTypeCategory on list_pages ([c616c89](https://github.com/d-zero-dev/nitpicker/commit/c616c8946b43a5cabacc8c892f469dc44b7a9408))
- **mcp-server:** surface mode and crawlerPid via open_archive ([9f54def](https://github.com/d-zero-dev/nitpicker/commit/9f54defc41e07666109e5c766586312e47f1f9f4))
- **query:** accept stub directories in ArchiveManager.open ([d51b605](https://github.com/d-zero-dev/nitpicker/commit/d51b60517e9aa83108fd3142e800521b4aa8ca5d))
- **query:** add content-type classification engine ([529df8c](https://github.com/d-zero-dev/nitpicker/commit/529df8c4daddb1ceb7f8a685662da26999b22af9))
- **query:** add link-graph and per-page-links queries ([4b8fb69](https://github.com/d-zero-dev/nitpicker/commit/4b8fb69fbf7d891c4c6551fabfd387a949376313))
- **query:** add listIsolatedPages / listUnusedResources ([5a467d3](https://github.com/d-zero-dev/nitpicker/commit/5a467d304bd0f9764d88c7c08b287434c3d0f25c))
- **query:** classify crawl failures by cause with getErrorKinds + error-kinds query ([a7601ad](https://github.com/d-zero-dev/nitpicker/commit/a7601adec4213dcb84deef9773d519ed1114ce3e))
- **query:** expand ContentTypeCategory and add content-row totals to summary ([bac1aed](https://github.com/d-zero-dev/nitpicker/commit/bac1aedefd830ad24f620e3d38fba38add218917))
- **repo:** replace migrate-html-to-blob with migrate-to-0.10 (Step A+B+C) ([d602245](https://github.com/d-zero-dev/nitpicker/commit/d602245bd75f67b4d59d8405bbac471b078a951f)), closes [#75](https://github.com/d-zero-dev/nitpicker/issues/75)
- **viewer:** accept stub directories and distinguish live vs interrupted crawls ([6e64fe5](https://github.com/d-zero-dev/nitpicker/commit/6e64fe5afd55b25c5118acc449e925d07cda9e99))
- **viewer:** add an Errors view for crawl-failure causes ([7e181d6](https://github.com/d-zero-dev/nitpicker/commit/7e181d670ec1b90ccfc987852a0cf160fbc75bec))
- **viewer:** add content-type filter and distribution chart ([f719bb2](https://github.com/d-zero-dev/nitpicker/commit/f719bb261560757ff8abc05397726af041ed775f))
- **viewer:** add footer badge styles for stub-mode crawl state ([da79f10](https://github.com/d-zero-dev/nitpicker/commit/da79f10ddde62022de7767ac572412007d48d021))
- **viewer:** add local browser viewer for .nitpicker archives ([dbc5427](https://github.com/d-zero-dev/nitpicker/commit/dbc5427acbdf7b1646a7040678fa014a389ef836))
- **viewer:** expose isolated-pages and unused-resources surfaces ([f4939ed](https://github.com/d-zero-dev/nitpicker/commit/f4939edc295887383463c3a5b4ede303e0ca173e))
- **viewer:** redesign summary cards, legend layout, and content-type swatches ([710734f](https://github.com/d-zero-dev/nitpicker/commit/710734f9560fa6a5b09f85601d3e85ba6a8dc042))
- **viewer:** rework summary bars and add macOS-style content-type stacked bar ([fa35ea5](https://github.com/d-zero-dev/nitpicker/commit/fa35ea5e545ad8b8db23dfb53b21d6b473846ca7))

### Performance Improvements

- **repo:** parallelize Step C and skip non-HTML BLOBs in migrate-to-0.10 ([26410b8](https://github.com/d-zero-dev/nitpicker/commit/26410b80978ce61451b0f265a1c9baee9e4fe9c0))

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

### Features

- **cli:** expose --dedupe-resources flag for report and pipeline ([7749414](https://github.com/d-zero-dev/nitpicker/commit/77494146e42ff188eaffc0716cfbd6ff5240b19a))
- **report-google-sheets:** add canonical-URL dedupe mode for the Resources sheet ([877f887](https://github.com/d-zero-dev/nitpicker/commit/877f887234ddf3eb8abe191ceb3be08e7d61be89))
- **report-google-sheets:** add Query Pattern column with precise overflow detection ([ea4b6fa](https://github.com/d-zero-dev/nitpicker/commit/ea4b6fa84cbea5f9855531e803f9b162f17d0caa))
- **report-google-sheets:** sort Resources by natural URL order before output ([62c4787](https://github.com/d-zero-dev/nitpicker/commit/62c4787d8c807addbbc3fa055f52b2a2fdca53c2))
- **report-google-sheets:** stream Phase 2/3 row sends so large reports do not OOM ([5e90c13](https://github.com/d-zero-dev/nitpicker/commit/5e90c13138f0e02d7fedf20369a7f82424ef05b6))
- **report-google-sheets:** subscribe to Sheet.onProgress in Phase 3 finalize ([c1a09cf](https://github.com/d-zero-dev/nitpicker/commit/c1a09cfdfa6769d40b94955887105ac9a41122d5))

### Performance Improvements

- **report-google-sheets:** port Martin Pool's strnatcmp for the Resources sort ([2079e6e](https://github.com/d-zero-dev/nitpicker/commit/2079e6ec46d4941e43096370015d2ddab02b5060))
- **report-google-sheets:** sort dedupe output after aggregation, not before ([3e8802e](https://github.com/d-zero-dev/nitpicker/commit/3e8802edcc4d586f186aecf978c7167dd6e10dfe))

# [0.8.0](https://github.com/d-zero-dev/nitpicker/compare/v0.7.0...v0.8.0) (2026-05-16)

### Bug Fixes

- **crawler:** dedupe initial URLs so append-mode does not race on a URL in both resume pending and the new roots ([06aeda7](https://github.com/d-zero-dev/nitpicker/commit/06aeda7924dd57fcbeeed8e61fb41900acc14a46))
- **crawler:** make scope match port-aware ([691e876](https://github.com/d-zero-dev/nitpicker/commit/691e87621e20ebf1194d14a231e53a4551675641))
- **crawler:** release archive lock on every CrawlerOrchestrator.append error path ([d8878d6](https://github.com/d-zero-dev/nitpicker/commit/d8878d68a26506601d17ad236516fd39d639f74d))
- **crawler:** stop swallowing append restore failures and tighten updateConfig safety ([b9405f1](https://github.com/d-zero-dev/nitpicker/commit/b9405f1a5fa9e340923424d09d319d199fec6b3a))

- feat(cli)!: flip --append to take URLs and use the positional as the archive ([01ee205](https://github.com/d-zero-dev/nitpicker/commit/01ee205406a4443b6a42b7a0714504f8ccffa8be))
- feat(crawler)!: merge positional roots into info.scope and crawler scope map ([1166b50](https://github.com/d-zero-dev/nitpicker/commit/1166b50a2cd293a8c6a3d42d45a435fc6d379dda))
- refactor(crawler)!: unify Crawler.start and startMultiple into a single multi-root API ([cb700df](https://github.com/d-zero-dev/nitpicker/commit/cb700df977376b81a100cb9ce5dfefeda7846a2b))
- feat(crawler)!: add info.roots column, advisory archive lock, and repromote/updateConfig DB ops ([4545614](https://github.com/d-zero-dev/nitpicker/commit/4545614386f2e5cf1f54ee15e711435c98468d9c))
- refactor(crawler)!: consolidate scope-entry lookup into findScopeEntry ([b2c9766](https://github.com/d-zero-dev/nitpicker/commit/b2c9766cb43078624f93ae0ded2ba7deb432b313))

### Features

- **cli:** accept multiple positional URLs and tighten flag exclusions ([33fd443](https://github.com/d-zero-dev/nitpicker/commit/33fd44364cfaa264b8a7eec17ddfcd56d4c0c81d))
- **cli:** add --append flag for incremental crawl on an existing archive ([9c0e02e](https://github.com/d-zero-dev/nitpicker/commit/9c0e02e605caa82fea9a3af8b39f8515e9e84fbd))
- **crawler:** add CrawlerOrchestrator.append for incremental scope expansion ([2a7fdbb](https://github.com/d-zero-dev/nitpicker/commit/2a7fdbbb2d70209d301ab62a1201ac2007243e94))
- **mcp-server:** include roots in open_archive response ([a58c942](https://github.com/d-zero-dev/nitpicker/commit/a58c942004565a584a690c87d265db85670c27b5))
- **query:** expose roots on SummaryResult and OpenArchiveResult ([0563072](https://github.com/d-zero-dev/nitpicker/commit/05630720d67aa352462eace2a9692428edb5275a))

### BREAKING CHANGES

- the CLI invocation order for append is reversed. Old
  `crawl --append archive.nitpicker https://x/` becomes
  `crawl archive.nitpicker --append https://x/`. The internal
  `CrawlerOrchestrator.append(archivePath, newUrls, ...)` JS API is unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

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

- **cli:** ensure archive close and explicit exit after work completes ([6b736b2](https://github.com/d-zero-dev/nitpicker/commit/6b736b2edf7117956aac094c00ce364a19f5fc38))
- **crawler:** cancel HEAD request timeout to prevent timer leak ([10f1b7a](https://github.com/d-zero-dev/nitpicker/commit/10f1b7a370943f953aaf7b9c7dec8153864134de))
- **github:** add dist-tag detection to publish workflow ([a4cf524](https://github.com/d-zero-dev/nitpicker/commit/a4cf5249a4382b6242bffd18dc9e8b4f2404fc43))

### Features

- **analyze-lighthouse:** cap pool concurrency to 2 to throttle chrome launches ([86943e2](https://github.com/d-zero-dev/nitpicker/commit/86943e2a29aecd28e2e47dfe8ce1dcad26acdfd8))
- **cli:** add -v / --version flag for version output ([ad9eef4](https://github.com/d-zero-dev/nitpicker/commit/ad9eef44e95083332e8ae5da5d411ad40f70631b))
- **repo:** add 7-day cooldown period for npm package releases ([cf49097](https://github.com/d-zero-dev/nitpicker/commit/cf49097d1d7453b7f2b80c4a6c1eb515075f05c0))

## [0.6.5-alpha.0](https://github.com/d-zero-dev/nitpicker/compare/v0.6.4...v0.6.5-alpha.0) (2026-04-08)

**Note:** Version bump only for package nitpicker-monorepo

## [0.6.4](https://github.com/d-zero-dev/nitpicker/compare/v0.6.3...v0.6.4) (2026-04-01)

### Bug Fixes

- **report-google-sheets:** add ServerError label to onLog countdown display ([752cec8](https://github.com/d-zero-dev/nitpicker/commit/752cec880f5af78f73111ddb52d4b583821cb4f9))
- **report-google-sheets:** fix 3 bugs in data sheet generators and add unit tests ([bf2c08d](https://github.com/d-zero-dev/nitpicker/commit/bf2c08d746eba85bcb746fc11ec25703d5222118)), closes [#14](https://github.com/d-zero-dev/nitpicker/issues/14)

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

### Bug Fixes

- add exhaustive switch checks and improve test coverage for query CLI ([0243bef](https://github.com/d-zero-dev/nitpicker/commit/0243befef5f5b19b2caca767974649e0f530256c))
- address QA review findings for query CLI command ([656e51c](https://github.com/d-zero-dev/nitpicker/commit/656e51c2338c6a7a0f3349fe298f72ab190af6ad))

### Features

- add query CLI command for querying .nitpicker archives ([f063e0a](https://github.com/d-zero-dev/nitpicker/commit/f063e0a474755b122c025f592e8c91715089ffd8))

## [0.5.1](https://github.com/d-zero-dev/nitpicker/compare/v0.5.0...v0.5.1) (2026-03-13)

### Bug Fixes

- add try/finally for exception-safe cleanup and add missing tests ([b6c4ae0](https://github.com/d-zero-dev/nitpicker/commit/b6c4ae0bfdef511f5d64bd4593504cf6209a13f0))
- remove process signal listeners to prevent MaxListenersExceededWarning ([2d7359c](https://github.com/d-zero-dev/nitpicker/commit/2d7359c4c6e72517dd4ad07da3633c59b21c15d1))

# [0.5.0](https://github.com/d-zero-dev/nitpicker/compare/v0.4.4...v0.5.0) (2026-03-13)

### Bug Fixes

- --single と --list 同時指定時の警告追加とコードコメント改善 ([f16172b](https://github.com/d-zero-dev/nitpicker/commit/f16172b03d471b63d3bbf74efd9f5e3c19625112))
- --single フラグで再帰クロールを停止するよう修正 ([c59c392](https://github.com/d-zero-dev/nitpicker/commit/c59c392c5e18bec3fe51fdc1a292054958de4623)), closes [#32](https://github.com/d-zero-dev/nitpicker/issues/32)
- add path traversal protection and improve error sanitization ([b376e86](https://github.com/d-zero-dev/nitpicker/commit/b376e867e9e759f2999552e0e24d5e3e7ce912e4))
- address QA review findings across query and mcp-server packages ([1ae9b7d](https://github.com/d-zero-dev/nitpicker/commit/1ae9b7d2a4bcc4ee83ddae39fc2214070c4d5792))
- address QA review findings for archive-manager ([d0c2171](https://github.com/d-zero-dev/nitpicker/commit/d0c21717167239eb16618d6f8ad1b4fa94de7e2f))
- address security audit findings ([99a2202](https://github.com/d-zero-dev/nitpicker/commit/99a2202f2330e606adc5f8c222e63ef98106c02a))
- **analyze-axe:** make toError parameter optional and add object test ([6afee12](https://github.com/d-zero-dev/nitpicker/commit/6afee1236712db15d03f04b0447e849bd5775654))
- **analyze-axe:** preserve stack trace when coercing caught errors ([434257d](https://github.com/d-zero-dev/nitpicker/commit/434257d9e9d3b8c264eb28f7c9b99fa9b90dcb5a)), closes [#9](https://github.com/d-zero-dev/nitpicker/issues/9)
- **analyze-lighthouse:** Chrome プロセスがエラー時にリークする問題を修正 ([6ac3271](https://github.com/d-zero-dev/nitpicker/commit/6ac3271a9f645ba99551fb8b039724ac909f910f)), closes [#8](https://github.com/d-zero-dev/nitpicker/issues/8)
- **cli,crawler:** map CLI flag names to CrawlConfig properties ([3003025](https://github.com/d-zero-dev/nitpicker/commit/30030251d0c79516795d77ddc65f1eb2c2d657ca)), closes [#1](https://github.com/d-zero-dev/nitpicker/issues/1)
- **cli:** add analyze plugins to CLI dependencies for npx compatibility ([efdfcff](https://github.com/d-zero-dev/nitpicker/commit/efdfcff36ccfac746ac0de3a223aa2c1f66c7aba)), closes [#34](https://github.com/d-zero-dev/nitpicker/issues/34)
- **cli:** address --output flag QA/PdM review findings ([a36270c](https://github.com/d-zero-dev/nitpicker/commit/a36270ce9177139df6f605dba3a459e9b042013e))
- **cli:** address QA review findings for exit code implementation ([abbb955](https://github.com/d-zero-dev/nitpicker/commit/abbb955e32b296d306aea9682ed7b8507725ad57))
- **cli:** address remaining QA review findings ([c07b4e0](https://github.com/d-zero-dev/nitpicker/commit/c07b4e0ef6084f4f34dbc9de0518d5ee634e13a5))
- **cli:** QA review fixes for pipeline command ([ab9fe4f](https://github.com/d-zero-dev/nitpicker/commit/ab9fe4f7bcdc32131b3cd670791e278ef46c359a))
- **cli:** update crawl error test to match CrawlAggregateError implementation ([690da07](https://github.com/d-zero-dev/nitpicker/commit/690da0729d223213eba85ed98382e983f36709da))
- **core:** address QA review findings for analyze error handling ([6078a62](https://github.com/d-zero-dev/nitpicker/commit/6078a6284df5857ec1fa5aea4d775bf79a40cd20))
- **core:** prevent analyze results from being silently empty ([08e9043](https://github.com/d-zero-dev/nitpicker/commit/08e9043c61d16cbdd12ad1a4c905f1417db68cce)), closes [#35](https://github.com/d-zero-dev/nitpicker/issues/35)
- crawl コマンドの入力バリデーション強化 ([9b41a74](https://github.com/d-zero-dev/nitpicker/commit/9b41a7408b7c020d6181aaee926c5ee612ffe0c3)), closes [#17](https://github.com/d-zero-dev/nitpicker/issues/17)
- **crawler:** Archive 書き込みの一貫性を保証する ([7cd3e32](https://github.com/d-zero-dev/nitpicker/commit/7cd3e3299f3129bcc43033d9f9fd011e067a78d7)), closes [#10](https://github.com/d-zero-dev/nitpicker/issues/10)
- **crawler:** clean up partial copy on fallback failure and add missing tests ([4942b11](https://github.com/d-zero-dev/nitpicker/commit/4942b113385c9c4bf3d083e61f0a1bd461353d07))
- **crawler:** fall back to cp+remove when fs.rename throws EPERM or EXDEV ([9702ef8](https://github.com/d-zero-dev/nitpicker/commit/9702ef8ae7ebb155a4d58aaa1aa040a887074801)), closes [#33](https://github.com/d-zero-dev/nitpicker/issues/33)
- **crawler:** improve crawl progress display to show done/found/remaining ([a950208](https://github.com/d-zero-dev/nitpicker/commit/a9502088ad84c521c52cdfb5476ba0e535db3a5f)), closes [#37](https://github.com/d-zero-dev/nitpicker/issues/37)
- **crawler:** QA レビュー指摘事項を修正 ([d5da50f](https://github.com/d-zero-dev/nitpicker/commit/d5da50f271e7f69283927a22c615e5de2fd64259))
- **crawler:** serialize Archive writes with WriteQueue to prevent race condition ([50b61e4](https://github.com/d-zero-dev/nitpicker/commit/50b61e4d75f3ede4cd92b298feec3accb8ed5c0a)), closes [#11](https://github.com/d-zero-dev/nitpicker/issues/11)
- **e2e:** increase CI timeouts and guard cleanup against undefined results ([a2aaa5b](https://github.com/d-zero-dev/nitpicker/commit/a2aaa5b0d8eb992b499a5cae198318ff80f395b8))
- E2Eテストの条件付きアサーションを無条件アサーションに修正 ([6293f55](https://github.com/d-zero-dev/nitpicker/commit/6293f55f8e4db434f8b2875906b6f6ad78b2af1c)), closes [#16](https://github.com/d-zero-dev/nitpicker/issues/16)
- **github:** run corepack enable before setup-node for yarn cache ([ccc60a4](https://github.com/d-zero-dev/nitpicker/commit/ccc60a48cd0769bf1f4907c0ce496b95085f8bfd))
- index.ts 禁止ルール違反を解消 ([b5d3cda](https://github.com/d-zero-dev/nitpicker/commit/b5d3cdab633c16fa73cedc4cc92ab18609312940)), closes [#15](https://github.com/d-zero-dev/nitpicker/issues/15)
- PdMレビュー指摘の修正 ([f68ac54](https://github.com/d-zero-dev/nitpicker/commit/f68ac541d66e2c897e8a8a27d832b11e482f5a03))
- QAレビュー指摘事項の一括修正 ([e461a09](https://github.com/d-zero-dev/nitpicker/commit/e461a0991359ddc151a22fbd310b67417c0f693d))
- remove remaining non-null assertions and strengthen test assertions ([75364a5](https://github.com/d-zero-dev/nitpicker/commit/75364a5003c8c829f3949322354c308bbd9a5d78))
- remove stale zod entry from lockfile ([658fc38](https://github.com/d-zero-dev/nitpicker/commit/658fc381cea336b82590a6469167baab5238181b))
- replace duplicate abort test with meaningful coverage ([22afac4](https://github.com/d-zero-dev/nitpicker/commit/22afac42086c896c5fd5074aea592cac3d27ddb5))
- **repo:** track **mock** directory to include mock.sqlite in CI ([7d5d629](https://github.com/d-zero-dev/nitpicker/commit/7d5d62998ba61bf3eb3bb6b4722d1065d412b3fc))
- resolve TS2589 and TS2339 build errors in mcp-server ([d20c8ad](https://github.com/d-zero-dev/nitpicker/commit/d20c8adc1c89cde2c09c0b97ee8fd0ae663c4931))
- URL バリデーションを全入力パスに適用 ([3e0c1f1](https://github.com/d-zero-dev/nitpicker/commit/3e0c1f18d933fc2d03d63e33f76a752ada354e3b))

### Features

- **cli:** add --all, --verbose, --silent flags to report command ([574764a](https://github.com/d-zero-dev/nitpicker/commit/574764a3a44f04177f50c55689b620b53e2387d2)), closes [#3](https://github.com/d-zero-dev/nitpicker/issues/3)
- **cli:** add --output (-o) flag to crawl command ([fcbebc8](https://github.com/d-zero-dev/nitpicker/commit/fcbebc8b91e04f0e1b89d4ed02a18f259c76925a)), closes [#5](https://github.com/d-zero-dev/nitpicker/issues/5)
- **cli:** add --plugin flag and non-TTY fallback to analyze command ([d9e28ba](https://github.com/d-zero-dev/nitpicker/commit/d9e28badb4e615b1a97c5283752ebbd3d8fb2885)), closes [#2](https://github.com/d-zero-dev/nitpicker/issues/2)
- **cli:** add error handling and verbose support to analyze and report commands ([b9e79b9](https://github.com/d-zero-dev/nitpicker/commit/b9e79b9b06bc4bd4154eee4658f5981debbcae81))
- **cli:** add pipeline subcommand for sequential crawl → analyze → report execution ([b0e1494](https://github.com/d-zero-dev/nitpicker/commit/b0e14943e5e2229d478af626110f896a9d5be80e)), closes [#7](https://github.com/d-zero-dev/nitpicker/issues/7)
- **cli:** add plugin option CLI flags to analyze command ([a504717](https://github.com/d-zero-dev/nitpicker/commit/a5047176833691a2bbd89c3320ac0f7b2ebdf813)), closes [#4](https://github.com/d-zero-dev/nitpicker/issues/4)
- **cli:** improve exit code granularity for CI/CD pipelines ([57d67cb](https://github.com/d-zero-dev/nitpicker/commit/57d67cb4c6077b0a4c535fddccb7717acd05385d)), closes [#36](https://github.com/d-zero-dev/nitpicker/issues/36)
- implement .nitpicker archive query MCP server ([#21](https://github.com/d-zero-dev/nitpicker/issues/21)) ([9f0f407](https://github.com/d-zero-dev/nitpicker/commit/9f0f4079219c97990724a75cd04fcf41ca1ac82d))
- reuse extracted archive when same file is opened multiple times ([7316e87](https://github.com/d-zero-dev/nitpicker/commit/7316e878cd75d5dd53b0927fe0cc9432fb2bb5a2))

### Reverts

- **ci:** remove E2E job from CI workflow ([eaa5215](https://github.com/d-zero-dev/nitpicker/commit/eaa52153bc9248b3a8ee5501fe51019c8743a802)), closes [#13](https://github.com/d-zero-dev/nitpicker/issues/13)
- remove out-of-scope changes (report-google-sheets tests, docs) ([c54f14f](https://github.com/d-zero-dev/nitpicker/commit/c54f14f5782399f5284a506a6e317dab146b87fe)), closes [#13](https://github.com/d-zero-dev/nitpicker/issues/13)

## [0.4.4](https://github.com/d-zero-dev/nitpicker/compare/v0.4.3...v0.4.4) (2026-03-02)

### Bug Fixes

- **crawler:** add missing userAgent and ignoreRobots columns to info table schema ([e62776d](https://github.com/d-zero-dev/nitpicker/commit/e62776dea5945ae58e9d547aa3bfc49fc63bae13))

## [0.4.3](https://github.com/d-zero-dev/nitpicker/compare/v0.4.2...v0.4.3) (2026-03-02)

### Bug Fixes

- add files field to all package.json to explicitly include lib/ in npm packages ([d1a7625](https://github.com/d-zero-dev/nitpicker/commit/d1a76255dc5af5f6a12cdef275e473ab637e1cbb)), closes [#20](https://github.com/d-zero-dev/nitpicker/issues/20)
- explicitly include bin directory in @nitpicker/cli files field ([514cea6](https://github.com/d-zero-dev/nitpicker/commit/514cea672c1b471cfd40f65decbcbeae771adc40))

## [0.4.2](https://github.com/d-zero-dev/nitpicker/compare/v0.4.1...v0.4.2) (2026-02-27)

**Note:** Version bump only for package nitpicker-monorepo

## [0.4.1](https://github.com/d-zero-dev/nitpicker/compare/v0.4.0...v0.4.1) (2026-02-27)

**Note:** Version bump only for package nitpicker-monorepo
