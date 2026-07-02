# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
