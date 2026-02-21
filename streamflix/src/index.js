/**
 * StreamFlix Cloudflare Worker
 *
 * Routes:
 *   GET /                           → API info + URL patterns
 *   GET /movie/{tmdbId}             → Movie video links
 *   GET /tv/{tmdbId}/{season}/{ep}  → TV episode video links
 */

const API_BASE = "https://api.streamflix.app";
const FIREBASE_REST =
  "https://chilflix-410be-default-rtdb.asia-southeast1.firebasedatabase.app";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// ─── Data Fetchers ────────────────────────────────────────────────────────────

async function fetchConfig() {
  const resp = await fetch(
    `${API_BASE}/config/config-streamflixapp.json`,
    { headers: FETCH_HEADERS }
  );
  if (!resp.ok) throw new Error(`Config fetch failed: ${resp.status}`);
  return resp.json();
}

async function fetchCatalog() {
  const resp = await fetch(`${API_BASE}/data.json`, {
    headers: FETCH_HEADERS,
  });
  if (!resp.ok) throw new Error(`Catalog fetch failed: ${resp.status}`);
  const data = await resp.json();
  return data.data || [];
}

function findByTmdb(items, tmdbId) {
  const id = String(tmdbId);
  return items.find((item) => String(item.tmdb || "") === id) || null;
}

async function fetchEpisodes(movieKey, season) {
  const url = `${FIREBASE_REST}/Data/${movieKey}/seasons/${season}/episodes.json`;
  const resp = await fetch(url, { headers: FETCH_HEADERS });
  if (!resp.ok) return null;
  return resp.json();
}

// ─── Link Builders ────────────────────────────────────────────────────────────

function buildMovieLinks(config, movieLink) {
  const links = [];
  for (const base of config.premium || []) {
    links.push({ url: base + movieLink, quality: "720p", tier: "Premium" });
  }
  for (const base of config.movies || []) {
    links.push({ url: base + movieLink, quality: "480p", tier: "Movies" });
  }
  for (const base of config.download || []) {
    links.push({ url: base + movieLink, quality: "1080p", tier: "Standard" });
  }
  return links;
}

function buildTvLinks(config, episodeLink) {
  const links = [];
  for (const base of config.premium || []) {
    links.push({ url: base + episodeLink, quality: "720p", tier: "Premium" });
  }
  for (const base of config.tv || []) {
    links.push({ url: base + episodeLink, quality: "480p", tier: "TV" });
  }
  for (const base of config.download || []) {
    links.push({ url: base + episodeLink, quality: "1080p", tier: "Standard" });
  }
  return links;
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

async function handleRoot(request) {
  const host = new URL(request.url).origin;
  return jsonResponse({
    service: "StreamFlix Video Links API",
    version: "1.0.0",
    movieUrlPattern: `${host}/movie/{tmdbId}`,
    tvUrlPattern: `${host}/tv/{tmdbId}/{season}/{episode}`,
    examples: {
      movie: `${host}/movie/550`,
      tv: `${host}/tv/1396/1/1`,
    },
  });
}

async function handleMovie(tmdbId) {
  const [config, catalog] = await Promise.all([
    fetchConfig(),
    fetchCatalog(),
  ]);

  const item = findByTmdb(catalog, tmdbId);
  if (!item) {
    return errorResponse(`No content found with TMDB ID: ${tmdbId}`, 404);
  }

  if (item.isTV) {
    return errorResponse(
      `TMDB ID ${tmdbId} is a TV show, not a movie. Use /tv/${tmdbId}/{season}/{episode}`,
      400
    );
  }

  const movieLink = item.movielink || "";
  if (!movieLink) {
    return errorResponse("No movie link available in catalog data", 404);
  }

  const links = buildMovieLinks(config, movieLink);

  return jsonResponse({
    type: "movie",
    tmdbId: String(tmdbId),
    title: item.moviename || "Unknown",
    year: item.movieyear || null,
    rating: item.movierating || 0,
    duration: item.movieduration || null,
    description: item.moviedesc || null,
    poster: item.movieposter ? `${TMDB_IMG}/${item.movieposter}` : null,
    relativePath: movieLink,
    links,
  });
}

async function handleTv(tmdbId, season, episode) {
  const [config, catalog] = await Promise.all([
    fetchConfig(),
    fetchCatalog(),
  ]);

  const item = findByTmdb(catalog, tmdbId);
  if (!item) {
    return errorResponse(`No content found with TMDB ID: ${tmdbId}`, 404);
  }

  if (!item.isTV) {
    return errorResponse(
      `TMDB ID ${tmdbId} is a movie, not a TV show. Use /movie/${tmdbId}`,
      400
    );
  }

  const movieKey = item.moviekey || "";
  if (!movieKey) {
    return errorResponse("No movie key available for this TV show", 404);
  }

  // Fetch episodes for the requested season via Firebase REST API
  const episodesRaw = await fetchEpisodes(movieKey, season);
  if (!episodesRaw) {
    return errorResponse(
      `No episodes found for season ${season} of "${item.moviename}"`,
      404
    );
  }

  // Episode index is 0-based in Firebase, user passes 1-based
  const epIndex = String(episode - 1);
  const ep = episodesRaw[epIndex];
  if (!ep) {
    return errorResponse(
      `Episode ${episode} not found in season ${season} of "${item.moviename}"`,
      404
    );
  }

  const episodeLink = ep.link || "";
  if (!episodeLink) {
    return errorResponse(
      `No video link available for S${season}E${episode}`,
      404
    );
  }

  const links = buildTvLinks(config, episodeLink);

  return jsonResponse({
    type: "tv",
    tmdbId: String(tmdbId),
    title: item.moviename || "Unknown",
    year: item.movieyear || null,
    rating: item.movierating || 0,
    poster: item.movieposter ? `${TMDB_IMG}/${item.movieposter}` : null,
    season: season,
    episode: episode,
    episodeName: ep.name || `Episode ${episode}`,
    episodeOverview: ep.overview || null,
    episodeRating: ep.vote_average || 0,
    episodeRuntime: ep.runtime || 0,
    stillPath: ep.still_path
      ? `${TMDB_IMG}${ep.still_path}`
      : null,
    relativePath: episodeLink,
    links,
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    try {
      // GET /
      if (path === "/" || path === "") {
        return handleRoot(request);
      }

      // GET /movie/{tmdbId}
      const movieMatch = path.match(/^\/movie\/(\d+)\/?$/);
      if (movieMatch) {
        return handleMovie(movieMatch[1]);
      }

      // GET /tv/{tmdbId}/{season}/{episode}
      const tvMatch = path.match(/^\/tv\/(\d+)\/(\d+)\/(\d+)\/?$/);
      if (tvMatch) {
        return handleTv(
          tvMatch[1],
          parseInt(tvMatch[2], 10),
          parseInt(tvMatch[3], 10)
        );
      }

      return errorResponse("Not found. Use /movie/{tmdbId} or /tv/{tmdbId}/{season}/{episode}", 404);
    } catch (err) {
      return errorResponse(`Internal error: ${err.message}`, 500);
    }
  },
};
