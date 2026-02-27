/**
 * AnimeKai Content ID Lookup Provider
 *
 * Uses the enc-dec.app database API to find anime content IDs.
 * Database endpoints are at https://enc-dec.app/db/kai/ (not /api/db/kai/).
 *
 * Supports two lookup strategies:
 * 1. ID-based lookup (most reliable): Use MAL ID or AniList ID directly
 * 2. Title search (fallback): Search by anime title with fuzzy matching
 */

import { logger } from '$lib/logging';
import { getEncDecClient } from '../../enc-dec';
import type {
	IContentIdLookupProvider,
	LookupMediaType,
	LookupParams,
	LookupProviderId,
	LookupResult
} from '../types';

const streamLog = { logCategory: 'streams' as const };

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize a title for comparison
 */
function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^\w\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Calculate similarity score between two strings (0-1)
 */
function similarity(a: string, b: string): number {
	const normA = normalizeTitle(a);
	const normB = normalizeTitle(b);

	if (normA === normB) return 1;
	if (normA.includes(normB) || normB.includes(normA)) return 0.9;

	// Word overlap score
	const wordsA = normA.split(' ');
	const wordsB = normB.split(' ');
	const intersection = wordsA.filter((w) => wordsB.includes(w));
	const union = [...new Set([...wordsA, ...wordsB])];

	return intersection.length / union.length;
}

// ============================================================================
// Provider Implementation
// ============================================================================

/**
 * AnimeKai content ID lookup using enc-dec.app database
 *
 * Lookup priority:
 * 1. MAL ID (most reliable)
 * 2. AniList ID
 * 3. Title search (fallback)
 */
export class AnimeKaiLookup implements IContentIdLookupProvider {
	readonly providerId: LookupProviderId = 'animekai';
	readonly name = 'AnimeKai';

	private encDec = getEncDecClient();

	/**
	 * AnimeKai only supports anime content
	 */
	supportsMediaType(type: LookupMediaType): boolean {
		return type === 'anime';
	}

	/**
	 * Look up AnimeKai content ID
	 *
	 * Strategy:
	 * 1. Try MAL ID lookup (instant, exact match)
	 * 2. Try AniList ID lookup (instant, exact match)
	 * 3. Fall back to title search (fuzzy matching)
	 */
	async lookup(params: LookupParams): Promise<LookupResult> {
		const startTime = Date.now();

		try {
			// Strategy 1: Try MAL ID lookup (most reliable)
			if (params.malId) {
				const result = await this.findById({ mal_id: params.malId });
				if (result.success) {
					logger.debug('AnimeKai found via MAL ID', {
						malId: params.malId,
						contentId: result.contentId,
						...streamLog
					});
					return { ...result, durationMs: Date.now() - startTime };
				}
			}

			// Strategy 2: Try AniList ID lookup
			if (params.anilistId) {
				const result = await this.findById({ anilist_id: params.anilistId });
				if (result.success) {
					logger.debug('AnimeKai found via AniList ID', {
						anilistId: params.anilistId,
						contentId: result.contentId,
						...streamLog
					});
					return { ...result, durationMs: Date.now() - startTime };
				}
			}

			// Strategy 3: Fall back to title search
			let result = await this.searchForTitle(params.title, params.year);

			if (result.success) {
				return { ...result, durationMs: Date.now() - startTime };
			}

			// Try alternative titles if primary failed
			if (params.alternativeTitles?.length) {
				for (const altTitle of params.alternativeTitles) {
					result = await this.searchForTitle(altTitle, params.year);
					if (result.success) {
						logger.debug('AnimeKai found via alternative title', {
							primaryTitle: params.title,
							matchedTitle: altTitle,
							contentId: result.contentId,
							...streamLog
						});
						return { ...result, durationMs: Date.now() - startTime };
					}
				}
			}

			// No match found
			return {
				success: false,
				contentId: null,
				error: 'No matching anime found',
				cached: false,
				durationMs: Date.now() - startTime
			};
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.warn('AnimeKai lookup failed', {
				title: params.title,
				malId: params.malId,
				anilistId: params.anilistId,
				error: errorMsg,
				...streamLog
			});

			return {
				success: false,
				contentId: null,
				error: errorMsg,
				cached: false,
				durationMs: Date.now() - startTime
			};
		}
	}

	/**
	 * Find by external ID (MAL or AniList)
	 */
	private async findById(options: {
		mal_id?: number;
		anilist_id?: number;
	}): Promise<Omit<LookupResult, 'durationMs'>> {
		const entry = await this.encDec.findAnimeKaiById(options);

		if (!entry) {
			return {
				success: false,
				contentId: null,
				cached: false
			};
		}

		// Extract slug from kai_watch path (e.g., "/watch/cowboy-bebop-4gnv" -> "cowboy-bebop-4gnv")
		const slug = entry.kai_watch?.replace('/watch/', '') ?? undefined;

		return {
			success: true,
			contentId: entry.kai_id,
			slug,
			cached: false
		};
	}

	/**
	 * Search for a specific title (fuzzy matching)
	 */
	private async searchForTitle(
		title: string,
		year?: number
	): Promise<Omit<LookupResult, 'durationMs'>> {
		const results = await this.encDec.searchAnimeKai(title, { year });

		if (!results || results.length === 0) {
			return {
				success: false,
				contentId: null,
				cached: false
			};
		}

		// Find best match
		let bestMatch = results[0];
		let bestScore = 0;

		for (const entry of results) {
			// Use title_en for English title matching
			let score = similarity(title, entry.title_en);

			// Check Japanese title if available
			if (entry.title_jp) {
				const jpScore = similarity(title, entry.title_jp);
				score = Math.max(score, jpScore);
			}

			// Year match bonus (year is string in API response)
			if (year && entry.year && parseInt(entry.year, 10) === year) {
				score += 0.1;
			}

			if (score > bestScore) {
				bestScore = score;
				bestMatch = entry;
			}
		}

		// Require reasonable similarity (0.5 = 50% match)
		if (bestScore < 0.5) {
			logger.debug('AnimeKai no confident match', {
				title,
				bestMatch: bestMatch.title_en,
				score: bestScore,
				...streamLog
			});
			return {
				success: false,
				contentId: null,
				cached: false
			};
		}

		// Extract slug from kai_watch path
		const slug = bestMatch.kai_watch?.replace('/watch/', '') ?? undefined;

		logger.debug('AnimeKai found via title search', {
			searchTitle: title,
			matchedTitle: bestMatch.title_en,
			contentId: bestMatch.kai_id,
			score: bestScore,
			year: bestMatch.year,
			...streamLog
		});

		return {
			success: true,
			contentId: bestMatch.kai_id,
			slug,
			cached: false
		};
	}
}
