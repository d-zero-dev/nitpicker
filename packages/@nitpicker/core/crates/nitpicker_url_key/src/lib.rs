//! The natural URL order the viewer lists pages and resources in, as byte
//! keys: sorting the keys with `memcmp` sorts the URLs.
//!
//! # The order
//!
//! The order is a total order, defined by the key and nothing else. Each text
//! is compared by reading it left to right, run by run; a number is never
//! parsed out of a mixed string, because comparing pairs by parsed numbers is
//! not transitive (`a9` < `a10` < `a1x` < `a9`) and no sort could be
//! consistent with it.
//!
//! A URL is parsed once (the way `@d-zero/shared`'s `parseUrl` does, on the
//! WHATWG URL rules) and its key is the following fields in turn, each
//! comparing as described and closing with a terminator that sorts before
//! any character, so a shorter text sorts before the longer text it starts:
//!
//! 1. **Host**, without the port.
//! 2. **Path**, segment by segment. Each segment starts with a class that is
//!    compared first: the path ends here, then the URL ends in a slash (a
//!    directory's own page), then an index page (the last segment is `index`
//!    with at most one extension), then a name that only starts with `index`
//!    (`index-j.html`), then any other segment. The three index classes
//!    apply to the **last** segment only: a directory called `index` is an
//!    ordinary name. So `/a` < `/a/` < `/a/index.html` < `/a/index-j.html` <
//!    `/a/b`; `/a` < `/a/b` as a path sorts before the longer paths it
//!    starts; and index pages come ahead of the sibling directories
//!    (`/index.html` < `/about/x`) while a directory `/index/x` sorts among
//!    them. Within a class, segments are ordered by their text.
//! 3. **Query** (as normalized: `PHPSESSID` removed, pairs sorted by name),
//!    then **fragment**, then **protocol**.
//!
//! URLs whose keys are equal (they differ only in the port or credentials, or
//! in how the same query was written) are then ordered by their **raw URL
//! string**, by UTF-8 byte order, and identical strings by the caller's
//! position. [`sort_ranks`] applies this after the key, from the strings it
//! already holds; the key does not repeat them, which would double the memory
//! a ranking of millions of URLs takes.
//!
//! Text is compared percent-decoded (like `decodeURI`; text that does not
//! decode stays as written) and lowercased, by UTF-16 code unit. The host and
//! the protocol compare as plain text. Everywhere else a run of ASCII digits
//! compares by value: by its length once leading zeros are removed, then
//! digit by digit, then, for equal values, as the digit strings order —
//! `page2` < `page10`, `a001` < `a01` < `a1` < `a2`. A decimal point or an
//! exponent is no part of a number: `1.5` reads as `1`, `.`, `5`, and `1e3`
//! as `1`, `e`, `3`.
//!
//! A string that is not a URL, and a URL that is not HTTP(S), have no host
//! and no path and so sort ahead of the HTTP(S) URLs; among themselves they
//! order by protocol and then by their raw strings (a query or number in
//! them gets no natural ordering).
//!
//! The order is persisted: the viewer read model stores each page's rank, so
//! changing any rule above must bump the read model's schema version.

//! # Alias keys
//!
//! The same crate also decides which pages are one page under another URL
//! ([`alias_keys`], [`group_alias_candidates`]). That is unrelated to the
//! order above, and independent of it: the alias keys read the URL as it is
//! written (`pathname` and `search` as the WHATWG URL serializes them), not
//! the normalized form the sort key reads. The grouping is persisted
//! (`content_items.alias_of_id`); the definition lives in the docs of those
//! two functions.

#![forbid(unsafe_code)]

mod alias_group;
mod alias_key;
mod build_url_sort_key;
mod decode_uri;
mod parse_url;
mod push_text;
mod sort_ranks;

pub use alias_group::{AliasCandidate, group_alias_candidates};
pub use alias_key::{AliasKeys, alias_keys};
pub use build_url_sort_key::build_url_sort_key;
pub use sort_ranks::sort_ranks;
