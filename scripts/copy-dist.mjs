const fs = require('fs');
const path = require('path');

const src = 'C:\\Users\\37533\\Desktop\\超市web\\supermarket-web\\dist';
const dst = 'C:\\tmp\\ghpages-deploy';

fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });

function copy(dir, base) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    const tp = path.join(dst, base || '', f);
    if (fs.statSync(fp).isDirectory()) {
      fs.mkdirSync(tp, { recursive: true });
      copy(fp, f);
    } else {
      fs.copyFileSync(fp, tp);
    }
  }
}

copy(src);
console.log('Copied', fs.readdirSync(dst).length, 'top-level items');
