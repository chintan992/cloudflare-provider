export class EncDecApiError extends Error {
    constructor(
        public provider: string,
        public operation: string,
        public statusCode?: number,
        message?: string
    ) {
        super(message || `API Error (${provider} ${operation})`);
        this.name = 'EncDecApiError';
    }
}
export type EncDecOperation = string;
