import { VidlinkProvider } from './vidlink';
import * as fs from 'fs';

async function run() {
    const provider = new VidlinkProvider();

    console.log("--- Testing Movie (Fight Club) ---");
    const movieResults = await provider.extract({
        type: 'movie',
        tmdbId: '550',
    });

    console.log("\n--- Testing TV Show (Breaking Bad S1E1) ---");
    const tvResults = await provider.extract({
        type: 'tv',
        tmdbId: '1396',
        season: 1,
        episode: 1
    });

    fs.writeFileSync('output.json', JSON.stringify({ movie: movieResults, tv: tvResults }, null, 2));
    console.log('Results written to output.json');
}

run().catch(console.error);
