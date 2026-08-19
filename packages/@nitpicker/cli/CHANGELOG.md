# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.19.0](https://github.com/d-zero-dev/nitpicker/compare/v0.18.1...v0.19.0) (2026-08-19)

### Bug Fixes

- **cli:** address code-review findings on TaskList progress migration ([0d98a78](https://github.com/d-zero-dev/nitpicker/commit/0d98a7889dca1b69c9846c3fefff3403a1f526c0)), closes [#294](https://github.com/d-zero-dev/nitpicker/issues/294) [#294](https://github.com/d-zero-dev/nitpicker/issues/294)

- refactor(cli)!: use await using for archive/orchestrator lifecycle ([02b2722](https://github.com/d-zero-dev/nitpicker/commit/02b272265f7c6f561492e1133d252e4e1926dadf))

### Features

- **cli:** eliminate silent stretches and lazy-load command implementations (issue [#294](https://github.com/d-zero-dev/nitpicker/issues/294)) ([cd20a67](https://github.com/d-zero-dev/nitpicker/commit/cd20a67ba2bec72e2812c8854ac4085b2323a133))
- **cli:** expand viewer read model build into individual TaskList rows ([c9567a3](https://github.com/d-zero-dev/nitpicker/commit/c9567a3a37890952173895852c67f0b506a3aaad))
- **cli:** fail fast when puppeteer diverges from beholder's install ([93bcb41](https://github.com/d-zero-dev/nitpicker/commit/93bcb418df5fdb9921aef3acb8fc7c202216df47))
- **cli:** migrate crawl/viewer-build progress display to dealer TaskList ([15ea441](https://github.com/d-zero-dev/nitpicker/commit/15ea441ba330fb27619f52a543c1e280f4d41809))
- **cli:** show viewer read model build phase/progress on one Lanes line ([#294](https://github.com/d-zero-dev/nitpicker/issues/294)) ([b41c868](https://github.com/d-zero-dev/nitpicker/commit/b41c868f89b221eb12c53a4bdbd2310b718321ea))

### BREAKING CHANGES

- requires Node >=24.11.

crawl/analyze/viewer-build/diff commands replace their try/finally
close() blocks with `await using`, relying on the dispose
implementations added to CrawlerOrchestrator, Nitpicker, and Archive.

formatCliError now unwraps SuppressedError (thrown when a body error
and a disposal error occur together) so both underlying causes are
printed instead of the generic disposal message.

## [0.18.1](https://github.com/d-zero-dev/nitpicker/compare/v0.18.0...v0.18.1) (2026-08-12)

**Note:** Version bump only for package @nitpicker/cli

# [0.18.0](https://github.com/d-zero-dev/nitpicker/compare/v0.17.0...v0.18.0) (2026-08-11)

### Features

- **cli:** expose --dedupeCapEventId on query pages ([1187ca8](https://github.com/d-zero-dev/nitpicker/commit/1187ca8901eb8ec1c093ade0b4b0469a57ce9d30))

# [0.17.0](https://github.com/d-zero-dev/nitpicker/compare/v0.16.0...v0.17.0) (2026-08-09)

### Features

- **cli:** default-enable --dedupe-cap and expose --isDedupeCapped on query pages ([7b31a4c](https://github.com/d-zero-dev/nitpicker/commit/7b31a4c0f8b77280d70e5a8007d6129605ba4f57))
- **cli:** restructure --help output with usage lines, flag groups, and sub-command help ([d9fe791](https://github.com/d-zero-dev/nitpicker/commit/d9fe7911df4d8c441ba66e5e648e9e47ea8ecf51))

# [0.16.0](https://github.com/d-zero-dev/nitpicker/compare/v0.15.0...v0.16.0) (2026-08-07)

### Bug Fixes

- **cli:** show npx @nitpicker/cli in usage and cache hints ([95f7b27](https://github.com/d-zero-dev/nitpicker/commit/95f7b273296ded400ef5bcadb15cbeccd37a76b8))

### Features

- **cli:** add --dedupe-cap flags and duplicate-clusters/dedupe-cap-events subcommands ([ef46282](https://github.com/d-zero-dev/nitpicker/commit/ef4628228a8c0747655311cd3ee1eb65d31ab53b)), closes [#208](https://github.com/d-zero-dev/nitpicker/issues/208)
- **cli:** fail fast when Chrome is missing before crawl/pipeline runs ([e304e30](https://github.com/d-zero-dev/nitpicker/commit/e304e30ce42dc58069deb76839ad47bb2ffbeca2))

# [0.15.0](https://github.com/d-zero-dev/nitpicker/compare/v0.14.0...v0.15.0) (2026-07-30)

### Features

- **cli:** add `nitpicker cache list`/`cache clear` command ([a23b649](https://github.com/d-zero-dev/nitpicker/commit/a23b649d7f5663702af241b32ae0d2dfae4563d9))
- **cli:** add console-logs and page-console-logs query sub-commands ([4cac07e](https://github.com/d-zero-dev/nitpicker/commit/4cac07eb6070e535fea5e1f8298178c28076a693))
- **cli:** add duplicate-bodies query sub-command ([3a92818](https://github.com/d-zero-dev/nitpicker/commit/3a92818a23ab206198d2073672f80d07e6ca8cda))
- **cli:** add inbound-links query sub-command ([38ec0cf](https://github.com/d-zero-dev/nitpicker/commit/38ec0cff71bcbd04d2512b7cc3c6618f1e95300d))
- **cli:** add outages query sub-command ([bedd007](https://github.com/d-zero-dev/nitpicker/commit/bedd007cd2b5a426df9231ade4c8db32a4e09cfb))
- **cli:** backfill content_items.alias_of_id on every viewer-build run ([4226d04](https://github.com/d-zero-dev/nitpicker/commit/4226d04cd8d4373d63aaaaef145400fe58956d22))
- **cli:** warn-and-skip invalid inventory URLs instead of hard-erroring ([0883e93](https://github.com/d-zero-dev/nitpicker/commit/0883e9379b9ec1867ec31b66125a069b62cf9d0c))

# [0.14.0](https://github.com/d-zero-dev/nitpicker/compare/v0.13.0...v0.14.0) (2026-07-24)

- feat(cli)!: promote --main-content-selector to a crawl-time option ([99425cc](https://github.com/d-zero-dev/nitpicker/commit/99425cc57b776e8df15e9ef25e7a8ade653b7a0f))

### Features

- **cli:** add --templates flag for DOM-structure page classification ([5bdc870](https://github.com/d-zero-dev/nitpicker/commit/5bdc870cce4240bb383b77f60b5db6ec3039707f))

### BREAKING CHANGES

- `nitpicker analyze --main-content-selector` and
  `nitpicker pipeline --main-content-selector` (as an analyze option) no
  longer exist. Use `nitpicker crawl --main-content-selector` (or
  `pipeline`'s own crawl-time flag of the same name) instead.

# [0.13.0](https://github.com/d-zero-dev/nitpicker/compare/v0.12.0...v0.13.0) (2026-07-21)

### Bug Fixes

- **cli:** unconditionally rebuild the viewer read model on crawl completion ([55e8d0a](https://github.com/d-zero-dev/nitpicker/commit/55e8d0a14c1d9a194a9ec4d1ba39531bd1543041))
- populate 0.13 tables at every crawl-end site (not just write()) ([8126bde](https://github.com/d-zero-dev/nitpicker/commit/8126bde81c76f023339ad03c7d02f988934fc6da))

### Features

- **cli:** add crawl-completion read model hook and viewer-build command ([4f43aa9](https://github.com/d-zero-dev/nitpicker/commit/4f43aa9da4f9f13857a09464c31e063e2b9466c4)), closes [#112](https://github.com/d-zero-dev/nitpicker/issues/112)
- **cli:** dispatch query duplicates/mismatches through fast paths (issue [#115](https://github.com/d-zero-dev/nitpicker/issues/115)) ([448f98f](https://github.com/d-zero-dev/nitpicker/commit/448f98f6696377ddbf721f47bf312d3f57a006df))
- **cli:** dispatch query error-kinds through getErrorKindsFastPath ([e01f711](https://github.com/d-zero-dev/nitpicker/commit/e01f7111d41570c5feb8766bfbcf4e02433cf96e))
- **cli:** dispatch query headers through getHeaderChecksFastPath ([a0ec06d](https://github.com/d-zero-dev/nitpicker/commit/a0ec06d426a896fcf4318cbda1dba6dfa5072a67))
- **cli:** dispatch query images through getImagesFastPath ([5604f7a](https://github.com/d-zero-dev/nitpicker/commit/5604f7ad9dfb619fdc6716c9641d4f469f8b991c))
- **cli:** dispatch query summary through getSummaryFastPath ([18da45c](https://github.com/d-zero-dev/nitpicker/commit/18da45c674cfaae7b5e2411c765ac46067e544de))
- **cli:** support limit/cursor for query resource-referrers ([545fb8b](https://github.com/d-zero-dev/nitpicker/commit/545fb8bb6643e732743b39e5db221c13943fecf4))
- **repo:** move analysis violations to sql ([3cec379](https://github.com/d-zero-dev/nitpicker/commit/3cec379d6d79696924a98960368ed30109b41fdb))
- **repo:** precompute isolated and graph viewer reads ([577cce6](https://github.com/d-zero-dev/nitpicker/commit/577cce6d13c583a1b0224a3bb55b50bff722420b))

# [0.12.0](https://github.com/d-zero-dev/nitpicker/compare/v0.11.0...v0.12.0) (2026-07-01)

### Bug Fixes

- **crawler,query,cli:** drop inventory_runs.source_file_path column ([5514e59](https://github.com/d-zero-dev/nitpicker/commit/5514e5959ac4d33b57a5f45a430c3c58857ceda7))

### Features

- **cli:** isolated-clusters / get-isolated-cluster subcommands + --include-redirect-sources ([4867d35](https://github.com/d-zero-dev/nitpicker/commit/4867d35b08a55aaf3c5e3c72be10e030f63e40a5))
- **crawler,query,cli:** inventory_runs audit log (Phase 1) ([4fccf41](https://github.com/d-zero-dev/nitpicker/commit/4fccf410c7a60625ad55f39f2d71e5d92b8bffcf))

# [0.11.0](https://github.com/d-zero-dev/nitpicker/compare/v0.9.0...v0.11.0) (2026-06-18)

### Features

- **cli,mcp:** expose isolated-pages / unused-resources via query CLI and MCP tools ([e0c0c5c](https://github.com/d-zero-dev/nitpicker/commit/e0c0c5c6180afb4b5f7f720c8df4553408c42f30))
- **cli:** accept a stub directory as `viewer` positional arg ([cbab270](https://github.com/d-zero-dev/nitpicker/commit/cbab270a735a253a9d2a317838ceb9e4d9e50872))
- **cli:** add --contentTypeCategory flag to pages sub-command ([27f10cb](https://github.com/d-zero-dev/nitpicker/commit/27f10cb2c99ef6f0cd571c7d7da7f8548ec2deae))
- **cli:** add --retry-failed flag to the crawl command ([89485d4](https://github.com/d-zero-dev/nitpicker/commit/89485d424aa3a83caa0d9be3eb21f67b60052bed))
- **cli:** add the error-kinds query sub-command ([7657d57](https://github.com/d-zero-dev/nitpicker/commit/7657d571a9cbf84b5e7c3fc4c792444515d68cae))
- **cli:** add viewer subcommand ([c386949](https://github.com/d-zero-dev/nitpicker/commit/c3869499804be1817543170db0fee5a2015353f5))
- **cli:** wire up crawl --inventory flag and dispatch ([61b9054](https://github.com/d-zero-dev/nitpicker/commit/61b905484dbf3e016c472dc6b246e28b6da5d0c1))

# [0.9.0](https://github.com/d-zero-dev/nitpicker/compare/v0.8.0...v0.9.0) (2026-05-29)

### Features

- **cli:** expose --dedupe-resources flag for report and pipeline ([7749414](https://github.com/d-zero-dev/nitpicker/commit/77494146e42ff188eaffc0716cfbd6ff5240b19a))

# [0.8.0](https://github.com/d-zero-dev/nitpicker/compare/v0.7.0...v0.8.0) (2026-05-16)

### Bug Fixes

- **crawler:** dedupe initial URLs so append-mode does not race on a URL in both resume pending and the new roots ([06aeda7](https://github.com/d-zero-dev/nitpicker/commit/06aeda7924dd57fcbeeed8e61fb41900acc14a46))

- feat(cli)!: flip --append to take URLs and use the positional as the archive ([01ee205](https://github.com/d-zero-dev/nitpicker/commit/01ee205406a4443b6a42b7a0714504f8ccffa8be))

### Features

- **cli:** accept multiple positional URLs and tighten flag exclusions ([33fd443](https://github.com/d-zero-dev/nitpicker/commit/33fd44364cfaa264b8a7eec17ddfcd56d4c0c81d))
- **cli:** add --append flag for incremental crawl on an existing archive ([9c0e02e](https://github.com/d-zero-dev/nitpicker/commit/9c0e02e605caa82fea9a3af8b39f8515e9e84fbd))

### BREAKING CHANGES

- the CLI invocation order for append is reversed. Old
  `crawl --append archive.nitpicker https://x/` becomes
  `crawl archive.nitpicker --append https://x/`. The internal
  `CrawlerOrchestrator.append(archivePath, newUrls, ...)` JS API is unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

# [0.7.0](https://github.com/d-zero-dev/nitpicker/compare/v0.6.5-alpha.0...v0.7.0) (2026-05-13)

### Bug Fixes

- **cli:** ensure archive close and explicit exit after work completes ([6b736b2](https://github.com/d-zero-dev/nitpicker/commit/6b736b2edf7117956aac094c00ce364a19f5fc38))

### Features

- **cli:** add -v / --version flag for version output ([ad9eef4](https://github.com/d-zero-dev/nitpicker/commit/ad9eef44e95083332e8ae5da5d411ad40f70631b))

## [0.6.5-alpha.0](https://github.com/d-zero-dev/nitpicker/compare/v0.6.4...v0.6.5-alpha.0) (2026-04-08)

**Note:** Version bump only for package @nitpicker/cli

## [0.6.4](https://github.com/d-zero-dev/nitpicker/compare/v0.6.3...v0.6.4) (2026-04-01)

**Note:** Version bump only for package @nitpicker/cli

## [0.6.3](https://github.com/d-zero-dev/nitpicker/compare/v0.6.2...v0.6.3) (2026-03-30)

### Bug Fixes

- **cli,crawler,query:** address QA review findings ([0c53d1e](https://github.com/d-zero-dev/nitpicker/commit/0c53d1e8a2b32a0cb1101975232ca3d356f2ad61))

## [0.6.2](https://github.com/d-zero-dev/nitpicker/compare/v0.6.1...v0.6.2) (2026-03-30)

**Note:** Version bump only for package @nitpicker/cli

## [0.6.1](https://github.com/d-zero-dev/nitpicker/compare/v0.6.0...v0.6.1) (2026-03-27)

**Note:** Version bump only for package @nitpicker/cli

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
- **cli,crawler:** map CLI flag names to CrawlConfig properties ([3003025](https://github.com/d-zero-dev/nitpicker/commit/30030251d0c79516795d77ddc65f1eb2c2d657ca)), closes [#1](https://github.com/d-zero-dev/nitpicker/issues/1)
- **cli:** add analyze plugins to CLI dependencies for npx compatibility ([efdfcff](https://github.com/d-zero-dev/nitpicker/commit/efdfcff36ccfac746ac0de3a223aa2c1f66c7aba)), closes [#34](https://github.com/d-zero-dev/nitpicker/issues/34)
- **cli:** address --output flag QA/PdM review findings ([a36270c](https://github.com/d-zero-dev/nitpicker/commit/a36270ce9177139df6f605dba3a459e9b042013e))
- **cli:** address QA review findings for exit code implementation ([abbb955](https://github.com/d-zero-dev/nitpicker/commit/abbb955e32b296d306aea9682ed7b8507725ad57))
- **cli:** address remaining QA review findings ([c07b4e0](https://github.com/d-zero-dev/nitpicker/commit/c07b4e0ef6084f4f34dbc9de0518d5ee634e13a5))
- **cli:** QA review fixes for pipeline command ([ab9fe4f](https://github.com/d-zero-dev/nitpicker/commit/ab9fe4f7bcdc32131b3cd670791e278ef46c359a))
- **cli:** update crawl error test to match CrawlAggregateError implementation ([690da07](https://github.com/d-zero-dev/nitpicker/commit/690da0729d223213eba85ed98382e983f36709da))
- crawl コマンドの入力バリデーション強化 ([9b41a74](https://github.com/d-zero-dev/nitpicker/commit/9b41a7408b7c020d6181aaee926c5ee612ffe0c3)), closes [#17](https://github.com/d-zero-dev/nitpicker/issues/17)
- index.ts 禁止ルール違反を解消 ([b5d3cda](https://github.com/d-zero-dev/nitpicker/commit/b5d3cdab633c16fa73cedc4cc92ab18609312940)), closes [#15](https://github.com/d-zero-dev/nitpicker/issues/15)
- PdMレビュー指摘の修正 ([f68ac54](https://github.com/d-zero-dev/nitpicker/commit/f68ac541d66e2c897e8a8a27d832b11e482f5a03))
- QAレビュー指摘事項の一括修正 ([e461a09](https://github.com/d-zero-dev/nitpicker/commit/e461a0991359ddc151a22fbd310b67417c0f693d))
- URL バリデーションを全入力パスに適用 ([3e0c1f1](https://github.com/d-zero-dev/nitpicker/commit/3e0c1f18d933fc2d03d63e33f76a752ada354e3b))

### Features

- **cli:** add --all, --verbose, --silent flags to report command ([574764a](https://github.com/d-zero-dev/nitpicker/commit/574764a3a44f04177f50c55689b620b53e2387d2)), closes [#3](https://github.com/d-zero-dev/nitpicker/issues/3)
- **cli:** add --output (-o) flag to crawl command ([fcbebc8](https://github.com/d-zero-dev/nitpicker/commit/fcbebc8b91e04f0e1b89d4ed02a18f259c76925a)), closes [#5](https://github.com/d-zero-dev/nitpicker/issues/5)
- **cli:** add --plugin flag and non-TTY fallback to analyze command ([d9e28ba](https://github.com/d-zero-dev/nitpicker/commit/d9e28badb4e615b1a97c5283752ebbd3d8fb2885)), closes [#2](https://github.com/d-zero-dev/nitpicker/issues/2)
- **cli:** add error handling and verbose support to analyze and report commands ([b9e79b9](https://github.com/d-zero-dev/nitpicker/commit/b9e79b9b06bc4bd4154eee4658f5981debbcae81))
- **cli:** add pipeline subcommand for sequential crawl → analyze → report execution ([b0e1494](https://github.com/d-zero-dev/nitpicker/commit/b0e14943e5e2229d478af626110f896a9d5be80e)), closes [#7](https://github.com/d-zero-dev/nitpicker/issues/7)
- **cli:** add plugin option CLI flags to analyze command ([a504717](https://github.com/d-zero-dev/nitpicker/commit/a5047176833691a2bbd89c3320ac0f7b2ebdf813)), closes [#4](https://github.com/d-zero-dev/nitpicker/issues/4)
- **cli:** improve exit code granularity for CI/CD pipelines ([57d67cb](https://github.com/d-zero-dev/nitpicker/commit/57d67cb4c6077b0a4c535fddccb7717acd05385d)), closes [#36](https://github.com/d-zero-dev/nitpicker/issues/36)

## [0.4.4](https://github.com/d-zero-dev/nitpicker/compare/v0.4.3...v0.4.4) (2026-03-02)

**Note:** Version bump only for package @nitpicker/cli

## [0.4.3](https://github.com/d-zero-dev/nitpicker/compare/v0.4.2...v0.4.3) (2026-03-02)

### Bug Fixes

- add files field to all package.json to explicitly include lib/ in npm packages ([d1a7625](https://github.com/d-zero-dev/nitpicker/commit/d1a76255dc5af5f6a12cdef275e473ab637e1cbb)), closes [#20](https://github.com/d-zero-dev/nitpicker/issues/20)
- explicitly include bin directory in @nitpicker/cli files field ([514cea6](https://github.com/d-zero-dev/nitpicker/commit/514cea672c1b471cfd40f65decbcbeae771adc40))

## [0.4.2](https://github.com/d-zero-dev/nitpicker/compare/v0.4.1...v0.4.2) (2026-02-27)

**Note:** Version bump only for package @nitpicker/cli

## [0.4.1](https://github.com/d-zero-dev/nitpicker/compare/v0.4.0...v0.4.1) (2026-02-27)

**Note:** Version bump only for package nitpicker
