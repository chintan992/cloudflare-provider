/**
 * KissKH Content ID Lookup Provider
 *
 * Uses site scraping to search for Asian drama content IDs.
 * KissKH requires episode-level IDs, so this provider returns
 * the specific episode ID based on season/episode parameters.
 */

import { logger } from '$lib/logging';
import type {
	IContentIdLookupProvider,
	LookupMediaType,
	LookupParams,
	LookupProviderId,
	LookupResult
} from '../types';

const streamLog = { logCategory: 'streams' as const };

// ============================================================================
// Configuration
// ============================================================================

const KISSKH_BASE = 'https://kisskh.do';
const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

// Rate limiting for scraping
const RATE_LIMIT_DELAY_MS = 100;

// ============================================================================
// Response Types
// ============================================================================

interface KissKHSearchResult {
	id: number;
	title: string;
	episodesCount: number;
	type?: number;
	status?: number;
	country?: string;
	releaseDate?: string;
}

interface KissKHEpisode {
	id: number;
	number: number;
	title?: string;
	sub?: number;
}

interface KissKHDrama {
	id: number;
	title: string;
	episodes: KissKHEpisode[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize title for comparison
 */
function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^\w\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Calculate similarity between titles
 */
function similarity(a: string, b: string): number {
	const normA = normalizeTitle(a);
	const normB = normalizeTitle(b);

	if (normA === normB) return 1;
	if (normA.includes(normB) || normB.includes(normA)) return 0.9;

	// Simple word overlap score
	const wordsA = normA.split(' ');
	const wordsB = normB.split(' ');
	const intersection = wordsA.filter((w) => wordsB.includes(w));
	const union = [...new Set([...wordsA, ...wordsB])];

	return intersection.length / union.length;
}

/**
 * Sleep for rate limiting
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Provider Implementation
// ============================================================================

/**
 * KissKH content ID lookup via site scraping
 */
export class KissKHLookup implements IContentIdLookupProvider {
	readonly providerId: LookupProviderId = 'kisskh';
	readonly name = 'KissKH';

	/**
	 * KissKH supports TV shows (Asian dramas)
	 */
	supportsMediaType(type: LookupMediaType): boolean {
		return type === 'tv';
	}

	/**
	 * Look up KissKH episode ID by title and episode
	 */
	async lookup(params: LookupParams): Promise<LookupResult> {
		const startTime = Date.now();

		try {
			// Search for drama
			const searchResults = await this.searchDrama(params.title);

			if (!searchResults || searchResults.length === 0) {
				return {
					success: false,
					contentId: null,
					error: 'No dramas found',
					cached: false,
					durationMs: Date.now() - startTime
				};
			}

			// Find best match
			const match = this.findBestMatch(searchResults, params.title, params.year);

			if (!match) {
				// Try alternative titles
				if (params.alternativeTitles?.length) {
					for (const altTitle of params.alternativeTitles) {
						const altResults = await this.searchDrama(altTitle);
						await sleep(RATE_LIMIT_DELAY_MS);

						if (altResults?.length) {
							const altMatch = this.findBestMatch(altResults, altTitle, params.year);
							if (altMatch) {
								return this.getEpisodeId(altMatch, params, startTime);
							}
						}
					}
				}

				return {
					success: false,
					contentId: null,
					error: 'No matching drama found',
					cached: false,
					durationMs: Date.now() - startTime
				};
			}

			return this.getEpisodeId(match, params, startTime);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.warn('KissKH lookup failed', {
				title: params.title,
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
	 * Search KissKH for dramas
	 */
	private async searchDrama(query: string): Promise<KissKHSearchResult[]> {
		const searchUrl = `${KISSKH_BASE}/api/DramaList/Search?q=${encodeURIComponent(query)}&type=0`;

		const response = await fetch(searchUrl, {
			headers: {
				'User-Agent': USER_AGENT,
				Accept: 'application/json',
				Referer: `${KISSKH_BASE}/`
			}
		});

		if (!response.ok) {
			throw new Error(`Search failed: ${response.status}`);
		}

		const results = (await response.json()) as KissKHSearchResult[];
		return results;
	}

	/**
	 * Find best matching drama from search results
	 */
	private findBestMatch(
		results: KissKHSearchResult[],
		title: string,
		year?: number
	): KissKHSearchResult | null {
		let bestMatch: KissKHSearchResult | null = null;
		let bestScore = 0;

		for (const result of results) {
			let score = similarity(title, result.title);

			// Year match bonus
			if (year && result.releaseDate) {
				const releaseYear = parseInt(result.releaseDate.substring(0, 4));
				if (releaseYear === year) {
					score += 0.1;
				}
			}

			if (score > bestScore && score >= 0.5) {
				bestScore = score;
				bestMatch = result;
			}
		}

		if (bestMatch) {
			logger.debug('KissKH found match', {
				searchTitle: title,
				matchedTitle: bestMatch.title,
				dramaId: bestMatch.id,
				score: bestScore,
				...streamLog
			});
		}

		return bestMatch;
	}

	/**
	 * Get episode ID from drama
	 */
	private async getEpisodeId(
		drama: KissKHSearchResult,
		params: LookupParams,
		startTime: number
	): Promise<LookupResult> {
		// For KissKH, most Asian dramas are single season
		// Episode number maps directly to the episode list
		const episode = params.episode ?? 1;

		// Get drama details with episodes
		const detailUrl = `${KISSKH_BASE}/api/DramaList/Drama/${drama.id}?is498=false`;

		const response = await fetch(detailUrl, {
			headers: {
				'User-Agent': USER_AGENT,
				Accept: 'application/json',
				Referer: `${KISSKH_BASE}/`
			}
		});

		if (!response.ok) {
			return {
				success: false,
				contentId: null,
				error: `Failed to get drama details: ${response.status}`,
				cached: false,
				durationMs: Date.now() - startTime
			};
		}

		const dramaDetails = (await response.json()) as KissKHDrama;

		if (!dramaDetails.episodes || dramaDetails.episodes.length === 0) {
			return {
				success: false,
				contentId: null,
				error: 'Drama has no episodes',
				cached: false,
				durationMs: Date.now() - startTime
			};
		}

		// Find episode by number
		// KissKH episodes are typically numbered sequentially
		const episodeData = dramaDetails.episodes.find((ep) => ep.number === episode);

		if (!episodeData) {
			// Try finding by index if direct number match fails
			const episodeByIndex = dramaDetails.episodes[episode - 1];

			if (!episodeByIndex) {
				return {
					success: false,
					contentId: null,
					error: `Episode ${episode} not found`,
					cached: false,
					durationMs: Date.now() - startTime
				};
			}

			logger.debug('KissKH found episode', {
				dramaId: drama.id,
				dramaTitle: drama.title,
				episodeId: episodeByIndex.id,
				episodeNumber: episode,
				...streamLog
			});

			return {
				success: true,
				contentId: drama.id.toString(),
				episodeId: episodeByIndex.id.toString(),
				cached: false,
				durationMs: Date.now() - startTime
			};
		}

		logger.debug('KissKH found episode', {
			dramaId: drama.id,
			dramaTitle: drama.title,
			episodeId: episodeData.id,
			episodeNumber: episode,
			...streamLog
		});

		return {
			success: true,
			contentId: drama.id.toString(),
			episodeId: episodeData.id.toString(),
			cached: false,
			durationMs: Date.now() - startTime
		};
	}
}
