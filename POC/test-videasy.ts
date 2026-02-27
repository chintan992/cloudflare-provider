import { VideasyProvider } from './videasy';
import * as fs from 'fs';

async function run() {
    const provider = new VideasyProvider();

    console.log("--- Testing Movie (Fight Club) ---");
    const movieResults = await provider.extract({
        type: 'movie',
        title: 'Fight Club',
        year: 1999,
        tmdbId: '550'
    });

    console.log("\n--- Testing TV Show (Breaking Bad S1E1) ---");
    const tvResults = await provider.extract({
        type: 'tv',
        title: 'Breaking Bad',
        year: 2008,
        tmdbId: '1396',
        season: 1,
        episode: 1
    });

    fs.writeFileSync('output-videasy.json', JSON.stringify({ movie: movieResults, tv: tvResults }, null, 2));
    console.log('Results written to output-videasy.json');
}

run().catch(console.error);
