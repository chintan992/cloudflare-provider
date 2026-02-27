/**
 * Content ID Lookup Providers
 *
 * Provider-specific adapters for resolving TMDB IDs to provider content IDs.
 */

export { AnimeKaiLookup } from './AnimeKaiLookup';
export { KissKHLookup } from './KissKHLookup';
export { YFlixLookup } from './YFlixLookup';
export { OneTouchTVLookup } from './OneTouchTVLookup';

// ============================================================================
// Provider Registration
// ============================================================================

import { contentIdLookupService } from '../ContentIdLookupService';
import { AnimeKaiLookup } from './AnimeKaiLookup';
import { KissKHLookup } from './KissKHLookup';
import { YFlixLookup } from './YFlixLookup';
import { OneTouchTVLookup } from './OneTouchTVLookup';

/**
 * Register all lookup providers with the service
 */
export function registerAllLookupProviders(): void {
	contentIdLookupService.registerProvider(new AnimeKaiLookup());
	contentIdLookupService.registerProvider(new KissKHLookup());
	contentIdLookupService.registerProvider(new YFlixLookup());
	contentIdLookupService.registerProvider(new OneTouchTVLookup());
}

// Auto-register on import
registerAllLookupProviders();
