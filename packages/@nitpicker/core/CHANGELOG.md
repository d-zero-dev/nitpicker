# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.25.0](https://github.com/d-zero-dev/nitpicker/compare/v0.24.0...v0.25.0) (2026-10-28)

### Bug Fixes

- **core:** decide streaming samples upfront and tell which pages each read uses ([981ec6b](https://github.com/d-zero-dev/nitpicker/commit/981ec6bf303a508e1db65e53ef6658dff53c91f2))
- **core:** find the body with capture-free regex searches and sharpen loader diagnostics ([1b23419](https://github.com/d-zero-dev/nitpicker/commit/1b23419d821492eb67647c3abaf6cfd55816f499)), closes [#425](https://github.com/d-zero-dev/nitpicker/issues/425)
- **core:** require a tag-name boundary after body when extracting the body ([f26bf0c](https://github.com/d-zero-dev/nitpicker/commit/f26bf0cacb7a4113802d3dcac6ed7e49d147e5eb)), closes [#434](https://github.com/d-zero-dev/nitpicker/issues/434)

### Features

- **core:** add native union-find, alias keys and alias grouping ([51d370e](https://github.com/d-zero-dev/nitpicker/commit/51d370e6fe44b35bf1ccc2a1bd5dd0ed6ca2db1c))
- **core:** add nitpicker_url_key and computeUrlSortRanks ([3f7d64a](https://github.com/d-zero-dev/nitpicker/commit/3f7d64a7c45a6e827033552a856bc6e41d545b33))
- **core:** cluster every block whole unless its table or the held pages are too large ([903f1ee](https://github.com/d-zero-dev/nitpicker/commit/903f1ee606690497af8b11aa47106d123f2f952b))
- **core:** fold identical comparison sets before the Stage A similarity table ([8a05c9c](https://github.com/d-zero-dev/nitpicker/commit/8a05c9c6d26042e170b45de328ea5f42da5b0533))
- **core:** fuse the body hash stages and port structural technology detection ([54e704a](https://github.com/d-zero-dev/nitpicker/commit/54e704a157f178086eb966ecaac106d24c6ca44f)), closes [#430](https://github.com/d-zero-dev/nitpicker/issues/430)
- **core:** hold less of each page's parse results until its block is clustered ([91cba17](https://github.com/d-zero-dev/nitpicker/commit/91cba17326962981bba02aef025b752d1632e500))
- **core:** judge stored HTML snapshots against CSS selectors natively ([8b0ed9a](https://github.com/d-zero-dev/nitpicker/commit/8b0ed9a1d6d152ff80063c430a3d8cd282355cf0))
- **core:** run asynchronous native calls on a dedicated pool, with a concurrency limit and cancellation ([babbd2f](https://github.com/d-zero-dev/nitpicker/commit/babbd2f0a50e078fb8235e04e0d591582ac066bd))
- **core:** run Stage A of template classification natively ([b1b9b0f](https://github.com/d-zero-dev/nitpicker/commit/b1b9b0f18eca3530f5e2fd0f2bc07846cf2e8647))
- **core:** run the whole template classification natively ([69f78ab](https://github.com/d-zero-dev/nitpicker/commit/69f78ab1ef6b67142557f40c5ba7b8d29fc2f0d3)), closes [#426](https://github.com/d-zero-dev/nitpicker/issues/426)
- **core:** search stored HTML snapshots natively under a defined pattern contract ([2f90df2](https://github.com/d-zero-dev/nitpicker/commit/2f90df2e93b6b94180572006c8186480e4a95278))
- **core:** stop a zstd snapshot at the most a crawl can store, and on cancel ([76c708f](https://github.com/d-zero-dev/nitpicker/commit/76c708fee6fb52695cc217c532fc58447042ed04))
- **repo:** add the Rust @nitpicker/core addon and compute body_hash with it ([4563fa3](https://github.com/d-zero-dev/nitpicker/commit/4563fa3d1ec4b0818a1d3a0b287e8bbb2d79b7cd)), closes [#425](https://github.com/d-zero-dev/nitpicker/issues/425)
