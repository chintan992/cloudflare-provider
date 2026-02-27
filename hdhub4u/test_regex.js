const fs = require('fs');
const html = fs.readFileSync('got_s1.html', 'utf-8');

const aTagRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
let match;
let count = 0;
while ((match = aTagRegex.exec(html)) !== null) {
    const href = match[1];
    if (href.match(/https:\/\/(?:.*\.)?(hdstream4u|hubstream|hblinks|hubcdn|hubdrive)\./)) {
        count++;
    }
}
console.log(`Regex matched ${count} links in the local HTML file`);
