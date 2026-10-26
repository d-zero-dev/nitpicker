//! What JS sees of the executor (`executor`): the cancel token and the check
//! of its settings.

use std::sync::Arc;

use napi::{Error, Result, Status};
use napi_derive::napi;

use crate::executor::{CancelFlag, Executor};

/// The shared executor, or `InvalidArg` naming the setting that is invalid.
pub fn shared_executor() -> Result<&'static Arc<Executor>> {
	Executor::shared().map_err(|message| Error::new(Status::InvalidArg, message))
}

/// The rejection of a call stopped through its token.
pub fn cancelled_error(what: &str) -> Error {
	Error::new(Status::Cancelled, format!("{what} was cancelled"))
}

/// Stops the asynchronous native calls it was handed to (the flag itself is
/// `executor::CancelFlag`).
///
/// Raising it is one-way: a call that has the token reads the flag when it is
/// taken off the queue and between the snapshots it judges, and rejects with
/// code `Cancelled` once it sees it raised. A call already past its last check
/// finishes normally. The JS wrappers make one token per call and raise it when
/// the caller's `AbortSignal` fires.
#[napi]
pub struct NativeCancelToken {
	flag: CancelFlag,
}

#[napi]
impl NativeCancelToken {
	/// A token that is not raised.
	#[napi(constructor)]
	#[must_use]
	pub fn new() -> Self {
		Self {
			flag: CancelFlag::default(),
		}
	}

	/// Raises the token.
	#[napi]
	pub fn cancel(&self) {
		self.flag.cancel();
	}
}

impl Default for NativeCancelToken {
	fn default() -> Self {
		Self::new()
	}
}

impl NativeCancelToken {
	/// The flag a running call reads: the token's own for a call that was given
	/// one, a flag nobody raises otherwise.
	#[must_use]
	pub fn flag_of(token: Option<&Self>) -> CancelFlag {
		token.map_or_else(CancelFlag::default, |token| token.flag.clone())
	}
}

/// Builds the executor from `NITPICKER_NATIVE_THREADS` and
/// `NITPICKER_NATIVE_CONCURRENCY` now, so an invalid value fails before any
/// work starts instead of at the first native call that needs the pool.
///
/// # Errors
///
/// `InvalidArg`, naming the variable and its value, when a setting is not a
/// positive integer.
#[napi(catch_unwind)]
pub fn check_native_executor_config() -> Result<()> {
	shared_executor().map(|_| ())
}
