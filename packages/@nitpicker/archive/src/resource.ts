import type { ArchiveAccessor } from './archive-accessor.js';
import type { DB_Resource } from './types.js';

/**
 * Represents a sub-resource (CSS, JS, image, font, etc.) stored in the archive.
 *
 * Provides access to the resource's HTTP metadata and referrer information.
 * Instances are created by {@link ArchiveAccessor.getResources}.
 */
export default class Resource {
	#archive: ArchiveAccessor;
	#raw: DB_Resource;

	/**
	 * The content length of the resource in bytes, or null if unknown.
	 */
	get contentLength() {
		return this.#raw.contentLength;
	}

	/**
	 * The MIME content type of the resource (e.g., `"text/css"`, `"application/javascript"`), or null if unknown.
	 */
	get contentType() {
		return this.#raw.contentType;
	}

	/**
	 * Whether this resource is hosted on an external domain.
	 */
	get isExternal() {
		return !!this.#raw.isExternal;
	}

	/**
	 * The HTTP response status code, or null if not yet fetched.
	 */
	get status() {
		return this.#raw.status;
	}

	/**
	 * The HTTP response status text (e.g., `"OK"`, `"Not Found"`), or null if not yet fetched.
	 */
	get statusText() {
		return this.#raw.statusText;
	}

	/**
	 * The URL of the resource.
	 */
	get url() {
		return this.#raw.url;
	}

	/**
	 * Creates a new Resource instance.
	 * @param archive - The ArchiveAccessor used for querying referrer data.
	 * @param raw - The raw database row for this resource.
	 */
	constructor(archive: ArchiveAccessor, raw: DB_Resource) {
		this.#archive = archive;
		this.#raw = raw;
	}

	/**
	 * Retrieves the page URLs that reference this resource.
	 * @returns An array of page URL strings that include or reference this resource.
	 */
	async getReferrers() {
		return this.#archive.getReferrersOfResource(this.#raw.id);
	}
}
