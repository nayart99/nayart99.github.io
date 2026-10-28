import { absolute } from '../lib/site.js';
export function GET() {
  return new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /pay/\nDisallow: /ar/pay/\n\nSitemap: ${absolute('/sitemap.xml')}\n`, { headers: { 'Content-Type': 'text/plain' } });
}
