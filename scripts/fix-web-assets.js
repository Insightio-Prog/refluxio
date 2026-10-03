// Cloudflare Pages skips any folder named "node_modules" when uploading a site,
// which drops the icon and text fonts Expo puts in dist/assets/node_modules.
// Rename that folder and update every reference to it.
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const from = path.join(dist, 'assets', 'node_modules');
if (!fs.existsSync(from)) {
  console.log('fix-web-assets: nothing to do');
  process.exit(0);
}
fs.renameSync(from, path.join(dist, 'assets', 'vendor'));

let changed = 0;
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html|css|json|map)$/.test(name)) {
      const s = fs.readFileSync(p, 'utf8');
      if (s.includes('assets/node_modules')) {
        fs.writeFileSync(p, s.split('assets/node_modules').join('assets/vendor'));
        changed++;
      }
    }
  }
})(dist);
console.log(`fix-web-assets: renamed assets/node_modules -> assets/vendor in ${changed} files`);
