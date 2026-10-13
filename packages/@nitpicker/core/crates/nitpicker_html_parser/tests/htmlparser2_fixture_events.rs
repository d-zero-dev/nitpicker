//! The template classifier's HTML fixtures (whole, and cut short), parsed
//! here and by htmlparser2 12.0.0: the event counts and digests in
//! `htmlparser2-fixture-events.tsv` were recorded from htmlparser2 by
//! `scripts/record-htmlparser2-events.mjs`, whose header defines the digest.
//! A mismatch names the fixture; re-running that script's recording handler
//! on it shows the events to compare.
//!
//! The fixtures live with the classifier's tests in `@nitpicker/archive`
//! (read from the source tree; nothing is built against that package). A
//! fixture added there fails here until the events are recorded again.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

/// Every `.html` file under `directory`, as paths relative to `root` with `/`.
fn html_files(root: &Path, directory: &Path, files: &mut Vec<String>) {
	for entry in std::fs::read_dir(directory).unwrap() {
		let path: PathBuf = entry.unwrap().path();
		if path.is_dir() {
			html_files(root, &path, files);
		} else if path
			.extension()
			.is_some_and(|extension| extension == "html")
		{
			let relative = path.strip_prefix(root).unwrap();
			files.push(
				relative
					.components()
					.map(|component| component.as_os_str().to_string_lossy())
					.collect::<Vec<_>>()
					.join("/"),
			);
		}
	}
}

use nitpicker_html_parser::{AttributeValue, EventKind, parse};

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0100_0000_01b3;

fn fnv1a64(text: &str) -> String {
	let mut hash = FNV_OFFSET;
	for &byte in text.as_bytes() {
		hash ^= u64::from(byte);
		hash = hash.wrapping_mul(FNV_PRIME);
	}
	format!("{hash:016x}")
}

fn field(value: Option<&AttributeValue>, html: &str) -> String {
	value.map_or_else(
		|| "-".to_owned(),
		|value| {
			let decoded = value.decoded(html);
			format!("{}:{decoded}", decoded.len())
		},
	)
}

/// `<event count>\t<digest>`, as the script records it.
fn record(html: &str) -> String {
	let document = parse(html);
	let mut lines = String::new();
	for (index, event) in document.events.iter().enumerate() {
		if index > 0 {
			lines.push('\n');
		}
		let kind = match event.kind {
			EventKind::Open => "open",
			EventKind::Close { implied: false } => "close",
			EventKind::Close { implied: true } => "implied",
		};
		write!(
			lines,
			"{kind}\t{}\t{}\t{}",
			document.tag_name(event.name),
			event.start_index,
			event.end_index
		)
		.unwrap();
		if event.kind == EventKind::Open {
			let attributes = document.attributes_of(event);
			write!(
				lines,
				"\t{}\t{}\t{}\t{}",
				field(attributes.class.as_ref(), html),
				field(attributes.role.as_ref(), html),
				field(attributes.r#type.as_ref(), html),
				field(attributes.id.as_ref(), html)
			)
			.unwrap();
		}
	}
	format!("{}\t{}", document.events.len(), fnv1a64(&lines))
}

#[test]
fn matches_htmlparser2_on_every_fixture() {
	let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
	let fixtures =
		manifest.join("../../../archive/src/template-classification/page-cluster/__fixtures__");
	let expected = std::fs::read_to_string(manifest.join("tests/htmlparser2-fixture-events.tsv"))
		.expect("the recorded events are checked in");

	let mut on_disk = Vec::new();
	html_files(&fixtures, &fixtures, &mut on_disk);
	on_disk.sort();
	let mut recorded_files: Vec<String> = expected
		.lines()
		.map(|line| line.split('\t').next().unwrap().to_owned())
		.collect();
	recorded_files.dedup();
	assert_eq!(
		recorded_files, on_disk,
		"the fixtures changed: record the events again (scripts/record-htmlparser2-events.mjs)"
	);

	let mut mismatches = Vec::new();
	let mut rows = 0;
	for line in expected.lines() {
		let mut columns = line.splitn(3, '\t');
		let (file, cut, recorded) = (
			columns.next().unwrap(),
			columns.next().unwrap(),
			columns.next().unwrap(),
		);
		let html = std::fs::read_to_string(fixtures.join(file))
			.unwrap_or_else(|error| panic!("{file}: {error}"));
		let html = match cut {
			"all" => html,
			count => html.chars().take(count.parse().unwrap()).collect(),
		};
		let actual = record(&html);
		if actual != recorded {
			mismatches.push(format!(
				"{file} ({cut}): htmlparser2 {recorded}, port {actual}"
			));
		}
		rows += 1;
	}
	assert!(rows > 0, "no recorded events");
	assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}
