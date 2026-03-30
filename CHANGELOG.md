# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
