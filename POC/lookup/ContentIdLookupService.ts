/**
 * Content ID Lookup Service
 *
 * Orchestrates content ID lookups for providers that require
 * provider-specific IDs instead of TMDB IDs.
 */

import { logger } from '$lib/logging';
import { contentIdCache } from './ContentIdCache';
import type {
	IContentIdLookupProvider,
	LookupMediaType,
	LookupParams,
	LookupProviderId,
	LookupResult
} from './types';

const streamLog = { logCategory: 'streams' as const };

// ============================================================================
// Configuration
// ============================================================================

/** Default timeout for lookup operations */
export const LOOKUP_TIMEOUT_MS = 10000;

// ============================================================================
// Lookup Service
// ============================================================================

/**
 * Central service for content ID lookups
 *
 * Manages provider adapters, caching, and graceful error handling.
 * Never throws - always returns a result indicating success or failure.
 */
export class ContentIdLookupService {
	private providers = new Map<LookupProviderId, IContentIdLookupProvider>();

	/**
	 * Register a lookup provider
	 */
	registerProvider(provider: IContentIdLookupProvider): void {
		this.providers.set(provider.providerId, provider);
		logger.debug('Registered content ID lookup provider', {
			provider: provider.providerId,
			name: provider.name,
			...streamLog
		});
	}

	/**
	 * Get a registered provider
	 */
	getProvider(providerId: LookupProviderId): IContentIdLookupProvider | undefined {
		return this.providers.get(providerId);
	}

	/**
	 * Check if a provider is registered
	 */
	hasProvider(providerId: LookupProviderId): boolean {
		return this.providers.has(providerId);
	}

	/**
	 * Look up content ID for a provider
	 *
	 * Checks cache first, then delegates to provider adapter.
	 * Never throws - logs warnings and returns failure result.
	 */
	async lookup(providerId: LookupProviderId, params: LookupParams): Promise<LookupResult> {
		const startTime = Date.now();

		// Check cache first
		const cached = contentIdCache.get(providerId, params.tmdbId, params.type);
		if (cached) {
			logger.debug('Content ID cache hit', {
				provider: providerId,
				tmdbId: params.tmdbId,
				contentId: cached.contentId,
				...streamLog
			});
			return {
				...cached,
				durationMs: Date.now() - startTime
			};
		}

		// Get provider
		const provider = this.providers.get(providerId);
		if (!provider) {
			logger.warn('Content ID lookup provider not registered', {
				provider: providerId,
				...streamLog
			});
			return {
				success: false,
				contentId: null,
				error: `Provider ${providerId} not registered`,
				cached: false,
				durationMs: Date.now() - startTime
			};
		}

		// Check if provider supports this media type
		if (!provider.supportsMediaType(params.type)) {
			logger.debug('Provider does not support media type', {
				provider: providerId,
				type: params.type,
				...streamLog
			});
			return {
				success: false,
				contentId: null,
				error: `Provider ${providerId} does not support ${params.type}`,
				cached: false,
				durationMs: Date.now() - startTime
			};
		}

		// Perform lookup with timeout
		try {
			const result = await this.withTimeout(provider.lookup(params), LOOKUP_TIMEOUT_MS);

			// Cache the result (success or failure)
			contentIdCache.set(providerId, params.tmdbId, params.type, result, params.title);

			if (result.success) {
				logger.debug('Content ID lookup succeeded', {
					provider: providerId,
					tmdbId: params.tmdbId,
					title: params.title,
					contentId: result.contentId,
					durationMs: Date.now() - startTime,
					...streamLog
				});
			} else {
				logger.warn('Content ID lookup failed', {
					provider: providerId,
					tmdbId: params.tmdbId,
					title: params.title,
					error: result.error,
					durationMs: Date.now() - startTime,
					...streamLog
				});
			}

			return {
				...result,
				durationMs: Date.now() - startTime
			};
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);

			logger.warn('Content ID lookup error', {
				provider: providerId,
				tmdbId: params.tmdbId,
				title: params.title,
				error: errorMsg,
				...streamLog
			});

			// Cache the failure
			const failureResult: LookupResult = {
				success: false,
				contentId: null,
				error: errorMsg,
				cached: false
			};
			contentIdCache.set(providerId, params.tmdbId, params.type, failureResult, params.title);

			return {
				...failureResult,
				durationMs: Date.now() - startTime
			};
		}
	}

	/**
	 * Look up content IDs for multiple providers in parallel
	 */
	async lookupMultiple(
		providerIds: LookupProviderId[],
		params: LookupParams
	): Promise<Map<LookupProviderId, LookupResult>> {
		const results = new Map<LookupProviderId, LookupResult>();

		const lookups = providerIds.map(async (providerId) => {
			const result = await this.lookup(providerId, params);
			results.set(providerId, result);
		});

		await Promise.all(lookups);
		return results;
	}

	/**
	 * Clear cached lookup for a specific provider/content
	 */
	invalidateCache(providerId: LookupProviderId, tmdbId: string, type: LookupMediaType): boolean {
		return contentIdCache.delete(providerId, tmdbId, type);
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): { size: number; providers: Record<LookupProviderId, number> } {
		return contentIdCache.getStats();
	}

	/**
	 * Wrap a promise with a timeout
	 */
	private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`Lookup timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			promise
				.then((result) => {
					clearTimeout(timer);
					resolve(result);
				})
				.catch((error) => {
					clearTimeout(timer);
					reject(error);
				});
		});
	}
}

// ============================================================================
// Global Instance
// ============================================================================

/** Global content ID lookup service instance */
export const contentIdLookupService = new ContentIdLookupService();
