# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.18.1](https://github.com/d-zero-dev/nitpicker/compare/v0.18.0...v0.18.1) (2026-08-12)

**Note:** Version bump only for package @nitpicker/report-google-sheets

# [0.18.0](https://github.com/d-zero-dev/nitpicker/compare/v0.17.0...v0.18.0) (2026-08-11)

**Note:** Version bump only for package @nitpicker/report-google-sheets

# [0.17.0](https://github.com/d-zero-dev/nitpicker/compare/v0.16.0...v0.17.0) (2026-08-09)

**Note:** Version bump only for package @nitpicker/report-google-sheets

# [0.16.0](https://github.com/d-zero-dev/nitpicker/compare/v0.15.0...v0.16.0) (2026-08-07)

**Note:** Version bump only for package @nitpicker/report-google-sheets

# [0.15.0](https://github.com/d-zero-dev/nitpicker/compare/v0.14.0...v0.15.0) (2026-07-30)

**Note:** Version bump only for package @nitpicker/report-google-sheets

# [0.14.0](https://github.com/d-zero-dev/nitpicker/compare/v0.13.0...v0.14.0) (2026-07-24)

### Bug Fixes

- **repo:** assign the E2E test server a dynamic port instead of 8010 ([589f245](https://github.com/d-zero-dev/nitpicker/commit/589f24508b8a9c7d0bb07aab2f562e6abe224f7e)), closes [#162](https://github.com/d-zero-dev/nitpicker/issues/162)

### Features

- **report-google-sheets:** add main-content columns to page list sheet ([b6b2ae6](https://github.com/d-zero-dev/nitpicker/commit/b6b2ae6c99dc5f16f17f3eb7ee2c262a3ec68e71))

# [0.13.0](https://github.com/d-zero-dev/nitpicker/compare/v0.12.0...v0.13.0) (2026-07-21)

### Bug Fixes

- **report-google-sheets:** convert inline import() type to top-level import type ([7f95838](https://github.com/d-zero-dev/nitpicker/commit/7f95838f7a7a437c9d3e38f23dd8cc9ef1f3fc72))
- **report-google-sheets:** tolerate null resource URLs in the Resources sheet ([326d6bd](https://github.com/d-zero-dev/nitpicker/commit/326d6bdfab2387d062f9442e3a82e41e0f7047c8))

### Features

- **repo:** move analysis violations to sql ([3cec379](https://github.com/d-zero-dev/nitpicker/commit/3cec379d6d79696924a98960368ed30109b41fdb))

# [0.12.0](https://github.com/d-zero-dev/nitpicker/compare/v0.11.0...v0.12.0) (2026-07-01)

**Note:** Version bump only for package @nitpicker/report-google-sheets

# [0.11.0](https://github.com/d-zero-dev/nitpicker/compare/v0.9.0...v0.11.0) (2026-06-18)

**Note:** Version bump only for package @nitpicker/report-google-sheets

# [0.9.0](https://github.com/d-zero-dev/nitpicker/compare/v0.8.0...v0.9.0) (2026-05-29)

### Features

- **report-google-sheets:** add canonical-URL dedupe mode for the Resources sheet ([877f887](https://github.com/d-zero-dev/nitpicker/commit/877f887234ddf3eb8abe191ceb3be08e7d61be89))
- **report-google-sheets:** add Query Pattern column with precise overflow detection ([ea4b6fa](https://github.com/d-zero-dev/nitpicker/commit/ea4b6fa84cbea5f9855531e803f9b162f17d0caa))
- **report-google-sheets:** sort Resources by natural URL order before output ([62c4787](https://github.com/d-zero-dev/nitpicker/commit/62c4787d8c807addbbc3fa055f52b2a2fdca53c2))
- **report-google-sheets:** stream Phase 2/3 row sends so large reports do not OOM ([5e90c13](https://github.com/d-zero-dev/nitpicker/commit/5e90c13138f0e02d7fedf20369a7f82424ef05b6))
- **report-google-sheets:** subscribe to Sheet.onProgress in Phase 3 finalize ([c1a09cf](https://github.com/d-zero-dev/nitpicker/commit/c1a09cfdfa6769d40b94955887105ac9a41122d5))

### Performance Improvements

- **report-google-sheets:** port Martin Pool's strnatcmp for the Resources sort ([2079e6e](https://github.com/d-zero-dev/nitpicker/commit/2079e6ec46d4941e43096370015d2ddab02b5060))
- **report-google-sheets:** sort dedupe output after aggregation, not before ([3e8802e](https://github.com/d-zero-dev/nitpicker/commit/3e8802edcc4d586f186aecf978c7167dd6e10dfe))

# [0.8.0](https://github.com/d-zero-dev/nitpicker/compare/v0.7.0...v0.8.0) (2026-05-16)

**Note:** Version bump only for package @nitpicker/report-google-sheets

# [0.7.0](https://github.com/d-zero-dev/nitpicker/compare/v0.6.5-alpha.0...v0.7.0) (2026-05-13)

**Note:** Version bump only for package @nitpicker/report-google-sheets

## [0.6.5-alpha.0](https://github.com/d-zero-dev/nitpicker/compare/v0.6.4...v0.6.5-alpha.0) (2026-04-08)

**Note:** Version bump only for package @nitpicker/report-google-sheets

## [0.6.4](https://github.com/d-zero-dev/nitpicker/compare/v0.6.3...v0.6.4) (2026-04-01)

### Bug Fixes

- **report-google-sheets:** add ServerError label to onLog countdown display ([752cec8](https://github.com/d-zero-dev/nitpicker/commit/752cec880f5af78f73111ddb52d4b583821cb4f9))
- **report-google-sheets:** fix 3 bugs in data sheet generators and add unit tests ([bf2c08d](https://github.com/d-zero-dev/nitpicker/commit/bf2c08d746eba85bcb746fc11ec25703d5222118)), closes [#14](https://github.com/d-zero-dev/nitpicker/issues/14)

## [0.6.3](https://github.com/d-zero-dev/nitpicker/compare/v0.6.2...v0.6.3) (2026-03-30)

**Note:** Version bump only for package @nitpicker/report-google-sheets

## [0.6.2](https://github.com/d-zero-dev/nitpicker/compare/v0.6.1...v0.6.2) (2026-03-30)

**Note:** Version bump only for package @nitpicker/report-google-sheets

## [0.6.1](https://github.com/d-zero-dev/nitpicker/compare/v0.6.0...v0.6.1) (2026-03-27)

**Note:** Version bump only for package @nitpicker/report-google-sheets

# [0.6.0](https://github.com/d-zero-dev/nitpicker/compare/v0.5.1...v0.6.0) (2026-03-16)

**Note:** Version bump only for package @nitpicker/report-google-sheets

## [0.5.1](https://github.com/d-zero-dev/nitpicker/compare/v0.5.0...v0.5.1) (2026-03-13)

### Bug Fixes

- add try/finally for exception-safe cleanup and add missing tests ([b6c4ae0](https://github.com/d-zero-dev/nitpicker/commit/b6c4ae0bfdef511f5d64bd4593504cf6209a13f0))
- remove process signal listeners to prevent MaxListenersExceededWarning ([2d7359c](https://github.com/d-zero-dev/nitpicker/commit/2d7359c4c6e72517dd4ad07da3633c59b21c15d1))

# [0.5.0](https://github.com/d-zero-dev/nitpicker/compare/v0.4.4...v0.5.0) (2026-03-13)

### Bug Fixes

- index.ts 禁止ルール違反を解消 ([b5d3cda](https://github.com/d-zero-dev/nitpicker/commit/b5d3cdab633c16fa73cedc4cc92ab18609312940)), closes [#15](https://github.com/d-zero-dev/nitpicker/issues/15)

### Features

- **cli:** add --all, --verbose, --silent flags to report command ([574764a](https://github.com/d-zero-dev/nitpicker/commit/574764a3a44f04177f50c55689b620b53e2387d2)), closes [#3](https://github.com/d-zero-dev/nitpicker/issues/3)

## [0.4.4](https://github.com/d-zero-dev/nitpicker/compare/v0.4.3...v0.4.4) (2026-03-02)

**Note:** Version bump only for package @nitpicker/report-google-sheets

## [0.4.3](https://github.com/d-zero-dev/nitpicker/compare/v0.4.2...v0.4.3) (2026-03-02)

### Bug Fixes

- add files field to all package.json to explicitly include lib/ in npm packages ([d1a7625](https://github.com/d-zero-dev/nitpicker/commit/d1a76255dc5af5f6a12cdef275e473ab637e1cbb)), closes [#20](https://github.com/d-zero-dev/nitpicker/issues/20)

## [0.4.2](https://github.com/d-zero-dev/nitpicker/compare/v0.4.1...v0.4.2) (2026-02-27)

**Note:** Version bump only for package @nitpicker/report-google-sheets

## [0.4.1](https://github.com/d-zero-dev/nitpicker/compare/v0.4.0...v0.4.1) (2026-02-27)

**Note:** Version bump only for package @nitpicker/report-google-sheets
