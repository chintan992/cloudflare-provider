export type StreamingProviderId = string;
export type MediaType = 'movie' | 'tv' | 'anime';
export type ContentCategory = string;
export type ProviderCapabilities = any;
export type RetryConfig = any;
export type TimeoutConfig = any;
export type ProviderConfig = any;
export type ServerConfig = any;
export type SearchParams = any;
export type StreamResult = any;
export type ProviderResult = any;
export interface IStreamProvider {
    extract(params: SearchParams): Promise<ProviderResult>;
}
