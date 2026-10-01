const fs = require('fs');
const filename = 'subtitle-engine/manifest.json';
const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
manifest.payload = fs.readFileSync('subtitle-engine/subtitle-engine.ts', 'utf8');
fs.writeFileSync(filename, JSON.stringify(manifest, null, 2) + '\n');
console.log('Manifest synchronized with TypeScript source.');
