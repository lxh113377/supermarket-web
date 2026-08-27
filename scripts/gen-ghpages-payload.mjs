const fs = require('fs');
const path = require('path');

const distDir = 'C:\\Users\\37533\\Desktop\\超市web\\supermarket-web\\dist';

function walk(dir, base = '') {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(walk(fullPath, base ? `${base}/${file}` : file));
    } else {
      const rel = base ? `${base}/${file}` : file;
      const content = fs.readFileSync(fullPath, 'utf-8');
      // Skip binary files that are too large, keep as placeholder
      if (content.includes('\0') || stat.size > 500000) {
        const buf = fs.readFileSync(fullPath);
        results.push({ path: rel, content: buf.toString('base64'), encoding: 'base64' });
      } else {
        results.push({ path: rel, content: content });
      }
    }
  }
  return results;
}

const files = walk(distDir);
fs.writeFileSync('gh-pages-payload.json', JSON.stringify({ count: files.length, files }, null, 0));
console.log(`Generated payload: ${files.length} files`);
console.log('Total size:', Math.round(fs.statSync('gh-pages-payload.json').size / 1024), 'KB');
