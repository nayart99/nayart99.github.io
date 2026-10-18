import { absolute } from '../lib/site.js';
export function GET() {
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${absolute('/sitemap.xml')}\n`, { headers: { 'Content-Type': 'text/plain' } });
}
