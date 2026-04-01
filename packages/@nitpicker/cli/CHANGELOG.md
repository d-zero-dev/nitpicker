# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
