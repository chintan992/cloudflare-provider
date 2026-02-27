import sys
import requests
import json
import re
import base64
from urllib.parse import urlparse
from bs4 import BeautifulSoup

try:
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import unpad
except ImportError:
    print("Please install pycryptodome: pip install pycryptodome")
    sys.exit(1)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Cookie": "xla=s4t",
    "Referer": "https://hdhub4u.rehab"
}

def search(query):
    print(f"\n[*] Searching for: {query}")
    url = f"https://search.pingora.fyi/collections/post/documents/search?q={query}&query_by=post_title,category&query_by_weights=4,2&sort_by=sort_by_date:desc&limit=15&highlight_fields=none&use_cache=true&page=1"
    response = requests.get(url, headers=HEADERS)
    if response.status_code != 200:
        print(f"Search API failed with {response.status_code}")
        return []
    
    hits = response.json().get("hits", [])
    return [hit["document"] for hit in hits]

def pen(val):
    res = ""
    for c in val:
        if 'A' <= c <= 'Z':
            res += chr(((ord(c) - ord('A') + 13) % 26) + ord('A'))
        elif 'a' <= c <= 'z':
            res += chr(((ord(c) - ord('a') + 13) % 26) + ord('a'))
        else:
            res += c
    return res

def get_redirect_links(url):
    try:
        response = requests.get(url, headers=HEADERS)
        doc = response.text
        regex = re.compile(r"s\('o','([A-Za-z0-9+/=]+)'\)|ck\('_wp_http_\d+','([^']+)'\)")
        matches = regex.findall(doc)
        
        combined = ""
        for match in matches:
            combined += match[0] if match[0] else match[1]
        
        if not combined:
            return url
        
        step1 = base64.b64decode(combined).decode('utf-8')
        step2 = base64.b64decode(step1).decode('utf-8')
        step3 = pen(step2)
        decoded_string = base64.b64decode(step3).decode('utf-8')
        
        json_obj = json.loads(decoded_string)
        encodedurl = json_obj.get("o", "")
        if encodedurl:
            return base64.b64decode(encodedurl).decode('utf-8').strip()
            
        data_encoded = json_obj.get("data", "")
        if data_encoded:
            data = base64.b64decode(data_encoded).decode('utf-8').strip()
            wphttp1 = json_obj.get("blog_url", "").strip()
            directlink_url = f"{wphttp1}?re={data}"
            dl_resp = requests.get(directlink_url, headers=HEADERS)
            soup = BeautifulSoup(dl_resp.text, 'html.parser')
            if soup.body:
                return soup.body.text.strip()
    except Exception as e:
        print(f"[!] Error resolving redirect: {e}")
    return url

def extract_vidstack(url):
    try:
        hash_val = url.split("#")[-1].split("/")[-1]
        baseurl = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
        api_url = f"{baseurl}/api/v1/video?id={hash_val}"
        
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0"}
        encoded = requests.get(api_url, headers=headers).text.strip()
        
        key = b"kiemtienmua911ca"
        iv_list = [b"1234567890oiuytr", b"0123456789abcdef"]
        
        input_bytes = bytes.fromhex(encoded)
        decrypted_text = None
        for iv in iv_list:
            try:
                cipher = AES.new(key, AES.MODE_CBC, iv)
                decrypted_bytes = cipher.decrypt(input_bytes)
                decrypted_text = unpad(decrypted_bytes, AES.block_size).decode('utf-8')
                break
            except Exception:
                continue
                
        if not decrypted_text:
            return "Decryption failed"
            
        m3u8_match = re.search(r'"source":"(.*?)"', decrypted_text)
        if m3u8_match:
            return m3u8_match.group(1).replace('\\/', '/')
            
    except Exception as e:
        print(f"[!] Error in VidStack: {e}")
    return "Source not found"

def extract_hubcloud(url):
    results = []
    try:
        response = requests.get(url, headers=HEADERS)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Check if it's the gateway page
        if "hubcloud.php" not in url:
            download_btn = soup.find(id="download")
            if download_btn:
                href = download_btn.get("href")
                if not href.startswith("http"):
                    baseurl = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
                    url = f"{baseurl}/{href.lstrip('/')}"
                else:
                    url = href
        
        doc_resp = requests.get(url, headers=HEADERS)
        doc_soup = BeautifulSoup(doc_resp.text, 'html.parser')
        
        for a in doc_soup.select("a.btn"):
            link = a.get("href")
            text = a.text.strip()
            results.append({"label": text, "url": link})
    except Exception as e:
        print(f"[!] Error in Hubcloud: {e}")
    return results

def get_movie_links(permalink):
    if not permalink.startswith("http"):
        permalink = "https://hdhub4u.rehab" + permalink
    print(f"\n[*] Fetching page: {permalink}")
    response = requests.get(permalink, headers=HEADERS)
    soup = BeautifulSoup(response.text, 'html.parser')
    
    a_tags = soup.select("h3 a, h4 a, .page-body > div a")
    
    allowed_domains = re.compile(r"https://(.*\.)?(hdstream4u|hubstream|hblinks|hubcdn|hubdrive)\..*")
    
    extracted = []
    for tag in a_tags:
        href = tag.get("href")
        if href and allowed_domains.search(href):
            extracted.append(href)
    
    extracted = list(set(extracted))
    print(f"[*] Found {len(extracted)} potential source links.")
    
    for link in extracted:
        try:
            # Resolve obfuscated ?id= links
            if "?id=" in link:
                final_link = get_redirect_links(link)
            else:
                final_link = link
                
            print(f"\n=> Source: {final_link}")
            
            if final_link and ("hubdrive" in final_link.lower() or "hubcloud" in final_link.lower()):
                if "hubdrive" in final_link.lower():
                    hd_resp = requests.get(final_link, headers=HEADERS)
                    hd_soup = BeautifulSoup(hd_resp.text, 'html.parser')
                    btn = hd_soup.find("a", class_="btn btn-primary btn-user btn-success1 m-1")
                    if btn and btn.get("href"):
                        final_link = btn.get("href")
                
                if final_link and "hubcloud" in final_link.lower():
                    links = extract_hubcloud(final_link)
                    for l in links:
                        print(f"   - [{l['label']}] {l['url']}")
            elif final_link and ("vidstack" in final_link.lower() or "hubstream" in final_link.lower()):
                m3u8 = extract_vidstack(final_link)
                print(f"   - [VidStack/Hubstream M3U8] {m3u8}")
            else:
                print(f"   - Needs matching extractor")
        except Exception as e:
            print(f"   [!] Error processing {link}: {e}")
            import traceback
            traceback.print_exc()

def main():
    print("=== HDHub4u Link Scraper ===")
    query = input("Enter Movie/TV Show to search: ")
    docs = search(query)
    
    if not docs:
        print("No results found.")
        return
        
    print()
    for i, doc in enumerate(docs):
        print(f"[{i}] {doc.get('post_title')} ({doc.get('post_date')})")
        
    choice = input("\nSelect a title number (or 'q' to quit): ")
    if choice.lower() == 'q':
        return
        
    try:
        idx = int(choice)
        selected = docs[idx]
        get_movie_links(selected.get("permalink"))
    except (ValueError, IndexError):
        print("Invalid choice.")

if __name__ == "__main__":
    main()


"""
Tv Show response -->
```
python hdhub4u_scraper.py
=== HDHub4u Link Scraper ===
Enter Movie/TV Show to search: game of thrones

[*] Searching for: game of thrones
Search API failed with 403
No results found.
(venv) PS C:\Users\chint\StudioProjects\CNCVerse-Cloud-Stream-Extension\HDhub4u> python hdhub4u_scraper.py
=== HDHub4u Link Scraper ===
Enter Movie/TV Show to search: game of thrones

[*] Searching for: game of thrones

[0] [18+] Game of Thrones (Season 8) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 7, 2023)
[1] [18+] Game of Thrones (Season 7) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 6, 2023)
[2] [18+] Game of Thrones (Season 6) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 6, 2023)
[3] [18+] Game of Thrones (Season 5) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 5, 2023)
[4] [18+] Game of Thrones (Season 4) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 5, 2023)
[5] [18+] Game of Thrones (Season 3) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 4, 2023)
[6] [18+] Game of Thrones (Season 2) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 4, 2023)
[7] [18+] Game of Thrones (Season 1) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 3, 2023)

Select a title number (or 'q' to quit): 1

[*] Fetching page: /game-of-thrones-season-7-hindi-bluray-all-episodes/
Invalid choice.
(venv) PS C:\Users\chint\StudioProjects\CNCVerse-Cloud-Stream-Extension\HDhub4u> python hdhub4u_scraper.py
=== HDHub4u Link Scraper ===
Enter Movie/TV Show to search: game of thrones

[*] Searching for: game of thrones

[0] [18+] Game of Thrones (Season 8) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 7, 2023)
[1] [18+] Game of Thrones (Season 7) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 6, 2023)
[2] [18+] Game of Thrones (Season 6) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 6, 2023)
[3] [18+] Game of Thrones (Season 5) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 5, 2023)
[4] [18+] Game of Thrones (Season 4) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 5, 2023)
[5] [18+] Game of Thrones (Season 3) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 4, 2023)
[6] [18+] Game of Thrones (Season 2) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 4, 2023)
[7] [18+] Game of Thrones (Season 1) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 3, 2023)

Select a title number (or 'q' to quit): 7

[*] Fetching page: https://hdhub4u.rehab/game-of-thrones-season-1-hindi-org-bluray-all-episodes/     
[*] Found 20 potential source links.

=> Source: https://hubcdn.fans/file/evEbcBZIAFflwd49srU2vpXHX
   - Needs matching extractor

=> Source: https://hubdrive.space/file/1698968780
Traceback (most recent call last):
  File "C:\Users\chint\StudioProjects\CNCVerse-Cloud-Stream-Extension\HDhub4u\hdhub4u_scraper.py", line 215, in <module>
    main()
  File "C:\Users\chint\StudioProjects\CNCVerse-Cloud-Stream-Extension\HDhub4u\hdhub4u_scraper.py", line 210, in main
    get_movie_links(selected.get("permalink"))
  File "C:\Users\chint\StudioProjects\CNCVerse-Cloud-Stream-Extension\HDhub4u\hdhub4u_scraper.py", line 176, in get_movie_links
    btn = hd_soup.select_first(".btn.btn-primary.btn-user.btn-success1.m-1")
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
TypeError: 'NoneType' object is not callable
(venv) PS C:\Users\chint\StudioProjects\CNCVerse-Cloud-Stream-Extension\HDhub4u> python hdhub4u_scraper.py
=== HDHub4u Link Scraper ===
Enter Movie/TV Show to search: game of thrones

[*] Searching for: game of thrones

[0] [18+] Game of Thrones (Season 8) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 7, 2023)
[1] [18+] Game of Thrones (Season 7) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 6, 2023)
[2] [18+] Game of Thrones (Season 6) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 6, 2023)
[3] [18+] Game of Thrones (Season 5) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 5, 2023)
[4] [18+] Game of Thrones (Season 4) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 5, 2023)
[5] [18+] Game of Thrones (Season 3) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 4, 2023)
[6] [18+] Game of Thrones (Season 2) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 4, 2023)
[7] [18+] Game of Thrones (Season 1) BluRay [Hindi (ORG 2.0) & English 5.1] 1080p 720p & 480p [x264/10Bit-HEVC] | TVSeries [ALL Episodes] (November 3, 2023)

Select a title number (or 'q' to quit): 7

[*] Fetching page: https://hdhub4u.rehab/game-of-thrones-season-1-hindi-org-bluray-all-episodes/     
[*] Found 20 potential source links.

=> Source: https://hubdrive.space/file/1698968788
   - [Download [FSLv2 Server]] https://cdn.fsl-buckets.work/Game.of.Thrones.S01E02.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=6240d5c868278f3254c28ffd7a44e6dc
   - [Download [FSL Server]] https://hub.oreao-cdn.buzz/3fe575de26b2829a469077216464db44?token=1771984799
   - [Download [Server : 10Gbps]] https://pixel.hubcdn.fans/?id=3cb449b1300336c225305c782f4dbc51768ce7dd193b550abfb4f473f7a19262152f4b2d04a74c589cd35d431323966b8fb245037bd9900eb1846ab1150f5c7d50b4cdfd7e6b7c80fb19140c3483f49e2339b15a94b457c43dcc7290748a6ed8::1c9d1040742d15e0a1d47ca835dfc27b
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/tKvH29T6
   - [Downoad From Telegram] https://www-google-com.cdn.ampproject.org/c/s/bloggingvector.shop/foo/aHR0cHM6Ly93d3ctZ29vZ2xlLWNvbS5jZG4uYW1wcHJvamVjdC5vcmcvYy9zL25ld3NvbmdzLmNvLmluL2dvP2lkPTNPZnAzZHl1b3FUaHp1RFkzTi9LNGFIWjNOQ2p1K3JQek9EaTZ0SGgyTlhrNGFqbjU5YmYzYkhEek9HK3lPM0R2N3U1cTZhL3dlVEN3cDIvcXNxOTNkUEd1SzNrdXN2anc4ZlV2cmpKMjlXNjJPQ2htc2pMNWJ6T3ljbTZ3Y0hZdWN1eTRMRT0=

=> Source: https://hubcdn.fans/file/hNpgayyyQJcCSr3qTrqR2S5En
   - Needs matching extractor

=> Source: https://hubdrive.space/file/1698968782
   - [Download [FSLv2 Server]] https://fsl.gigabytes.icu/Game.of.Thrones.S01E07.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=43f7e517061c91a5630170c2ed5f17c7
   - [Download [FSL Server]] https://pub-b5ecaffddf2344a0ae2222f5e8913e1b.r2.dev/Game.of.Thrones.S01E07.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=1771984803
   - [Download [Server : 10Gbps]] https://pixel.hubcdn.fans/?id=83e0fbfdbcf5df7df723c909378e4cb5b61e32a0028c011569bacd4d3cec69a4d2b3539ffbbe48490293e0c0f2716834b1c60dde002585b3d4546dd0118fa88a952ea0acf84f010c5d40f8d6b44e8da0d8e2508c52a451b4eaf7495155dedcbc::20fa75f8b9fe3e71fb6ba351bbe010a5
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/gvqXojcE
   - [Downoad From Telegram] https://www-google-com.cdn.ampproject.org/c/s/bloggingvector.shop/foo/aHR0cHM6Ly93d3ctZ29vZ2xlLWNvbS5jZG4uYW1wcHJvamVjdC5vcmcvYy9zL25ld3NvbmdzLmNvLmluL2dvP2lkPTNPZnAzZHl1b3FUaHp1RFkzTi9LNGFIWjNOQ2p1K3JQek9EaTZ0SGgyTlhrNGFqbjU5YmYzYkhEeXRtdXlNZkh2N3U1cTZhL3dlVEN3cDIvcXNxNXU5Zkd1S25rdXN2anc4ZlV2cmpKMjlXNjJPQ2htc2pMNWJ6T3ljbTZ3Y0hZdWN1eTRMRT0=

=> Source: https://hubcdn.fans/file/SqL5NzCADkFHaOK0lAQWhW1NY
   - Needs matching extractor

=> Source: https://hubcdn.fans/file/evEbcBZIAFflwd49srU2vpXHX
   - Needs matching extractor

=> Source: https://hubdrive.space/file/1698968783
   - [Download [FSLv2 Server]] https://cdn.fsl-buckets.life/Game.of.Thrones.S01E06.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=43f7e517061c91a5630170c2ed5f17c7
   - [Download [FSL Server]] https://hub.oreao-cdn.buzz/6ff1941d0b2dccb6bc0e094ed16ac454?token=1771984806
   - [Download [Server : 10Gbps]] https://pixel.hubcdn.fans/?id=2ab3faff1cf47e73b19715f71ed2fd1f18fc7b8f211a44efd9ed03d8cd612d1e91f0fed78f10597c713c3a396e3cc3a86fd68a3e41dfd5ce0f41a8783240475e7e2ba2451950fbc09f2246027899c0ba0fa2608cd82875c454c18a0eb2d39166::cb99caf87d998750259548db7693f386
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/rRZav43T
   - [Downoad From Telegram] https://www-google-com.cdn.ampproject.org/c/s/bloggingvector.shop/foo/aHR0cHM6Ly93d3ctZ29vZ2xlLWNvbS5jZG4uYW1wcHJvamVjdC5vcmcvYy9zL25ld3NvbmdzLmNvLmluL2dvP2lkPTNPZnAzZHl1b3FUaHp1RFkzTi9LNGFIWjNOQ2p1K3JQek9EaTZ0SGgyTlhrNGFqbjU5YmYzYkhEeTltdXlNZkh2N3U1cTZhL3dlVEN3cDIvcXNxOTNidkt1S1hsdXN2anc4ZlV2cmpKMjlXNjJPQ2htc2pMNWJ6T3ljbTZ3Y0hZdWN1eTRMRT0=

=> Source: https://hubcdn.fans/file/UVkij24RgKVKniJboHucS9o8N
   - Needs matching extractor

=> Source: https://hubcdn.fans/file/PqKIaqUl0zQyxHsyFrEEHNWDJ
   - Needs matching extractor

=> Source: https://hubdrive.space/file/1698968785
   - [Download [FSLv2 Server]] https://cdn.fsl-buckets.work/Game.of.Thrones.S01E05.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=43f7e517061c91a5630170c2ed5f17c7
   - [Download [FSL Server]] https://pub-b5ecaffddf2344a0ae2222f5e8913e1b.r2.dev/Game.of.Thrones.S01E05.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=1771984810
   - [Download [Server : 10Gbps]] https://pixel.hubcdn.fans/?id=b22995829827c79b00046362925f4af1fe74be56dfd968e405218656db5014f2929b3109e30462cb7d088bfee7e78adeaa06b42d0749b1b422681d6a6b502a9894c691f4ed4a6c8b67e449ff7566df6f0ed578f052fb9c90cffd54d197e21f80::1bc846925faece0f40f331a70ea9a587
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/pZGFhiBj
   - [Downoad From Telegram] https://www-google-com.cdn.ampproject.org/c/s/bloggingvector.shop/foo/aHR0cHM6Ly93d3ctZ29vZ2xlLWNvbS5jZG4uYW1wcHJvamVjdC5vcmcvYy9zL25ld3NvbmdzLmNvLmluL2dvP2lkPTNPZnAzZHl1b3FUaHp1RFkzTi9LNGFIWjNOQ2p1K3JQek9EaTZ0SGgyTlhrNGFqbjU5YmYzYkhEeXJPK3lNZkh2N3U1cTZhL3dlVEN3cDIvcXNxOTNkUEd1S1hsdXN2anc4ZlV2cmpKMjlXNjJPQ2htc2pMNWJ6T3ljbTZ3Y0hZdWN1eTRMRT0=

=> Source: https://hubcdn.fans/file/8YRSrGgFk1X5Nx8gqSObvAxT5
   - Needs matching extractor

=> Source: https://hubdrive.space/file/1698968789
   - [Download [FSLv2 Server]] https://cdn.fsl-buckets.work/Game.of.Thrones.S01E01.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=43f7e517061c91a5630170c2ed5f17c7
   - [Download [FSL Server]] https://pub-b5ecaffddf2344a0ae2222f5e8913e1b.r2.dev/Game.of.Thrones.S01E01.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=1771984814
   - [Download [Server : 10Gbps]] https://pixel.hubcdn.fans/?id=06a8e3dfba08b39a2d8db9861362bc85e8cd81cb8cc4aa6c3a2749894cd33e89f7056d95744f7aacf9003b72189b2d803112e33e0f2fbb9c87c7b90c38815182c32fff13fe3bbb2e8562d8d84ad748e362dbfc5edc9c91d03a48462ad2c6bb77::0f85d31e547fb7053418c98e3aa5b6d0
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/GZoBKgsp
   - [Downoad From Telegram] https://www-google-com.cdn.ampproject.org/c/s/bloggingvector.shop/foo/aHR0cHM6Ly93d3ctZ29vZ2xlLWNvbS5jZG4uYW1wcHJvamVjdC5vcmcvYy9zL25ld3NvbmdzLmNvLmluL2dvP2lkPTNPZnAzZHl1b3FUaHp1RFkzTi9LNGFIWjNOQ2p1K3JQek9EaTZ0SGgyTlhrNGFqbjU5YmYzYkhEeXA2K3lNZkh2N3U1cTZhL3dlVEN3cDIvcXNxNXc5dkd1S25rdXN2anc4ZlV2cmpKMjlXNjJPQ2htc2pMNWJ6T3ljbTZ3Y0hZdWN1eTRMRT0=

=> Source: https://hubdrive.space/file/1698968780
   - [Download [FSLv2 Server]] https://cdn.fukggl.buzz/Game.of.Thrones.S01E09.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=43f7e517061c91a5630170c2ed5f17c7
   - [Download [FSL Server]] https://pub-b5ecaffddf2344a0ae2222f5e8913e1b.r2.dev/Game.of.Thrones.S01E09.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=1771984817
   - [Download [Server : 10Gbps]] https://pixel.hubcdn.fans/?id=4f7e827772a5e40503055a0658441ab635c6b186e1367f87c3a8b7f1293fdd9ceee76c69127e274d520254495c7d1c19f0a6104ffaf4bef824af9f2ab0e47583f3df2605ac089326cdccafbba0806d70bb0dedb6e1d5ff27c8608d6245d0f9cb::324c8d1a6104310661cfffe0c0655e67
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/SsyZiLd2
   - [Downoad From Telegram] https://www-google-com.cdn.ampproject.org/c/s/bloggingvector.shop/foo/aHR0cHM6Ly93d3ctZ29vZ2xlLWNvbS5jZG4uYW1wcHJvamVjdC5vcmcvYy9zL25ld3NvbmdzLmNvLmluL2dvP2lkPTNPZnAzZHl1b3FUaHp1RFkzTi9LNGFIWjNOQ2p1K3JQek9EaTZ0SGgyTlhrNGFqbjU5YmYzYkhEekx1K3lNZkh2N3U1cTZhL3dlVEN3cDIvcXNxNXc3UEt1S1hsdXN2anc4ZlV2cmpKMjlXNjJPQ2htc2pMNWJ6T3ljbTZ3Y0hZdWN1eTRMRT0=

=> Source: https://hubcdn.fans/file/QqXgspiRimqBGEGnyKq2tD1Mx
   - Needs matching extractor

=> Source: https://hubcdn.fans/file/phg8xUcp6Z0FgB5HBo8lgp3Cj
   - Needs matching extractor

=> Source: https://hubcdn.fans/file/Q4qqdhvrz289f69GNlT8bWEi0
   - Needs matching extractor

=> Source: https://hubcdn.fans/file/1HhSvjrJnrWbZv3jUHFHfROzO
   - Needs matching extractor

=> Source: https://hubdrive.space/file/1698968781
   - [Download [FSLv2 Server]] https://cdn.fsl-buckets.life/Game.of.Thrones.S01E08.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=43f7e517061c91a5630170c2ed5f17c7
   - [Download [FSL Server]] https://pub-b5ecaffddf2344a0ae2222f5e8913e1b.r2.dev/Game.of.Thrones.S01E08.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=1771984821
   - [Download [Server : 10Gbps]] https://pixel.hubcdn.fans/?id=36aa4fe5a0cbd2c1034717ad464a0173ebde8102ab28bd348e109fe908273b1528cb202db91d26652423647334851375fcab4921e663063000062f1a7561487e0492e59e9e5a40609ec29ab2cfa67bdcaeeb32fa2402992c04446aff00cc04ff::bbabed7d35519656875c28846ba8a731
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/NuLB8NYc
   - [Downoad From Telegram] https://www-google-com.cdn.ampproject.org/c/s/bloggingvector.shop/foo/aHR0cHM6Ly93d3ctZ29vZ2xlLWNvbS5jZG4uYW1wcHJvamVjdC5vcmcvYy9zL25ld3NvbmdzLmNvLmluL2dvP2lkPTNPZnAzZHl1b3FUaHp1RFkzTi9LNGFIWjNOQ2p1K3JQek9EaTZ0SGgyTlhrNGFqbjU5YmYzYkhEeXNQYXlNZkh2N3U1cTZhL3dlVEN3cDIvcXNxOTFjUEd1S25rdXN2anc4ZlV2cmpKMjlXNjJPQ2htc2pMNWJ6T3ljbTZ3Y0hZdWN1eTRMRT0=

=> Source: https://hubdrive.space/file/1698968779
   - [Download [FSLv2 Server]] https://cdn.fsl-buckets.work/Game.of.Thrones.S01E10.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=43f7e517061c91a5630170c2ed5f17c7
   - [Download [FSL Server]] https://hub.oreao-cdn.buzz/0036c6481e7fc65862fb2585ec3db630?token=1771984825
   - [Download [Server : 10Gbps]] https://pixel.hubcdn.fans/?id=10efc326cf268eebe7d18b9585dd49977a6e615dd91f272ddef08aed89be607099742dc3a040f7c65f9e96dd4b5b95f948bb12341363f9b0497001dda2ceb3f5923fac7130fec6fa48955474c1ce27944af1fb7e0429e9032bf001faa1a4a9ac::1469d9d8036487c9becf428875f5178f
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/r1ThKvdZ
   - [Downoad From Telegram] https://www-google-com.cdn.ampproject.org/c/s/bloggingvector.shop/foo/aHR0cHM6Ly93d3ctZ29vZ2xlLWNvbS5jZG4uYW1wcHJvamVjdC5vcmcvYy9zL25ld3NvbmdzLmNvLmluL2dvP2lkPTNPZnAzZHl1b3FUaHp1RFkzTi9LNGFIWjNOQ2p1K3JQek9EaTZ0SGgyTlhrNGFqbjU5YmYzYkhEeThQYXlNZkh2N3U1cTZhL3dlVEN3cDIvcXNxOTFiZkt1S25rdXN2anc4ZlV2cmpKMjlXNjJPQ2htc2pMNWJ6T3ljbTZ3Y0hZdWN1eTRMRT0=

=> Source: https://hubdrive.space/file/1698968786
   - [Download [FSLv2 Server]] https://cdn.fsl-buckets.work/Game.of.Thrones.S01E04.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=43f7e517061c91a5630170c2ed5f17c7
   - [Download [FSL Server]] https://pub-b5ecaffddf2344a0ae2222f5e8913e1b.r2.dev/Game.of.Thrones.S01E04.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=1771984829
   - [Download [Server : 10Gbps]] https://pixel.hubcdn.fans/?id=9f361efd50bb8f3420d8591865db8dc79dd4ff9015ba17315889950741f564f6cffe69ad02d4c4203a8450446aecc7d73d7f574aaa6000efc5cafddb4e6fde89aaa5cb22edfd357813026a7a1f0d6f9b90993a1d0ac6604578580abfe8970450::371e2d338382a801ece4a6be50badb92
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/pVvTV2sK
   - [Download [ZipDisk Server]] https://ddl2.telew36983.workers.dev/1397955525/8412d61baac97a9f18f24c000a4b16f9dd7ed6d253efdd28f9e2f494ce4a33ca00cc817c1f367b82552812cbe41e31add4119c799dbcc3bcb065bb90431f0996581007eb7752faed3857fd77ac10bfcac67eef1912427d8177189510af86883343b654ca553af351863ead00d77e78e8d2194080be6fbe13b57a61445aa09d05a2b24afca716b87d12bda7a0f7e62a94767cb7b38c47a8adee31f8f0ee04c6562698ca89554bb430d6d5a04fc7b67a7c6eabe202f9503b646c2845b6b4362983::cf5cbae84877a895a10cbe161f188bbb/Game.of.Thrones.S01E04.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv.zip
   - [Downoad From Telegram] https://www-google-com.cdn.ampproject.org/c/s/bloggingvector.shop/foo/aHR0cHM6Ly93d3ctZ29vZ2xlLWNvbS5jZG4uYW1wcHJvamVjdC5vcmcvYy9zL25ld3NvbmdzLmNvLmluL2dvP2lkPTNPZnAzZHl1b3FUaHp1RFkzTi9LNGFIWjNOQ2p1K3JQek9EaTZ0SGgyTlhrNGFqbjU5YmYzYkhEek9IYXlNZkh2N3U1cTZhL3dlVEN3cDIvcXNxNXU2dkt1S25rdXN2anc4ZlV2cmpKMjlXNjJPQ2htc2pMNWJ6T3ljbTZ3Y0hZdWN1eTRMRT0=

=> Source: https://hubdrive.space/file/1698968787
   - [Download [FSLv2 Server]] https://cdn.fukggl.buzz/Game.of.Thrones.S01E03.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv?token=43f7e517061c91a5630170c2ed5f17c7
   - [Download [Server : 10Gbps]] https://pixel.hubcdn.fans/?id=46d2652511cd780c886828edcfb1b32b4cb45be5551b01d40deac3e3371d80f599e17674b87a8ac9ad3a10d362f882aabc89f3db951c95aa1f20e4750224976e67a5318ac72f76a6ed26db6d8f596a48448faab3e4078a8fe93a0acbd0dfc3db::1f96fa68d8309bd84e7cc75db652132b
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/pUUXd9BL
   - [Download File [491.88 MB]] https://pub-a78eab7486814d6ebe7b13051db39fa6.r2.dev/Game.of.Thrones.S01E03.720p.10Bit.BluRay.Hindi.ORG.2.0-English.HEVC.x265-HDHub4u.Tv.mkv
   - [Downoad From Telegram] https://www-google-com.cdn.ampproject.org/c/s/bloggingvector.shop/foo/aHR0cHM6Ly93d3ctZ29vZ2xlLWNvbS5jZG4uYW1wcHJvamVjdC5vcmcvYy9zL25ld3NvbmdzLmNvLmluL2dvP2lkPTNPZnAzZHl1b3FUaHp1RFkzTi9LNGFIWjNOQ2p1K3JQek9EaTZ0SGgyTlhrNGFqbjU5YmYzYkhEeXRtZnlNZkh2N3U1cTZhL3dlVEN3cDIvcXNxNXc3UEt1SzNrdXN2anc4ZlV2cmpKMjlXNjJPQ2htc2pMNWJ6T3ljbTZ3Y0hZdWN1eTRMRT0=
```


Movie Response -->

```
python hdhub4u_scraper.py
=== HDHub4u Link Scraper ===
Enter Movie/TV Show to search: mercy

[*] Searching for: mercy

[0] Mercy (2026) WEB-DL [Hindi (DD5.1) & English] 4K 1080p 720p & 480p Dual Audio [x264/10Bit-HEVC] | Full Movie (February 17, 2026)
[1] Mercy for None (Season 1) WEB-DL [Hindi (DD5.1) & English] 1080p 720p & 480p [x264/10Bit-HEVC] | [ALL Episodes] | NF Series (June 6, 2025)
[2] Mercy (2023) WEB-DL [Hindi (ORG 5.1) + English] 1080p 720p & 480p Dual Audio [x264/10Bit-HEVC] | Full Movie (March 4, 2024)
[3] WWE No Mercy 24th September 2017 PPV WEBRip 480p 800MB (September 25, 2017)

Select a title number (or 'q' to quit): 0

[*] Fetching page: https://hdhub4u.rehab/mercy-2026-hindi-webrip-full-movie/
[*] Found 7 potential source links.

=> Source: https://hubcdn.fans/file/mtpwLDOrJx3u6LxPubD0DbYqX
   - Needs matching extractor

=> Source: https://hubstream.art/#i9dv9b
   - [VidStack/Hubstream M3U8] https://203.188.166.12/v4/HdcskD-MEXbGPG8CeT4PqA/1772002433/sc/i9dv9b/master.m3u8?v=1771324171

=> Source: https://hubdrive.space/file/14503472807
   - [Download [FSLv2 Server]] https://cdn.fsl-buckets.life/Mercy.2026.2160p.iT.WEB-DL.MULTi.DDP5.1.Atmos.H.265-4kHDHub.Com.mkv?token=43f7e517061c91a5630170c2ed5f17c7
   - [Download [FSL Server]] https://pub-34413a7eec4f40c883aa01fe9d524f5c.r2.dev/eef8b685b647dd9e7bb0f5aa9048cb9c?token=1771988087
   - [Download [Server : 10Gbps]] https://gpdl.hubcdn.fans/?id=72cf164cbd5c5a13a918adb7d8586ff68b93475be7c30db1c825472cbf368e8f14f8007caccba412be9eff93053fcf39e3023747e82b154c01ad7d9b2bbf94e10cceec4cda3894c5ce5b205a9a3faa5819c4f341a277330b9ee0cd3ae69d04c3459b38a2291c6fef3c2763d91885416a::44f9b767b034ee29209e262e3b2965d0

=> Source: https://hubdrive.space/file/2097587254
   - [Download [FSLv2 Server]] https://cdn.fsl-buckets.work/Mercy.2026.720p.10Bit.WEB-DL.Hindi.5.1-English.5.1.HEVC.x265-HDHub4u.Ms.mkv?token=a6dcbfbe1c59423044d4296bfe675f8d
   - [Download [FSL Server]] https://pub-34413a7eec4f40c883aa01fe9d524f5c.r2.dev/2b0cb226592b79801bca5fd0b2b18c9a?token=1771992439
   - [Download [Server : 10Gbps]] https://gpdl.hubcdn.fans/?id=346d6c967bd3715e5ceeda3bb4ebe2c4d5ec456d9e23400d46d1e6597cac712d710e34dbbd94d5361870533b8800e0602ce3f92ec36d12309996fbf58906c82698dbbea106db8bb458475d676dabec43400824d6d4065b321222356af850b1c466ecc4007f69b364e073f3b9388a476d::981287cbf21d3c64b43a59f5d54fe4c6
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/4v2d5VWb
   - [Downoad From Telegram] https://www-google-com.cdn.ampproject.org/c/s/bloggingvector.shop/foo/aHR0cHM6Ly93d3ctZ29vZ2xlLWNvbS5jZG4uYW1wcHJvamVjdC5vcmcvYy9zL25ld3NvbmdzLmNvLmluL2dvP2lkPTNPZnAzZHl1b3FUaHp1RFkzTi9LNGFIWjNOQ2p1K3JQek9EaTZ0SGgyTlhrNGFqbjU5YmYzYkhEek9HZnlNZTN0Nys1cTZhL3dlVEN3cDIvcXNxOTJhdlYzcWFndThyRnhjZlV2cmpKMjlXNjJPQ2htc2pMNWJ6T3ljbTZ3Y0hZdWN1eTRMRT0=

=> Source: https://hdstream4u.com/file/rff8k1m2r4mr
   - Needs matching extractor

=> Source: https://hubdrive.space/file/3532653187
   - [Download [FSLv2 Server]] https://cdn.fukggl.buzz/Mercy.2026.1080p.10Bit.WEB-DL.Hindi.5.1-English.5.1.HEVC.x265-HDHub4u.Ms.mkv?token=a6dcbfbe1c59423044d4296bfe675f8d
   - [Download [FSL Server]] https://pub-34413a7eec4f40c883aa01fe9d524f5c.r2.dev/93c8dbf6bc88a08383fd6219bb3a392b?token=1771992442
   - [Download [Server : 10Gbps]] https://pixel.hubcdn.fans/?id=4b92a5e9f5fbc1ff8af1ddfb9d04288548a0aa704b903620aa455fabdaf0267276c90e560006c7d3cc62b40ead2c3d95d563773b42f8b47362f4f793a27fd204570bc3f2832cc96060ba9d79447db355d8fd84734d00d7f68470dc536142e345::0ce5b57d83c7f5f1798c16407fade37c
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/rMJooFQu
   - [Downoad From Telegram] https://www-google-com.cdn.ampproject.org/c/s/bloggingvector.shop/foo/aHR0cHM6Ly93d3ctZ29vZ2xlLWNvbS5jZG4uYW1wcHJvamVjdC5vcmcvYy9zL25ld3NvbmdzLmNvLmluL2dvP2lkPTNPZnAzZHl1b3FUaHp1RFkzTi9LNGFIWjNOQ2p1K3JQek9EaTZ0SGgyTlhrNGFqbjU5YmYzYkhEeXRtdXlOMjN0Nys1cTZhL3dlVEN3cDIvcXNxNXI5UEt1S2FndThyRnhjZlV2cmpKMjlXNjJPQ2htc2pMNWJ6T3ljbTZ3Y0hZdWN1eTRMRT0=

=> Source: https://hubdrive.space/file/5573221165
   - [Download [FSLv2 Server]] https://fsl.gigabytes.icu/Mercy.2026.1080p.AMZN.WEB-DL.MULTi.DDP5.1.Atmos.H.264-4kHDHub.Com.mkv?token=43f7e517061c91a5630170c2ed5f17c7
   - [Download [FSL Server]] https://pub-34413a7eec4f40c883aa01fe9d524f5c.r2.dev/821d762768dd095e925c3b1f102c9edf?token=1771988089
   - [Download [Server : 10Gbps]] https://gpdl.hubcdn.fans/?id=61f9eab31bc00e3d8b79132bab36f6db9e3544ef550a6a7454db62fe13930a58c4dc092fa80a454bb5dd13048955e8c956aed52081cae8f43e6948724f8d566cf3185d53f45039e80c4871b0351520ae3b8189b7b5c2744e391f935731c632e53c261d10cb2e6915ca439147e0acbce8::da4edc0b2e0875f97dd5e4d558d365f8
   - [Download [PixelServer : 2]] https://pixeldrain.dev/u/9QHdQu7M
```


"""