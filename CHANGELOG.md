# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.17.0](https://github.com/d-zero-dev/nitpicker/compare/v0.16.0...v0.17.0) (2026-08-09)

### Bug Fixes

- **crawler:** normalize maxExcludedDepth to 0 when NULL in the info table ([e4501ce](https://github.com/d-zero-dev/nitpicker/commit/e4501ce56677fca54ba98f1c2343d1d0f5b23361))
- **crawler:** provision adjunct tables in insert-inventory-content-items.spec.ts ([4e769dd](https://github.com/d-zero-dev/nitpicker/commit/4e769dd37850ba73d4931e02b93a2cfee9fb129c))
- **crawler:** record exclude-matched inventory URLs as skipped pages ([6c9f30b](https://github.com/d-zero-dev/nitpicker/commit/6c9f30b4e5f154173097d13b4f0ba03d8b124104)), closes [#260](https://github.com/d-zero-dev/nitpicker/issues/260)
- **github:** move dedupe-cap.e2e.ts off the already-heaviest e2e shard ([3ad7e5d](https://github.com/d-zero-dev/nitpicker/commit/3ad7e5d0e28b5598bd10aafe5f16aade940beb0f))
- **query:** expose isDedupeCapped on PageListItem across all list paths ([4096b15](https://github.com/d-zero-dev/nitpicker/commit/4096b15f7df187e4d223801716e54fae4f6450f5))
- **viewer:** add a real isDedupeCapped column so its filter button renders ([6f8f0b3](https://github.com/d-zero-dev/nitpicker/commit/6f8f0b3147283c5d2606dedee59fbbe0077c43f4))

### Features

- **cli:** default-enable --dedupe-cap and expose --isDedupeCapped on query pages ([7b31a4c](https://github.com/d-zero-dev/nitpicker/commit/7b31a4c0f8b77280d70e5a8007d6129605ba4f57))
- **cli:** restructure --help output with usage lines, flag groups, and sub-command help ([d9fe791](https://github.com/d-zero-dev/nitpicker/commit/d9fe7911df4d8c441ba66e5e648e9e47ea8ecf51))
- **crawler:** add content_items.dedupe_cap_event_id for post-hoc trap marking ([b59fb17](https://github.com/d-zero-dev/nitpicker/commit/b59fb1720a61d741459e581a30035db66cacc957))
- **mcp-server:** expose isDedupeCapped on list_pages/get_page_detail ([41e0090](https://github.com/d-zero-dev/nitpicker/commit/41e0090b3b595ea6a8fb8983b6534cff78e13d69))
- **query:** mark dedupe-cap trap pages after the fact via viewer-build ([73eaaeb](https://github.com/d-zero-dev/nitpicker/commit/73eaaeb7d8d6b9ae59ec8880aface0570a19d1bc))
- **query:** return exclude_skipped from inventory-runs listings ([6e68284](https://github.com/d-zero-dev/nitpicker/commit/6e682843a733c1bedaa06fe704ce30b92d300a95)), closes [#260](https://github.com/d-zero-dev/nitpicker/issues/260)
- **query:** surface crawl exclude settings in SummaryResult ([2f87e01](https://github.com/d-zero-dev/nitpicker/commit/2f87e01a49589e0e7bed7b407251b44d4bcb4403))
- **viewer:** add isDedupeCapped filter and page-detail display ([962baee](https://github.com/d-zero-dev/nitpicker/commit/962baee427fb95c8333d7d2fafa7042c7b879505))
- **viewer:** display crawl exclude settings on the summary view ([e400b40](https://github.com/d-zero-dev/nitpicker/commit/e400b403bfa6756d2c114807c34687b746a41cad))

# [0.16.0](https://github.com/d-zero-dev/nitpicker/compare/v0.15.0...v0.16.0) (2026-08-07)

### Bug Fixes

- **cli:** show npx @nitpicker/cli in usage and cache hints ([95f7b27](https://github.com/d-zero-dev/nitpicker/commit/95f7b273296ded400ef5bcadb15cbeccd37a76b8))
- **crawler:** decode percent-encoded basic auth credentials before forwarding ([d4cc182](https://github.com/d-zero-dev/nitpicker/commit/d4cc1828cffd6ce9fe23bcd217740a23d1944754))
- **crawler:** fix rejected_count finalization gap, stale body_hash comparison, and gate inconsistency ([e8dcf76](https://github.com/d-zero-dev/nitpicker/commit/e8dcf76cd7b7afe1610ef4ce3dbcb3725b2376f7)), closes [#208](https://github.com/d-zero-dev/nitpicker/issues/208)
- **query:** validate limit/offset and batch duplicate-cluster URL fetches ([112c6cd](https://github.com/d-zero-dev/nitpicker/commit/112c6cd6e1aaa955b712e21e70b8071a392aef24)), closes [#208](https://github.com/d-zero-dev/nitpicker/issues/208)
- **repo:** forbid client info from leaking into PR body ([f57cd2b](https://github.com/d-zero-dev/nitpicker/commit/f57cd2bd8f603eb7d1108e3023b600b6e35b7373))
- **viewer:** build the e2e read model and stop retrying deterministic refusals ([5a3247a](https://github.com/d-zero-dev/nitpicker/commit/5a3247a5dec63476b13a747c3adff94166282443))
- **viewer:** show npx @nitpicker/cli in command hints ([4780b7a](https://github.com/d-zero-dev/nitpicker/commit/4780b7af01009a79b00f01501ec8921d26af2612))
- **viewer:** treat an empty ?lang= value as no filter, not zero rows ([f2a2253](https://github.com/d-zero-dev/nitpicker/commit/f2a2253b4a587f1e814d1aa6e9db9aaedb1fcf30)), closes [#252](https://github.com/d-zero-dev/nitpicker/issues/252)

### Features

- **cli:** add --dedupe-cap flags and duplicate-clusters/dedupe-cap-events subcommands ([ef46282](https://github.com/d-zero-dev/nitpicker/commit/ef4628228a8c0747655311cd3ee1eb65d31ab53b)), closes [#208](https://github.com/d-zero-dev/nitpicker/issues/208)
- **cli:** fail fast when Chrome is missing before crawl/pipeline runs ([e304e30](https://github.com/d-zero-dev/nitpicker/commit/e304e30ce42dc58069deb76839ad47bb2ffbeca2))
- **crawler:** add assertChromeIsInstalled preflight check ([2462172](https://github.com/d-zero-dev/nitpicker/commit/2462172f7b1a03b157a3e14e405b8e76a72b99b0))
- **crawler:** classify redirect loops as a distinct error kind ([72d044d](https://github.com/d-zero-dev/nitpicker/commit/72d044dcbf02c544bb9ccb991224882ffbaddcc5))
- **crawler:** fix self-generating pagination URLs and add dedupe-cap soft cap ([f3d9fb8](https://github.com/d-zero-dev/nitpicker/commit/f3d9fb8cb0edece62177f168f797382ab9e3d540)), closes [#208](https://github.com/d-zero-dev/nitpicker/issues/208)
- **mcp-server:** add find_duplicate_clusters and list_dedupe_cap_events tools ([e41a423](https://github.com/d-zero-dev/nitpicker/commit/e41a4230e6b8b9ba1315ef9dd8b922c642e5cbeb)), closes [#208](https://github.com/d-zero-dev/nitpicker/issues/208)
- **query:** add duplicate-body-cluster and dedupe-cap-event queries ([7c5fd9a](https://github.com/d-zero-dev/nitpicker/commit/7c5fd9a3585a5a27d457871ea482aec8b32a00f9)), closes [#208](https://github.com/d-zero-dev/nitpicker/issues/208)
- **query:** exclude 404 pages from summary totals and the directory tree ([6065ba0](https://github.com/d-zero-dev/nitpicker/commit/6065ba0234c3a96a68a1c724140f9f11c6f6c720))
- **query:** OR-combine boolean/lang filters on the viewer fast path ([f98028d](https://github.com/d-zero-dev/nitpicker/commit/f98028d069f59e91d2dbed2043ea0d3faff3ee4e))
- **query:** OR-combine multi-value enum filters on the fast path ([9891406](https://github.com/d-zero-dev/nitpicker/commit/98914064e34a084cf3caa276cc59971b4856dfa4))
- **query:** serve every viewer filter/sort from the read model fast path ([89c3165](https://github.com/d-zero-dev/nitpicker/commit/89c316580fc3907ff322814e80b07628291effa9))
- **viewer:** add Duplicate Clusters view for issue [#208](https://github.com/d-zero-dev/nitpicker/issues/208) ([7cb87f1](https://github.com/d-zero-dev/nitpicker/commit/7cb87f1027d382dda36dd10c2ebee9d583d0f8d1))
- **viewer:** add redirect-loop error kind label (en/ja) ([65a55f3](https://github.com/d-zero-dev/nitpicker/commit/65a55f3e5ffe21f0888e89e1a7dcaf70cf8e0783))
- **viewer:** convert remaining boolean/lang filters from radio to OR checkboxes ([09ea0e9](https://github.com/d-zero-dev/nitpicker/commit/09ea0e9c04dc78d42437b0e1261a1098aeda8832))
- **viewer:** refuse stale read models with guidance instead of silent live fallback ([35fa0ab](https://github.com/d-zero-dev/nitpicker/commit/35fa0ab0df7f4e64434e0712c3529f22079929c8))
- **viewer:** render the inventory-seed 404 row in the summary status histogram ([6ed9f08](https://github.com/d-zero-dev/nitpicker/commit/6ed9f08e02d8d771eea3e6a97cf78ca62101d681))
- **viewer:** switch enum table filters from radio to OR checkboxes ([6a4e68e](https://github.com/d-zero-dev/nitpicker/commit/6a4e68ec420a6b1b6b4f51a421659c4075da0b5a))

# [0.15.0](https://github.com/d-zero-dev/nitpicker/compare/v0.14.0...v0.15.0) (2026-07-30)

### Bug Fixes

- **crawler:** use decimals in output-binary.spec.ts to fix CI lint ([fdfc25a](https://github.com/d-zero-dev/nitpicker/commit/fdfc25a589a8a264f7d7feeafabd00b87943cb6f))
- **github:** read the release version from lerna.json for dist-tag ([f6bf2f8](https://github.com/d-zero-dev/nitpicker/commit/f6bf2f8b5f8a5892868573c7f9113c689c9cad55))
- **query:** show directory distribution instead of single common prefix ([9429e17](https://github.com/d-zero-dev/nitpicker/commit/9429e1776b3926401ba8ab1dbb892ae0aa5168f5))

- feat(query)!: split inbound links out of getPageDetail into listInboundLinks ([e3889fc](https://github.com/d-zero-dev/nitpicker/commit/e3889fc006b9e902185b1f4cfd6009a89ac2b25c))

### Features

- **cli:** add `nitpicker cache list`/`cache clear` command ([a23b649](https://github.com/d-zero-dev/nitpicker/commit/a23b649d7f5663702af241b32ae0d2dfae4563d9))
- **cli:** add console-logs and page-console-logs query sub-commands ([4cac07e](https://github.com/d-zero-dev/nitpicker/commit/4cac07eb6070e535fea5e1f8298178c28076a693))
- **cli:** add duplicate-bodies query sub-command ([3a92818](https://github.com/d-zero-dev/nitpicker/commit/3a92818a23ab206198d2073672f80d07e6ca8cda))
- **cli:** add inbound-links query sub-command ([38ec0cf](https://github.com/d-zero-dev/nitpicker/commit/38ec0cff71bcbd04d2512b7cc3c6618f1e95300d))
- **cli:** add outages query sub-command ([bedd007](https://github.com/d-zero-dev/nitpicker/commit/bedd007cd2b5a426df9231ade4c8db32a4e09cfb))
- **cli:** backfill content_items.alias_of_id on every viewer-build run ([4226d04](https://github.com/d-zero-dev/nitpicker/commit/4226d04cd8d4373d63aaaaef145400fe58956d22))
- **cli:** warn-and-skip invalid inventory URLs instead of hard-erroring ([0883e93](https://github.com/d-zero-dev/nitpicker/commit/0883e9379b9ec1867ec31b66125a069b62cf9d0c))
- **core:** capture cluster-selection reasons during classification ([6f13726](https://github.com/d-zero-dev/nitpicker/commit/6f13726a5a9de5e25e609067662bd8f47e1eb838))
- **core:** collect ClusterReason via onClusterReason and bump page-cluster ([83a9463](https://github.com/d-zero-dev/nitpicker/commit/83a9463e81c572532bdc129c041da31414cef318))
- **crawler:** add cache-root list/clear utilities and export them ([c05aa04](https://github.com/d-zero-dev/nitpicker/commit/c05aa049e1a397e529139b81b1d9cb3969ffc29a))
- **crawler:** add content_items.alias_of_id self-referencing column ([d7e44b2](https://github.com/d-zero-dev/nitpicker/commit/d7e44b232d82f8357c47de2d43f8076ef8e56745))
- **crawler:** capture and persist console log entries per page ([31ba317](https://github.com/d-zero-dev/nitpicker/commit/31ba317bd12a36ac884bd99dcf729e52c984ee5f))
- **crawler:** compute page_meta.body_hash from masked <body> content ([c3cdbb3](https://github.com/d-zero-dev/nitpicker/commit/c3cdbb38f2cb97e4fece5526d4be893cd185bffe))
- **crawler:** detect operator network outages and pause the crawl gate ([d6f2d32](https://github.com/d-zero-dev/nitpicker/commit/d6f2d32c36e8f8b267328929c02e00ee29758c80))
- **crawler:** persist page-cluster's cluster-selection reason ([f7c72b6](https://github.com/d-zero-dev/nitpicker/commit/f7c72b68ef821003f34661636940238b780d1c18))
- **crawler:** persist page-cluster's ClusterReason per template cluster ([8054165](https://github.com/d-zero-dev/nitpicker/commit/80541658a1548a483a01f2ca2c43ef71bb1077be))
- **crawler:** warn-and-skip inventory sources, archive them, fix tar drop bug ([376bf43](https://github.com/d-zero-dev/nitpicker/commit/376bf435a54656a4dd53cc7a822e5f95efdf74e4))
- **mcp-server:** add list_console_logs and get_page_console_logs tools ([1c77b71](https://github.com/d-zero-dev/nitpicker/commit/1c77b7156a166e7374d222c54abfb059cfddb07d))
- **mcp-server:** add list_inbound_links tool ([1b7ce24](https://github.com/d-zero-dev/nitpicker/commit/1b7ce24c020c2fe28fe126f9a05894331416575a))
- **mcp-server:** add list_network_outages tool ([b932be8](https://github.com/d-zero-dev/nitpicker/commit/b932be8d7b6d5212bd3bcb643f84ded970ef6109))
- **mcp-server:** expose find_duplicate_bodies tool ([a51f852](https://github.com/d-zero-dev/nitpicker/commit/a51f852b2f1951d8071fe1972910ba0136b11c40))
- **query:** add console log read APIs and viewer read model support ([6d9304c](https://github.com/d-zero-dev/nitpicker/commit/6d9304c682028d373dbeb31c3a4de15d3e8acc66))
- **query:** add findDuplicateBodies and body_hash backfill ([bd1f87f](https://github.com/d-zero-dev/nitpicker/commit/bd1f87f634c2d1dc76f4033b94adea25b2d3ae3e))
- **query:** add template cluster summary aggregation ([be388c8](https://github.com/d-zero-dev/nitpicker/commit/be388c86ecb87d6433c734bf5a48ff454585989d))
- **query:** expose cluster-selection reason on template cluster summaries ([32741fc](https://github.com/d-zero-dev/nitpicker/commit/32741fc11bfd1ab3d65095e127ae3e3d2a681ec5))
- **query:** merge URL-normalization-equivalent pages via alias_of_id ([f13797b](https://github.com/d-zero-dev/nitpicker/commit/f13797b8d62bc64b7c3565035de8142af717db25))
- **query:** read ClusterReason from page_template_cluster_reasons ([ba535e6](https://github.com/d-zero-dev/nitpicker/commit/ba535e6ecd41c227ee5229b02c10c8b1f02086b0))
- **query:** split failure attribution between site and network causes ([5cf14d1](https://github.com/d-zero-dev/nitpicker/commit/5cf14d13b7ea0cd9d0fc34c6d13b8574f38722d8))
- **query:** surface invalid_skipped and tolerate its absence on old archives ([972b8c5](https://github.com/d-zero-dev/nitpicker/commit/972b8c578e68b0d184c119bb989437fee477110d))
- **viewer:** add Console Logs view, Page Detail section, and Summary badges ([00397ad](https://github.com/d-zero-dev/nitpicker/commit/00397ad1b9d7feebb65bedfa5b65a69343647573))
- **viewer:** add dedicated inbound-links view and Page Detail count ([868bd13](https://github.com/d-zero-dev/nitpicker/commit/868bd139182129d8e17ef15cb5f178767d55f01a))
- **viewer:** add template cluster analysis view ([0529d0e](https://github.com/d-zero-dev/nitpicker/commit/0529d0ebef3ae2b44bda84910e9028647497f2ed))
- **viewer:** show cluster selection reason in the template clusters view ([8c790d2](https://github.com/d-zero-dev/nitpicker/commit/8c790d20b0c2beb01af1e0a32dc370d6c2c3fb77))
- **viewer:** show cluster-selection evidence on the template clusters view ([7db2ceb](https://github.com/d-zero-dev/nitpicker/commit/7db2cebebaa256bc4b263e9016d5ca475d08986a))
- **viewer:** show network-outage attribution in Summary and Errors views ([aa40798](https://github.com/d-zero-dev/nitpicker/commit/aa40798d71c1ec2f051a9c494a7d1314f19bada2))

### BREAKING CHANGES

- PageDetail no longer has an inboundLinks field. Use
  listInboundLinks(accessor, { url }) instead.

# [0.14.0](https://github.com/d-zero-dev/nitpicker/compare/v0.13.0...v0.14.0) (2026-07-24)

### Bug Fixes

- **core:** remove stray NUL byte from intern-key join separator ([39ce081](https://github.com/d-zero-dev/nitpicker/commit/39ce08117142e948dd39ffe6eae817a41b459dfd))
- **github:** declare main-contents.e2e.ts in the CI shard manifest ([4055b6e](https://github.com/d-zero-dev/nitpicker/commit/4055b6e05e3afd004f97b91281adbaed08136f6d))
- **repo:** assign the E2E test server a dynamic port instead of 8010 ([589f245](https://github.com/d-zero-dev/nitpicker/commit/589f24508b8a9c7d0bb07aab2f562e6abe224f7e)), closes [#162](https://github.com/d-zero-dev/nitpicker/issues/162)

- feat(cli)!: promote --main-content-selector to a crawl-time option ([99425cc](https://github.com/d-zero-dev/nitpicker/commit/99425cc57b776e8df15e9ef25e7a8ade653b7a0f))
- feat(crawler)!: extract beholder main-content data into core schema ([4864b8a](https://github.com/d-zero-dev/nitpicker/commit/4864b8a10453867204a23ecba3b0601726cb914b))
- refactor(core)!: drop analyze-main-contents from standard plugin list ([fe2beb4](https://github.com/d-zero-dev/nitpicker/commit/fe2beb4357ae853abb74e4ff41c002a5d1546c85))
- refactor(repo)!: remove analyze-main-contents package ([dbdf155](https://github.com/d-zero-dev/nitpicker/commit/dbdf15569551a4d015fa1bd4836ec68b874a87ac))

### Features

- **cli:** add --templates flag for DOM-structure page classification ([5bdc870](https://github.com/d-zero-dev/nitpicker/commit/5bdc870cce4240bb383b77f60b5db6ec3039707f))
- **core:** add DOM-structure template classification ([50d631a](https://github.com/d-zero-dev/nitpicker/commit/50d631aa19b5cbb9ae9acd52c0d11c23855b5d7e))
- **crawler:** add page_templates SQL table for --templates classification ([a2a5772](https://github.com/d-zero-dev/nitpicker/commit/a2a5772267446aa4e80f830bc1159b33415a3c89))
- **mcp-server:** add get_page_main_contents tool ([977b152](https://github.com/d-zero-dev/nitpicker/commit/977b1523dfc8e4e2cc997b1267cec75d479da49a))
- **query:** expose main-content data through getPageMainContents and list views ([f0e3f67](https://github.com/d-zero-dev/nitpicker/commit/f0e3f67ff03b9be4a727f2cf2b712602eeb6f2f5))
- **query:** expose templateKey on page-list/detail reads and support filtering ([e631305](https://github.com/d-zero-dev/nitpicker/commit/e631305cd435ba4b1cc0068f3aa70894bb3242ed))
- **query:** let the viewer_pages fast path resolve a directory filter ([0f3b9bd](https://github.com/d-zero-dev/nitpicker/commit/0f3b9bdfb790be80d5711b5a98da9df26598ce8e))
- **query:** track html-only page counts in the directory-tree read model ([5ba6d62](https://github.com/d-zero-dev/nitpicker/commit/5ba6d62daa963727e2927457ba68ff9ad8b93367))
- **repo:** add migrate-to-0.14 script for the viewer read model rebuild ([f0530ba](https://github.com/d-zero-dev/nitpicker/commit/f0530ba85508f8310b9d289e8f066bc690be0515))
- **report-google-sheets:** add main-content columns to page list sheet ([b6b2ae6](https://github.com/d-zero-dev/nitpicker/commit/b6b2ae6c99dc5f16f17f3eb7ee2c262a3ec68e71))
- **viewer:** add collapse-to-depth and sort-order controls to directory tree ([8e60549](https://github.com/d-zero-dev/nitpicker/commit/8e605496698b5cfb131bd4088154b3022172b759))
- **viewer:** add directory tree UI ([ff8e369](https://github.com/d-zero-dev/nitpicker/commit/ff8e36932ea13f57d05c5c6ebf7c3022028e39dd)), closes [#156](https://github.com/d-zero-dev/nitpicker/issues/156) [#107](https://github.com/d-zero-dev/nitpicker/issues/107)
- **viewer:** add folder icons and move expand arrow to row end ([51f2492](https://github.com/d-zero-dev/nitpicker/commit/51f2492477d641345a710cb1b6b1822d9f43db89))
- **viewer:** add templateKey column and filter to the Pages list ([789b2e8](https://github.com/d-zero-dev/nitpicker/commit/789b2e83f40341b8dd8e4c07d4e4ee907e0a4f86))
- **viewer:** show a directory-filter notice above the Pages table ([2d737e4](https://github.com/d-zero-dev/nitpicker/commit/2d737e46073ecef56e22d3c47ca81bf86ed10189))
- **viewer:** show main-content columns, sorting, and detail section ([2937af3](https://github.com/d-zero-dev/nitpicker/commit/2937af3d4da44ede205687ceee9a5ea52e433f4b))
- **viewer:** simplify directory tree to a single pane, delegate pages to /pages ([9b5ba00](https://github.com/d-zero-dev/nitpicker/commit/9b5ba00e388fa35cd2381166dafe88da076697c7))

### BREAKING CHANGES

- `nitpicker analyze --main-content-selector` and
  `nitpicker pipeline --main-content-selector` (as an analyze option) no
  longer exist. Use `nitpicker crawl --main-content-selector` (or
  `pipeline`'s own crawl-time flag of the same name) instead.
- page_meta gains 17 new columns and 8 new adjunct
  tables are created on next archive open; existing archives are
  migrated additively (no REQUIRED_FORMAT_VERSION change).
- NitpickerConfig no longer accepts a
  '@nitpicker/analyze-main-contents' override — the plugin is gone
  (see the analyze-main-contents package removal).
- @nitpicker/analyze-main-contents is deleted with no
  compatibility shim. Beholder 4.0.0 now extracts the same main-content
  metrics during crawling, promoted into the core page schema instead of
  a post-hoc analyze plugin.

# [0.13.0](https://github.com/d-zero-dev/nitpicker/compare/v0.12.0...v0.13.0) (2026-07-21)

### Bug Fixes

- **analyze-markuplint:** stop concatenating position onto violation url ([47d9d9c](https://github.com/d-zero-dev/nitpicker/commit/47d9d9c9b415c9b3618c724d46bc7fbc8a310dcb)), closes [#225](https://github.com/d-zero-dev/nitpicker/issues/225)
- **analyze-textlint:** stop concatenating position onto violation url ([b0e4e75](https://github.com/d-zero-dev/nitpicker/commit/b0e4e75fddadb5130edd365d72d9bee6db90027c)), closes [#225](https://github.com/d-zero-dev/nitpicker/issues/225)
- chain populate-migration into crawler write path and reader spec ordering ([e9cc84e](https://github.com/d-zero-dev/nitpicker/commit/e9cc84e6054cb5596fc63db0a6ebb83af78eb95a)), closes [#196](https://github.com/d-zero-dev/nitpicker/issues/196)
- **cli:** unconditionally rebuild the viewer read model on crawl completion ([55e8d0a](https://github.com/d-zero-dev/nitpicker/commit/55e8d0a14c1d9a194a9ec4d1ba39531bd1543041))
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
- **deps:** update dependency @hono/node-server to v2 ([c620ff6](https://github.com/d-zero-dev/nitpicker/commit/c620ff69b01058dc22e5c71b69b9598b38042ca3))
- **deps:** update dependency @hono/node-server to v2.0.8 ([#188](https://github.com/d-zero-dev/nitpicker/issues/188)) ([12158ed](https://github.com/d-zero-dev/nitpicker/commit/12158ed4ead4da406405536bbe81b8e1beae3049))
- **deps:** update dependency @tanstack/react-query to v5.101.2 ([#170](https://github.com/d-zero-dev/nitpicker/issues/170)) ([d88c73d](https://github.com/d-zero-dev/nitpicker/commit/d88c73dc9edddc4d3b9d2b5b6d22a7ad8992541c))
- **deps:** update dependency @tanstack/react-virtual to v3.14.4 ([6967bc7](https://github.com/d-zero-dev/nitpicker/commit/6967bc7d5a471687d071313d2599b9ad44d9d16d))
- **deps:** update dependency @tanstack/react-virtual to v3.14.5 ([#180](https://github.com/d-zero-dev/nitpicker/issues/180)) ([3fb0993](https://github.com/d-zero-dev/nitpicker/commit/3fb0993042ea39adbaf378a714c1ba0ad47deba5))
- **deps:** update dependency @tanstack/react-virtual to v3.14.6 ([#223](https://github.com/d-zero-dev/nitpicker/issues/223)) ([afdb582](https://github.com/d-zero-dev/nitpicker/commit/afdb58224ec91bde91ab682e14cddb36dc0a376b))
- **deps:** update dependency fs-extra to v11.3.6 ([#134](https://github.com/d-zero-dev/nitpicker/issues/134)) ([f30d42e](https://github.com/d-zero-dev/nitpicker/commit/f30d42ef4242026a8b99e160cd90ac8d21cefc7b))
- **deps:** update dependency hono to v4.12.28 ([a251de2](https://github.com/d-zero-dev/nitpicker/commit/a251de25551f372aae6ae58d50ef4a3aa6a6191c))
- **deps:** update dependency hono to v4.12.29 ([#219](https://github.com/d-zero-dev/nitpicker/issues/219)) ([b9244a6](https://github.com/d-zero-dev/nitpicker/commit/b9244a651e34d378e248c737c6f0e4602f9b66a4))
- **deps:** update dependency hono to v4.12.30 ([3f74d63](https://github.com/d-zero-dev/nitpicker/commit/3f74d631b64d2ea9f59eae73cbe2c6fc73a37aaa))
- **deps:** update dependency knex to v3.3.0 ([#160](https://github.com/d-zero-dev/nitpicker/issues/160)) ([959bf10](https://github.com/d-zero-dev/nitpicker/commit/959bf10129a3a7e72670b600779171567a464772))
- **deps:** update dependency react-router to v8.1.0 ([c39397a](https://github.com/d-zero-dev/nitpicker/commit/c39397a9b035547ba0e907cd9412f3715e19c6f5))
- **deps:** update dependency react-router to v8.2.0 ([#213](https://github.com/d-zero-dev/nitpicker/issues/213)) ([9d2cb3e](https://github.com/d-zero-dev/nitpicker/commit/9d2cb3edd57b76f4abe0afe4bd77927258e00d66))
- **deps:** update dependency tar to v7.5.17 ([#135](https://github.com/d-zero-dev/nitpicker/issues/135)) ([bf98d5c](https://github.com/d-zero-dev/nitpicker/commit/bf98d5cab1604ca9f2668472428d86aa02bac985))
- **deps:** update dependency tar to v7.5.19 ([#171](https://github.com/d-zero-dev/nitpicker/issues/171)) ([7306b08](https://github.com/d-zero-dev/nitpicker/commit/7306b0804d96eb9c966ed3edec83650eea129941))
- **deps:** update dependency tar to v7.5.20 ([852aa36](https://github.com/d-zero-dev/nitpicker/commit/852aa363219ca213a51716600fd77f71c15c5d3a))
- populate 0.13 tables at every crawl-end site (not just write()) ([8126bde](https://github.com/d-zero-dev/nitpicker/commit/8126bde81c76f023339ad03c7d02f988934fc6da))
- populate 0.13 tables at resume() crawl end ([87fbd42](https://github.com/d-zero-dev/nitpicker/commit/87fbd4265363ff5bdfe6d4ae7d927a7fdc5fbcd9))
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
- **repo:** exclude build output from root tsconfig, fix stale docs ([a263a83](https://github.com/d-zero-dev/nitpicker/commit/a263a832b21264f10e3a79e9e2777b86fca1e95a))
- **repo:** recycle jsdom worker threads to bound migrate-to-0.13 memory ([187660b](https://github.com/d-zero-dev/nitpicker/commit/187660bf9da4aabc3540dc687dba426fb668595a))
- **report-google-sheets:** convert inline import() type to top-level import type ([7f95838](https://github.com/d-zero-dev/nitpicker/commit/7f95838f7a7a437c9d3e38f23dd8cc9ef1f3fc72))
- **report-google-sheets:** tolerate null resource URLs in the Resources sheet ([326d6bd](https://github.com/d-zero-dev/nitpicker/commit/326d6bdfab2387d062f9442e3a82e41e0f7047c8))
- **types:** add optional line/col to Violation ([e6bb583](https://github.com/d-zero-dev/nitpicker/commit/e6bb583332ed2cdf944744bd78c240eeeb2dbda3)), closes [#225](https://github.com/d-zero-dev/nitpicker/issues/225)
- **viewer:** disambiguate shared filter-popover e2e test on /broken-links ([6252b76](https://github.com/d-zero-dev/nitpicker/commit/6252b7637ba75e58ff83aba14a32155f44cc0562))
- **viewer:** honor default radio filter state ([207b0d9](https://github.com/d-zero-dev/nitpicker/commit/207b0d9f91a0599c025809e0d918e68d8df53218))
- **viewer:** make error-kinds-cache options-aware for the host×kind reshape ([53818cc](https://github.com/d-zero-dev/nitpicker/commit/53818cc046c690ed227a14e001fb2c5e7457e6d3))
- **viewer:** reproduce SQL host/kind tie-break in error-kinds-cache ([33072fa](https://github.com/d-zero-dev/nitpicker/commit/33072fab58662bce6bc53cf1f144229dbe0db940))
- **viewer:** resolve remaining lint warnings ([39637ef](https://github.com/d-zero-dev/nitpicker/commit/39637ef3fd987a962cf2201b04887affec14f915))
- **viewer:** update DuplicatesView for the /api/duplicates envelope response ([146678a](https://github.com/d-zero-dev/nitpicker/commit/146678a2ca2ac2e2486e7779a4b9e2646ede00e6))

- feat(crawler)!: drop legacy write-model tables and unify adjunct FKs on content_items ([c801014](https://github.com/d-zero-dev/nitpicker/commit/c8010147afb42230a797eecbe9929285640e0129))
- feat(query)!: normalize error-kinds aggregation to host×kind rows ([f9bd2c6](https://github.com/d-zero-dev/nitpicker/commit/f9bd2c61e5740c2a517f664191a40d8c03dc1e3f))
- feat(viewer)!: fold Headers into Pages, split Links into Broken/External Links ([aae6125](https://github.com/d-zero-dev/nitpicker/commit/aae6125556fe1dc96d6260be852c2bf15a735ced))
- feat(query)!: narrow broken links to 404, merge header checks into page lists ([bce3379](https://github.com/d-zero-dev/nitpicker/commit/bce3379eed866b121b786ff6c0801d4eb578c351))

### Features

- **cli:** add crawl-completion read model hook and viewer-build command ([4f43aa9](https://github.com/d-zero-dev/nitpicker/commit/4f43aa9da4f9f13857a09464c31e063e2b9466c4)), closes [#112](https://github.com/d-zero-dev/nitpicker/issues/112)
- **cli:** dispatch query duplicates/mismatches through fast paths (issue [#115](https://github.com/d-zero-dev/nitpicker/issues/115)) ([448f98f](https://github.com/d-zero-dev/nitpicker/commit/448f98f6696377ddbf721f47bf312d3f57a006df))
- **cli:** dispatch query error-kinds through getErrorKindsFastPath ([e01f711](https://github.com/d-zero-dev/nitpicker/commit/e01f7111d41570c5feb8766bfbcf4e02433cf96e))
- **cli:** dispatch query headers through getHeaderChecksFastPath ([a0ec06d](https://github.com/d-zero-dev/nitpicker/commit/a0ec06d426a896fcf4318cbda1dba6dfa5072a67))
- **cli:** dispatch query images through getImagesFastPath ([5604f7a](https://github.com/d-zero-dev/nitpicker/commit/5604f7ad9dfb619fdc6716c9641d4f469f8b991c))
- **cli:** dispatch query summary through getSummaryFastPath ([18da45c](https://github.com/d-zero-dev/nitpicker/commit/18da45c674cfaae7b5e2411c765ac46067e544de))
- **cli:** expose directory tree endpoints in the viewer ([cc630ae](https://github.com/d-zero-dev/nitpicker/commit/cc630aea8b0f21864c3d222898f118e240f42f01)), closes [#107](https://github.com/d-zero-dev/nitpicker/issues/107)
- **cli:** link Connection Failures sample URLs to Page Detail ([340b3e0](https://github.com/d-zero-dev/nitpicker/commit/340b3e04808f23c4fe7de18cf12c59206cc11069))
- **cli:** rebuild connection failures view as sortable host×kind table ([55fe53f](https://github.com/d-zero-dev/nitpicker/commit/55fe53f9c89c5b2b0c82b954bd99849ec6388f91))
- **cli:** support limit/cursor for query resource-referrers ([545fb8b](https://github.com/d-zero-dev/nitpicker/commit/545fb8bb6643e732743b39e5db221c13943fecf4))
- **crawler:** add phase 6-a ref and header staging tables ([f78a5ef](https://github.com/d-zero-dev/nitpicker/commit/f78a5ef9c130b780c3ebf95ee3b821e1fd8fc079)), closes [#190](https://github.com/d-zero-dev/nitpicker/issues/190) [#103](https://github.com/d-zero-dev/nitpicker/issues/103) [#191](https://github.com/d-zero-dev/nitpicker/issues/191) [#192](https://github.com/d-zero-dev/nitpicker/issues/192)
- **crawler:** add phase 6-b ref-table population helpers ([1786bd4](https://github.com/d-zero-dev/nitpicker/commit/1786bd41a830369ffc7486d97b4e8595f6952cee)), closes [#191](https://github.com/d-zero-dev/nitpicker/issues/191) [#103](https://github.com/d-zero-dev/nitpicker/issues/103)
- **crawler:** add phase 6-c entity and edge tables ([c762b08](https://github.com/d-zero-dev/nitpicker/commit/c762b08810e70a604e6cc3d4b13fa0ed118ff79e)), closes [#192](https://github.com/d-zero-dev/nitpicker/issues/192) [#103](https://github.com/d-zero-dev/nitpicker/issues/103) [#193](https://github.com/d-zero-dev/nitpicker/issues/193)
- **crawler:** populate phase 6-d entity and edge tables ([4b11ca8](https://github.com/d-zero-dev/nitpicker/commit/4b11ca85e7f2c947c8e370d25dc69067c595abde))
- **crawler:** report progress from every 0.13 populate step ([3058904](https://github.com/d-zero-dev/nitpicker/commit/305890431ec266d1898562c5ad69edc5c3a1ef11))
- **crawler:** support writable Archive.connect and expose lock primitives ([5f5f6e6](https://github.com/d-zero-dev/nitpicker/commit/5f5f6e696a6486884a2dff6e46949c497d25e5e0)), closes [#112](https://github.com/d-zero-dev/nitpicker/issues/112)
- **crawler:** verify phase 6-e migration invariants ([bab23fd](https://github.com/d-zero-dev/nitpicker/commit/bab23fd9ab5408068cdc65e8d02bc6659ddeff28)), closes [#3](https://github.com/d-zero-dev/nitpicker/issues/3) [#4](https://github.com/d-zero-dev/nitpicker/issues/4) [#8](https://github.com/d-zero-dev/nitpicker/issues/8)
- **crawler:** write directly to 0.13 entity tables ([d0657d0](https://github.com/d-zero-dev/nitpicker/commit/d0657d013e4cd1d052e20fd5d812111cf627733e)), closes [#196](https://github.com/d-zero-dev/nitpicker/issues/196)
- **mcp-server:** bound and paginate get_resource_referrers ([f97b0f9](https://github.com/d-zero-dev/nitpicker/commit/f97b0f9a27ebb37be991cd3106cd03f2016cbc94))
- **mcp-server:** dispatch check_headers through getHeaderChecksFastPath ([6cf3e55](https://github.com/d-zero-dev/nitpicker/commit/6cf3e551ad95248d9b26b78d96b509c40d45d8d9))
- **mcp-server:** dispatch find_duplicates/find_mismatches through fast paths (issue [#115](https://github.com/d-zero-dev/nitpicker/issues/115)) ([a675928](https://github.com/d-zero-dev/nitpicker/commit/a6759282944de6707c5971a14ca321f0c699d58c))
- **mcp-server:** dispatch get_summary/open_archive through getSummaryFastPath ([510e781](https://github.com/d-zero-dev/nitpicker/commit/510e78161eca9a9b4ffd67a1ab0aecfa7534f5fe))
- **mcp-server:** dispatch list_images through getImagesFastPath ([190d599](https://github.com/d-zero-dev/nitpicker/commit/190d599c3a6bcaa07c9ec954c797f30d44fe355e))
- **mcp-server:** expose page header filters, align list_links docs with 404-only broken ([4123ba5](https://github.com/d-zero-dev/nitpicker/commit/4123ba597221e466ff9894fa1e7817d8095cbc9b))
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
- **repo:** build the viewer read model as part of migrate-to-0.13 ([8f59fef](https://github.com/d-zero-dev/nitpicker/commit/8f59fef250284a1a37ba0a7a4e9b2cc627bfca82))
- **repo:** make migrate-to-0.13 resumable across process kills ([65814d4](https://github.com/d-zero-dev/nitpicker/commit/65814d49c179da7896417dd5a5c42a26de333eea))
- **repo:** move analysis violations to sql ([3cec379](https://github.com/d-zero-dev/nitpicker/commit/3cec379d6d79696924a98960368ed30109b41fdb))
- **repo:** precompute isolated and graph viewer reads ([577cce6](https://github.com/d-zero-dev/nitpicker/commit/577cce6d13c583a1b0224a3bb55b50bff722420b))
- **repo:** print total elapsed time on migrate-to-0.13 completion ([5dee619](https://github.com/d-zero-dev/nitpicker/commit/5dee6194f0d4530dc04c9d230425fbb1eae7651e))
- **repo:** wire progress reporting into migrate-to-0.13 ([012d798](https://github.com/d-zero-dev/nitpicker/commit/012d7984bb310a6daf5acb4dd5efcf31b0f86b61))
- **viewer:** add /api/headers route for the viewer_header_checks fast path ([689f83a](https://github.com/d-zero-dev/nitpicker/commit/689f83ad1b42c6ca82709caa4e4e86aea89b375c)), closes [#107](https://github.com/d-zero-dev/nitpicker/issues/107)
- **viewer:** add spreadsheet table controls ([ba2ca5d](https://github.com/d-zero-dev/nitpicker/commit/ba2ca5d2b314fbba724ef044dc6bb7df64f9f4c3))
- **viewer:** color network graph nodes by source with legend ([8f37bec](https://github.com/d-zero-dev/nitpicker/commit/8f37becda43958d5d1ba53ab2c7916d135266863)), closes [#117](https://github.com/d-zero-dev/nitpicker/issues/117) [#117](https://github.com/d-zero-dev/nitpicker/issues/117)
- **viewer:** dedupe External Links by destination, show referrers on Page Detail ([d1cf5a6](https://github.com/d-zero-dev/nitpicker/commit/d1cf5a69799ca12d6f304afc702b62a73ca8b737))
- **viewer:** dispatch /api/duplicates and /api/mismatches through fast paths (issue [#115](https://github.com/d-zero-dev/nitpicker/issues/115)) ([2039ed3](https://github.com/d-zero-dev/nitpicker/commit/2039ed3d71d56ea85cc3ae413bd6a5a9a5a1ce90))
- **viewer:** dispatch /api/images through getImagesFastPath ([dfc7142](https://github.com/d-zero-dev/nitpicker/commit/dfc71425fddcc51354c30f982129dabe4e25bbc1)), closes [#113](https://github.com/d-zero-dev/nitpicker/issues/113)
- **viewer:** dispatch /api/resources and /api/unused-resources through the viewer_resources fast path ([850d423](https://github.com/d-zero-dev/nitpicker/commit/850d42390357861ce0e4d96976fc7c177d145e85))
- **viewer:** route /api/pages through viewer_pages fast path with fallback ([79450ee](https://github.com/d-zero-dev/nitpicker/commit/79450ee0b515b9b7944826b90de3f5519d3a5763))
- **viewer:** route broken links through the viewer_anchor_facts fast path ([d619c4a](https://github.com/d-zero-dev/nitpicker/commit/d619c4a04c9968906002d7e76b0e6a686213fda1))
- **viewer:** route external links through the viewer_external_links fast path ([986119e](https://github.com/d-zero-dev/nitpicker/commit/986119eea63125bf5c189529a031fb43a6113adf))
- **viewer:** serve /api/error-kinds through the viewer*error_kind*\* fast path ([043755e](https://github.com/d-zero-dev/nitpicker/commit/043755e0668b12ef48138656f903bd92e096b552))
- **viewer:** serve /api/summary through the viewer_summary fast path ([68e72bf](https://github.com/d-zero-dev/nitpicker/commit/68e72bfa9675eb6ca6650b6630a0e66dae18b806))
- **viewer:** show Lanes progress and cache the URL sort to disk ([211a61f](https://github.com/d-zero-dev/nitpicker/commit/211a61f77654bd7270ffb673d9b9ecc47a176eac))
- **viewer:** stop running the startup URL sort when the read model is current ([cb30dee](https://github.com/d-zero-dev/nitpicker/commit/cb30dee37c87bf1bd9d7a5bd5663a599e1eae085))
- **viewer:** swap page detail link order and surface 200-item cap ([fd54b50](https://github.com/d-zero-dev/nitpicker/commit/fd54b5036ae35ce29140b733c1d33040d78ea27c))
- **viewer:** unify status filters across table views ([6bc48de](https://github.com/d-zero-dev/nitpicker/commit/6bc48dec41e33a3686f89961b460eb28c49e3519))

### Performance Improvements

- **query:** remove duplicate sortUrl call in buildUrlRanks ([a1a06b3](https://github.com/d-zero-dev/nitpicker/commit/a1a06b3a2bc50a90315ce10a4bf204f2b7b3db7b))

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

- ErrorKindsResult is now { items, total, facets }
  instead of { total, channelSource, groups }. ErrorKindGroup and
  ErrorKindHost are removed in favor of ErrorKindEntry and
  ErrorKindFacets. Sample URLs are capped per host×kind pair (not per
  kind) with an overflowedCount for anything beyond the cap. Adds
  host/kind/sortBy/sortOrder/limit/offset filtering, validating sortBy
  against a fixed set of fields so an out-of-range value falls back to
  count-desc instead of crashing.
- the standalone "Headers" and "Page Links" views/nav items
  are removed. Security-header presence (CSP/X-Frame-Options/
  X-Content-Type-Options/HSTS) is now shown as four columns on the Pages
  view, with matching filter/sort controls wired to /api/pages. Per-page
  status/referrers/redirect-from now live on the Page Detail view instead
  of Page Links; Page Detail also surfaces isSkipped/skipReason for
  excluded URLs. The combined "Links" view (broken/external toggle) is
  replaced by two dedicated views, "Broken Links" and "External Links",
  sharing a new LinkListView component instead of duplicating the table
  wiring. referrer-count-cache.ts is removed along with the page-links
  route it backed.

The e2e fixture now seeds one 404 page and one external link so the new
Broken/External Links views have non-empty data to exercise.

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
