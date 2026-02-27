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

function errorResponse(type, tmdbId, season, episode, message, corsHeaders = {}) {
  return jsonResponse({
    provider: "hexa",
    type,
    tmdb_id: tmdbId,
    season: season ?? null,
    episode: episode ?? null,
    streams: [],
    success: false,
    error: message,
  }, 200, corsHeaders);
}

function generateRandomHexKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extractStreamUrl(result) {
  if (typeof result === "string") {
    return result;
  }
  if (result.stream) return result.stream;
  if (result.file) return result.file;
  if (result.url) return result.url;
  if (result.sources && result.sources.length > 0) {
    const src = result.sources[0];
    if (src.url) return src.url;
    if (src.file) return src.file;
  }
  return null;
}

async function fetchHexaStream(type, tmdbId, season, episode) {
  const randomKey = generateRandomHexKey();

  let hexaUrl;
  if (type === "movie") {
    hexaUrl = `https://themoviedb.hexa.su/api/tmdb/movie/${tmdbId}/images`;
  } else {
    hexaUrl = `https://themoviedb.hexa.su/api/tmdb/tv/${tmdbId}/season/${season}/episode/${episode}/images`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let encryptedText;
  try {
    const hexaRes = await fetch(hexaUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "X-Api-Key": randomKey,
        Accept: "plain/text",
      },
    });

    if (!hexaRes.ok) {
      throw new Error(`Hexa API returned status ${hexaRes.status}`);
    }

    encryptedText = await hexaRes.text();
  } finally {
    clearTimeout(timeoutId);
  }

  if (!encryptedText || encryptedText.trim() === "") {
    throw new Error("Hexa API returned empty response");
  }

  const decRes = await fetch("https://enc-dec.app/api/dec-hexa", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ text: encryptedText.trim(), key: randomKey }),
  });

  if (!decRes.ok) {
    throw new Error(`Decryption API returned status ${decRes.status}`);
  }

  const decData = await decRes.json();

  if (!decData || decData.result === undefined) {
    throw new Error("Decryption API returned unexpected response");
  }

  const streamUrl = extractStreamUrl(decData.result);

  if (!streamUrl) {
    throw new Error("Could not extract stream URL from decrypted result");
  }

  return streamUrl;
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
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
    }

    // Match /movie/{tmdb_id}
    const movieMatch = pathname.match(/^\/movie\/(\d+)\/?$/);
    if (movieMatch) {
      const tmdbId = parseInt(movieMatch[1], 10);
      try {
        const streamUrl = await fetchHexaStream("movie", tmdbId, null, null);
        return jsonResponse({
          provider: "hexa",
          type: "movie",
          tmdb_id: tmdbId,
          season: null,
          episode: null,
          streams: [
            {
              url: streamUrl,
              quality: "Auto",
              title: "Hexa Stream",
              stream_type: "hls",
              referer: "",
              language: "en",
            },
          ],
          success: true,
          error: null,
        }, 200, corsHeaders);
      } catch (err) {
        return errorResponse("movie", tmdbId, null, null, err.message || "Failed to fetch stream", corsHeaders);
      }
    }

    // Match /tv/{tmdb_id}/{season}/{episode}
    const tvMatch = pathname.match(/^\/tv\/(\d+)\/(\d+)\/(\d+)\/?$/);
    if (tvMatch) {
      const tmdbId = parseInt(tvMatch[1], 10);
      const season = parseInt(tvMatch[2], 10);
      const episode = parseInt(tvMatch[3], 10);
      try {
        const streamUrl = await fetchHexaStream("tv", tmdbId, season, episode);
        return jsonResponse({
          provider: "hexa",
          type: "tv",
          tmdb_id: tmdbId,
          season,
          episode,
          streams: [
            {
              url: streamUrl,
              quality: "Auto",
              title: "Hexa Stream",
              stream_type: "hls",
              referer: "",
              language: "en",
            },
          ],
          success: true,
          error: null,
        }, 200, corsHeaders);
      } catch (err) {
        return errorResponse("tv", tmdbId, season, episode, err.message || "Failed to fetch stream", corsHeaders);
      }
    }

    return jsonResponse({ error: "Not found" }, 404, corsHeaders);
  },
};
