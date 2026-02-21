"""
StreamFlix API Test Script
Fetch video links for movies and TV shows by TMDB ID.

Usage:
    python streamflix_test.py movie <tmdb_id>
    python streamflix_test.py tv <tmdb_id> [--season N] [--episode N]
    python streamflix_test.py list
    python streamflix_test.py search <query>
"""

import sys
import os
import json
import re
import time
import requests
import websocket
import threading

# Fix encoding for Windows PowerShell
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

API_BASE = "https://api.streamflix.app"
FIREBASE_WS = "wss://chilflix-410be-default-rtdb.asia-southeast1.firebasedatabase.app/.ws?ns=chilflix-410be-default-rtdb&v=5"
TMDB_IMG = "https://image.tmdb.org/t/p/w500"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
}


# ─── API Fetchers ────────────────────────────────────────────────────────────

def fetch_config():
    """Fetch CDN configuration (premium/movies/tv base URLs)."""
    print("📡 Fetching config...")
    resp = requests.get(f"{API_BASE}/config/config-streamflixapp.json", headers=HEADERS, timeout=30)
    resp.raise_for_status()
    config = resp.json()
    print(f"   ✅ Config loaded — {len(config.get('premium', []))} premium CDNs, "
          f"{len(config.get('movies', []))} movie CDNs, {len(config.get('tv', []))} tv CDNs")
    return config


def fetch_catalog():
    """Fetch the full content catalog."""
    print("📡 Fetching catalog...")
    resp = requests.get(f"{API_BASE}/data.json", headers=HEADERS, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    items = data.get("data", [])
    movies = [i for i in items if not i.get("isTV")]
    shows = [i for i in items if i.get("isTV")]
    print(f"   ✅ Catalog loaded — {len(movies)} movies, {len(shows)} TV shows ({len(items)} total)")
    return items


def find_by_tmdb(items, tmdb_id):
    """Find a catalog item by its TMDB ID."""
    tmdb_str = str(tmdb_id)
    for item in items:
        if str(item.get("tmdb", "")) == tmdb_str:
            return item
    return None


def find_by_query(items, query):
    """Search catalog items by name."""
    query_lower = query.lower()
    return [i for i in items if query_lower in (i.get("moviename") or "").lower()]


# ─── WebSocket Episode Fetcher ───────────────────────────────────────────────

def fetch_episodes_ws(movie_key, total_seasons=1):
    """
    Connect to Firebase RTDB WebSocket and fetch episode data
    for all seasons of a TV show.
    """
    print(f"🔌 Connecting to Firebase WebSocket for '{movie_key}' ({total_seasons} season(s))...")

    seasons_data = {}
    current_season = [1]
    message_buffer = [""]
    done_event = threading.Event()

    def on_open(ws):
        print(f"   ✅ WebSocket connected — requesting season {current_season[0]}")
        request_season(ws, movie_key, current_season[0])

    def request_season(ws, key, season_num):
        req = json.dumps({
            "t": "d",
            "d": {
                "a": "q",
                "r": season_num,
                "b": {
                    "p": f"Data/{key}/seasons/{season_num}/episodes",
                    "h": ""
                }
            }
        })
        ws.send(req)

    def on_message(ws, text):
        # Skip numeric-only messages (expected response count)
        try:
            int(text.strip())
            return
        except ValueError:
            pass

        # Buffer messages until valid JSON
        message_buffer[0] += text
        try:
            msg = json.loads(message_buffer[0])
            message_buffer[0] = ""
        except json.JSONDecodeError:
            if len(message_buffer[0]) > 100_000:
                print("   ⚠️  Message buffer too large, clearing")
                message_buffer[0] = ""
                done_event.set()
            return

        # Process the JSON message
        process_message(ws, msg)

    def process_message(ws, msg):
        if msg.get("t") != "d":
            return

        d = msg.get("d", {})
        b = d.get("b", {})

        # Completion status
        if isinstance(b, dict) and b.get("s") == "ok":
            season = current_season[0]
            ep_count = len(seasons_data.get(season, {}))
            print(f"   ✅ Season {season} complete — {ep_count} episodes")

            if current_season[0] < total_seasons:
                current_season[0] += 1
                print(f"   📡 Requesting season {current_season[0]}...")
                request_season(ws, movie_key, current_season[0])
            else:
                print(f"   ✅ All {total_seasons} season(s) fetched")
                done_event.set()
                ws.close()
            return

        # Episode data
        if isinstance(b, dict) and "d" in b:
            episodes_raw = b["d"]
            path = b.get("p", "")
            season_match = re.search(r"seasons/(\d+)/episodes", path)
            season_num = int(season_match.group(1)) if season_match else current_season[0]

            episode_map = {}
            for key, ep in episodes_raw.items():
                try:
                    episode_map[int(key)] = {
                        "key": ep.get("key", 0),
                        "name": ep.get("name", f"Episode {key}"),
                        "link": ep.get("link", ""),
                        "overview": ep.get("overview", ""),
                        "runtime": ep.get("runtime", 0),
                        "still_path": ep.get("still_path"),
                        "vote_average": ep.get("vote_average", 0.0),
                    }
                except (ValueError, AttributeError):
                    pass

            if episode_map:
                existing = seasons_data.get(season_num, {})
                existing.update(episode_map)
                seasons_data[season_num] = existing
                print(f"   📺 Season {season_num}: received {len(episode_map)} episodes ({len(existing)} total)")

    def on_error(ws, error):
        print(f"   ❌ WebSocket error: {error}")
        done_event.set()

    def on_close(ws, code, reason):
        print(f"   🔌 WebSocket closed ({code}: {reason})")
        done_event.set()

    ws = websocket.WebSocketApp(
        FIREBASE_WS,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )

    ws_thread = threading.Thread(target=ws.run_forever, daemon=True)
    ws_thread.start()

    # Wait up to 30 seconds
    done_event.wait(timeout=30)
    if not done_event.is_set():
        print("   ⚠️  Timeout after 30 seconds")
        ws.close()

    return seasons_data


# ─── Video Link Construction ─────────────────────────────────────────────────

def build_movie_links(config, movie_link):
    """Build video URLs for a movie using CDN config."""
    links = []
    for base_url in config.get("premium", []):
        links.append({"url": base_url + movie_link, "quality": "720p", "tier": "Premium"})
    for base_url in config.get("movies", []):
        links.append({"url": base_url + movie_link, "quality": "480p", "tier": "Movies"})
    return links


def build_tv_links(config, episode_link):
    """Build video URLs for a TV episode using CDN config."""
    links = []
    for base_url in config.get("premium", []):
        links.append({"url": base_url + episode_link, "quality": "720p", "tier": "Premium"})
    for base_url in config.get("tv", []):
        links.append({"url": base_url + episode_link, "quality": "480p", "tier": "TV"})
    return links


# ─── Display Helpers ─────────────────────────────────────────────────────────

def print_item(item, index=None):
    """Pretty-print a catalog item."""
    prefix = f"  [{index}]" if index is not None else "  •"
    name = item.get("moviename", "Unknown")
    year = item.get("movieyear", "?")
    rating = item.get("movierating", 0)
    tmdb = item.get("tmdb", "N/A")
    kind = "📺 TV" if item.get("isTV") else "🎬 Movie"
    duration = item.get("movieduration", "")
    print(f"{prefix} {kind}  {name} ({year})  ⭐{rating}  TMDB:{tmdb}  {duration}")


def print_links(links):
    """Pretty-print video links."""
    if not links:
        print("   ❌ No links found")
        return
    print(f"\n🔗 Found {len(links)} video link(s):\n")
    for i, link in enumerate(links, 1):
        print(f"   [{i}] [{link['tier']}] [{link['quality']}]")
        print(f"       {link['url']}\n")


# ─── CLI Commands ────────────────────────────────────────────────────────────

def cmd_movie(tmdb_id):
    """Fetch video links for a movie by TMDB ID."""
    config = fetch_config()
    catalog = fetch_catalog()

    item = find_by_tmdb(catalog, tmdb_id)
    if not item:
        print(f"\n❌ No movie found with TMDB ID: {tmdb_id}")
        print("   Tip: Use 'python streamflix_test.py list' to see available content")
        return

    if item.get("isTV"):
        print(f"\n⚠️  TMDB ID {tmdb_id} is a TV show, not a movie. Use: python streamflix_test.py tv {tmdb_id}")
        return

    print(f"\n🎬 Found movie:")
    print_item(item)
    print(f"   📝 {item.get('moviedesc', 'No description')[:120]}...")
    print(f"   🖼️  Poster: {TMDB_IMG}/{item.get('movieposter', '')}")

    movie_link = item.get("movielink", "")
    if not movie_link:
        print("\n❌ No movie link available in catalog data")
        return

    print(f"\n📁 Relative path: {movie_link}")
    links = build_movie_links(config, movie_link)
    print_links(links)


def cmd_tv(tmdb_id, season_filter=None, episode_filter=None):
    """Fetch video links for a TV show by TMDB ID."""
    config = fetch_config()
    catalog = fetch_catalog()

    item = find_by_tmdb(catalog, tmdb_id)
    if not item:
        print(f"\n❌ No TV show found with TMDB ID: {tmdb_id}")
        print("   Tip: Use 'python streamflix_test.py list' to see available content")
        return

    if not item.get("isTV"):
        print(f"\n⚠️  TMDB ID {tmdb_id} is a movie, not a TV show. Use: python streamflix_test.py movie {tmdb_id}")
        return

    print(f"\n📺 Found TV show:")
    print_item(item)
    print(f"   📝 {item.get('moviedesc', 'No description')[:120]}...")

    # Parse season count from duration
    duration = item.get("movieduration", "")
    season_match = re.search(r"(\d+)\s+Season", duration)
    total_seasons = int(season_match.group(1)) if season_match else 1
    print(f"   📊 Detected {total_seasons} season(s) from duration: '{duration}'")

    movie_key = item.get("moviekey", "")
    if not movie_key:
        print("\n❌ No movie key available")
        return

    # Fetch episodes via WebSocket
    seasons = fetch_episodes_ws(movie_key, total_seasons)

    if not seasons:
        print("\n❌ No episodes found via WebSocket")
        return

    # Display episodes and build links
    total_eps = sum(len(eps) for eps in seasons.values())
    print(f"\n📋 Total: {total_eps} episodes across {len(seasons)} season(s)\n")

    for season_num in sorted(seasons.keys()):
        episodes = seasons[season_num]

        if season_filter is not None and season_num != season_filter:
            continue

        print(f"{'─' * 60}")
        print(f"  Season {season_num} ({len(episodes)} episodes)")
        print(f"{'─' * 60}")

        for ep_key in sorted(episodes.keys()):
            ep = episodes[ep_key]

            if episode_filter is not None and (ep_key + 1) != episode_filter:
                continue

            ep_num = ep_key + 1  # 0-indexed → 1-indexed
            ep_name = ep.get("name", f"Episode {ep_num}")
            ep_rating = ep.get("vote_average", 0)
            ep_runtime = ep.get("runtime", 0)
            ep_link = ep.get("link", "")

            print(f"\n  E{ep_num:02d}: {ep_name}  ⭐{ep_rating:.1f}  ⏱️{ep_runtime}min")
            if ep.get("overview"):
                print(f"       {ep['overview'][:100]}...")

            if ep_link:
                print(f"       📁 Path: {ep_link}")
                links = build_tv_links(config, ep_link)
                for link in links:
                    print(f"       🔗 [{link['tier']}] [{link['quality']}] {link['url']}")
            else:
                print(f"       ❌ No episode link available")

    print()


def cmd_list():
    """List all available content in the catalog."""
    catalog = fetch_catalog()

    movies = [i for i in catalog if not i.get("isTV") and i.get("moviename")]
    shows = [i for i in catalog if i.get("isTV") and i.get("moviename")]

    print(f"\n🎬 Movies ({len(movies)}):\n")
    for i, item in enumerate(movies, 1):
        print_item(item, i)

    print(f"\n📺 TV Shows ({len(shows)}):\n")
    for i, item in enumerate(shows, 1):
        print_item(item, i)

    print(f"\n📊 Total: {len(movies)} movies + {len(shows)} TV shows = {len(catalog)} items")


def cmd_search(query):
    """Search the catalog by name."""
    catalog = fetch_catalog()
    results = find_by_query(catalog, query)

    if not results:
        print(f"\n❌ No results for '{query}'")
        return

    print(f"\n🔍 Search results for '{query}' ({len(results)} found):\n")
    for i, item in enumerate(results, 1):
        print_item(item, i)


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

    elif command == "list":
        cmd_list()

    elif command == "search" and len(sys.argv) >= 3:
        cmd_search(" ".join(sys.argv[2:]))

    else:
        print(__doc__)


if __name__ == "__main__":
    main()
