const ALLOWED_ORIGIN = 'https://letsstream2.pages.dev';

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Cookie": "xla=s4t",
    "Referer": "https://hdhub4u.rehab"
};

export default {
    async fetch(request, env, ctx) {
        // Check origin
        const origin = request.headers.get('Origin');
        const isAllowedOrigin = origin === ALLOWED_ORIGIN;

        if (!isAllowedOrigin) {
            return new Response(JSON.stringify({ error: 'Forbidden: unauthorized origin' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Handle OPTIONS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
                    'Vary': 'Origin'
                }
            });
        }

        // Check API key
        const apiKey = request.headers.get('X-Api-Key');
        if (!apiKey || apiKey !== env.API_KEY) {
            return new Response(JSON.stringify({ error: 'Unauthorized: invalid or missing API key' }), {
                status: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
                    'Vary': 'Origin'
                }
            });
        }

        const TMDB_API_KEY = env.TMDB_API_KEY;

        const url = new URL(request.url);
        const path = url.pathname;

        const movieMatch = path.match(/^\/movie\/(\d+)$/);
        const tvMatch = path.match(/^\/tv\/(\d+)\/(\d+)\/(\d+)$/);

        try {
            if (movieMatch) {
                const tmdbId = movieMatch[1];
                return await handleRequest(tmdbId, 'movie', null, null, TMDB_API_KEY, env);
            } else if (tvMatch) {
                const tmdbId = tvMatch[1];
                const season = tvMatch[2];
                const episode = tvMatch[3];
                return await handleRequest(tmdbId, 'tv', season, episode, TMDB_API_KEY, env);
            }
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Vary': 'Origin' }
            });
        }

        return new Response("Not Found", { status: 404 });
    }
};

async function handleRequest(tmdbId, type, season, episode, TMDB_API_KEY, env) {
    let query = '';
    if (type === 'movie') {
        const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`);
        if (!res.ok) throw new Error("TMDB details fetch failed: " + res.status);
        const data = await res.json();
        const year = data.release_date ? data.release_date.split('-')[0] : '';
        query = `${data.title} ${year}`.trim();
    } else {
        const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`);
        if (!res.ok) throw new Error("TMDB details fetch failed: " + res.status);
        const data = await res.json();
        query = data.name;
    }

    // Search on Pingora
    const searchUrl = `https://search.pingora.fyi/collections/post/documents/search?q=${encodeURIComponent(query)}&query_by=post_title,category&query_by_weights=4,2&sort_by=sort_by_date:desc&limit=15&highlight_fields=none&use_cache=true&page=1`;
    const searchRes = await fetch(searchUrl, { headers: HEADERS });
    if (!searchRes.ok) throw new Error(`Search API failed with ${searchRes.status}`);
    const searchData = await searchRes.json();

    const hits = searchData.hits || [];
    if (hits.length === 0) {
        return jsonResponse([]);
    }

    // Pick the most relevant post
    let selectedPost = hits[0].document;
    if (type === 'tv') {
        const seasonStr = `Season ${season}`;
        const match = hits.find(h => h.document.post_title.includes(seasonStr) || h.document.post_title.includes(`S${season.toString().padStart(2, '0')}`));
        if (match) selectedPost = match.document;
    }

    let permalink = selectedPost.permalink;
    if (!permalink.startsWith("http")) {
        permalink = "https://hdhub4u.rehab" + permalink;
    }

    // Fetch post page
    const pageRes = await fetch(permalink, { headers: HEADERS });
    const html = await pageRes.text();

    const aTagRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
    let match;
    let lastEpisodeStr = "1";
    let extractedLinks = [];

    while ((match = aTagRegex.exec(html)) !== null) {
        const href = match[1];
        const aText = match[2];
        if (href.match(/https:\/\/(?:.*\.)?(hdstream4u|hubstream|hblinks|hubcdn|hubdrive)\./)) {
            const contextStart = Math.max(0, match.index - 500);
            const context = html.substring(contextStart, match.index);

            // Find ALL episode markers in the context window
            const epMatches = [...context.matchAll(/(?:E|Ep|Episode)(?:\s|&#8211;|-)*0*(\d+)/gi)];
            // Take the last one (closest to the link)
            if (epMatches.length > 0) {
                lastEpisodeStr = epMatches[epMatches.length - 1][1];
            }

            extractedLinks.push({
                url: href,
                text: aText.replace(/<[^>]*>?/gm, '').trim(),
                episode: parseInt(lastEpisodeStr, 10)
            });
        }
    }

    const uniqueLinks = [];
    const seenUrls = new Set();
    for (const link of extractedLinks) {
        if (!seenUrls.has(link.url)) {
            seenUrls.add(link.url);
            uniqueLinks.push(link);
        }
    }

    let targetLinks = uniqueLinks;
    if (type === 'tv') {
        const targetEp = parseInt(episode, 10);
        const episodeLinks = uniqueLinks.filter(l => l.episode === targetEp);
        if (episodeLinks.length > 0) {
            targetLinks = episodeLinks;
        } else {
            // If no precise episode links matched, return all just in case
            targetLinks = uniqueLinks;
        }
    }

    // For debugging, we can return the raw targetLinks immediately if we want to see what was parsed
    // uncomment this to debug:
    // return jsonResponse({ query, linkCount: targetLinks.length, links: targetLinks });

    let resolvedLinks = [];

    // We cannot do too many requests in parallel or we might timeout. Let's do batch of 3.
    for (let i = 0; i < targetLinks.length; i += 3) {
        const batch = targetLinks.slice(i, i + 3);
        await Promise.all(batch.map(async (linkObj) => {
            try {
                let finalLink = linkObj.url;

                if (finalLink.includes("?id=")) {
                    finalLink = await getRedirectLinks(finalLink);
                    if (!finalLink) return;
                }

                if (finalLink.toLowerCase().includes("hubdrive")) {
                    const hdRes = await fetch(finalLink, { headers: HEADERS });
                    if (hdRes.ok) {
                        const hdHtml = await hdRes.text();
                        const aTags = hdHtml.match(/<a[^>]+>/ig) || [];
                        for (const tag of aTags) {
                            if (tag.includes('btn-success1')) {
                                const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
                                if (hrefMatch) {
                                    finalLink = hrefMatch[1];
                                    break;
                                }
                            }
                        }
                    }
                }

                if (finalLink.toLowerCase().includes("hubcloud") || finalLink.toLowerCase().includes("hubcdn")) {
                    const results = await extractHubcloud(finalLink);
                    for (const r of results) {
                        resolvedLinks.push({
                            name: "HDHub4u",
                            link: r.url,
                            quality: r.label || "Unknown",
                        });
                    }
                } else if (finalLink.toLowerCase().includes("vidstack") || finalLink.toLowerCase().includes("hubstream")) {
                    const m3u8 = await extractVidstack(finalLink, env);
                    if (m3u8 && m3u8.endsWith(".m3u8")) {
                        resolvedLinks.push({
                            name: "HDHub4u",
                            link: m3u8,
                            quality: "Auto",
                        });
                    }
                } else {
                    resolvedLinks.push({
                        name: "HDHub4u",
                        link: finalLink,
                        quality: "Unknown",
                    });
                }
            } catch (e) {
                console.error("Error processing link:", linkObj.url, e);
            }
        }));
    }

    // Sort array so it's consistent
    resolvedLinks.sort((a, b) => a.quality.localeCompare(b.quality));
    return jsonResponse(resolvedLinks);
}

function jsonResponse(data) {
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
            'Vary': 'Origin'
        }
    });
}

function pen(val) {
    let res = "";
    for (let i = 0; i < val.length; i++) {
        const c = val[i];
        if (c >= 'A' && c <= 'Z') {
            res += String.fromCharCode(((c.charCodeAt(0) - 65 + 13) % 26) + 65);
        } else if (c >= 'a' && c <= 'z') {
            res += String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97);
        } else {
            res += c;
        }
    }
    return res;
}

async function getRedirectLinks(url) {
    try {
        const response = await fetch(url, { headers: HEADERS });
        const doc = await response.text();

        let combined = "";
        const regex1 = /s\('o','([A-Za-z0-9+/=]+)'\)/g;
        const regex2 = /ck\('_wp_http_\d+','([^']+)'\)/g;

        let m;
        while ((m = regex1.exec(doc)) !== null) { combined += m[1]; }
        while ((m = regex2.exec(doc)) !== null) { combined += m[1]; }

        if (!combined) return url;

        const step1 = atob(combined);
        const step2 = atob(step1);
        const step3 = pen(step2);
        const decodedString = atob(step3);

        const jsonObj = JSON.parse(decodedString);

        if (jsonObj.o) {
            return atob(jsonObj.o).trim();
        }

        if (jsonObj.data) {
            const data = atob(jsonObj.data).trim();
            const wphttp1 = (jsonObj.blog_url || "").trim();
            const directlinkUrl = `${wphttp1}?re=${data}`;

            const dlResp = await fetch(directlinkUrl, { headers: HEADERS });
            const html = await dlResp.text();

            const match = html.match(/<body[^>]*>(.*?)<\/body>/is);
            if (match) {
                return match[1].replace(/<[^>]*>?/gm, '').trim();
            }
        }
    } catch (e) {
        console.error("Error resolving redirect", e);
    }
    return url;
}

async function extractVidstack(url, env) {
    try {
        let hash_val = "";
        if (url.includes("#")) {
            const parts = url.split("#");
            hash_val = parts[parts.length - 1];
        }
        if (hash_val.includes("/")) {
            const parts = hash_val.split("/");
            hash_val = parts[parts.length - 1];
        }
        if (!hash_val) {
            const u = new URL(url);
            hash_val = u.pathname.split('/').pop() || u.hash.replace('#', '');
        }

        const baseurl = new URL(url).origin;
        const apiUrl = `${baseurl}/api/v1/video?id=${hash_val}`;

        const reqHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0" };
        const res = await fetch(apiUrl, { headers: reqHeaders });
        const encoded = (await res.text()).trim();

        const keyData = new TextEncoder().encode(env.AES_KEY);
        const importedKey = await crypto.subtle.importKey(
            "raw",
            keyData,
            { name: "AES-CBC" },
            false,
            ["decrypt"]
        );

        const ivList = ["1234567890oiuytr", "0123456789abcdef"];
        const hexArray = [];
        for (let i = 0; i < encoded.length; i += 2) {
            hexArray.push(parseInt(encoded.substr(i, 2), 16));
        }
        const dataBuffer = new Uint8Array(hexArray);

        let decryptedText = null;
        for (const ivString of ivList) {
            try {
                const ivData = new TextEncoder().encode(ivString);
                const decryptedBuffer = await crypto.subtle.decrypt(
                    { name: "AES-CBC", iv: ivData },
                    importedKey,
                    dataBuffer
                );
                decryptedText = new TextDecoder().decode(decryptedBuffer);
                break;
            } catch (e) {
                // try next
            }
        }

        if (!decryptedText) return null;

        const m3u8Match = decryptedText.match(/"source":"(.*?)"/);
        if (m3u8Match) {
            return m3u8Match[1].replace(/\\\//g, '/');
        }
    } catch (e) {
        console.error("Error in VidStack", e);
    }
    return null;
}

async function extractHubcloud(url) {
    const results = [];
    try {
        let fetchUrl = url;
        if (!url.includes("hubcloud.php") && !url.includes("api/video")) {
            const res = await fetch(url, { headers: HEADERS });
            if (res.ok) {
                const html = await res.text();
                const aTags = html.match(/<a[^>]+>/ig) || [];
                for (const tag of aTags) {
                    if (tag.includes("id=\"download\"") || tag.includes("id='download'")) {
                        const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
                        if (hrefMatch) {
                            let href = hrefMatch[1];
                            if (!href.startsWith("http")) {
                                const baseurl = new URL(url).origin;
                                fetchUrl = `${baseurl}/${href.replace(/^\//, '')}`;
                            } else {
                                fetchUrl = href;
                            }
                            break;
                        }
                    }
                }
            }
        }

        const docResp = await fetch(fetchUrl, { headers: HEADERS });
        if (!docResp.ok) return results;
        const docHtml = await docResp.text();

        const aTagsFull = docHtml.match(/<a[^>]+>(.*?)<\/a>/gis) || [];
        for (const tag of aTagsFull) {
            const openTagMatch = tag.match(/^<a([^>]+)>/i);
            if (openTagMatch) {
                const openTag = openTagMatch[1];
                if (openTag.toLowerCase().includes('class=')) {
                    const classMatch = openTag.match(/class=["']([^"']+)["']/i);
                    const hrefMatch = openTag.match(/href=["']([^"']+)["']/i);

                    if (classMatch && classMatch[1].split(' ').includes('btn') && hrefMatch) {
                        results.push({
                            label: tag.replace(/<[^>]*>?/gm, '').trim(),
                            url: hrefMatch[1]
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error in Hubcloud", e);
    }
    return results;
}
