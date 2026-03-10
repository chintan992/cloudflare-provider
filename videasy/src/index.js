const SERVERS = [
  { id: "1movies",          name: "Sage",      language: "en",     movieOnly: false },
  { id: "moviebox",         name: "Cypher",    language: "en",     movieOnly: false },
  { id: "myflixerzupcloud", name: "Neon",      language: "en",     movieOnly: false },
  { id: "cdn",              name: "Yoru",      language: "en",     movieOnly: true  },
  { id: "primewire",        name: "Reyna",     language: "en",     movieOnly: false },
  { id: "onionplay",        name: "Omen",      language: "en",     movieOnly: false },
  { id: "m4uhd",            name: "Breach",    language: "en",     movieOnly: false },
  { id: "hdmovie",          name: "Vyse",      language: "en",     movieOnly: false },
  { id: "meine",            name: "Killjoy",   language: "de",     movieOnly: false },
  { id: "meine-it",         name: "Harbor",    language: "it",     movieOnly: false },
  { id: "meine-fr",         name: "Chamber",   language: "fr",     movieOnly: true  },
  { id: "hdmovie-hi",       name: "Fade",      language: "hi",     movieOnly: false },
  { id: "cuevana-latino",   name: "Gekko",     language: "es-419", movieOnly: false },
  { id: "cuevana-spanish",  name: "Kayo",      language: "es",     movieOnly: false },
  { id: "superflix",        name: "Raze",      language: "pt-BR",  movieOnly: false },
  { id: "overflix",         name: "Phoenix",   language: "pt-BR",  movieOnly: false },
  { id: "visioncine",       name: "Astra",     language: "pt-BR",  movieOnly: false },
];

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Connection": "keep-alive",
};

function getCorsHeaders(request, env) {
  const allowedOrigins = (env.ALLOWED_ORIGINS || "").split(",").map(o => o.trim()).filter(Boolean);
  const requestOrigin = request.headers.get("Origin") || "";
  const matchedOrigin = allowedOrigins.find(o => o === requestOrigin);
  const origin = matchedOrigin || (allowedOrigins[0] || "*");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
    "Vary": "Origin",
  };
}

function checkAuth(request, env) {
  if (!env.API_KEY) return null; // auth not configured, allow all
  if (request.method === "OPTIONS") return null; // skip for preflight
  const key = request.headers.get("X-Api-Key");
  if (key !== env.API_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

function jsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function buildVideasyUrl(serverId, { title, mediaType, year, tmdbId, season, episode }) {
  const encodedTitle = encodeURIComponent(title);
  let url = `https://api.videasy.net/${serverId}/sources-with-title?title=${encodedTitle}&mediaType=${mediaType}&year=${year}&tmdbId=${tmdbId}`;
  if (mediaType === "tv") {
    url += `&seasonId=${season}&episodeId=${episode}`;
  }
  return url;
}

async function fetchServerStream(server, params, tmdbId) {
  const url = buildVideasyUrl(server.id, params);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  let encryptedText;
  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${server.id}`);
    }
    encryptedText = await response.text();
  } finally {
    clearTimeout(timeoutId);
  }

  if (!encryptedText || encryptedText.trim() === "") {
    throw new Error(`Empty response from ${server.id}`);
  }

  // Decrypt the response
  const decryptController = new AbortController();
  const decryptTimeoutId = setTimeout(() => decryptController.abort(), 20000);

  let decrypted;
  try {
    const decryptResponse = await fetch("https://enc-dec.app/api/dec-videasy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        text: encryptedText.trim(),
        id: String(tmdbId),
      }),
      signal: decryptController.signal,
    });
    if (!decryptResponse.ok) {
      throw new Error(`Decrypt HTTP ${decryptResponse.status} for ${server.id}`);
    }
    decrypted = await decryptResponse.json();
  } finally {
    clearTimeout(decryptTimeoutId);
  }

  const result = decrypted?.result;
  if (!result) {
    throw new Error(`No result in decrypt response for ${server.id}`);
  }

  // Extract stream URL
  let streamUrl = null;
  if (typeof result === "string") {
    streamUrl = result;
  } else {
    streamUrl =
      result.stream ||
      result.file ||
      result.url ||
      (result.sources && result.sources[0] && (result.sources[0].url || result.sources[0].file)) ||
      null;
  }

  if (!streamUrl) {
    throw new Error(`No stream URL found in decrypt result for ${server.id}`);
  }

  return {
    url: streamUrl,
    quality: "Auto",
    title: `Videasy - ${server.name}`,
    stream_type: "hls",
    referer: "https://videasy.net/",
    server: server.name,
    language: server.language,
  };
}

async function tryServersParallel(servers, params, tmdbId) {
  const results = await Promise.allSettled(
    servers.map((server) => fetchServerStream(server, params, tmdbId))
  );

  const streams = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      streams.push(result.value);
    }
  }
  return streams;
}

async function tryServerSequential(server, params, tmdbId) {
  try {
    const stream = await fetchServerStream(server, params, tmdbId);
    return stream;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    // Auth check first (skip for OPTIONS)
    if (request.method !== "OPTIONS") {
      const authError = checkAuth(request, env);
      if (authError) return authError;
    }

    const corsHeaders = getCorsHeaders(request, env);
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Parse route
    let mediaType = null;
    let tmdbId = null;
    let season = null;
    let episode = null;

    const movieMatch = pathname.match(/^\/movie\/([^/]+)$/);
    const tvMatch = pathname.match(/^\/tv\/([^/]+)\/(\d+)\/(\d+)$/);

    if (movieMatch) {
      mediaType = "movie";
      tmdbId = movieMatch[1];
    } else if (tvMatch) {
      mediaType = "tv";
      tmdbId = tvMatch[1];
      season = tvMatch[2];
      episode = tvMatch[3];
    } else {
      return jsonResponse(
        {
          provider: "videasy",
          type: null,
          tmdb_id: null,
          season: null,
          episode: null,
          streams: [],
          success: false,
          error: "Invalid route. Use /movie/{tmdb_id} or /tv/{tmdb_id}/{season}/{episode}",
        },
        404,
        corsHeaders
      );
    }

    const title = url.searchParams.get("title");
    const year = url.searchParams.get("year");

    const baseResponse = {
      provider: "videasy",
      type: mediaType,
      tmdb_id: isNaN(Number(tmdbId)) ? tmdbId : Number(tmdbId),
      season: season ? Number(season) : null,
      episode: episode ? Number(episode) : null,
    };

    if (!title || !year) {
      return jsonResponse({
        ...baseResponse,
        streams: [],
        success: false,
        error: "Missing required query parameters: title and year",
      }, 200, corsHeaders);
    }

    const params = {
      title,
      mediaType,
      year,
      tmdbId,
      season,
      episode,
    };

    // Filter servers for TV shows
    const eligibleServers = mediaType === "tv"
      ? SERVERS.filter((s) => !s.movieOnly)
      : SERVERS;

    try {
      // Try first 4 servers in parallel
      const firstBatch = eligibleServers.slice(0, 4);
      let streams = await tryServersParallel(firstBatch, params, tmdbId);

      // If no streams, try servers 5-7 sequentially
      if (streams.length === 0) {
        const fallbackBatch = eligibleServers.slice(4, 7);
        for (const server of fallbackBatch) {
          const stream = await tryServerSequential(server, params, tmdbId);
          if (stream) {
            streams.push(stream);
          }
        }
      }

      if (streams.length === 0) {
        return jsonResponse({
          ...baseResponse,
          streams: [],
          success: false,
          error: "No streams found from any server",
        }, 200, corsHeaders);
      }

      return jsonResponse({
        ...baseResponse,
        streams,
        success: true,
        error: null,
      }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({
        ...baseResponse,
        streams: [],
        success: false,
        error: err.message || "Unexpected error",
      }, 200, corsHeaders);
    }
  },
};
