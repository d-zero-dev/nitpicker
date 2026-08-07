# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.16.0](https://github.com/d-zero-dev/nitpicker/compare/v0.15.0...v0.16.0) (2026-08-07)

### Features

- **mcp-server:** add find_duplicate_clusters and list_dedupe_cap_events tools ([e41a423](https://github.com/d-zero-dev/nitpicker/commit/e41a4230e6b8b9ba1315ef9dd8b922c642e5cbeb)), closes [#208](https://github.com/d-zero-dev/nitpicker/issues/208)

# [0.15.0](https://github.com/d-zero-dev/nitpicker/compare/v0.14.0...v0.15.0) (2026-07-30)

### Features

- **mcp-server:** add list_console_logs and get_page_console_logs tools ([1c77b71](https://github.com/d-zero-dev/nitpicker/commit/1c77b7156a166e7374d222c54abfb059cfddb07d))
- **mcp-server:** add list_inbound_links tool ([1b7ce24](https://github.com/d-zero-dev/nitpicker/commit/1b7ce24c020c2fe28fe126f9a05894331416575a))
- **mcp-server:** add list_network_outages tool ([b932be8](https://github.com/d-zero-dev/nitpicker/commit/b932be8d7b6d5212bd3bcb643f84ded970ef6109))
- **mcp-server:** expose find_duplicate_bodies tool ([a51f852](https://github.com/d-zero-dev/nitpicker/commit/a51f852b2f1951d8071fe1972910ba0136b11c40))

# [0.14.0](https://github.com/d-zero-dev/nitpicker/compare/v0.13.0...v0.14.0) (2026-07-24)

### Features

- **mcp-server:** add get_page_main_contents tool ([977b152](https://github.com/d-zero-dev/nitpicker/commit/977b1523dfc8e4e2cc997b1267cec75d479da49a))

# [0.13.0](https://github.com/d-zero-dev/nitpicker/compare/v0.12.0...v0.13.0) (2026-07-21)

### Features

- **mcp-server:** bound and paginate get_resource_referrers ([f97b0f9](https://github.com/d-zero-dev/nitpicker/commit/f97b0f9a27ebb37be991cd3106cd03f2016cbc94))
- **mcp-server:** dispatch check_headers through getHeaderChecksFastPath ([6cf3e55](https://github.com/d-zero-dev/nitpicker/commit/6cf3e551ad95248d9b26b78d96b509c40d45d8d9))
- **mcp-server:** dispatch find_duplicates/find_mismatches through fast paths (issue [#115](https://github.com/d-zero-dev/nitpicker/issues/115)) ([a675928](https://github.com/d-zero-dev/nitpicker/commit/a6759282944de6707c5971a14ca321f0c699d58c))
- **mcp-server:** dispatch get_summary/open_archive through getSummaryFastPath ([510e781](https://github.com/d-zero-dev/nitpicker/commit/510e78161eca9a9b4ffd67a1ab0aecfa7534f5fe))
- **mcp-server:** dispatch list_images through getImagesFastPath ([190d599](https://github.com/d-zero-dev/nitpicker/commit/190d599c3a6bcaa07c9ec954c797f30d44fe355e))
- **mcp-server:** expose page header filters, align list_links docs with 404-only broken ([4123ba5](https://github.com/d-zero-dev/nitpicker/commit/4123ba597221e466ff9894fa1e7817d8095cbc9b))
- **repo:** move analysis violations to sql ([3cec379](https://github.com/d-zero-dev/nitpicker/commit/3cec379d6d79696924a98960368ed30109b41fdb))
- **repo:** precompute isolated and graph viewer reads ([577cce6](https://github.com/d-zero-dev/nitpicker/commit/577cce6d13c583a1b0224a3bb55b50bff722420b))

# [0.12.0](https://github.com/d-zero-dev/nitpicker/compare/v0.11.0...v0.12.0) (2026-07-01)

### Features

- **mcp-server:** list_isolated_clusters / get_isolated_cluster + redirect-resolved list_links ([b89a577](https://github.com/d-zero-dev/nitpicker/commit/b89a5779837f19125f36fda683e502f6655c623b))

# [0.11.0](https://github.com/d-zero-dev/nitpicker/compare/v0.9.0...v0.11.0) (2026-06-18)

### Features

- **cli,mcp:** expose isolated-pages / unused-resources via query CLI and MCP tools ([e0c0c5c](https://github.com/d-zero-dev/nitpicker/commit/e0c0c5c6180afb4b5f7f720c8df4553408c42f30))
- **mcp-server:** advertise contentTypeCategory on list_pages ([c616c89](https://github.com/d-zero-dev/nitpicker/commit/c616c8946b43a5cabacc8c892f469dc44b7a9408))
- **mcp-server:** surface mode and crawlerPid via open_archive ([9f54def](https://github.com/d-zero-dev/nitpicker/commit/9f54defc41e07666109e5c766586312e47f1f9f4))

# [0.9.0](https://github.com/d-zero-dev/nitpicker/compare/v0.8.0...v0.9.0) (2026-05-29)

**Note:** Version bump only for package @nitpicker/mcp-server

# [0.8.0](https://github.com/d-zero-dev/nitpicker/compare/v0.7.0...v0.8.0) (2026-05-16)

### Features

- **mcp-server:** include roots in open_archive response ([a58c942](https://github.com/d-zero-dev/nitpicker/commit/a58c942004565a584a690c87d265db85670c27b5))

# [0.7.0](https://github.com/d-zero-dev/nitpicker/compare/v0.6.5-alpha.0...v0.7.0) (2026-05-13)

**Note:** Version bump only for package @nitpicker/mcp-server

## [0.6.5-alpha.0](https://github.com/d-zero-dev/nitpicker/compare/v0.6.4...v0.6.5-alpha.0) (2026-04-08)

**Note:** Version bump only for package @nitpicker/mcp-server

## [0.6.3](https://github.com/d-zero-dev/nitpicker/compare/v0.6.2...v0.6.3) (2026-03-30)

**Note:** Version bump only for package @nitpicker/mcp-server

## [0.6.2](https://github.com/d-zero-dev/nitpicker/compare/v0.6.1...v0.6.2) (2026-03-30)

**Note:** Version bump only for package @nitpicker/mcp-server

## [0.6.1](https://github.com/d-zero-dev/nitpicker/compare/v0.6.0...v0.6.1) (2026-03-27)

**Note:** Version bump only for package @nitpicker/mcp-server

# [0.6.0](https://github.com/d-zero-dev/nitpicker/compare/v0.5.1...v0.6.0) (2026-03-16)

**Note:** Version bump only for package @nitpicker/mcp-server

# [0.5.0](https://github.com/d-zero-dev/nitpicker/compare/v0.4.4...v0.5.0) (2026-03-13)

### Bug Fixes

- add path traversal protection and improve error sanitization ([b376e86](https://github.com/d-zero-dev/nitpicker/commit/b376e867e9e759f2999552e0e24d5e3e7ce912e4))
- address QA review findings across query and mcp-server packages ([1ae9b7d](https://github.com/d-zero-dev/nitpicker/commit/1ae9b7d2a4bcc4ee83ddae39fc2214070c4d5792))
- address security audit findings ([99a2202](https://github.com/d-zero-dev/nitpicker/commit/99a2202f2330e606adc5f8c222e63ef98106c02a))
- resolve TS2589 and TS2339 build errors in mcp-server ([d20c8ad](https://github.com/d-zero-dev/nitpicker/commit/d20c8adc1c89cde2c09c0b97ee8fd0ae663c4931))

### Features

- implement .nitpicker archive query MCP server ([#21](https://github.com/d-zero-dev/nitpicker/issues/21)) ([9f0f407](https://github.com/d-zero-dev/nitpicker/commit/9f0f4079219c97990724a75cd04fcf41ca1ac82d))
