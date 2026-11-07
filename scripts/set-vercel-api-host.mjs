// Usage: npm run vercel:api-host -- https://arihant-workspace-api.onrender.com
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../vercel.json', import.meta.url);
const host = process.argv[2]?.replace(/\/+$/, '');
if (!host || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(host)) {
  console.error(
    'Usage: npm run vercel:api-host -- https://<api-host>   (https, host only, no path)',
  );
  process.exit(1);
}
const config = JSON.parse(readFileSync(file, 'utf8'));
const api = config.rewrites.find((r) => r.source === '/api/:path*');
api.destination = `${host}/api/:path*`;
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`vercel.json: /api -> ${api.destination}`);
