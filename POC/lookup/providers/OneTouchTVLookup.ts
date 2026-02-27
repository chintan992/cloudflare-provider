/**
 * OneTouchTV Content ID Lookup Provider
 *
 * Uses site scraping to search for content IDs on OneTouchTV.
 * TV shows only - returns both content ID and slug.
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

const ONETOUCHTV_BASE = 'https://onetouchtv.me';
const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

const RATE_LIMIT_DELAY_MS = 100;

// ============================================================================
// Utility Functions
// ============================================================================

function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^\w\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function similarity(a: string, b: string): number {
	const normA = normalizeTitle(a);
	const normB = normalizeTitle(b);

	if (normA === normB) return 1;
	if (normA.includes(normB) || normB.includes(normA)) return 0.9;

	const wordsA = normA.split(' ');
	const wordsB = normB.split(' ');
	const intersection = wordsA.filter((w) => wordsB.includes(w));
	const union = [...new Set([...wordsA, ...wordsB])];

	return intersection.length / union.length;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Provider Implementation
// ============================================================================

interface OneTouchTVSearchResult {
	id: string;
	slug: string;
	title: string;
	year?: number;
}

/**
 * OneTouchTV content ID lookup via site scraping
 */
export class OneTouchTVLookup implements IContentIdLookupProvider {
	readonly providerId: LookupProviderId = 'onetouchtv';
	readonly name = 'OneTouchTV';

	/**
	 * OneTouchTV only supports TV shows
	 */
	supportsMediaType(type: LookupMediaType): boolean {
		return type === 'tv';
	}

	/**
	 * Look up OneTouchTV content ID and slug by title
	 */
	async lookup(params: LookupParams): Promise<LookupResult> {
		const startTime = Date.now();

		// OneTouchTV only supports TV
		if (params.type !== 'tv') {
			return {
				success: false,
				contentId: null,
				error: 'OneTouchTV only supports TV shows',
				cached: false,
				durationMs: Date.now() - startTime
			};
		}

		try {
			// Search for content
			const searchResults = await this.searchContent(params.title);

			if (!searchResults || searchResults.length === 0) {
				// Try alternative titles
				if (params.alternativeTitles?.length) {
					for (const altTitle of params.alternativeTitles) {
						await sleep(RATE_LIMIT_DELAY_MS);
						const altResults = await this.searchContent(altTitle);

						if (altResults?.length) {
							const match = this.findBestMatch(altResults, altTitle, params.year);
							if (match) {
								return {
									success: true,
									contentId: match.id,
									slug: match.slug,
									cached: false,
									durationMs: Date.now() - startTime
								};
							}
						}
					}
				}

				return {
					success: false,
					contentId: null,
					error: 'No content found',
					cached: false,
					durationMs: Date.now() - startTime
				};
			}

			// Find best match
			const match = this.findBestMatch(searchResults, params.title, params.year);

			if (!match) {
				return {
					success: false,
					contentId: null,
					error: 'No matching content found',
					cached: false,
					durationMs: Date.now() - startTime
				};
			}

			logger.debug('OneTouchTV found match', {
				searchTitle: params.title,
				matchedTitle: match.title,
				contentId: match.id,
				slug: match.slug,
				...streamLog
			});

			return {
				success: true,
				contentId: match.id,
				slug: match.slug,
				cached: false,
				durationMs: Date.now() - startTime
			};
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.warn('OneTouchTV lookup failed', {
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
	 * Search OneTouchTV for content
	 */
	private async searchContent(query: string): Promise<OneTouchTVSearchResult[]> {
		const searchUrl = `${ONETOUCHTV_BASE}/search?query=${encodeURIComponent(query)}`;

		const response = await fetch(searchUrl, {
			headers: {
				'User-Agent': USER_AGENT,
				Accept: 'text/html',
				Referer: `${ONETOUCHTV_BASE}/`
			}
		});

		if (!response.ok) {
			throw new Error(`Search failed: ${response.status}`);
		}

		const html = await response.text();
		return this.parseSearchResults(html);
	}

	/**
	 * Parse search results from HTML
	 */
	private parseSearchResults(html: string): OneTouchTVSearchResult[] {
		const results: OneTouchTVSearchResult[] = [];
		const seen = new Set<string>();

		// Match vod links: /vod/123-show-name or /web/vod/123-show-name
		const vodPattern = /\/(?:web\/)?vod\/(\d+)-([a-z0-9-]+)/gi;

		let match;
		while ((match = vodPattern.exec(html)) !== null) {
			const id = match[1];
			const slug = match[2];

			if (id && slug && !seen.has(id)) {
				seen.add(id);

				// Convert slug to title
				const title = slug.replace(/-/g, ' ');

				// Try to extract year from nearby context
				const yearMatch = html.substring(match.index, match.index + 200).match(/\b(20\d{2})\b/);
				const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

				results.push({ id, slug, title, year });
			}
		}

		return results;
	}

	/**
	 * Find best matching content from search results
	 */
	private findBestMatch(
		results: OneTouchTVSearchResult[],
		title: string,
		year?: number
	): OneTouchTVSearchResult | null {
		let bestMatch: OneTouchTVSearchResult | null = null;
		let bestScore = 0;

		for (const result of results) {
			let score = similarity(title, result.title);

			// Year match bonus
			if (year && result.year === year) {
				score += 0.15;
			} else if (year && result.year && Math.abs(year - result.year) <= 1) {
				score += 0.05;
			}

			if (score > bestScore && score >= 0.5) {
				bestScore = score;
				bestMatch = result;
			}
		}

		return bestMatch;
	}
}
