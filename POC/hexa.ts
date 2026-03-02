/**
 * Hexa Provider
 *
 * Requires random API key in header for encryption.
 *
 * Pattern: Generate random key → Fetch with X-Api-Key header → Decrypt with key
 */

import { logger } from '$lib/logging';
import { BaseProvider } from './base';
import type { ProviderConfig, SearchParams, StreamResult } from './types';

const streamLog = { logCategory: 'streams' as const };

// ============================================================================
// Response Types
// ============================================================================

interface HexaDecryptedResponse {
	stream?: string;
	file?: string;
	url?: string;
	sources?: Array<{
		url?: string;
		file?: string;
		server?: string;
		type?: string;
	}>;
}

// ============================================================================
// Provider Implementation
// ============================================================================

export class HexaProvider extends BaseProvider {
	readonly config: ProviderConfig = {
		id: 'hexa',
		name: 'Hexa',
		priority: 50,
		enabledByDefault: true,
		supportsMovies: true,
		supportsTv: true,
		supportsAnime: false,
		supportsAsianDrama: false,
		requiresProxy: true,
		referer: 'https://hexa.su/',
		timeout: 15000,
		requirements: {
			imdbId: false,
			title: false,
			year: false
		}
	};

	protected async doExtract(params: SearchParams): Promise<StreamResult[]> {
		// Generate random 32-byte hex key
		const key = this.generateRandomHexKey(32);

		// Build URL based on content type
		let url: string;
		if (params.type === 'movie') {
			url = `https://themoviedb.hexa.su/api/tmdb/movie/${params.tmdbId}/images`;
		} else {
			if (params.season === undefined || params.episode === undefined) {
				logger.debug('Hexa requires season and episode for TV shows', streamLog);
				return [];
			}
			url = `https://themoviedb.hexa.su/api/tmdb/tv/${params.tmdbId}/season/${params.season}/episode/${params.episode}/images`;
		}

		// Fetch with API key header
		const encrypted = await this.fetchGet<string>(url, {
			headers: {
				'X-Api-Key': key,
				Accept: 'plain/text'
			},
			responseType: 'text'
		});

		if (!encrypted || encrypted.length < 10) {
			logger.debug('No encrypted data from Hexa', streamLog);
			return [];
		}

		// Decrypt with the key we generated
		const decrypted = await this.encDec.decryptHexa<HexaDecryptedResponse>({
			text: encrypted,
			key: key
		});

		const streams: StreamResult[] = [];

		// Check for top-level stream properties first
		const topLevelUrl = decrypted.stream || decrypted.file || decrypted.url;
		if (topLevelUrl && this.isValidStreamUrl(topLevelUrl)) {
			streams.push(
				this.createStreamResult(topLevelUrl, {
					quality: 'Auto',
					title: 'Hexa Stream',
					language: 'en',
					referer: '',
					headers: { Origin: '' }
				})
			);
		}

		// Process all sources from the array
		if (decrypted.sources && Array.isArray(decrypted.sources)) {
			for (const source of decrypted.sources) {
				const sourceUrl = source.url || source.file;
				if (sourceUrl && this.isValidStreamUrl(sourceUrl)) {
					const quality = source.server ? source.server : 'Auto';
					streams.push(
						this.createStreamResult(sourceUrl, {
							quality: quality,
							title: 'Hexa Stream',
							language: 'en',
							referer: '',
							headers: { Origin: '' }
						})
					);
				}
			}
		}

		if (streams.length === 0) {
			logger.debug('No valid stream URL in Hexa response', streamLog);
		}

		return streams;
	}

	private generateRandomHexKey(bytes: number): string {
		const array = new Uint8Array(bytes);
		crypto.getRandomValues(array);
		return Array.from(array)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}
}
