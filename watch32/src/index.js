/**
 * Watch32 Cloudflare Worker
 *
 * Routes:
 *   GET /                                → API info + URL patterns
 *   GET /movie/{tmdbId}                  → Movie video links
 *   GET /tv/{tmdbId}/{season}/{episode}  → TV episode video links
 *
 * Ported from watch32_test.py
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const WATCH32_BASE = "https://watch32.sx";
const VIDEOSTR_BASE = "https://videostr.net";
const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

const MEGACLOUD_KEYS_URL =
  "https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json";
const DECRYPT_SERVICE_URL =
  "https://script.google.com/macros/s/AKfycbxHbYHbrGMXYD2-bC-C43D3njIbU-wGiYQuJL61H4vyy6YVXkybMNNEPJNPPuZrD1gRVA/exec";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const AJAX_HEADERS = {
  ...HEADERS,
  "X-Requested-With": "XMLHttpRequest",
  Accept: "*/*",
};

// ─── Security Helpers ─────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function errorResponse(message, status = 400, corsHeaders = {}) {
  return jsonResponse({ error: message }, status, corsHeaders);
}

// ─── TMDB Helpers ─────────────────────────────────────────────────────────────

async function tmdbGetMovie(tmdbId, TMDB_API_KEY) {
  const resp = await fetch(
    `${TMDB_API_BASE}/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`,
    { headers: HEADERS }
  );
  if (!resp.ok) throw new Error(`TMDB movie fetch failed: ${resp.status}`);
  return resp.json();
}

async function tmdbGetTv(tmdbId, TMDB_API_KEY) {
  const resp = await fetch(
    `${TMDB_API_BASE}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`,
    { headers: HEADERS }
  );
  if (!resp.ok) throw new Error(`TMDB TV fetch failed: ${resp.status}`);
  return resp.json();
}

// ─── Watch32 Scraper ──────────────────────────────────────────────────────────

async function w32Search(query) {
  const resp = await fetch(`${WATCH32_BASE}/ajax/search`, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: `keyword=${encodeURIComponent(query)}`,
  });
  if (!resp.ok) throw new Error(`Watch32 search failed: ${resp.status}`);
  const html = await resp.text();

  // Parse search results — flexible regex that handles any attribute order
  const results = [];

  // Match all <a...>...</a> blocks that contain an href
  const anchorRegex = /<a\s([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const attrs = match[1];
    const inner = match[2];

    // Extract href from attributes (any position)
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1];

    // Must be a nav-item link (class can contain multiple values)
    if (!attrs.match(/class=["'][^"']*nav-item[^"']*["']/i)) continue;

    // Extract title from <h3> inside
    const h3Match = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const title = h3Match ? h3Match[1].replace(/<[^>]*>/g, "").trim() : "";

    // Extract poster from <img>
    const imgMatch = inner.match(/<img[^>]+src=["']([^"']*)["']/i);
    const poster = imgMatch ? imgMatch[1] : "";

    const url = WATCH32_BASE + "/" + href.replace(/^\/+/, "");
    if (title && url) {
      results.push({ title, url, poster });
    }
  }

  return { results, rawLength: html.length };
}

async function w32LoadDetail(url) {
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`Detail page fetch failed: ${resp.status}`);
  const html = await resp.text();

  // Title
  const headingMatch = html.match(
    /<[^>]*class="[^"]*heading-name[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i
  );
  const title = headingMatch
    ? headingMatch[1].replace(/<[^>]*>/g, "").trim()
    : "";

  // Poster
  const posterMatch = html.match(
    /<img[^>]*class="[^"]*film-poster-img[^"]*"[^>]*src="([^"]*)"/i
  );
  const poster = posterMatch ? posterMatch[1] : "";

  // Background
  const coverMatch = html.match(
    /class="[^"]*cover_follow[^"]*"[^>]*style="[^"]*url\(([^)]*)\)/i
  );
  const background = coverMatch ? coverMatch[1] : poster;

  // Synopsis
  const synopsisMatch = html.match(
    /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  );
  const synopsis = synopsisMatch
    ? synopsisMatch[1].replace(/<[^>]*>/g, "").trim()
    : "";

  // Row-line metadata
  const rowLines = [];
  const rowRegex =
    /<div[^>]*class="[^"]*row-line[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let rlMatch;
  while ((rlMatch = rowRegex.exec(html)) !== null) {
    rowLines.push(rlMatch[1].replace(/<[^>]*>/g, "").trim());
  }

  let year = "";
  let genres = [];
  let duration = "";
  if (rowLines.length > 0 && rowLines[0].includes(":")) {
    year = rowLines[0].split(":").slice(1).join(":").split("-")[0].trim();
  }
  if (rowLines.length > 1 && rowLines[1].includes(":")) {
    genres = rowLines[1]
      .split(":")
      .slice(1)
      .join(":")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
  }
  if (rowLines.length > 3 && rowLines[3].includes(":")) {
    duration = rowLines[3]
      .split(":")
      .slice(1)
      .join(":")
      .trim()
      .split(" ")[0]
      .trim();
  }

  const isMovie = url.includes("/movie/");
  const contentType = isMovie ? "movie" : "tv";

  // data-id
  const dataIdMatch = html.match(
    /class="[^"]*detail_page-watch[^"]*"[^>]*data-id="([^"]*)"/i
  );
  const dataId = dataIdMatch ? dataIdMatch[1] : "";

  return {
    title,
    poster,
    background,
    synopsis,
    year,
    genres,
    duration,
    type: contentType,
    dataId,
    url,
  };
}

async function w32GetMovieServers(dataId) {
  const resp = await fetch(
    `${WATCH32_BASE}/ajax/episode/list/${dataId}`,
    { headers: AJAX_HEADERS }
  );
  if (!resp.ok) throw new Error(`Movie servers fetch failed: ${resp.status}`);
  const html = await resp.text();

  const servers = [];
  const regex =
    /<a[^>]*class="[^"]*"[^>]*data-id="([^"]*)"[^>]*title="([^"]*)"[^>]*>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    servers.push({ id: m[1], name: m[2] });
  }

  // Fallback: try without title attribute
  if (servers.length === 0) {
    const altRegex =
      /<a[^>]*data-id="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = altRegex.exec(html)) !== null) {
      const name = m[2].replace(/<[^>]*>/g, "").trim();
      if (m[1] && name) {
        servers.push({ id: m[1], name });
      }
    }
  }

  return servers;
}

async function w32GetSeasonList(dataId) {
  const resp = await fetch(
    `${WATCH32_BASE}/ajax/season/list/${dataId}`,
    { headers: AJAX_HEADERS }
  );
  if (!resp.ok) throw new Error(`Season list fetch failed: ${resp.status}`);
  const html = await resp.text();

  const seasonIds = [];
  const regex = /<a[^>]*data-id="([^"]*)"[^>]*>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    if (m[1]) seasonIds.push(m[1]);
  }
  return seasonIds;
}

async function w32GetSeasonEpisodes(seasonId) {
  const resp = await fetch(
    `${WATCH32_BASE}/ajax/season/episodes/${seasonId}`,
    { headers: AJAX_HEADERS }
  );
  if (!resp.ok)
    throw new Error(`Season episodes fetch failed: ${resp.status}`);
  const html = await resp.text();

  const episodes = [];
  // Match nav-items containing <a> with data-id
  const regex =
    /<a[^>]*data-id="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  let epNum = 0;
  while ((m = regex.exec(html)) !== null) {
    epNum++;
    const epDataId = m[1];
    let rawText = m[2].replace(/<[^>]*>/g, "").trim();
    // Episode name is after the colon, e.g. "Eps 1:Pilot"
    const epName = rawText.includes(":")
      ? rawText.split(":").slice(1).join(":").trim()
      : rawText;
    if (epDataId) {
      episodes.push({
        episode: epNum,
        name: epName,
        dataId: epDataId,
      });
    }
  }
  return episodes;
}

async function w32GetEpisodeServers(epDataId) {
  const resp = await fetch(
    `${WATCH32_BASE}/ajax/episode/servers/${epDataId}`,
    { headers: AJAX_HEADERS }
  );
  if (!resp.ok)
    throw new Error(`Episode servers fetch failed: ${resp.status}`);
  const html = await resp.text();

  const servers = [];
  const regex =
    /<a[^>]*data-id="([^"]*)"[^>]*title="([^"]*)"[^>]*>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    servers.push({ id: m[1], name: m[2] });
  }

  if (servers.length === 0) {
    const altRegex =
      /<a[^>]*data-id="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = altRegex.exec(html)) !== null) {
      const name = m[2].replace(/<[^>]*>/g, "").trim();
      if (m[1] && name) {
        servers.push({ id: m[1], name });
      }
    }
  }

  return servers;
}

async function w32GetSourceLink(vidId) {
  const resp = await fetch(
    `${WATCH32_BASE}/ajax/episode/sources/${vidId}`,
    { headers: AJAX_HEADERS }
  );
  if (!resp.ok) throw new Error(`Source link fetch failed: ${resp.status}`);
  const data = await resp.json();
  return data.link || "";
}

// ─── Videostr Extractor ───────────────────────────────────────────────────────

async function extractVideostr(url) {
  // Step 1: Get embed page and extract nonce
  const resp = await fetch(url, {
    headers: {
      ...HEADERS,
      Referer: VIDEOSTR_BASE,
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!resp.ok) throw new Error(`Embed page fetch failed: ${resp.status}`);
  const pageText = await resp.text();

  const vidId = url
    .replace(/\/+$/, "")
    .split("/")
    .pop()
    .split("?")[0];

  // Try 48-char nonce first
  let nonce = "";
  const match48 = pageText.match(/\b[a-zA-Z0-9]{48}\b/);
  if (match48) {
    nonce = match48[0];
  } else {
    // Fallback: 3 × 16-char tokens
    const match3x16 = pageText.match(
      /\b([a-zA-Z0-9]{16})\b[\s\S]*?\b([a-zA-Z0-9]{16})\b[\s\S]*?\b([a-zA-Z0-9]{16})\b/
    );
    if (match3x16) {
      nonce = match3x16[1] + match3x16[2] + match3x16[3];
    }
  }

  if (!nonce) {
    return { error: "Nonce not found in embed page" };
  }

  // Step 2: Get sources
  const apiUrl = `${VIDEOSTR_BASE}/embed-1/v3/e-1/getSources?id=${vidId}&_k=${nonce}`;
  const srcResp = await fetch(apiUrl, {
    headers: {
      ...HEADERS,
      Referer: VIDEOSTR_BASE,
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!srcResp.ok)
    throw new Error(`Sources API failed: ${srcResp.status}`);
  const sourceData = await srcResp.json();

  const sources = sourceData.sources || [];
  const tracks = sourceData.tracks || [];
  const encrypted = sourceData.encrypted || false;

  if (!sources.length) {
    return { error: "No sources in response" };
  }

  const encodedSource = sources[0].file || "";
  let m3u8Url = "";

  // Step 3: Decrypt if needed
  if (encodedSource.includes(".m3u8")) {
    m3u8Url = encodedSource;
  } else {
    // Get key from GitHub
    const keyResp = await fetch(MEGACLOUD_KEYS_URL, { headers: HEADERS });
    if (!keyResp.ok) throw new Error(`Key fetch failed: ${keyResp.status}`);
    const keys = await keyResp.json();
    const key = keys.vidstr || "";
    if (!key) {
      return { error: "Decryption key 'vidstr' not found" };
    }

    // Decrypt via Google Apps Script
    const decryptUrl = `${DECRYPT_SERVICE_URL}?encrypted_data=${encodeURIComponent(
      encodedSource
    )}&nonce=${encodeURIComponent(nonce)}&secret=${encodeURIComponent(key)}`;

    const decResp = await fetch(decryptUrl, { headers: HEADERS, redirect: "follow" });
    if (!decResp.ok)
      throw new Error(`Decrypt service failed: ${decResp.status}`);
    const decText = await decResp.text();

    const m3u8Match = decText.match(/"file":"(.*?)"/);
    if (m3u8Match) {
      m3u8Url = m3u8Match[1];
    } else {
      return {
        error: "Could not extract M3U8 from decrypted response",
        preview: decText.substring(0, 200),
      };
    }
  }

  // Step 4: Extract subtitles
  const subtitles = [];
  for (const track of tracks) {
    const kind = track.kind || "";
    if (kind === "captions" || kind === "subtitles") {
      subtitles.push({
        label: track.label || "Unknown",
        url: track.file || "",
        default: track.default || false,
      });
    }
  }

  return {
    url: m3u8Url,
    subtitles,
    source: "Videostr",
  };
}

async function extractGeneric(url) {
  if (url.includes("videostr.net")) {
    return extractVideostr(url);
  }
  // Unknown extractor — return raw embed URL
  return { url, subtitles: [], source: "Unknown" };
}

// ─── Result Picker ────────────────────────────────────────────────────────────

function pickBestResult(results, title, preferType = "movie") {
  const titleLower = title.toLowerCase().trim();

  const scored = results.map((r) => {
    let score = 0;
    const rTitle = r.title.toLowerCase().trim();
    const rUrl = r.url.toLowerCase();

    if (rTitle === titleLower) score += 100;
    else if (rTitle.startsWith(titleLower)) score += 60;
    else if (rTitle.includes(titleLower)) score += 40;

    if (preferType === "tv" && rUrl.includes("/tv-show/")) score += 50;
    else if (preferType === "movie" && rUrl.includes("/movie/")) score += 50;
    else if (preferType === "tv" && rUrl.includes("/movie/")) score -= 30;
    else if (preferType === "movie" && rUrl.includes("/tv-show/")) score -= 30;

    return { score, result: r };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.length > 0 ? scored[0].result : results[0] || null;
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

async function handleRoot(request, corsHeaders) {
  const host = new URL(request.url).origin;
  return jsonResponse({
    service: "Watch32 Video Links API",
    version: "1.0.0",
    movieUrlPattern: `${host}/movie/{tmdbId}`,
    tvUrlPattern: `${host}/tv/{tmdbId}/{season}/{episode}`,
    examples: {
      movie: `${host}/movie/155`,
      tv: `${host}/tv/1396/1/1`,
    },
  }, 200, corsHeaders);
}

async function handleMovie(tmdbId, corsHeaders, TMDB_API_KEY) {
  // Step 1: Get movie title from TMDB
  const tmdbData = await tmdbGetMovie(tmdbId, TMDB_API_KEY);
  const title = tmdbData.title || "";
  const year = (tmdbData.release_date || "").substring(0, 4);
  const overview = tmdbData.overview || "";
  const posterPath = tmdbData.poster_path
    ? `${TMDB_IMG}${tmdbData.poster_path}`
    : null;

  if (!title) {
    return errorResponse(`No movie found on TMDB with ID: ${tmdbId}`, 404, corsHeaders);
  }

  // Step 2: Search Watch32
  const { results: searchResults } = await w32Search(title);
  if (!searchResults.length) {
    return errorResponse(
      `No results on Watch32 for "${title}"`,
      404,
      corsHeaders
    );
  }

  const chosen = pickBestResult(searchResults, title, "movie");
  if (!chosen) {
    return errorResponse("Could not match a result on Watch32", 404, corsHeaders);
  }

  // Step 3: Load detail page
  const detail = await w32LoadDetail(chosen.url);
  if (!detail.dataId) {
    return errorResponse("Could not extract data_id from detail page", 500, corsHeaders);
  }

  // Step 4: Get video servers
  const servers = await w32GetMovieServers(detail.dataId);
  if (!servers.length) {
    return errorResponse("No video servers found", 404, corsHeaders);
  }

  // Step 5: Extract video links from each server (process in parallel)
  const serverResults = await Promise.all(
    servers.map(async (server) => {
      try {
        const embedLink = await w32GetSourceLink(server.id);
        if (!embedLink) return { name: server.name, error: "No embed link" };
        const extracted = await extractGeneric(embedLink);
        return {
          name: server.name,
          ...extracted,
        };
      } catch (err) {
        return { name: server.name, error: err.message };
      }
    })
  );

  return jsonResponse({
    type: "movie",
    tmdbId: String(tmdbId),
    title: detail.title || title,
    year: detail.year || year,
    poster: detail.poster || posterPath,
    background: detail.background || null,
    synopsis: detail.synopsis || overview,
    genres: detail.genres,
    duration: detail.duration || null,
    watch32Url: chosen.url,
    servers: serverResults,
  }, 200, corsHeaders);
}

async function handleTv(tmdbId, season, episode, corsHeaders, TMDB_API_KEY) {
  // Step 1: Get TV show title from TMDB
  const tmdbData = await tmdbGetTv(tmdbId, TMDB_API_KEY);
  const title = tmdbData.name || "";
  const year = (tmdbData.first_air_date || "").substring(0, 4);
  const overview = tmdbData.overview || "";
  const posterPath = tmdbData.poster_path
    ? `${TMDB_IMG}${tmdbData.poster_path}`
    : null;

  if (!title) {
    return errorResponse(`No TV show found on TMDB with ID: ${tmdbId}`, 404, corsHeaders);
  }

  // Step 2: Search Watch32
  const { results: searchResults } = await w32Search(title);
  if (!searchResults.length) {
    return errorResponse(
      `No results on Watch32 for "${title}"`,
      404,
      corsHeaders
    );
  }

  const chosen = pickBestResult(searchResults, title, "tv");
  if (!chosen) {
    return errorResponse("Could not match a result on Watch32", 404, corsHeaders);
  }

  // Step 3: Load detail page
  const detail = await w32LoadDetail(chosen.url);
  if (!detail.dataId) {
    return errorResponse("Could not extract data_id from detail page", 500, corsHeaders);
  }

  // Step 4: Get seasons
  const seasonIds = await w32GetSeasonList(detail.dataId);
  if (!seasonIds.length) {
    return errorResponse("No seasons found", 404, corsHeaders);
  }

  if (season < 1 || season > seasonIds.length) {
    return errorResponse(
      `Season ${season} not available. This show has ${seasonIds.length} season(s).`,
      404,
      corsHeaders
    );
  }

  // Step 5: Get episodes for the target season (1-indexed)
  const seasonId = seasonIds[season - 1];
  const episodes = await w32GetSeasonEpisodes(seasonId);
  if (!episodes.length) {
    return errorResponse(
      `No episodes found for season ${season}`,
      404,
      corsHeaders
    );
  }

  if (episode < 1 || episode > episodes.length) {
    return errorResponse(
      `Episode ${episode} not available in season ${season}. This season has ${episodes.length} episode(s).`,
      404,
      corsHeaders
    );
  }

  const targetEp = episodes[episode - 1];

  // Step 6: Get servers for the target episode
  const servers = await w32GetEpisodeServers(targetEp.dataId);
  if (!servers.length) {
    return errorResponse(
      `No video servers found for S${season}E${episode}`,
      404,
      corsHeaders
    );
  }

  // Step 7: Extract video links from each server (process in parallel)
  const serverResults = await Promise.all(
    servers.map(async (server) => {
      try {
        const embedLink = await w32GetSourceLink(server.id);
        if (!embedLink) return { name: server.name, error: "No embed link" };
        const extracted = await extractGeneric(embedLink);
        return {
          name: server.name,
          ...extracted,
        };
      } catch (err) {
        return { name: server.name, error: err.message };
      }
    })
  );

  return jsonResponse({
    type: "tv",
    tmdbId: String(tmdbId),
    title: detail.title || title,
    year: detail.year || year,
    poster: detail.poster || posterPath,
    background: detail.background || null,
    synopsis: detail.synopsis || overview,
    genres: detail.genres,
    season,
    episode,
    episodeName: targetEp.name || `Episode ${episode}`,
    totalSeasons: seasonIds.length,
    totalEpisodesInSeason: episodes.length,
    watch32Url: chosen.url,
    servers: serverResults,
  }, 200, corsHeaders);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    // Auth check first (skip for OPTIONS)
    if (request.method !== "OPTIONS") {
      const authError = checkAuth(request, env);
      if (authError) return authError;
    }

    const corsHeaders = getCorsHeaders(request, env);
    const TMDB_API_KEY = env.TMDB_API_KEY || "297f1b91919bae59d50ed815f8d2e14c";
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      // GET /
      if (path === "/" || path === "") {
        return handleRoot(request, corsHeaders);
      }

      // GET /movie/{tmdbId}
      const movieMatch = path.match(/^\/movie\/(\d+)\/?$/);
      if (movieMatch) {
        return await handleMovie(movieMatch[1], corsHeaders, TMDB_API_KEY);
      }

      // GET /tv/{tmdbId}/{season}/{episode}
      const tvMatch = path.match(/^\/tv\/(\d+)\/(\d+)\/(\d+)\/?$/);
      if (tvMatch) {
        return await handleTv(
          tvMatch[1],
          parseInt(tvMatch[2], 10),
          parseInt(tvMatch[3], 10),
          corsHeaders,
          TMDB_API_KEY
        );
      }

      return errorResponse(
        "Not found. Use /movie/{tmdbId} or /tv/{tmdbId}/{season}/{episode}",
        404,
        corsHeaders
      );
    } catch (err) {
      return errorResponse(`Internal error: ${err.message}`, 500, corsHeaders);
    }
  },
};
