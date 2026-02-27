const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function errorResponse(type, tmdbId, season, episode, message) {
  return jsonResponse({
    provider: "vidlink",
    type,
    tmdb_id: tmdbId,
    season: season ?? null,
    episode: episode ?? null,
    streams: [],
    success: false,
    error: message,
  });
}

function mapLanguageCode(label) {
  if (!label) return "en";
  const lower = label.toLowerCase();
  const langMap = {
    english: "en",
    spanish: "es",
    french: "fr",
    german: "de",
    italian: "it",
    portuguese: "pt",
    russian: "ru",
    japanese: "ja",
    korean: "ko",
    chinese: "zh",
    arabic: "ar",
    hindi: "hi",
    dutch: "nl",
    swedish: "sv",
    norwegian: "no",
    danish: "da",
    finnish: "fi",
    polish: "pl",
    turkish: "tr",
    greek: "el",
    hebrew: "he",
    thai: "th",
    vietnamese: "vi",
    indonesian: "id",
    malay: "ms",
    czech: "cs",
    slovak: "sk",
    hungarian: "hu",
    romanian: "ro",
    bulgarian: "bg",
    croatian: "hr",
    serbian: "sr",
    ukrainian: "uk",
  };
  return langMap[lower] || label.toLowerCase().slice(0, 2);
}

function parseSubtitles(subtitles) {
  if (!Array.isArray(subtitles)) return [];
  return subtitles.map((sub) => ({
    url: sub.file || sub.url || "",
    label: sub.label || "",
    language:
      sub.kind === "captions" ? mapLanguageCode(sub.label) : sub.label || "",
    kind: sub.kind || "subtitles",
  }));
}

async function encryptTmdbId(tmdbId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://enc-dec.app/api/enc-vidlink?text=${tmdbId}`,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: controller.signal,
      }
    );
    if (!res.ok) throw new Error(`Encryption API returned ${res.status}`);
    const data = await res.json();
    if (!data.result) throw new Error("No result in encryption response");
    return data.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchStreamData(encryptedId, type, season, episode) {
  let url;
  if (type === "movie") {
    url = `https://vidlink.pro/api/b/movie/${encryptedId}`;
  } else {
    url = `https://vidlink.pro/api/b/tv/${encryptedId}/${season}/${episode}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        Referer: "https://vidlink.pro/",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Vidlink API returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function handleMovie(tmdbId) {
  const type = "movie";
  try {
    const encryptedId = await encryptTmdbId(tmdbId);
    const data = await fetchStreamData(encryptedId, type, null, null);

    if (!data.status || !data.stream || !data.stream.playlist) {
      return errorResponse(type, tmdbId, null, null, "No stream available");
    }

    const subtitles = parseSubtitles(data.stream.subtitles);

    return jsonResponse({
      provider: "vidlink",
      type,
      tmdb_id: tmdbId,
      season: null,
      episode: null,
      streams: [
        {
          url: data.stream.playlist,
          quality: "Auto",
          title: "Vidlink Stream",
          stream_type: "hls",
          referer: "https://vidlink.pro/",
          language: "en",
          subtitles,
        },
      ],
      success: true,
      error: null,
    });
  } catch (err) {
    return errorResponse(type, tmdbId, null, null, err.message || "Failed to fetch stream");
  }
}

async function handleTv(tmdbId, season, episode) {
  const type = "tv";
  try {
    const encryptedId = await encryptTmdbId(tmdbId);
    const data = await fetchStreamData(encryptedId, type, season, episode);

    if (!data.status || !data.stream || !data.stream.playlist) {
      return errorResponse(type, tmdbId, season, episode, "No stream available");
    }

    const subtitles = parseSubtitles(data.stream.subtitles);

    return jsonResponse({
      provider: "vidlink",
      type,
      tmdb_id: tmdbId,
      season,
      episode,
      streams: [
        {
          url: data.stream.playlist,
          quality: "Auto",
          title: "Vidlink Stream",
          stream_type: "hls",
          referer: "https://vidlink.pro/",
          language: "en",
          subtitles,
        },
      ],
      success: true,
      error: null,
    });
  } catch (err) {
    return errorResponse(type, tmdbId, season, episode, err.message || "Failed to fetch stream");
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Movie: /movie/{tmdb_id}
    const movieMatch = pathname.match(/^\/movie\/(\d+)$/);
    if (movieMatch) {
      const tmdbId = parseInt(movieMatch[1], 10);
      return handleMovie(tmdbId);
    }

    // TV: /tv/{tmdb_id}/{season}/{episode}
    const tvMatch = pathname.match(/^\/tv\/(\d+)\/(\d+)\/(\d+)$/);
    if (tvMatch) {
      const tmdbId = parseInt(tvMatch[1], 10);
      const season = parseInt(tvMatch[2], 10);
      const episode = parseInt(tvMatch[3], 10);
      return handleTv(tmdbId, season, episode);
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
};
