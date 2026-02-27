/**
 * Content ID Cache
 *
 * LRU cache for content ID lookups with different TTLs for
 * successful lookups vs failures.
 */

import { logger } from '$lib/logging';
import type {
	CacheEntry,
	CacheKey,
	LookupMediaType,
	LookupProviderId,
	LookupResult
} from './types';

const streamLog = { logCategory: 'streams' as const };

// ============================================================================
// Constants
// ============================================================================

/** Cache TTL for successful lookups (7 days) */
export const CONTENT_ID_CACHE_TTL_SUCCESS_MS = 7 * 24 * 60 * 60 * 1000;

/** Cache TTL for failed lookups (1 hour) */
export const CONTENT_ID_CACHE_TTL_FAILURE_MS = 1 * 60 * 60 * 1000;

/** Maximum cache entries */
export const CONTENT_ID_CACHE_MAX_SIZE = 2000;

// ============================================================================
// Cache Implementation
// ============================================================================

/**
 * Specialized LRU cache for content ID lookups
 */
export class ContentIdCache {
	private cache = new Map<CacheKey, CacheEntry>();
	private readonly maxSize: number;
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor(maxSize: number = CONTENT_ID_CACHE_MAX_SIZE) {
		this.maxSize = maxSize;

		// Start periodic cleanup every 10 minutes
		this.cleanupInterval = setInterval(
			() => {
				this.cleanupExpired();
			},
			10 * 60 * 1000
		);
	}

	/**
	 * Generate cache key
	 */
	private makeKey(
		providerId: LookupProviderId,
		tmdbId: string,
		mediaType: LookupMediaType
	): CacheKey {
		return `${providerId}:${tmdbId}:${mediaType}`;
	}

	/**
	 * Get cached lookup result
	 */
	get(
		providerId: LookupProviderId,
		tmdbId: string,
		mediaType: LookupMediaType
	): LookupResult | null {
		const key = this.makeKey(providerId, tmdbId, mediaType);
		const entry = this.cache.get(key);

		if (!entry) {
			return null;
		}

		// Check expiration
		if (Date.now() > entry.expiresAt) {
			this.cache.delete(key);
			return null;
		}

		// Move to end (most recently used)
		this.cache.delete(key);
		this.cache.set(key, entry);

		// Return as LookupResult
		return {
			success: entry.contentId !== null,
			contentId: entry.contentId,
			slug: entry.slug,
			cached: true
		};
	}

	/**
	 * Cache a lookup result
	 */
	set(
		providerId: LookupProviderId,
		tmdbId: string,
		mediaType: LookupMediaType,
		result: LookupResult,
		title?: string
	): void {
		const key = this.makeKey(providerId, tmdbId, mediaType);

		// Evict oldest entry if at capacity
		if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey) {
				this.cache.delete(firstKey);
			}
		}

		// Use different TTL based on success/failure
		const ttl = result.success ? CONTENT_ID_CACHE_TTL_SUCCESS_MS : CONTENT_ID_CACHE_TTL_FAILURE_MS;
		const now = Date.now();

		const entry: CacheEntry = {
			providerId,
			tmdbId,
			mediaType,
			contentId: result.contentId,
			slug: result.slug,
			title,
			cachedAt: now,
			expiresAt: now + ttl
		};

		this.cache.set(key, entry);

		logger.debug('Cached content ID lookup', {
			provider: providerId,
			tmdbId,
			contentId: result.contentId,
			ttlMinutes: Math.round(ttl / 60000),
			...streamLog
		});
	}

	/**
	 * Check if a lookup is cached
	 */
	has(providerId: LookupProviderId, tmdbId: string, mediaType: LookupMediaType): boolean {
		return this.get(providerId, tmdbId, mediaType) !== null;
	}

	/**
	 * Remove a cached lookup
	 */
	delete(providerId: LookupProviderId, tmdbId: string, mediaType: LookupMediaType): boolean {
		const key = this.makeKey(providerId, tmdbId, mediaType);
		return this.cache.delete(key);
	}

	/**
	 * Clear all cached lookups
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Get current cache size
	 */
	get size(): number {
		return this.cache.size;
	}

	/**
	 * Remove expired entries
	 */
	private cleanupExpired(): void {
		const now = Date.now();
		let cleaned = 0;

		for (const [key, entry] of this.cache.entries()) {
			if (now > entry.expiresAt) {
				this.cache.delete(key);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			logger.debug('Content ID cache cleanup', {
				cleaned,
				remaining: this.cache.size,
				...streamLog
			});
		}
	}

	/**
	 * Get cache statistics
	 */
	getStats(): { size: number; providers: Record<LookupProviderId, number> } {
		const providers: Record<string, number> = {};

		for (const entry of this.cache.values()) {
			providers[entry.providerId] = (providers[entry.providerId] || 0) + 1;
		}

		return {
			size: this.cache.size,
			providers: providers as Record<LookupProviderId, number>
		};
	}

	/**
	 * Stop the cleanup interval
	 */
	destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
	}
}

// ============================================================================
// Global Instance
// ============================================================================

/** Global content ID cache instance */
export const contentIdCache = new ContentIdCache();
