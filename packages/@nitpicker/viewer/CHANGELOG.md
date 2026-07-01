# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
