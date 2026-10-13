//! A string interner shared by every thread of one classification run.
//!
//! Ids are only ever compared for equality and used as set members; nothing
//! orders by id, because which thread interns a string first — and so the id
//! it gets — depends on scheduling. Id lists are sorted (`sorted_set`) only
//! to compare them as sets (Jaccard, landmark signatures), never to order
//! output. Every ordering the output depends on is by first appearance or by
//! the string itself.

use std::hash::{BuildHasher, Hash};
use std::sync::{Arc, RwLock};

use rustc_hash::{FxBuildHasher, FxHashMap};

/// 64 shards: several per core on the machines this runs on, so threads
/// interning different strings rarely share a lock. Only contention depends
/// on it; ids are compared for equality only, so no output does.
const SHARD_BITS: u32 = 6;
const SHARDS: usize = 1 << SHARD_BITS;

#[derive(Default)]
struct Shard {
	ids: FxHashMap<Arc<str>, u32>,
	strings: Vec<Arc<str>>,
}

/// Concurrent `str` ↔ `u32` table, sharded by hash so threads interning
/// different strings rarely wait on each other.
pub struct Interner {
	shards: Vec<RwLock<Shard>>,
}

impl Default for Interner {
	fn default() -> Self {
		Self {
			shards: (0..SHARDS).map(|_| RwLock::default()).collect(),
		}
	}
}

fn shard_of(value: &str) -> usize {
	// Only the low bits pick the shard; truncation is the point.
	#[allow(clippy::cast_possible_truncation)]
	let hash = FxBuildHasher.hash_one(value) as usize;
	hash & (SHARDS - 1)
}

impl Interner {
	/// The id of `value`, adding it on first sight.
	///
	/// # Panics
	///
	/// When a shard's lock is poisoned (a thread panicked while holding it),
	/// or past 2^26 strings in one shard.
	pub fn intern(&self, value: &str) -> u32 {
		let shard_index = shard_of(value);
		let shard = &self.shards[shard_index];
		if let Some(&id) = shard.read().expect("interner lock").ids.get(value) {
			return id;
		}
		let mut shard = shard.write().expect("interner lock");
		if let Some(&id) = shard.ids.get(value) {
			return id;
		}
		let local = u32::try_from(shard.strings.len()).expect("interner shard overflow");
		assert!(
			local < 1 << (32 - SHARD_BITS - 1),
			"interner shard overflow"
		);
		let id = local << SHARD_BITS | u32::try_from(shard_index).expect("shard index fits");
		let value: Arc<str> = value.into();
		shard.strings.push(Arc::clone(&value));
		shard.ids.insert(value, id);
		id
	}

	/// The id of `value` if it was interned before, without adding it.
	///
	/// # Panics
	///
	/// When a shard's lock is poisoned.
	pub fn get(&self, value: &str) -> Option<u32> {
		self.shards[shard_of(value)]
			.read()
			.expect("interner lock")
			.ids
			.get(value)
			.copied()
	}

	/// The string behind `id`.
	///
	/// # Panics
	///
	/// When `id` did not come from this interner, or a lock is poisoned.
	pub fn resolve(&self, id: u32) -> Arc<str> {
		let shard = &self.shards[(id & ((1 << SHARD_BITS) - 1)) as usize];
		Arc::clone(&shard.read().expect("interner lock").strings[(id >> SHARD_BITS) as usize])
	}
}

/// Ids for strings that must not grow a shared [`Interner`]: they are looked
/// up there first and otherwise numbered locally, from the top of the id
/// range down, where no interned id reaches (an interned id stays below
/// 2^31). Two equal strings still get one id, and a local id never equals an
/// interned one, which is all set comparisons need.
#[derive(Default)]
pub struct ScratchIds {
	ids: FxHashMap<Arc<str>, u32>,
	strings: Vec<Arc<str>>,
}

impl ScratchIds {
	/// The interned id of `value`, or a local one.
	pub fn get_or_assign(&mut self, interner: &Interner, value: &str) -> u32 {
		if let Some(id) = interner.get(value) {
			return id;
		}
		if let Some(&id) = self.ids.get(value) {
			return id;
		}
		let id = u32::MAX - u32::try_from(self.strings.len()).expect("scratch id overflow");
		let value: Arc<str> = value.into();
		self.strings.push(Arc::clone(&value));
		self.ids.insert(value, id);
		id
	}

	/// The string a local id stands for.
	#[must_use]
	pub fn resolve(&self, id: u32) -> Option<&str> {
		self.strings
			.get((u32::MAX - id) as usize)
			.map(|value| &**value)
	}
}

/// Whether `id` is a [`ScratchIds`] id rather than an interned one.
#[must_use]
pub fn is_scratch_id(id: u32) -> bool {
	id >= 1 << 31
}

/// A concurrent map shared by every thread, sharded like [`Interner`].
pub struct SharedCache<K, V> {
	shards: Vec<RwLock<FxHashMap<K, V>>>,
}

impl<K, V> Default for SharedCache<K, V> {
	fn default() -> Self {
		Self {
			shards: (0..SHARDS).map(|_| RwLock::default()).collect(),
		}
	}
}

impl<K: Hash + Eq, V: Copy> SharedCache<K, V> {
	fn shard(&self, key: &K) -> &RwLock<FxHashMap<K, V>> {
		#[allow(clippy::cast_possible_truncation)]
		let hash = FxBuildHasher.hash_one(key) as usize;
		&self.shards[hash & (SHARDS - 1)]
	}

	/// The cached value for `key`.
	///
	/// # Panics
	///
	/// When the shard's lock is poisoned.
	pub fn get(&self, key: &K) -> Option<V> {
		self.shard(key)
			.read()
			.expect("cache lock")
			.get(key)
			.copied()
	}

	/// Caches `value` for `key` (a concurrent writer of the same key wins or
	/// loses harmlessly: both computed the same value).
	///
	/// # Panics
	///
	/// When the shard's lock is poisoned.
	pub fn insert(&self, key: K, value: V) {
		self.shard(&key)
			.write()
			.expect("cache lock")
			.insert(key, value);
	}
}

#[cfg(test)]
mod tests {
	use super::{Interner, ScratchIds, is_scratch_id};

	#[test]
	fn gives_equal_strings_one_id_and_resolves_it() {
		let interner = Interner::default();
		let a = interner.intern("body>main");
		let b = interner.intern("body>nav");
		assert_ne!(a, b);
		assert_eq!(interner.intern("body>main"), a);
		assert_eq!(&*interner.resolve(b), "body>nav");
		assert_eq!(interner.get("body>nav"), Some(b));
		assert_eq!(interner.get("absent"), None);
		assert!(!is_scratch_id(a));
	}

	#[test]
	fn numbers_unknown_strings_locally_without_growing_the_interner() {
		let interner = Interner::default();
		let known = interner.intern("known");
		let mut scratch = ScratchIds::default();
		assert_eq!(scratch.get_or_assign(&interner, "known"), known);
		let local = scratch.get_or_assign(&interner, "unknown");
		assert!(is_scratch_id(local));
		assert_eq!(scratch.get_or_assign(&interner, "unknown"), local);
		assert_eq!(interner.get("unknown"), None);
		assert_eq!(scratch.resolve(local), Some("unknown"));
	}
}
