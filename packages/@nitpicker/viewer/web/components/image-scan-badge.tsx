import type { ImageScanOutcome } from '@nitpicker/query/categories';

import { getImageScanLabel } from '../i18n/get-image-scan-label.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Visual badge for one viewport's `@d-zero/beholder` `<img>` element scan
 * outcome (`page_meta.image_scan_desktop` / `image_scan_mobile`).
 *
 * Three severity tiers, matching how actionable each outcome is:
 *
 * - `ok` — neutral styling; the common case, should not draw the eye.
 * - `degraded` / `nav-unsettled` — warn styling; the scan produced data (or
 *   may be worth a `--retry-failed` pass) but network activity never
 *   settled cleanly.
 * - `frame-lost` / `unknown` — danger styling; the scan was abandoned
 *   outright.
 * - `scroll-height-exceeded` — neutral styling; a deterministic, page-shape
 *   outcome that a retry cannot change, not a failure to investigate.
 * @param props
 * @param props.outcome - The image-scan outcome, or `null` when the scan was
 *   never attempted (renders nothing).
 */
export function ImageScanBadge({ outcome }: { outcome: ImageScanOutcome | null }) {
	const { t } = useI18n();
	if (outcome === null) {
		return null;
	}
	const label = getImageScanLabel(outcome, t);
	const className = `image-scan-badge image-scan-badge--${outcome}`;
	return (
		<span className={className} title={label}>
			{label}
		</span>
	);
}
