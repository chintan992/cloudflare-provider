"""
Watch32 Test Script
Fetch video links for movies and TV shows by TMDB ID via Watch32.sx scraping.

Usage:
    python watch32_test.py movie <tmdb_id>
    python watch32_test.py tv <tmdb_id> [--season N] [--episode N]
    python watch32_test.py search <query>

Examples:
    python watch32_test.py movie 155          # The Dark Knight
    python watch32_test.py tv 1396 --season 1 --episode 1  # Breaking Bad S01E01
    python watch32_test.py search "inception"
"""

import sys
import os
import re
import json
import requests
from urllib.parse import urlencode, quote
from bs4 import BeautifulSoup

# Fix encoding for Windows PowerShell
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ─── Constants ───────────────────────────────────────────────────────────────

WATCH32_BASE = "https://watch32.sx"
VIDEOSTR_BASE = "https://videostr.net"
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "297f1b91919bae59d50ed815f8d2e14c")
TMDB_API_BASE = "https://api.themoviedb.org/3"
TMDB_IMG = "https://image.tmdb.org/t/p/w500"

MEGACLOUD_KEYS_URL = "https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json"
DECRYPT_SERVICE_URL = "https://script.google.com/macros/s/AKfycbxHbYHbrGMXYD2-bC-C43D3njIbU-wGiYQuJL61H4vyy6YVXkybMNNEPJNPPuZrD1gRVA/exec"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

AJAX_HEADERS = {
    **HEADERS,
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "*/*",
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# ─── TMDB Helpers ────────────────────────────────────────────────────────────

def tmdb_get_movie(tmdb_id):
    """Fetch movie details from TMDB."""
    print(f"📡 Fetching movie info from TMDB (ID: {tmdb_id})...")
    resp = SESSION.get(
        f"{TMDB_API_BASE}/movie/{tmdb_id}",
        params={"api_key": TMDB_API_KEY, "language": "en-US"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    title = data.get("title", "")
    year = (data.get("release_date") or "")[:4]
    print(f"   ✅ TMDB: {title} ({year})")
    return data


def tmdb_get_tv(tmdb_id):
    """Fetch TV show details from TMDB."""
    print(f"📡 Fetching TV info from TMDB (ID: {tmdb_id})...")
    resp = SESSION.get(
        f"{TMDB_API_BASE}/tv/{tmdb_id}",
        params={"api_key": TMDB_API_KEY, "language": "en-US"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    title = data.get("name", "")
    year = (data.get("first_air_date") or "")[:4]
    seasons = data.get("number_of_seasons", 1)
    print(f"   ✅ TMDB: {title} ({year}) — {seasons} season(s)")
    return data


# ─── Watch32 Scraper ─────────────────────────────────────────────────────────

def w32_search(query):
    """Search Watch32 for a title."""
    print(f"🔍 Searching Watch32 for '{query}'...")
    resp = SESSION.post(
        f"{WATCH32_BASE}/ajax/search",
        data={"keyword": query},
        headers={
            **HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
        },
        timeout=20,
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    results = []
    for a in soup.select("a.nav-item:has(div)"):
        href = a.get("href", "")
        title = ""
        h3 = a.select_one("h3")
        if h3:
            title = h3.get_text(strip=True)
        img = a.select_one("img")
        poster = img.get("src", "") if img else ""
        url = WATCH32_BASE + "/" + href.lstrip("/") if href else ""
        if title and url:
            results.append({"title": title, "url": url, "poster": poster})

    print(f"   ✅ Found {len(results)} result(s)")
    for i, r in enumerate(results[:5], 1):
        print(f"      [{i}] {r['title']}  →  {r['url']}")
    return results


def w32_load_detail(url):
    """Load a Watch32 detail page and extract metadata."""
    print(f"📄 Loading detail page: {url}")
    resp = SESSION.get(url, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    title = ""
    heading = soup.select_one(".heading-name")
    if heading:
        title = heading.get_text(strip=True)

    poster_el = soup.select_one(".film-poster-img")
    poster = poster_el.get("src", "") if poster_el else ""

    # Background image from inline style
    cover = soup.select_one(".cover_follow")
    bg_match = re.search(r"url\((.*?)\)", cover.get("style", "") if cover else "")
    background = bg_match.group(1) if bg_match else poster

    synopsis_el = soup.select_one(".description")
    synopsis = synopsis_el.get_text(strip=True) if synopsis_el else ""

    row_lines = [el.get_text(strip=True) for el in soup.select(".row-line")]
    year = ""
    genres = []
    duration = ""
    if len(row_lines) > 0:
        year = row_lines[0].split(":", 1)[-1].split("-")[0].strip() if ":" in row_lines[0] else ""
    if len(row_lines) > 1:
        genres = [g.strip() for g in row_lines[1].split(":", 1)[-1].split(",")]
    if len(row_lines) > 3:
        duration = row_lines[3].split(":", 1)[-1].strip().split(" ")[0].strip()

    is_movie = "/movie/" in url
    content_type = "movie" if is_movie else "tv"

    # Get data-id
    detail_el = soup.select_one(".detail_page-watch")
    data_id = detail_el.get("data-id", "") if detail_el else ""

    print(f"   ✅ {title} ({year}) [{content_type.upper()}]")
    print(f"      Genres: {', '.join(genres) if genres else 'N/A'}")
    print(f"      Duration: {duration or 'N/A'}")
    print(f"      Synopsis: {synopsis[:100]}..." if synopsis else "      Synopsis: N/A")

    return {
        "title": title,
        "poster": poster,
        "background": background,
        "synopsis": synopsis,
        "year": year,
        "genres": genres,
        "duration": duration,
        "type": content_type,
        "data_id": data_id,
        "url": url,
    }


def w32_get_movie_servers(data_id):
    """Get video server links for a movie."""
    print(f"📡 Fetching movie episode list (data_id: {data_id})...")
    # First get the episode list
    resp = SESSION.get(f"{WATCH32_BASE}/ajax/episode/list/{data_id}", headers=AJAX_HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    servers = []
    for a in soup.select(".nav-item a"):
        vid_id = a.get("data-id", "")
        server_title = a.get("title", a.get_text(strip=True))
        if vid_id:
            servers.append({"id": vid_id, "name": server_title})

    print(f"   ✅ Found {len(servers)} server(s)")
    return servers


def w32_get_tv_episodes(data_id):
    """Get seasons and episodes for a TV show."""
    print(f"📡 Fetching season list (data_id: {data_id})...")
    resp = SESSION.get(f"{WATCH32_BASE}/ajax/season/list/{data_id}", headers=AJAX_HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    seasons = {}
    for idx, season_el in enumerate(soup.select("a"), 1):
        season_id = season_el.get("data-id", "")
        if not season_id:
            continue

        print(f"   📺 Fetching Season {idx} episodes (id: {season_id})...")
        ep_resp = SESSION.get(
            f"{WATCH32_BASE}/ajax/season/episodes/{season_id}",
            headers=AJAX_HEADERS, timeout=20,
        )
        ep_resp.raise_for_status()
        ep_soup = BeautifulSoup(ep_resp.text, "html.parser")

        episodes = []
        for ep_num, nav_item in enumerate(ep_soup.select(".nav-item"), 1):
            a = nav_item.select_one("a") if nav_item.name != "a" else nav_item
            if not a:
                continue
            ep_data_id = a.get("data-id", "")
            ep_text = nav_item.get_text(strip=True)
            # Episode name is after the colon, e.g. "Eps 1:Pilot"
            ep_name = ep_text.split(":", 1)[1].strip() if ":" in ep_text else ep_text
            server_url = f"{WATCH32_BASE}/ajax/episode/servers/{ep_data_id}"
            episodes.append({
                "episode": ep_num,
                "name": ep_name,
                "data_id": ep_data_id,
                "server_url": server_url,
            })

        seasons[idx] = episodes
        print(f"      ✅ Season {idx}: {len(episodes)} episode(s)")

    return seasons


def w32_get_source_link(vid_id):
    """Get the embed link for a video server."""
    resp = SESSION.get(
        f"{WATCH32_BASE}/ajax/episode/sources/{vid_id}",
        headers=AJAX_HEADERS, timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    link = data.get("link", "")
    return link


def w32_get_episode_servers(server_url):
    """Get video servers for a TV episode."""
    resp = SESSION.get(server_url, headers=AJAX_HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    servers = []
    for a in soup.select(".nav-item a"):
        vid_id = a.get("data-id", "")
        server_name = a.get("title", a.get_text(strip=True))
        if vid_id:
            servers.append({"id": vid_id, "name": server_name})

    return servers


# ─── Videostr Extractor ──────────────────────────────────────────────────────

def extract_videostr(url):
    """
    Extract M3U8 video URL and subtitles from a videostr.net embed.
    Ports the Kotlin Videostr extractor logic to Python.
    """
    print(f"   🎬 Extracting from: {url}")

    # Step 1: Get embed page and extract nonce
    resp = SESSION.get(url, headers={
        **HEADERS,
        "Referer": VIDEOSTR_BASE,
        "X-Requested-With": "XMLHttpRequest",
    }, timeout=20)
    resp.raise_for_status()
    page_text = resp.text

    vid_id = url.rstrip("/").split("/")[-1].split("?")[0]

    # Try 48-char nonce first
    match48 = re.search(r"\b[a-zA-Z0-9]{48}\b", page_text)
    if match48:
        nonce = match48.group(0)
    else:
        # Fallback: 3 × 16-char tokens
        match3x16 = re.search(
            r"\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b",
            page_text, re.DOTALL,
        )
        if match3x16:
            nonce = match3x16.group(1) + match3x16.group(2) + match3x16.group(3)
        else:
            print("      ❌ Nonce not found in embed page")
            return None

    print(f"      🔑 Nonce: {nonce[:12]}...{nonce[-6:]}")

    # Step 2: Get sources
    api_url = f"{VIDEOSTR_BASE}/embed-1/v3/e-1/getSources?id={vid_id}&_k={nonce}"
    resp = SESSION.get(api_url, headers={
        **HEADERS,
        "Referer": VIDEOSTR_BASE,
        "X-Requested-With": "XMLHttpRequest",
    }, timeout=20)
    resp.raise_for_status()
    source_data = resp.json()

    sources = source_data.get("sources", [])
    tracks = source_data.get("tracks", [])
    encrypted = source_data.get("encrypted", False)

    if not sources:
        print("      ❌ No sources in response")
        return None

    encoded_source = sources[0].get("file", "")
    print(f"      📦 Source encrypted: {encrypted}")

    # Step 3: Decrypt if needed
    if ".m3u8" in encoded_source:
        m3u8_url = encoded_source
        print(f"      ✅ Direct M3U8 URL found")
    else:
        print(f"      🔐 Encrypted source — fetching decryption key...")
        # Get key from GitHub
        key_resp = SESSION.get(MEGACLOUD_KEYS_URL, timeout=15)
        key_resp.raise_for_status()
        keys = key_resp.json()
        key = keys.get("vidstr", "")
        if not key:
            print("      ❌ Decryption key 'vidstr' not found")
            return None
        print(f"      🔑 Key: {key[:8]}...")

        # Decrypt via Google Apps Script
        decrypt_url = (
            f"{DECRYPT_SERVICE_URL}"
            f"?encrypted_data={quote(encoded_source)}"
            f"&nonce={quote(nonce)}"
            f"&secret={quote(key)}"
        )
        print(f"      🔓 Decrypting via Google Apps Script...")
        dec_resp = SESSION.get(decrypt_url, timeout=30)
        dec_resp.raise_for_status()
        dec_text = dec_resp.text

        m3u8_match = re.search(r'"file":"(.*?)"', dec_text)
        if m3u8_match:
            m3u8_url = m3u8_match.group(1)
            print(f"      ✅ Decrypted M3U8 URL obtained")
        else:
            print(f"      ❌ Could not extract M3U8 from decrypted response")
            print(f"         Response preview: {dec_text[:200]}")
            return None

    # Step 4: Extract subtitles
    subtitles = []
    for track in tracks:
        kind = track.get("kind", "")
        if kind in ("captions", "subtitles"):
            subtitles.append({
                "label": track.get("label", "Unknown"),
                "url": track.get("file", ""),
                "default": track.get("default", False),
            })

    return {
        "m3u8": m3u8_url,
        "subtitles": subtitles,
        "source_name": "Videostr",
    }


def extract_generic(url):
    """Try to extract from any embed URL — falls back to returning the URL."""
    if "videostr.net" in url:
        return extract_videostr(url)
    else:
        print(f"   ⚠️  Unknown extractor for: {url}")
        print(f"      Returning raw embed URL")
        return {"m3u8": url, "subtitles": [], "source_name": "Unknown"}


# ─── Display Helpers ─────────────────────────────────────────────────────────

def print_extraction_result(result, server_name=""):
    """Pretty-print an extraction result."""
    if not result:
        print(f"      ❌ Extraction failed for {server_name}")
        return

    prefix = f"[{server_name}] " if server_name else ""
    print(f"\n      🎥 {prefix}Source: {result['source_name']}")
    print(f"      🔗 M3U8: {result['m3u8']}")

    if result["subtitles"]:
        print(f"      📝 Subtitles ({len(result['subtitles'])}):")
        for sub in result["subtitles"]:
            default_tag = " ⭐" if sub.get("default") else ""
            print(f"         • {sub['label']}{default_tag}: {sub['url']}")


# ─── Result Picker ───────────────────────────────────────────────────────────

def pick_best_result(results, title, prefer_type="movie"):
    """
    Pick the best search result based on title similarity and content type.
    prefer_type: "movie" prefers /movie/ URLs, "tv" prefers /tv-show/ URLs
    """
    title_lower = title.lower().strip()

    scored = []
    for r in results:
        score = 0
        r_title = r["title"].lower().strip()
        r_url = r["url"].lower()

        # Exact title match
        if r_title == title_lower:
            score += 100
        # Title starts with query
        elif r_title.startswith(title_lower):
            score += 60
        # Query is contained in result title
        elif title_lower in r_title:
            score += 40

        # Prefer correct content type
        if prefer_type == "tv" and "/tv-show/" in r_url:
            score += 50
        elif prefer_type == "movie" and "/movie/" in r_url:
            score += 50
        # Penalize wrong type
        elif prefer_type == "tv" and "/movie/" in r_url:
            score -= 30
        elif prefer_type == "movie" and "/tv-show/" in r_url:
            score -= 30

        scored.append((score, r))

    scored.sort(key=lambda x: x[0], reverse=True)

    if scored:
        best_score, best = scored[0]
        print(f"\n   🎯 Best match (score {best_score}): {best['title']}  →  {best['url']}")
        return best
    return results[0] if results else None


# ─── CLI Commands ────────────────────────────────────────────────────────────

def cmd_movie(tmdb_id):
    """Fetch video links for a movie by TMDB ID."""
    # Step 1: Get movie title from TMDB
    try:
        tmdb_data = tmdb_get_movie(tmdb_id)
    except Exception as e:
        print(f"❌ TMDB error: {e}")
        return

    title = tmdb_data.get("title", "")
    year = (tmdb_data.get("release_date") or "")[:4]
    overview = tmdb_data.get("overview", "")

    print(f"\n🎬 Movie: {title} ({year})")
    print(f"   📝 {overview[:120]}..." if overview else "")

    # Step 2: Search Watch32
    results = w32_search(title)
    if not results:
        print(f"\n❌ No results on Watch32 for '{title}'")
        return

    # Pick best match
    chosen = pick_best_result(results, title, prefer_type="movie")
    print(f"\n✅ Selected: {chosen['title']}  →  {chosen['url']}")

    # Step 3: Load detail page
    detail = w32_load_detail(chosen["url"])
    if not detail.get("data_id"):
        print(f"\n❌ Could not extract data_id from detail page")
        return

    # Step 4: Get video servers
    servers = w32_get_movie_servers(detail["data_id"])
    if not servers:
        print(f"\n❌ No video servers found")
        return

    # Step 5: Extract video links from each server
    print(f"\n{'═' * 60}")
    print(f"  🎬 VIDEO LINKS")
    print(f"{'═' * 60}")

    for server in reversed(servers):
        print(f"\n   📡 Server: {server['name']} (ID: {server['id']})")
        try:
            embed_link = w32_get_source_link(server["id"])
            if not embed_link:
                print(f"      ❌ No embed link returned")
                continue
            print(f"      🌐 Embed: {embed_link}")
            result = extract_generic(embed_link)
            print_extraction_result(result, server["name"])
        except Exception as e:
            print(f"      ❌ Error: {e}")

    print()


def cmd_tv(tmdb_id, season_filter=None, episode_filter=None):
    """Fetch video links for a TV show by TMDB ID."""
    # Step 1: Get TV show title from TMDB
    try:
        tmdb_data = tmdb_get_tv(tmdb_id)
    except Exception as e:
        print(f"❌ TMDB error: {e}")
        return

    title = tmdb_data.get("name", "")
    year = (tmdb_data.get("first_air_date") or "")[:4]
    total_seasons = tmdb_data.get("number_of_seasons", 1)
    overview = tmdb_data.get("overview", "")

    print(f"\n📺 TV Show: {title} ({year}) — {total_seasons} season(s)")
    print(f"   📝 {overview[:120]}..." if overview else "")

    # Step 2: Search Watch32
    results = w32_search(title)
    if not results:
        print(f"\n❌ No results on Watch32 for '{title}'")
        return

    # Pick best match
    chosen = pick_best_result(results, title, prefer_type="tv")
    print(f"\n✅ Selected: {chosen['title']}  →  {chosen['url']}")

    # Step 3: Load detail page
    detail = w32_load_detail(chosen["url"])
    if not detail.get("data_id"):
        print(f"\n❌ Could not extract data_id from detail page")
        return

    # Step 4: Get seasons and episodes
    seasons = w32_get_tv_episodes(detail["data_id"])
    if not seasons:
        print(f"\n❌ No episodes found")
        return

    total_eps = sum(len(eps) for eps in seasons.values())
    print(f"\n📋 Total: {total_eps} episode(s) across {len(seasons)} season(s)")

    # Step 5: Extract video links
    for season_num in sorted(seasons.keys()):
        if season_filter is not None and season_num != season_filter:
            continue

        episodes = seasons[season_num]
        print(f"\n{'═' * 60}")
        print(f"  📺 Season {season_num} ({len(episodes)} episodes)")
        print(f"{'═' * 60}")

        for ep in episodes:
            ep_num = ep["episode"]
            if episode_filter is not None and ep_num != episode_filter:
                continue

            print(f"\n  {'─' * 56}")
            print(f"  E{ep_num:02d}: {ep['name']}")
            print(f"  {'─' * 56}")

            # Get servers for this episode
            try:
                servers = w32_get_episode_servers(ep["server_url"])
                if not servers:
                    print(f"   ❌ No servers found")
                    continue

                print(f"   📡 {len(servers)} server(s) found")

                for server in reversed(servers):
                    print(f"\n   📡 Server: {server['name']} (ID: {server['id']})")
                    try:
                        embed_link = w32_get_source_link(server["id"])
                        if not embed_link:
                            print(f"      ❌ No embed link returned")
                            continue
                        print(f"      🌐 Embed: {embed_link}")
                        result = extract_generic(embed_link)
                        print_extraction_result(result, server["name"])
                    except Exception as e:
                        print(f"      ❌ Error: {e}")

            except Exception as e:
                print(f"   ❌ Server fetch error: {e}")

    print()


def cmd_search(query):
    """Search Watch32 directly by query string."""
    results = w32_search(query)
    if not results:
        print(f"\n❌ No results for '{query}'")
        return

    print(f"\n🔍 Search results for '{query}' ({len(results)} found):\n")
    for i, r in enumerate(results, 1):
        print(f"   [{i}] {r['title']}")
        print(f"       {r['url']}")
        if r.get("poster"):
            print(f"       🖼️  {r['poster']}")
        print()


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    command = sys.argv[1].lower()

    if command == "movie" and len(sys.argv) >= 3:
        cmd_movie(sys.argv[2])

    elif command == "tv" and len(sys.argv) >= 3:
        tmdb_id = sys.argv[2]
        season = None
        episode = None
        i = 3
        while i < len(sys.argv):
            if sys.argv[i] == "--season" and i + 1 < len(sys.argv):
                season = int(sys.argv[i + 1])
                i += 2
            elif sys.argv[i] == "--episode" and i + 1 < len(sys.argv):
                episode = int(sys.argv[i + 1])
                i += 2
            else:
                i += 1
        cmd_tv(tmdb_id, season, episode)

    elif command == "search" and len(sys.argv) >= 3:
        cmd_search(" ".join(sys.argv[2:]))

    else:
        print(__doc__)


if __name__ == "__main__":
    main()
