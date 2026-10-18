import { getProducts, href, absolute } from '../lib/site.js';
export function GET() {
  const paths = ['/', '/custom', ...getProducts().map((p) => `/products/${p.slug}`)];
  const today = new Date().toISOString().slice(0, 10);
  const urls = paths.flatMap((p) => ['en', 'ar'].map((lang) => `  <url>
    <loc>${absolute(href(lang, p))}</loc>
    <lastmod>${today}</lastmod>
    <xhtml:link rel="alternate" hreflang="en" href="${absolute(href('en', p))}"/>
    <xhtml:link rel="alternate" hreflang="ar" href="${absolute(href('ar', p))}"/>
  </url>`));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
