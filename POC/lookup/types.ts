/**
 * Content ID Lookup Types
 *
 * Types and interfaces for the content ID lookup system that enables
 * providers requiring provider-specific content IDs (AnimeKai, YFlix, etc.)
 */

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Providers that require content ID lookup
 */
export type LookupProviderId = 'animekai' | 'yflix' | 'onetouchtv' | 'kisskh';

/**
 * Media type for lookups
 */
export type LookupMediaType = 'movie' | 'tv' | 'anime';

// ============================================================================
// Lookup Parameters
// ============================================================================

/**
 * Parameters for content ID lookup
 */
export interface LookupParams {
	/** TMDB ID of the content */
	tmdbId: string;
	/** Media type */
	type: LookupMediaType;
	/** Content title for search */
	title: string;
	/** Release year for filtering */
	year?: number;
	/** Season number (for TV episode lookups) */
	season?: number;
	/** Episode number (for TV episode lookups) */
	episode?: number;
	/** Alternative titles to try if primary fails */
	alternativeTitles?: string[];
	/** MyAnimeList ID (for anime - more reliable than title search) */
	malId?: number;
	/** AniList ID (for anime - more reliable than title search) */
	anilistId?: number;
}

// ============================================================================
// Lookup Results
// ============================================================================

/**
 * Result of a content ID lookup
 */
export interface LookupResult {
	/** Whether the lookup succeeded */
	success: boolean;
	/** Provider-specific content ID (null if not found) */
	contentId: string | null;
	/** URL slug (some providers need this alongside ID) */
	slug?: string;
	/** Episode-specific ID (for providers with episode-level IDs) */
	episodeId?: string;
	/** Error message if lookup failed */
	error?: string;
	/** Whether result came from cache */
	cached: boolean;
	/** Time taken for lookup in ms */
	durationMs?: number;
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Cache entry for a content ID lookup
 */
export interface CacheEntry {
	/** Provider this entry is for */
	providerId: LookupProviderId;
	/** TMDB ID that was looked up */
	tmdbId: string;
	/** Media type */
	mediaType: LookupMediaType;
	/** Resolved content ID (null = confirmed not found) */
	contentId: string | null;
	/** URL slug if applicable */
	slug?: string;
	/** Title used for the lookup */
	title?: string;
	/** Timestamp when cached */
	cachedAt: number;
	/** Timestamp when entry expires */
	expiresAt: number;
}

/**
 * Cache key format
 */
export type CacheKey = `${LookupProviderId}:${string}:${LookupMediaType}`;

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Interface for content ID lookup providers
 */
export interface IContentIdLookupProvider {
	/** Provider identifier */
	readonly providerId: LookupProviderId;

	/** Display name */
	readonly name: string;

	/** Whether this provider supports the given media type */
	supportsMediaType(type: LookupMediaType): boolean;

	/**
	 * Look up the content ID for given parameters
	 * Should never throw - returns failure result instead
	 */
	lookup(params: LookupParams): Promise<LookupResult>;
}

// ============================================================================
// Search Result Types (from external APIs)
// ============================================================================

/**
 * AnimeKai search result from enc-dec.app
 */
export interface AnimeKaiSearchResult {
	id: string;
	title: string;
	year?: number;
	type?: string;
	mal_id?: number;
	anilist_id?: number;
}

/**
 * YFlix/1Movies parsed search result
 */
export interface YFlixSearchResult {
	id: string;
	title: string;
	year?: number;
	url: string;
}

/**
 * OneTouchTV parsed search result
 */
export interface OneTouchTVSearchResult {
	id: string;
	slug: string;
	title: string;
	year?: number;
}

/**
 * KissKH parsed search result
 */
export interface KissKHSearchResult {
	id: string;
	title: string;
	year?: number;
	episodeCount?: number;
}
