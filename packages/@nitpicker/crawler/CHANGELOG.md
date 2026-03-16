# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
