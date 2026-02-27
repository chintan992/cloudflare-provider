from bs4 import BeautifulSoup

with open('got_s1.html', encoding='utf-8') as f:
    soup = BeautifulSoup(f.read(), 'html.parser')

with open('links.txt', 'w', encoding='utf-8') as out:
    for a in soup.select('a'):
        href = a.get('href', '')
        if 'hubdrive' in href or 'hubcdn' in href:
            parent = a.find_parent('p') or a.find_parent('div')
            out.write(f"TEXT: {a.text.strip()} | PARENT: {parent.text[:50] if parent else ''} | HREF: {href}\n")
