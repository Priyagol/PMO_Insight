// Fails the Vercel build if /api is still pointed at the placeholder host.
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const api = config.rewrites?.find((r) => r.source === '/api/:path*');
if (!api || api.destination.includes('REPLACE-WITH-API-HOST')) {
  console.error(
    'vercel.json: the /api rewrite still points to the placeholder.\n' +
      'Run: npm run vercel:api-host -- https://<your-api-host>  and commit the change.',
  );
  process.exit(1);
}
if (!api.destination.startsWith('https://')) {
  console.error('vercel.json: the API host must use https://');
  process.exit(1);
}
console.log(`vercel.json OK: /api -> ${api.destination}`);
