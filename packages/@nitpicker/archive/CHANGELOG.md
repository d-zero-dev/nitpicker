# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.25.0](https://github.com/d-zero-dev/nitpicker/compare/v0.24.0...v0.25.0) (2026-10-28)

### Bug Fixes

- **archive:** send pages a read skips without HTML and check each read's page count ([f587082](https://github.com/d-zero-dev/nitpicker/commit/f5870824bef0de73612b88e257886dea7e49331f))
- **archive:** surface the original error when SQLite rolls a transaction back by itself ([93638f2](https://github.com/d-zero-dev/nitpicker/commit/93638f2a2ff6535638bc4a4010bd7397382db889))
- **core:** require a tag-name boundary after body when extracting the body ([f26bf0c](https://github.com/d-zero-dev/nitpicker/commit/f26bf0cacb7a4113802d3dcac6ed7e49d147e5eb)), closes [#434](https://github.com/d-zero-dev/nitpicker/issues/434)

### Features

- **archive:** add a wrapper for the native stored-HTML selector matcher ([48592d8](https://github.com/d-zero-dev/nitpicker/commit/48592d82a862a8e56a76222c5576bb4b6290ab9b))
- **archive:** add helpers that free finished statements and tune a connection for a bulk write ([d8fa8d4](https://github.com/d-zero-dev/nitpicker/commit/d8fa8d498775535912072c6fcb6b287cc4a8305c))
- **archive:** classify templates with the native run and drop the TypeScript engine ([6ff6825](https://github.com/d-zero-dev/nitpicker/commit/6ff6825eeac31397f4c51fd79ddc6a9ddcd32187))
- **archive:** classify templates with the native Stage A ([bdec678](https://github.com/d-zero-dev/nitpicker/commit/bdec67857a1db32e68f22fc57ea56afa3d864721))
- **archive:** detect structural technology signals with the native matcher ([8c7b41b](https://github.com/d-zero-dev/nitpicker/commit/8c7b41b444e045e9c2d00c4070937deecff02ff2)), closes [#430](https://github.com/d-zero-dev/nitpicker/issues/430)
- **archive:** hash stored HTML from bytes and keep the JS body-hash stages out of the build ([a8d6fe9](https://github.com/d-zero-dev/nitpicker/commit/a8d6fe973bbdc94d8f6afd6de08939a98f091176)), closes [#425](https://github.com/d-zero-dev/nitpicker/issues/425)
- **archive:** limit the JS-side decode too, and name an undecodable snapshot ([bf59a6f](https://github.com/d-zero-dev/nitpicker/commit/bf59a6fbdf7dde5dcdcf48016a34c69146cfb76c))
- **archive:** pass an abort signal to the native snapshot scans and expose the settings check ([9f176cc](https://github.com/d-zero-dev/nitpicker/commit/9f176ccd956944ed8f0b82bbe4f273daacd9716c))
- **archive:** pass the memory limit to the classifier and return the blocks it sampled ([5403642](https://github.com/d-zero-dev/nitpicker/commit/54036421932f6bd9ca99473376fc8aa03ed4e2ad))
- **archive:** route alias keys and grouping through the native addon ([9c405ef](https://github.com/d-zero-dev/nitpicker/commit/9c405ef66b7e7d47a4d4e3f2de44ecaf02f2241c))
- **archive:** stop holding every Page handle before template classification ([c5ddc81](https://github.com/d-zero-dev/nitpicker/commit/c5ddc8159298f0c6a8913e08f0e2b19ec84954a1))
- **archive:** wrap the native snapshot search and pattern check ([02a4ca1](https://github.com/d-zero-dev/nitpicker/commit/02a4ca11b5b9b9680e7bbfa4a60bb30ff46446c1))
- **query:** rank URLs with the native total-order key ([c5765e4](https://github.com/d-zero-dev/nitpicker/commit/c5765e471987fb74b9f483fd992a971ab233550a))
- **repo:** add the Rust @nitpicker/core addon and compute body_hash with it ([4563fa3](https://github.com/d-zero-dev/nitpicker/commit/4563fa3d1ec4b0818a1d3a0b287e8bbb2d79b7cd)), closes [#425](https://github.com/d-zero-dev/nitpicker/issues/425)
