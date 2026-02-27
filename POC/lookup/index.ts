/**
 * Content ID Lookup Module
 *
 * Provides content ID resolution for streaming providers that require
 * provider-specific content IDs rather than TMDB IDs.
 */

// Types
export type {
	CacheEntry,
	CacheKey,
	IContentIdLookupProvider,
	LookupMediaType,
	LookupParams,
	LookupProviderId,
	LookupResult,
	AnimeKaiSearchResult,
	YFlixSearchResult,
	OneTouchTVSearchResult,
	KissKHSearchResult
} from './types';

// Cache
export {
	ContentIdCache,
	contentIdCache,
	CONTENT_ID_CACHE_TTL_SUCCESS_MS,
	CONTENT_ID_CACHE_TTL_FAILURE_MS,
	CONTENT_ID_CACHE_MAX_SIZE
} from './ContentIdCache';

// Service
export {
	ContentIdLookupService,
	contentIdLookupService,
	LOOKUP_TIMEOUT_MS
} from './ContentIdLookupService';

// Lookup Providers
export {
	AnimeKaiLookup,
	KissKHLookup,
	YFlixLookup,
	OneTouchTVLookup,
	registerAllLookupProviders
} from './providers';
