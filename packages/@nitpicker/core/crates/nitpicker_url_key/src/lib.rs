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
//! 4. The **raw URL string**, so two keys are equal only for identical URLs;
//!    among those the caller's position decides. The port and credentials
//!    take no part before this point: URLs that differ only in them order by
//!    their raw strings.
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

#![forbid(unsafe_code)]

mod build_url_sort_key;
mod decode_uri;
mod parse_url;
mod push_text;
mod sort_ranks;

pub use build_url_sort_key::build_url_sort_key;
pub use sort_ranks::sort_ranks;
