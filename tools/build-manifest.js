const fs = require('fs');
const filename = 'subtitle-engine/manifest.json';
const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
// Match Seanime's manifest limits so packaging errors fail before installation.
for (const [field, limit] of [['name', 50], ['author', 25]]) {
  if (typeof manifest[field] !== 'string' || !manifest[field] || Buffer.byteLength(manifest[field], 'utf8') > limit) {
    throw new Error('Manifest ' + field + ' must be nonempty and at most ' + limit + ' bytes');
  }
}
manifest.payload = fs.readFileSync('subtitle-engine/subtitle-engine.ts', 'utf8');
fs.writeFileSync(filename, JSON.stringify(manifest, null, 2) + '\n');
console.log('Manifest synchronized with TypeScript source.');
