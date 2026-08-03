// Downloads the game data files from zero-network.net and caches them locally.
// Run once before starting the server:  node fetch-data.js
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = [
  {
    url:  'https://zero-network.net/phasmophobia/data/ghosts.json?lang=en',
    file: 'ghosts.json',
  },
  {
    url:  'https://zero-network.net/phasmophobia/data/maps',
    file: 'maps.json',
  },
  {
    url:  'https://zero-network.net/phasmophobia/data/weekly.json',
    file: 'weekly.json',
  },
];

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer':    'https://tybayn.github.io/',
  'Origin':     'https://tybayn.github.io',
  'Accept':     'application/json',
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const parsed = new URL(url);
    const options = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: REQUEST_HEADERS };
    https.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

(async () => {
  let ok = 0;
  for (const { url, file } of FILES) {
    const dest = path.join(DATA_DIR, file);
    process.stdout.write(`Fetching ${file} ... `);
    try {
      await download(url, dest);
      const size = fs.statSync(dest).size;
      console.log(`OK (${(size / 1024).toFixed(1)} KB)`);
      ok++;
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }
  console.log(`\n${ok}/${FILES.length} files cached in ${DATA_DIR}`);
  if (ok < FILES.length) process.exit(1);
})();
