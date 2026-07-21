# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.13.0](https://github.com/d-zero-dev/nitpicker/compare/v0.12.0...v0.13.0) (2026-07-21)

### Bug Fixes

- chain populate-migration into crawler write path and reader spec ordering ([e9cc84e](https://github.com/d-zero-dev/nitpicker/commit/e9cc84e6054cb5596fc63db0a6ebb83af78eb95a)), closes [#196](https://github.com/d-zero-dev/nitpicker/issues/196)
- **deps:** update dependency @hono/node-server to v2.0.8 ([#188](https://github.com/d-zero-dev/nitpicker/issues/188)) ([12158ed](https://github.com/d-zero-dev/nitpicker/commit/12158ed4ead4da406405536bbe81b8e1beae3049))
- **deps:** update dependency @tanstack/react-query to v5.101.2 ([#170](https://github.com/d-zero-dev/nitpicker/issues/170)) ([d88c73d](https://github.com/d-zero-dev/nitpicker/commit/d88c73dc9edddc4d3b9d2b5b6d22a7ad8992541c))
- **deps:** update dependency @tanstack/react-virtual to v3.14.4 ([6967bc7](https://github.com/d-zero-dev/nitpicker/commit/6967bc7d5a471687d071313d2599b9ad44d9d16d))
- **deps:** update dependency @tanstack/react-virtual to v3.14.5 ([#180](https://github.com/d-zero-dev/nitpicker/issues/180)) ([3fb0993](https://github.com/d-zero-dev/nitpicker/commit/3fb0993042ea39adbaf378a714c1ba0ad47deba5))
- **deps:** update dependency @tanstack/react-virtual to v3.14.6 ([#223](https://github.com/d-zero-dev/nitpicker/issues/223)) ([afdb582](https://github.com/d-zero-dev/nitpicker/commit/afdb58224ec91bde91ab682e14cddb36dc0a376b))
- **deps:** update dependency hono to v4.12.28 ([a251de2](https://github.com/d-zero-dev/nitpicker/commit/a251de25551f372aae6ae58d50ef4a3aa6a6191c))
- **deps:** update dependency hono to v4.12.29 ([#219](https://github.com/d-zero-dev/nitpicker/issues/219)) ([b9244a6](https://github.com/d-zero-dev/nitpicker/commit/b9244a651e34d378e248c737c6f0e4602f9b66a4))
- **deps:** update dependency hono to v4.12.30 ([3f74d63](https://github.com/d-zero-dev/nitpicker/commit/3f74d631b64d2ea9f59eae73cbe2c6fc73a37aaa))
- **deps:** update dependency react-router to v8.1.0 ([c39397a](https://github.com/d-zero-dev/nitpicker/commit/c39397a9b035547ba0e907cd9412f3715e19c6f5))
- **deps:** update dependency react-router to v8.2.0 ([#213](https://github.com/d-zero-dev/nitpicker/issues/213)) ([9d2cb3e](https://github.com/d-zero-dev/nitpicker/commit/9d2cb3edd57b76f4abe0afe4bd77927258e00d66))
- **query,viewer:** restore header-presence data on the viewer_pages fast path ([e6b2617](https://github.com/d-zero-dev/nitpicker/commit/e6b2617bb91f4e186ed4c420bcfa9f33b4b97fe5))
- **viewer:** disambiguate shared filter-popover e2e test on /broken-links ([6252b76](https://github.com/d-zero-dev/nitpicker/commit/6252b7637ba75e58ff83aba14a32155f44cc0562))
- **viewer:** honor default radio filter state ([207b0d9](https://github.com/d-zero-dev/nitpicker/commit/207b0d9f91a0599c025809e0d918e68d8df53218))
- **viewer:** make error-kinds-cache options-aware for the host×kind reshape ([53818cc](https://github.com/d-zero-dev/nitpicker/commit/53818cc046c690ed227a14e001fb2c5e7457e6d3))
- **viewer:** reproduce SQL host/kind tie-break in error-kinds-cache ([33072fa](https://github.com/d-zero-dev/nitpicker/commit/33072fab58662bce6bc53cf1f144229dbe0db940))
- **viewer:** resolve remaining lint warnings ([39637ef](https://github.com/d-zero-dev/nitpicker/commit/39637ef3fd987a962cf2201b04887affec14f915))
- **viewer:** update DuplicatesView for the /api/duplicates envelope response ([146678a](https://github.com/d-zero-dev/nitpicker/commit/146678a2ca2ac2e2486e7779a4b9e2646ede00e6))

- feat(viewer)!: fold Headers into Pages, split Links into Broken/External Links ([aae6125](https://github.com/d-zero-dev/nitpicker/commit/aae6125556fe1dc96d6260be852c2bf15a735ced))

### Features

- **cli:** expose directory tree endpoints in the viewer ([cc630ae](https://github.com/d-zero-dev/nitpicker/commit/cc630aea8b0f21864c3d222898f118e240f42f01)), closes [#107](https://github.com/d-zero-dev/nitpicker/issues/107)
- **cli:** link Connection Failures sample URLs to Page Detail ([340b3e0](https://github.com/d-zero-dev/nitpicker/commit/340b3e04808f23c4fe7de18cf12c59206cc11069))
- **cli:** rebuild connection failures view as sortable host×kind table ([55fe53f](https://github.com/d-zero-dev/nitpicker/commit/55fe53f9c89c5b2b0c82b954bd99849ec6388f91))
- **repo:** precompute isolated and graph viewer reads ([577cce6](https://github.com/d-zero-dev/nitpicker/commit/577cce6d13c583a1b0224a3bb55b50bff722420b))
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

### BREAKING CHANGES

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

# [0.12.0](https://github.com/d-zero-dev/nitpicker/compare/v0.11.0...v0.12.0) (2026-07-01)

### Bug Fixes

- **viewer:** default-cap /api/graph + persist result so large archives stop returning Invalid string length ([6196051](https://github.com/d-zero-dev/nitpicker/commit/619605105f72c6f01c01830a0008ce58e6529813))
- **viewer:** promote pageSize to a first-class URL query (parity with page) ([a1b3f9e](https://github.com/d-zero-dev/nitpicker/commit/a1b3f9ef9fd12f779634cb59f27f4129af2b175e))
- **viewer:** show refetch feedback so Pager clicks feel immediate ([2c71a4a](https://github.com/d-zero-dev/nitpicker/commit/2c71a4a5ab6f787fed2c6a5a0573610aa9a75774))

- feat(viewer)!: switch list views to MPA pagination by default, virtual scroll opt-in ([7fd00db](https://github.com/d-zero-dev/nitpicker/commit/7fd00db3e4f0ee16ebbb9e68b931bc45c19dee46))

### Features

- **query,viewer:** subdivide status=-1 by errorKind in Summary ([cd9a85b](https://github.com/d-zero-dev/nitpicker/commit/cd9a85bc4ac0c168f6c5760e18d92f4a64b022a7))
- **viewer:** isolated-clusters view + infinite-scroll isolated-pages + retire orphaned chip ([711e434](https://github.com/d-zero-dev/nitpicker/commit/711e43441707c3267b309366c38a4a9295dff6ca))
- **viewer:** per-archive precompute caches drop isolated-\* / page-links to single-digit-ms ([096bd29](https://github.com/d-zero-dev/nitpicker/commit/096bd29dcb4cdc50435859ee10a71ea0205d08b7))
- **viewer:** per-archive process cache for getSummary — warm hits return in ms ([fc453d7](https://github.com/d-zero-dev/nitpicker/commit/fc453d792979e068f811473b89162dbd9a69d5f3))
- **viewer:** persist precomputed caches to disk across restarts ([101e6ae](https://github.com/d-zero-dev/nitpicker/commit/101e6aeb59f7ffc2e5f1d6c327b2806f6d360019)), closes [#98](https://github.com/d-zero-dev/nitpicker/issues/98)
- **viewer:** translate client-blocked error kind label ([8262caf](https://github.com/d-zero-dev/nitpicker/commit/8262caf54883b8b17d2544a035b0af7a6465cdf8))
- **viewer:** translate new ErrorKind buckets for the Errors view ([c2a9e03](https://github.com/d-zero-dev/nitpicker/commit/c2a9e031ea402838ff625910e229ed6ef961ec26))

### BREAKING CHANGES

- the viewer's default list-mode is now MPA pagination
  instead of infinite scroll. Operators can revert per-tab via the TopBar
  mode toggle; the preference persists in localStorage
  (`nitpicker-pagination-mode`, `nitpicker-page-size`). 0.x semver — no
  migration guide required.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

# [0.11.0](https://github.com/d-zero-dev/nitpicker/compare/v0.9.0...v0.11.0) (2026-06-18)

### Features

- **viewer:** accept stub directories and distinguish live vs interrupted crawls ([6e64fe5](https://github.com/d-zero-dev/nitpicker/commit/6e64fe5afd55b25c5118acc449e925d07cda9e99))
- **viewer:** add an Errors view for crawl-failure causes ([7e181d6](https://github.com/d-zero-dev/nitpicker/commit/7e181d670ec1b90ccfc987852a0cf160fbc75bec))
- **viewer:** add content-type filter and distribution chart ([f719bb2](https://github.com/d-zero-dev/nitpicker/commit/f719bb261560757ff8abc05397726af041ed775f))
- **viewer:** add footer badge styles for stub-mode crawl state ([da79f10](https://github.com/d-zero-dev/nitpicker/commit/da79f10ddde62022de7767ac572412007d48d021))
- **viewer:** add local browser viewer for .nitpicker archives ([dbc5427](https://github.com/d-zero-dev/nitpicker/commit/dbc5427acbdf7b1646a7040678fa014a389ef836))
- **viewer:** expose isolated-pages and unused-resources surfaces ([f4939ed](https://github.com/d-zero-dev/nitpicker/commit/f4939edc295887383463c3a5b4ede303e0ca173e))
- **viewer:** redesign summary cards, legend layout, and content-type swatches ([710734f](https://github.com/d-zero-dev/nitpicker/commit/710734f9560fa6a5b09f85601d3e85ba6a8dc042))
- **viewer:** rework summary bars and add macOS-style content-type stacked bar ([fa35ea5](https://github.com/d-zero-dev/nitpicker/commit/fa35ea5e545ad8b8db23dfb53b21d6b473846ca7))
