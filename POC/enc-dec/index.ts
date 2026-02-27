/**
 * EncDec Module
 *
 * Exports for the encryption-as-a-service API client.
 */

export {
	EncDecClient,
	getEncDecClient,
	createEncDecClient,
	type EncDecClientConfig
} from './client';

export {
	// Error class
	EncDecApiError,

	// Provider type unions
	type EncryptionProvider,
	type DecryptionProvider,

	// Request payload types
	type DecryptPayload,
	type VideasyDecryptPayload,
	type VidstackDecryptPayload,
	type HexaDecryptPayload,
	type KissKHDecryptPayload,
	type KissKHEncryptParams,
	type ParseHtmlPayload,

	// Response types
	type EncDecResponse,
	type StringResult,
	type VidstackTokenResult,
	type MappleSessionResult,
	type ParsedHtmlResult,

	// Provider-specific response types
	type VideasyStream,
	type VidlinkResponse,
	type XPrimeStream,
	type HexaStream,
	type SmashyStreamPlayerResponse,
	type SmashyStreamType2Data,
	type OneTouchTVStream,
	type KissKHVideoResponse,
	type KissKHSubtitle,

	// AnimeKai database types
	type AnimeKaiSearchParams,
	type AnimeKaiFindParams,
	type AnimeKaiEntry,
	type AnimeKaiSearchResponse,
	type AnimeKaiFindResponse,

	// Error types
	type EncDecError
} from './types';
