# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.17.0](https://github.com/d-zero-dev/nitpicker/compare/v0.16.0...v0.17.0) (2026-08-09)

### Bug Fixes

- **query:** expose isDedupeCapped on PageListItem across all list paths ([4096b15](https://github.com/d-zero-dev/nitpicker/commit/4096b15f7df187e4d223801716e54fae4f6450f5))

### Features

- **query:** mark dedupe-cap trap pages after the fact via viewer-build ([73eaaeb](https://github.com/d-zero-dev/nitpicker/commit/73eaaeb7d8d6b9ae59ec8880aface0570a19d1bc))
- **query:** return exclude_skipped from inventory-runs listings ([6e68284](https://github.com/d-zero-dev/nitpicker/commit/6e682843a733c1bedaa06fe704ce30b92d300a95)), closes [#260](https://github.com/d-zero-dev/nitpicker/issues/260)
- **query:** surface crawl exclude settings in SummaryResult ([2f87e01](https://github.com/d-zero-dev/nitpicker/commit/2f87e01a49589e0e7bed7b407251b44d4bcb4403))

# [0.16.0](https://github.com/d-zero-dev/nitpicker/compare/v0.15.0...v0.16.0) (2026-08-07)

### Bug Fixes

- **query:** validate limit/offset and batch duplicate-cluster URL fetches ([112c6cd](https://github.com/d-zero-dev/nitpicker/commit/112c6cd6e1aaa955b712e21e70b8071a392aef24)), closes [#208](https://github.com/d-zero-dev/nitpicker/issues/208)

### Features

- **query:** add duplicate-body-cluster and dedupe-cap-event queries ([7c5fd9a](https://github.com/d-zero-dev/nitpicker/commit/7c5fd9a3585a5a27d457871ea482aec8b32a00f9)), closes [#208](https://github.com/d-zero-dev/nitpicker/issues/208)
- **query:** exclude 404 pages from summary totals and the directory tree ([6065ba0](https://github.com/d-zero-dev/nitpicker/commit/6065ba0234c3a96a68a1c724140f9f11c6f6c720))
- **query:** OR-combine boolean/lang filters on the viewer fast path ([f98028d](https://github.com/d-zero-dev/nitpicker/commit/f98028d069f59e91d2dbed2043ea0d3faff3ee4e))
- **query:** OR-combine multi-value enum filters on the fast path ([9891406](https://github.com/d-zero-dev/nitpicker/commit/98914064e34a084cf3caa276cc59971b4856dfa4))
- **query:** serve every viewer filter/sort from the read model fast path ([89c3165](https://github.com/d-zero-dev/nitpicker/commit/89c316580fc3907ff322814e80b07628291effa9))

# [0.15.0](https://github.com/d-zero-dev/nitpicker/compare/v0.14.0...v0.15.0) (2026-07-30)

### Bug Fixes

- **query:** show directory distribution instead of single common prefix ([9429e17](https://github.com/d-zero-dev/nitpicker/commit/9429e1776b3926401ba8ab1dbb892ae0aa5168f5))

- feat(query)!: split inbound links out of getPageDetail into listInboundLinks ([e3889fc](https://github.com/d-zero-dev/nitpicker/commit/e3889fc006b9e902185b1f4cfd6009a89ac2b25c))

### Features

- **query:** add console log read APIs and viewer read model support ([6d9304c](https://github.com/d-zero-dev/nitpicker/commit/6d9304c682028d373dbeb31c3a4de15d3e8acc66))
- **query:** add findDuplicateBodies and body_hash backfill ([bd1f87f](https://github.com/d-zero-dev/nitpicker/commit/bd1f87f634c2d1dc76f4033b94adea25b2d3ae3e))
- **query:** add template cluster summary aggregation ([be388c8](https://github.com/d-zero-dev/nitpicker/commit/be388c86ecb87d6433c734bf5a48ff454585989d))
- **query:** expose cluster-selection reason on template cluster summaries ([32741fc](https://github.com/d-zero-dev/nitpicker/commit/32741fc11bfd1ab3d65095e127ae3e3d2a681ec5))
- **query:** merge URL-normalization-equivalent pages via alias_of_id ([f13797b](https://github.com/d-zero-dev/nitpicker/commit/f13797b8d62bc64b7c3565035de8142af717db25))
- **query:** read ClusterReason from page_template_cluster_reasons ([ba535e6](https://github.com/d-zero-dev/nitpicker/commit/ba535e6ecd41c227ee5229b02c10c8b1f02086b0))
- **query:** split failure attribution between site and network causes ([5cf14d1](https://github.com/d-zero-dev/nitpicker/commit/5cf14d13b7ea0cd9d0fc34c6d13b8574f38722d8))
- **query:** surface invalid_skipped and tolerate its absence on old archives ([972b8c5](https://github.com/d-zero-dev/nitpicker/commit/972b8c578e68b0d184c119bb989437fee477110d))

### BREAKING CHANGES

- PageDetail no longer has an inboundLinks field. Use
  listInboundLinks(accessor, { url }) instead.

# [0.14.0](https://github.com/d-zero-dev/nitpicker/compare/v0.13.0...v0.14.0) (2026-07-24)

### Features

- **query:** expose main-content data through getPageMainContents and list views ([f0e3f67](https://github.com/d-zero-dev/nitpicker/commit/f0e3f67ff03b9be4a727f2cf2b712602eeb6f2f5))
- **query:** expose templateKey on page-list/detail reads and support filtering ([e631305](https://github.com/d-zero-dev/nitpicker/commit/e631305cd435ba4b1cc0068f3aa70894bb3242ed))
- **query:** let the viewer_pages fast path resolve a directory filter ([0f3b9bd](https://github.com/d-zero-dev/nitpicker/commit/0f3b9bdfb790be80d5711b5a98da9df26598ce8e))
- **query:** track html-only page counts in the directory-tree read model ([5ba6d62](https://github.com/d-zero-dev/nitpicker/commit/5ba6d62daa963727e2927457ba68ff9ad8b93367))

# [0.13.0](https://github.com/d-zero-dev/nitpicker/compare/v0.12.0...v0.13.0) (2026-07-21)

### Bug Fixes

- chain populate-migration into crawler write path and reader spec ordering ([e9cc84e](https://github.com/d-zero-dev/nitpicker/commit/e9cc84e6054cb5596fc63db0a6ebb83af78eb95a)), closes [#196](https://github.com/d-zero-dev/nitpicker/issues/196)
- **query,viewer:** restore header-presence data on the viewer_pages fast path ([e6b2617](https://github.com/d-zero-dev/nitpicker/commit/e6b2617bb91f4e186ed4c420bcfa9f33b4b97fe5))
- **query:** accept line/col in the legacy violations backfill payload ([d4bb047](https://github.com/d-zero-dev/nitpicker/commit/d4bb047367678edaddc2e2b37c145426c82a33bc)), closes [#225](https://github.com/d-zero-dev/nitpicker/issues/225)
- **query:** address phase 6-f code-review findings ([b888c05](https://github.com/d-zero-dev/nitpicker/commit/b888c051106a8550527e638b2a4288dda26fce9e))
- **query:** avoid conflicting eslint/prettier hex-literal casing in a test ([9e06940](https://github.com/d-zero-dev/nitpicker/commit/9e069400f2433965715838b779b8ad8aec0e9db5))
- **query:** bound memory and defer indexes in viewer read-model build ([37ddad5](https://github.com/d-zero-dev/nitpicker/commit/37ddad5bb8c523422b2afed8b58095b24e9122fe))
- **query:** clamp violation pagination inputs ([bf965c6](https://github.com/d-zero-dev/nitpicker/commit/bf965c69078b365aeb139336145bb639b038e3e0))
- **query:** consolidate error-kinds sortBy validation and tie-break ([acf5532](https://github.com/d-zero-dev/nitpicker/commit/acf5532176a909c023cfe35084c6f14c1a901f26))
- **query:** propagate source column through viewer_graph_nodes fast path ([8def955](https://github.com/d-zero-dev/nitpicker/commit/8def95520f8df30adb5c5108b0a5302da7e49647))
- **query:** remove on-open opportunistic viewer read model build ([61cca63](https://github.com/d-zero-dev/nitpicker/commit/61cca63899c3650001fb4f622702b4ca52c287c1)), closes [#112](https://github.com/d-zero-dev/nitpicker/issues/112)
- **query:** reshape viewer*error_kind*\* read model to host×kind entries ([9c78662](https://github.com/d-zero-dev/nitpicker/commit/9c7866275772c76f6a341b238662a5b1fb5012a2)), closes [#106](https://github.com/d-zero-dev/nitpicker/issues/106)
- **query:** resolve unreachable JSDoc {[@link](https://github.com/link)} references ([3ad6718](https://github.com/d-zero-dev/nitpicker/commit/3ad67185a2d69ecaae1ef7ef6a810a54c283d807))
- **query:** restore \x1F URL_DELIMITER in find-duplicates and align reader specs with 0.13 API changes ([0108ef2](https://github.com/d-zero-dev/nitpicker/commit/0108ef2450cb038401547420fde1270b82016fd4))
- **query:** surface blob-routed resources instead of dropping them ([2e00331](https://github.com/d-zero-dev/nitpicker/commit/2e00331633b4286068717184135d2e52d9a7d320))

- feat(query)!: normalize error-kinds aggregation to host×kind rows ([f9bd2c6](https://github.com/d-zero-dev/nitpicker/commit/f9bd2c61e5740c2a517f664191a40d8c03dc1e3f))
- feat(query)!: narrow broken links to 404, merge header checks into page lists ([bce3379](https://github.com/d-zero-dev/nitpicker/commit/bce3379eed866b121b786ff6c0801d4eb578c351))

### Features

- **query:** add directory tree read model and query functions ([ee0a385](https://github.com/d-zero-dev/nitpicker/commit/ee0a385191e048bd119ef64d61c5118f8d5ff185)), closes [#107](https://github.com/d-zero-dev/nitpicker/issues/107)
- **query:** add listExternalLinks with destination dedup and referrer counts ([cf559a5](https://github.com/d-zero-dev/nitpicker/commit/cf559a58b00e3c3c770b4aef5df48aa3b4a58b55))
- **query:** add status filters to list queries ([1c0d038](https://github.com/d-zero-dev/nitpicker/commit/1c0d038f027c220a0c8e2f760ee30d7952ec4c8e))
- **query:** add viewer read model cache infrastructure ([a9cfd0d](https://github.com/d-zero-dev/nitpicker/commit/a9cfd0d8cede10dff6f89dffce0b2d7aba8f87ba)), closes [#112](https://github.com/d-zero-dev/nitpicker/issues/112) [#105](https://github.com/d-zero-dev/nitpicker/issues/105) [#108](https://github.com/d-zero-dev/nitpicker/issues/108)
- **query:** add viewer_anchor_facts edge read model for broken links ([#114](https://github.com/d-zero-dev/nitpicker/issues/114)) ([e53175c](https://github.com/d-zero-dev/nitpicker/commit/e53175c69d6731a5cfa894b6e7d8f26624272d9b))
- **query:** add viewer_duplicate_groups/mismatches read models (issue [#115](https://github.com/d-zero-dev/nitpicker/issues/115)) ([1866e03](https://github.com/d-zero-dev/nitpicker/commit/1866e03f78348829f57b2c9f353bae4253991afd)), closes [#119](https://github.com/d-zero-dev/nitpicker/issues/119)
- **query:** add viewer*error_kind*\* read model for /api/error-kinds (issue [#118](https://github.com/d-zero-dev/nitpicker/issues/118)) ([9fd24d7](https://github.com/d-zero-dev/nitpicker/commit/9fd24d774c89ceca4e1150353f56a82cd249e778)), closes [#139](https://github.com/d-zero-dev/nitpicker/issues/139)
- **query:** add viewer_external_links read model for fast external-link listing ([4dc5a4e](https://github.com/d-zero-dev/nitpicker/commit/4dc5a4e6b7858ea65ae3ead4c88066745670b6c7))
- **query:** add viewer_header_checks read model for /api/headers fast path ([9582754](https://github.com/d-zero-dev/nitpicker/commit/9582754f57f3e0797d2613931f048d7b2efe8c35)), closes [#119](https://github.com/d-zero-dev/nitpicker/issues/119)
- **query:** add viewer_images read model for /api/images fast path ([046a016](https://github.com/d-zero-dev/nitpicker/commit/046a01665f17e907f873c0aff3fb617b1ea887d3)), closes [epic-#103](https://github.com/epic-/issues/103) [#113](https://github.com/d-zero-dev/nitpicker/issues/113)
- **query:** add viewer_pages cursor pagination read path ([d297ef5](https://github.com/d-zero-dev/nitpicker/commit/d297ef509a4ef32bae2599944648dd96ace14e24))
- **query:** add viewer_summary read model for /api/summary (issue [#104](https://github.com/d-zero-dev/nitpicker/issues/104)) ([1ac6e22](https://github.com/d-zero-dev/nitpicker/commit/1ac6e2283577bfa67ea0365ac9ac229005ca1a22))
- **query:** build viewer read model on crawl-completion hook and on-open ([66bad5a](https://github.com/d-zero-dev/nitpicker/commit/66bad5a5d4b9ab52e10f6df567cedbdb122544a7)), closes [#112](https://github.com/d-zero-dev/nitpicker/issues/112)
- **query:** expose page source in link graph nodes ([aeeb90a](https://github.com/d-zero-dev/nitpicker/commit/aeeb90a902e254197f72c562bbbba6f4d04b588c))
- **query:** persist natural URL sort rank in the viewer read model ([dd1f343](https://github.com/d-zero-dev/nitpicker/commit/dd1f343ec16a562307030dfef9656f3c6f781ca9))
- **query:** precompute /api/pages facets and benchmark viewer_pages fast path ([a9c795c](https://github.com/d-zero-dev/nitpicker/commit/a9c795ca3ec7d17588a9d7fdee3abbcd514381e1)), closes [#148](https://github.com/d-zero-dev/nitpicker/issues/148) [#106](https://github.com/d-zero-dev/nitpicker/issues/106)
- **query:** precompute /api/resources and /api/unused-resources via a viewer_resources read model ([b6b6662](https://github.com/d-zero-dev/nitpicker/commit/b6b66620412e3f7f106b12b913c6a5de5c83b20d))
- **query:** share viewer link urls through refs ([ff5abf5](https://github.com/d-zero-dev/nitpicker/commit/ff5abf5036d317c9f29eda29ed7b6377f0736942))
- **query:** sort viewer URL ranks with an external merge sort ([703f250](https://github.com/d-zero-dev/nitpicker/commit/703f250b6f34043af851bbd7529d757c0daa83fa))
- **query:** switch phase 6-f readers to new entity tables ([e5ff302](https://github.com/d-zero-dev/nitpicker/commit/e5ff30234cd52c7bc7c1aa80704f80b0144579f6))
- **repo:** move analysis violations to sql ([3cec379](https://github.com/d-zero-dev/nitpicker/commit/3cec379d6d79696924a98960368ed30109b41fdb))
- **repo:** precompute isolated and graph viewer reads ([577cce6](https://github.com/d-zero-dev/nitpicker/commit/577cce6d13c583a1b0224a3bb55b50bff722420b))
- **viewer:** add spreadsheet table controls ([ba2ca5d](https://github.com/d-zero-dev/nitpicker/commit/ba2ca5d2b314fbba724ef044dc6bb7df64f9f4c3))

### Performance Improvements

- **query:** remove duplicate sortUrl call in buildUrlRanks ([a1a06b3](https://github.com/d-zero-dev/nitpicker/commit/a1a06b3a2bc50a90315ce10a4bf204f2b7b3db7b))

### BREAKING CHANGES

- ErrorKindsResult is now { items, total, facets }
  instead of { total, channelSource, groups }. ErrorKindGroup and
  ErrorKindHost are removed in favor of ErrorKindEntry and
  ErrorKindFacets. Sample URLs are capped per host×kind pair (not per
  kind) with an overflowedCount for anything beyond the cap. Adds
  host/kind/sortBy/sortOrder/limit/offset filtering, validating sortBy
  against a fixed set of fields so an out-of-range value falls back to
  count-desc instead of crashing.
- listLinks' broken judgment is now strictly canonical
  status = 404 (previously >= 400 or no status), so 403/5xx/excluded
  destinations no longer count as broken. listPageLinks and its
  PageLinkEntry/ListPageLinksOptions/PaginatedPageLinkList types are removed
  (no remaining consumer). listPages/listPagesByTag/listPagesByJsonLdType now
  compute hasCSP/hasXFrameOptions/hasXContentTypeOptions/hasHSTS via SQL
  instead of transferring the raw responseHeaders blob to JS. getPageDetail
  gains isSkipped/skipReason so a URL's exclusion reason is still
  discoverable now that listPageLinks is gone.

New @nitpicker/query/header-presence subpath exports HEADER_PRESENCE_KEYS
as the single source of truth for the tracked header set.

# [0.12.0](https://github.com/d-zero-dev/nitpicker/compare/v0.11.0...v0.12.0) (2026-07-01)

### Bug Fixes

- **crawler,query,cli:** drop inventory_runs.source_file_path column ([5514e59](https://github.com/d-zero-dev/nitpicker/commit/5514e5959ac4d33b57a5f45a430c3c58857ceda7))
- **query:** exclude excludes-pattern pages from summary distributions ([0284b5e](https://github.com/d-zero-dev/nitpicker/commit/0284b5ec76290c6460976943b60e9da0756fd7dc))

### Features

- **crawler,query,cli:** inventory_runs audit log (Phase 1) ([4fccf41](https://github.com/d-zero-dev/nitpicker/commit/4fccf410c7a60625ad55f39f2d71e5d92b8bffcf))
- **query,viewer:** subdivide status=-1 by errorKind in Summary ([cd9a85b](https://github.com/d-zero-dev/nitpicker/commit/cd9a85bc4ac0c168f6c5760e18d92f4a64b022a7))
- **query:** accept precomputed components / referrer-count map on isolated-\* and page-links ([bf610fd](https://github.com/d-zero-dev/nitpicker/commit/bf610fd61be379816403996e74e14774841440f3))
- **query:** isolated-clusters + source-based isolated-pages + redirect-resolved listLinks ([48d3e77](https://github.com/d-zero-dev/nitpicker/commit/48d3e77e6796583e307f79968eb062ccb30db190))
- **query:** route ArchiveManager open through Archive.openCached ([f607cfd](https://github.com/d-zero-dev/nitpicker/commit/f607cfd5fb4b1989279b3af98384493124ab864c))

### Performance Improvements

- **query:** SQL-first sweep — N+1 → GROUP_CONCAT, parallelise graph fetch, document accepted costs ([508f4b8](https://github.com/d-zero-dev/nitpicker/commit/508f4b8c28f6a2e82bfc1b5051bc7e2176da669b))

# [0.11.0](https://github.com/d-zero-dev/nitpicker/compare/v0.9.0...v0.11.0) (2026-06-18)

### Bug Fixes

- **query:** exclude non-HTML resources (not errored pages) from page list and summary ([354e0b7](https://github.com/d-zero-dev/nitpicker/commit/354e0b7fd861f7e44e80cf0f1da15a70b68ac15d)), closes [#72](https://github.com/d-zero-dev/nitpicker/issues/72)
- **query:** resolve inbound links and referrer counts through redirects ([f39b4b4](https://github.com/d-zero-dev/nitpicker/commit/f39b4b4c5ca66bc64640a34cbeb503a82b3d4ac0)), closes [#71](https://github.com/d-zero-dev/nitpicker/issues/71)

### Features

- **crawler:** add source provenance column to pages and resources ([1a78fe1](https://github.com/d-zero-dev/nitpicker/commit/1a78fe12eb786c8f7292bcd8bf5e423aee046178))
- **crawler:** thread inventoryMode source label through Crawler → Archive → Database ([109d346](https://github.com/d-zero-dev/nitpicker/commit/109d346503af5ada413bb3fd5a3f5e4a3bacaf36))
- **query:** accept stub directories in ArchiveManager.open ([d51b605](https://github.com/d-zero-dev/nitpicker/commit/d51b60517e9aa83108fd3142e800521b4aa8ca5d))
- **query:** add content-type classification engine ([529df8c](https://github.com/d-zero-dev/nitpicker/commit/529df8c4daddb1ceb7f8a685662da26999b22af9))
- **query:** add link-graph and per-page-links queries ([4b8fb69](https://github.com/d-zero-dev/nitpicker/commit/4b8fb69fbf7d891c4c6551fabfd387a949376313))
- **query:** add listIsolatedPages / listUnusedResources ([5a467d3](https://github.com/d-zero-dev/nitpicker/commit/5a467d304bd0f9764d88c7c08b287434c3d0f25c))
- **query:** classify crawl failures by cause with getErrorKinds + error-kinds query ([a7601ad](https://github.com/d-zero-dev/nitpicker/commit/a7601adec4213dcb84deef9773d519ed1114ce3e))
- **query:** expand ContentTypeCategory and add content-row totals to summary ([bac1aed](https://github.com/d-zero-dev/nitpicker/commit/bac1aedefd830ad24f620e3d38fba38add218917))

# [0.9.0](https://github.com/d-zero-dev/nitpicker/compare/v0.8.0...v0.9.0) (2026-05-29)

**Note:** Version bump only for package @nitpicker/query

# [0.8.0](https://github.com/d-zero-dev/nitpicker/compare/v0.7.0...v0.8.0) (2026-05-16)

### Features

- **query:** expose roots on SummaryResult and OpenArchiveResult ([0563072](https://github.com/d-zero-dev/nitpicker/commit/05630720d67aa352462eace2a9692428edb5275a))

# [0.7.0](https://github.com/d-zero-dev/nitpicker/compare/v0.6.5-alpha.0...v0.7.0) (2026-05-13)

**Note:** Version bump only for package @nitpicker/query

## [0.6.5-alpha.0](https://github.com/d-zero-dev/nitpicker/compare/v0.6.4...v0.6.5-alpha.0) (2026-04-08)

**Note:** Version bump only for package @nitpicker/query

## [0.6.3](https://github.com/d-zero-dev/nitpicker/compare/v0.6.2...v0.6.3) (2026-03-30)

### Bug Fixes

- **cli,crawler,query:** address QA review findings ([0c53d1e](https://github.com/d-zero-dev/nitpicker/commit/0c53d1e8a2b32a0cb1101975232ca3d356f2ad61))

## [0.6.2](https://github.com/d-zero-dev/nitpicker/compare/v0.6.1...v0.6.2) (2026-03-30)

**Note:** Version bump only for package @nitpicker/query

## [0.6.1](https://github.com/d-zero-dev/nitpicker/compare/v0.6.0...v0.6.1) (2026-03-27)

**Note:** Version bump only for package @nitpicker/query

# [0.6.0](https://github.com/d-zero-dev/nitpicker/compare/v0.5.1...v0.6.0) (2026-03-16)

**Note:** Version bump only for package @nitpicker/query

# [0.5.0](https://github.com/d-zero-dev/nitpicker/compare/v0.4.4...v0.5.0) (2026-03-13)

### Bug Fixes

- add path traversal protection and improve error sanitization ([b376e86](https://github.com/d-zero-dev/nitpicker/commit/b376e867e9e759f2999552e0e24d5e3e7ce912e4))
- address QA review findings across query and mcp-server packages ([1ae9b7d](https://github.com/d-zero-dev/nitpicker/commit/1ae9b7d2a4bcc4ee83ddae39fc2214070c4d5792))
- address QA review findings for archive-manager ([d0c2171](https://github.com/d-zero-dev/nitpicker/commit/d0c21717167239eb16618d6f8ad1b4fa94de7e2f))
- address security audit findings ([99a2202](https://github.com/d-zero-dev/nitpicker/commit/99a2202f2330e606adc5f8c222e63ef98106c02a))
- remove remaining non-null assertions and strengthen test assertions ([75364a5](https://github.com/d-zero-dev/nitpicker/commit/75364a5003c8c829f3949322354c308bbd9a5d78))

### Features

- implement .nitpicker archive query MCP server ([#21](https://github.com/d-zero-dev/nitpicker/issues/21)) ([9f0f407](https://github.com/d-zero-dev/nitpicker/commit/9f0f4079219c97990724a75cd04fcf41ca1ac82d))
- reuse extracted archive when same file is opened multiple times ([7316e87](https://github.com/d-zero-dev/nitpicker/commit/7316e878cd75d5dd53b0927fe0cc9432fb2bb5a2))
