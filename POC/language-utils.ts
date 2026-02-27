import type { ServerConfig } from './types';

export function prioritizeServersByLanguage(
    servers: ServerConfig[],
    preferredLanguages: string[]
): ServerConfig[] {
    if (!preferredLanguages?.length) return servers;

    return [...servers].sort((a, b) => {
        const aIndex = preferredLanguages.indexOf(a.language || '');
        const bIndex = preferredLanguages.indexOf(b.language || '');

        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return 0;
    });
}
