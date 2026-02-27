/**
 * YFlix Video Scraper - Cloudflare Worker
 *
 * Scrapes stream URLs from YFlix using the enc-dec.app external service
 * for all crypto operations.
 *
 * Routes:
 *   GET /movie/{tmdb_id}
 *   GET /tv/{tmdb_id}/{season}/{episode}
 */

// ============================================================================
// Constants
// ============================================================================

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

const ENC_DEC_API = 'https://enc-dec.app/api';
const ENC_DEC_DB = 'https://enc-dec.app';
const YFLIX_AJAX = 'https://yflix.to/ajax';
const YFLIX_REFERER = 'https://yflix.to/';

const ENC_DEC_HEADERS = {
  'User-Agent': USER_AGENT,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const YFLIX_HEADERS = {
  'User-Agent': USER_AGENT,
  Referer: YFLIX_REFERER,
  Accept: 'application/json',
};

// ============================================================================
// Security Helpers
// ============================================================================

function getCorsHeaders(request, env) {
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
  const requestOrigin = request.headers.get('Origin') || '';
  const matchedOrigin = allowedOrigins.find(o => o === requestOrigin);
  const origin = matchedOrigin || (allowedOrigins[0] || '*');
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    'Vary': 'Origin',
  };
}

function checkAuth(request, env) {
  if (!env.API_KEY) return null; // auth not configured, allow all
  if (request.method === 'OPTIONS') return null; // skip for preflight
  const key = request.headers.get('X-Api-Key');
  if (key !== env.API_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Build a JSON response with CORS headers
 */
function jsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

/**
 * Build a standard error response
 */
function errorResponse(type, tmdbId, season, episode, errorMsg, corsHeaders = {}) {
  return jsonResponse({
    provider: 'yflix',
    type,
    tmdb_id: tmdbId,
    season: season ?? null,
    episode: episode ?? null,
    streams: [],
    metadata: null,
    success: false,
    error: errorMsg,
  }, 200, corsHeaders);
}

// ============================================================================
// enc-dec.app API Helpers
// ============================================================================

/**
 * GET https://enc-dec.app/db/flix/find?tmdb_id={tmdbId}&type={type}
 * Returns array of YFlix DB items
 */
async function dbLookup(tmdbId, type) {
  const url = `${ENC_DEC_DB}/db/flix/find?tmdb_id=${encodeURIComponent(tmdbId)}&type=${encodeURIComponent(type)}`;
  const resp = await fetch(url, { method: 'GET', headers: ENC_DEC_HEADERS });
  if (!resp.ok) {
    throw new Error(`DB lookup failed: HTTP ${resp.status}`);
  }
  return resp.json();
}

/**
 * GET https://enc-dec.app/api/enc-movies-flix?text={text}
 * Returns { result: "encryptedString" }
 */
async function encryptText(text) {
  const url = `${ENC_DEC_API}/enc-movies-flix?text=${encodeURIComponent(text)}`;
  const resp = await fetch(url, { method: 'GET', headers: ENC_DEC_HEADERS });
  if (!resp.ok) {
    throw new Error(`Encryption failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.result;
}

/**
 * POST https://enc-dec.app/api/parse-html
 * Body: { "text": "htmlString" }
 * Returns { "result": { "default": { "1": { "lid": "..." } } } }
 */
async function parseHtml(htmlString) {
  const resp = await fetch(`${ENC_DEC_API}/parse-html`, {
    method: 'POST',
    headers: ENC_DEC_HEADERS,
    body: JSON.stringify({ text: htmlString }),
  });
  if (!resp.ok) {
    throw new Error(`HTML parsing failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.result;
}

/**
 * POST https://enc-dec.app/api/dec-movies-flix
 * Body: { "text": "encryptedString" }
 * Returns { "result": "streamUrlOrObject" }
 */
async function decryptMoviesFlix(encryptedText) {
  const resp = await fetch(`${ENC_DEC_API}/dec-movies-flix`, {
    method: 'POST',
    headers: ENC_DEC_HEADERS,
    body: JSON.stringify({ text: encryptedText }),
  });
  if (!resp.ok) {
    throw new Error(`Decryption failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.result;
}

/**
 * POST https://enc-dec.app/api/dec-rapid
 * Body: { "text": "encryptedString", "agent": "UserAgentString" }
 * Returns { "result": { "stream": "...", "sources": [...], "tracks": [...] } }
 */
async function decryptRapid(encryptedText) {
  const resp = await fetch(`${ENC_DEC_API}/dec-rapid`, {
    method: 'POST',
    headers: ENC_DEC_HEADERS,
    body: JSON.stringify({ text: encryptedText, agent: USER_AGENT }),
  });
  if (!resp.ok) {
    throw new Error(`Rapid decryption failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.result;
}

/**
 * POST https://enc-dec.app/api/dec-mega
 * Body: { "text": "encryptedString", "agent": "UserAgentString" }
 * Returns { "result": { "stream": "...", "sources": [...], "tracks": [...] } }
 */
async function decryptMega(encryptedText) {
  const resp = await fetch(`${ENC_DEC_API}/dec-mega`, {
    method: 'POST',
    headers: ENC_DEC_HEADERS,
    body: JSON.stringify({ text: encryptedText, agent: USER_AGENT }),
  });
  if (!resp.ok) {
    throw new Error(`Mega decryption failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.result;
}

// ============================================================================
// YFlix API Helpers
// ============================================================================

/**
 * GET https://yflix.to/ajax/links/list?eid={episodeId}&_={encryptedEpisodeId}
 * Returns HTML string (inside a JSON result field)
 */
async function getServersList(episodeId, encryptedEpisodeId) {
  const url = `${YFLIX_AJAX}/links/list?eid=${encodeURIComponent(episodeId)}&_=${encodeURIComponent(encryptedEpisodeId)}`;
  const resp = await fetch(url, { method: 'GET', headers: YFLIX_HEADERS });
  if (!resp.ok) {
    throw new Error(`Servers list fetch failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.result;
}

/**
 * GET https://yflix.to/ajax/links/view?id={lid}&_={encryptedLid}
 * Returns encrypted string (inside a JSON result field)
 */
async function getEmbedLink(lid, encryptedLid) {
  const url = `${YFLIX_AJAX}/links/view?id=${encodeURIComponent(lid)}&_=${encodeURIComponent(encryptedLid)}`;
  const resp = await fetch(url, { method: 'GET', headers: YFLIX_HEADERS });
  if (!resp.ok) {
    throw new Error(`Embed link fetch failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.result;
}

// ============================================================================
// Hoster Resolution
// ============================================================================

/**
 * Check if a URL is a rapidairmax.site embed URL
 */
function isRapidairmaxEmbed(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'rapidairmax.site' && parsed.pathname.startsWith('/e/');
  } catch {
    return false;
  }
}

/**
 * Check if a URL is a megaup embed URL
 * Matches megaup.site, megaup.live, megaup*.online, megaup*.live, megaup*.site
 */
function isMegaupEmbed(url) {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '');
    const isMegaup =
      domain === 'megaup.site' ||
      domain === 'megaup.live' ||
      /^megaup\d*\.(online|live|site)$/.test(domain);
    return isMegaup && parsed.pathname.startsWith('/e/');
  } catch {
    return false;
  }
}

/**
 * Check if a URL is an embed URL that needs hoster resolution
 */
function isEmbedUrl(url) {
  return isRapidairmaxEmbed(url) || isMegaupEmbed(url);
}

/**
 * Convert an embed URL (/e/{id}) to a media URL (/media/{id})
 */
function toMediaUrl(embedUrl) {
  return embedUrl.replace('/e/', '/media/');
}

/**
 * Resolve a hoster embed URL to a stream URL
 * Returns the stream URL string or null if resolution fails
 */
async function resolveEmbedUrl(embedUrl) {
  const mediaUrl = toMediaUrl(embedUrl);

  // Fetch encrypted media data from the hoster
  const mediaResp = await fetch(mediaUrl, {
    method: 'GET',
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!mediaResp.ok) {
    throw new Error(`Hoster media fetch failed: HTTP ${mediaResp.status}`);
  }
  const mediaData = await mediaResp.json();

  if (!mediaData.result) {
    throw new Error('No result in hoster media response');
  }

  // Decrypt using the appropriate endpoint
  let decrypted;
  if (isRapidairmaxEmbed(embedUrl)) {
    decrypted = await decryptRapid(mediaData.result);
  } else {
    decrypted = await decryptMega(mediaData.result);
  }

  if (!decrypted) {
    throw new Error('Hoster decryption returned empty result');
  }

  // Extract stream URL from decrypted result
  const streamUrl = decrypted.stream || (decrypted.sources && decrypted.sources[0]?.file);
  return streamUrl || null;
}

// ============================================================================
// Core Extraction Logic
// ============================================================================

/**
 * Extract stream URL using a known episode ID.
 * This is the optimized path that skips the episodes list fetch.
 *
 * Steps:
 *   1. Encrypt episode ID
 *   2. Get servers list HTML
 *   3. Parse HTML to get lid
 *   4. Encrypt lid
 *   5. Get embed link (encrypted)
 *   6. Decrypt embed link
 *   7. Handle result (direct URL or hoster embed)
 */
async function extractWithEpisodeId(episodeId) {
  // Step 1: Encrypt episode ID
  const encEid = await encryptText(episodeId);

  // Step 2: Get servers list
  const serversHtml = await getServersList(episodeId, encEid);

  // Step 3: Parse HTML to get server lid
  const servers = await parseHtml(serversHtml);

  // Extract lid from result.default["1"].lid
  const lid = servers?.default?.['1']?.lid;
  if (!lid) {
    throw new Error('No server ID (lid) found in parsed HTML');
  }

  // Step 4: Encrypt lid
  const encLid = await encryptText(lid);

  // Step 5: Get embed link (encrypted string)
  const encryptedEmbed = await getEmbedLink(lid, encLid);

  // Step 6: Decrypt embed link
  const decrypted = await decryptMoviesFlix(encryptedEmbed);

  // Step 7: Extract stream URL from decrypted result
  let streamUrl;
  if (typeof decrypted === 'string') {
    streamUrl = decrypted;
  } else if (decrypted && typeof decrypted === 'object') {
    streamUrl = decrypted.url || decrypted.stream || decrypted.file;
  }

  if (!streamUrl) {
    throw new Error('No stream URL in decrypted response');
  }

  // Step 8: Handle hoster embed URLs
  if (isEmbedUrl(streamUrl)) {
    const resolvedUrl = await resolveEmbedUrl(streamUrl);
    if (!resolvedUrl) {
      throw new Error('Failed to resolve hoster embed URL');
    }
    return resolvedUrl;
  }

  return streamUrl;
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle a movie request: GET /movie/{tmdb_id}
 */
async function handleMovie(tmdbId) {
  // Step 1: DB lookup
  const dbResults = await dbLookup(tmdbId, 'movie');

  if (!dbResults || dbResults.length === 0) {
    throw new Error('Content not found in database');
  }

  const dbItem = dbResults[0];
  const info = dbItem.info;
  const episodeId = dbItem.episodes?.['1']?.['1']?.eid;

  if (!episodeId) {
    throw new Error('Episode ID not found in database for movie');
  }

  // Step 2: Extract stream
  const streamUrl = await extractWithEpisodeId(episodeId);

  return {
    provider: 'yflix',
    type: 'movie',
    tmdb_id: parseInt(tmdbId, 10),
    season: null,
    episode: null,
    streams: [
      {
        url: streamUrl,
        quality: 'Auto',
        title: 'YFlix Stream',
        stream_type: 'hls',
        referer: YFLIX_REFERER,
        subtitles: [],
      },
    ],
    metadata: {
      title: info.title_en,
      year: info.year,
      flix_id: info.flix_id,
      episode_id: episodeId,
    },
    success: true,
    error: null,
  };
}

/**
 * Handle a TV show request: GET /tv/{tmdb_id}/{season}/{episode}
 */
async function handleTv(tmdbId, season, episode) {
  // Step 1: DB lookup
  const dbResults = await dbLookup(tmdbId, 'tv');

  if (!dbResults || dbResults.length === 0) {
    throw new Error('Content not found in database');
  }

  const dbItem = dbResults[0];
  const info = dbItem.info;
  const episodeId = dbItem.episodes?.[season]?.[episode]?.eid;

  if (!episodeId) {
    throw new Error(
      `Episode S${season}E${episode} not found in database`
    );
  }

  // Step 2: Extract stream
  const streamUrl = await extractWithEpisodeId(episodeId);

  return {
    provider: 'yflix',
    type: 'tv',
    tmdb_id: parseInt(tmdbId, 10),
    season: parseInt(season, 10),
    episode: parseInt(episode, 10),
    streams: [
      {
        url: streamUrl,
        quality: 'Auto',
        title: 'YFlix Stream',
        stream_type: 'hls',
        referer: YFLIX_REFERER,
        subtitles: [],
      },
    ],
    metadata: {
      title: info.title_en,
      year: info.year,
      flix_id: info.flix_id,
      episode_id: episodeId,
    },
    success: true,
    error: null,
  };
}

// ============================================================================
// Cloudflare Worker Entry Point
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    // Auth check first (skip for OPTIONS)
    if (request.method !== 'OPTIONS') {
      const authError = checkAuth(request, env);
      if (authError) return authError;
    }

    const corsHeaders = getCorsHeaders(request, env);
    const url = new URL(request.url);
    const { pathname } = url;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    // Route: GET /movie/{tmdb_id}
    const movieMatch = pathname.match(/^\/movie\/(\d+)$/);
    if (movieMatch) {
      const tmdbId = movieMatch[1];
      try {
        const result = await handleMovie(tmdbId);
        return jsonResponse(result, 200, corsHeaders);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return errorResponse('movie', parseInt(tmdbId, 10), null, null, errorMsg, corsHeaders);
      }
    }

    // Route: GET /tv/{tmdb_id}/{season}/{episode}
    const tvMatch = pathname.match(/^\/tv\/(\d+)\/(\d+)\/(\d+)$/);
    if (tvMatch) {
      const tmdbId = tvMatch[1];
      const season = tvMatch[2];
      const episode = tvMatch[3];
      try {
        const result = await handleTv(tmdbId, season, episode);
        return jsonResponse(result, 200, corsHeaders);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return errorResponse(
          'tv',
          parseInt(tmdbId, 10),
          parseInt(season, 10),
          parseInt(episode, 10),
          errorMsg,
          corsHeaders
        );
      }
    }

    // 404 for unmatched routes
    return jsonResponse(
      {
        error: 'Not found',
        message: 'Valid routes: GET /movie/{tmdb_id} or GET /tv/{tmdb_id}/{season}/{episode}',
      },
      404,
      corsHeaders
    );
  },
};
