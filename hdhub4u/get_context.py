html = open('got_s1.html', encoding='utf-8').read()
idx = html.find('hubdrive')
with open('hubdrive_context.txt', 'w', encoding='utf-8') as f:
    f.write(html[max(0, idx-1000):idx+500])
