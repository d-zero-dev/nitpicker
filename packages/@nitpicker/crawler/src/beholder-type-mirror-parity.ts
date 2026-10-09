import type * as Beholder from '@d-zero/beholder';
import type * as ArchiveMeta from '@nitpicker/archive/meta/types';
// The module exports only types, which `import-x/namespace` cannot see; the
// `tsc` build is what resolves (and checks) every member used below.
// eslint-disable-next-line import-x/namespace
import type * as Archive from '@nitpicker/archive/utils/types/types';

/**
 * `true` only when `A` and `B` are identical types — every member, optional
 * modifier and member type must match. Plain mutual assignability is not
 * enough here: it accepts a newly added optional field on one side.
 */
type Identical<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Compiles only when every value of `T` is `true`. */
type AssertAll<T extends Record<string, true>> = T;

/**
 * Compile-time proof that `@nitpicker/archive`'s mirrors of
 * `@d-zero/beholder`'s scrape-result types are identical to the installed
 * beholder's, checked by this package's `tsc` build.
 *
 * The archive defines these shapes itself so that it (and every read-only
 * consumer of it) does not depend on beholder / puppeteer. Structural typing
 * alone would let the mirrors drift silently: a field beholder ADDS (a new
 * `Meta` category, a new `IMAGE_SCAN_CODE`) still type-checks at the
 * crawler → archive boundary and is then never persisted. This assertion
 * turns any difference — additions included — into a build error in the one
 * package that depends on both, so a beholder bump forces the mirror in
 * `@nitpicker/archive` (`utils/types/types.ts`, `meta/types.ts`) to be
 * updated in the same change.
 *
 * The single intentional difference is `ConsoleLogEntry.type`, widened from
 * puppeteer's `ConsoleMessageType` union to `string` on the archive side;
 * it is checked for assignability instead of identity.
 */
export type BeholderTypeMirrorParity = AssertAll<{
	PageData: Identical<Beholder.PageData, Archive.PageData>;
	ScrollHeightData: Identical<Beholder.ScrollHeightData, Archive.ScrollHeightData>;
	ImageScanData: Identical<Beholder.ImageScanData, Archive.ImageScanData>;
	ImageScanCode: Identical<Beholder.ImageScanCode, Archive.ImageScanCode>;
	MainContentsData: Identical<Beholder.MainContentsData, Archive.MainContentsData>;
	MainContentsMainTag: Identical<
		Beholder.MainContentsMainTag,
		Archive.MainContentsMainTag
	>;
	MainContentsHeading: Identical<
		Beholder.MainContentsHeading,
		Archive.MainContentsHeading
	>;
	MainContentsImage: Identical<Beholder.MainContentsImage, Archive.MainContentsImage>;
	MainContentsTable: Identical<Beholder.MainContentsTable, Archive.MainContentsTable>;
	MainContentsButton: Identical<Beholder.MainContentsButton, Archive.MainContentsButton>;
	MainContentsIframe: Identical<Beholder.MainContentsIframe, Archive.MainContentsIframe>;
	MainContentsVideo: Identical<Beholder.MainContentsVideo, Archive.MainContentsVideo>;
	MainContentsAudio: Identical<Beholder.MainContentsAudio, Archive.MainContentsAudio>;
	MainContentsCanvas: Identical<Beholder.MainContentsCanvas, Archive.MainContentsCanvas>;
	ImageElement: Identical<Beholder.ImageElement, Archive.ImageElement>;
	Resource: Identical<Beholder.Resource, Archive.Resource>;
	AnchorData: Identical<Beholder.AnchorData, Archive.AnchorData>;
	ConsoleLogEntryWithoutType: Identical<
		Omit<Beholder.ConsoleLogEntry, 'type'>,
		Omit<Archive.ConsoleLogEntry, 'type'>
	>;
	ConsoleLogEntryType: Beholder.ConsoleLogEntry['type'] extends Archive.ConsoleLogEntry['type']
		? true
		: false;
	Meta: Identical<Beholder.Meta, ArchiveMeta.Meta>;
	ViewportMeta: Identical<Beholder.ViewportMeta, ArchiveMeta.ViewportMeta>;
	RobotsMeta: Identical<Beholder.RobotsMeta, ArchiveMeta.RobotsMeta>;
	ReferrerMeta: Identical<Beholder.ReferrerMeta, ArchiveMeta.ReferrerMeta>;
	FormatDetectionMeta: Identical<
		Beholder.FormatDetectionMeta,
		ArchiveMeta.FormatDetectionMeta
	>;
	HttpEquivMeta: Identical<Beholder.HttpEquivMeta, ArchiveMeta.HttpEquivMeta>;
	HttpEquivRefresh: Identical<Beholder.HttpEquivRefresh, ArchiveMeta.HttpEquivRefresh>;
	OpenGraphMeta: Identical<Beholder.OpenGraphMeta, ArchiveMeta.OpenGraphMeta>;
	OgArticleMeta: Identical<Beholder.OgArticleMeta, ArchiveMeta.OgArticleMeta>;
	OgBookMeta: Identical<Beholder.OgBookMeta, ArchiveMeta.OgBookMeta>;
	OgProfileMeta: Identical<Beholder.OgProfileMeta, ArchiveMeta.OgProfileMeta>;
	OgMusicMeta: Identical<Beholder.OgMusicMeta, ArchiveMeta.OgMusicMeta>;
	OgVideoNsMeta: Identical<Beholder.OgVideoNsMeta, ArchiveMeta.OgVideoNsMeta>;
	TwitterMeta: Identical<Beholder.TwitterMeta, ArchiveMeta.TwitterMeta>;
	FbMeta: Identical<Beholder.FbMeta, ArchiveMeta.FbMeta>;
	FediverseMeta: Identical<Beholder.FediverseMeta, ArchiveMeta.FediverseMeta>;
	AppleMeta: Identical<Beholder.AppleMeta, ArchiveMeta.AppleMeta>;
	MsApplicationMeta: Identical<Beholder.MsApplicationMeta, ArchiveMeta.MsApplicationMeta>;
	VerificationMeta: Identical<Beholder.VerificationMeta, ArchiveMeta.VerificationMeta>;
	GoogleMeta: Identical<Beholder.GoogleMeta, ArchiveMeta.GoogleMeta>;
	GeoMeta: Identical<Beholder.GeoMeta, ArchiveMeta.GeoMeta>;
	CitationMeta: Identical<Beholder.CitationMeta, ArchiveMeta.CitationMeta>;
	RdfaMeta: Identical<Beholder.RdfaMeta, ArchiveMeta.RdfaMeta>;
	MicrodataMeta: Identical<Beholder.MicrodataMeta, ArchiveMeta.MicrodataMeta>;
	AmpMeta: Identical<Beholder.AmpMeta, ArchiveMeta.AmpMeta>;
	LegacyMeta: Identical<Beholder.LegacyMeta, ArchiveMeta.LegacyMeta>;
	MobileMeta: Identical<Beholder.MobileMeta, ArchiveMeta.MobileMeta>;
	MicroformatsMeta: Identical<Beholder.MicroformatsMeta, ArchiveMeta.MicroformatsMeta>;
	PinterestMeta: Identical<Beholder.PinterestMeta, ArchiveMeta.PinterestMeta>;
	SlackMeta: Identical<Beholder.SlackMeta, ArchiveMeta.SlackMeta>;
	LinkedInMeta: Identical<Beholder.LinkedInMeta, ArchiveMeta.LinkedInMeta>;
	ExperimentalMeta: Identical<Beholder.ExperimentalMeta, ArchiveMeta.ExperimentalMeta>;
	WikiMeta: Identical<Beholder.WikiMeta, ArchiveMeta.WikiMeta>;
	LinkMeta: Identical<Beholder.LinkMeta, ArchiveMeta.LinkMeta>;
	LinkEntry: Identical<Beholder.LinkEntry, ArchiveMeta.LinkEntry>;
	JsonLdEntry: Identical<Beholder.JsonLdEntry, ArchiveMeta.JsonLdEntry>;
	OthersBucket: Identical<Beholder.OthersBucket, ArchiveMeta.OthersBucket>;
	ScriptEntry: Identical<Beholder.ScriptEntry, ArchiveMeta.ScriptEntry>;
	IframeEntry: Identical<Beholder.IframeEntry, ArchiveMeta.IframeEntry>;
	TagsMeta: Identical<Beholder.TagsMeta, ArchiveMeta.TagsMeta>;
	TagDetail: Identical<Beholder.TagDetail, ArchiveMeta.TagDetail>;
	TagEntry: Identical<Beholder.TagEntry, ArchiveMeta.TagEntry>;
	TagSource: Identical<Beholder.TagSource, ArchiveMeta.TagSource>;
	RawHeadEntry: Identical<Beholder.RawHeadEntry, ArchiveMeta.RawHeadEntry>;
}>;
