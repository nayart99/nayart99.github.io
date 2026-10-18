# NAY ART – website

Paint-by-numbers store for NAY ART. Static site built with [Astro](https://astro.build), English with an Arabic version at `/ar/`.

## Run it locally
```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # output in dist/
```

## Where things live
| What | File |
|---|---|
| Paintings (names, prices, images, both languages) | `src/content/products/*.json` |
| Store settings (delivery fee, custom sizes, phone, analytics IDs, orders link) | `src/data/settings.json` |
| Home page videos | `src/data/hero.json` + `public/media/video/` |
| FAQ / reviews | `src/data/faq.json`, `src/data/reviews.json` |
| All website text | `src/i18n/en.json`, `src/i18n/ar.json` |
| Images and videos | `public/media/` |
| Order receiver (Google Sheets) | `apps-script/Code.gs` |
| Editing panel config | `.pages.yml` (Pages CMS) |

## Hosting
Cloudflare Pages → connect this repository → build command `npm run build`, output folder `dist`. Every change pushed to `main` goes live in about a minute.

## Guides (Arabic)
- `docs/SETUP-AR.md` – one-time setup: hosting, orders sheet, analytics, monthly report, domain
- `docs/CLIENT-GUIDE-AR.md` – for the store owner: editing the site, adding paintings, following orders
