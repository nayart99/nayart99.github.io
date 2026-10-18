// Shared data + helpers for every page.
import settings from '../data/settings.json';
import en from '../i18n/en.json';
import ar from '../i18n/ar.json';
import faq from '../data/faq.json';
import reviews from '../data/reviews.json';
import hero from '../data/hero.json';

const productFiles = import.meta.glob('../content/products/*.json', { eager: true });

export const LANGS = ['en', 'ar'];
export const STRINGS = { en, ar };
export { settings, faq, reviews, hero };

/** All active products, sorted by "order". */
export function getProducts() {
  return Object.values(productFiles)
    .map((m) => m.default || m)
    .filter((p) => p.active !== false)
    .map((p) => ({
      ...p,
      price: Number(p.price || settings.default_price),
      compare_price: Number(p.compare_price || settings.default_compare_price || 0),
      landscape: (p.orientation || 'landscape') === 'landscape',
    }))
    .sort((a, b) => (a.order || 99) - (b.order || 99));
}

/** Translation helper: t('key') or t('key', {name: 'Sara'}) */
export function useT(lang) {
  const dict = STRINGS[lang] || en;
  return (key, vars) => {
    let s = dict[key] ?? en[key] ?? key;
    if (vars && typeof s === 'string') for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
    return s;
  };
}

/** Pick a field that is either a plain string or {en, ar}. */
export const pick = (v, lang) => (v && typeof v === 'object' ? (v[lang] || v.en || '') : (v || ''));

/** Build a link for the given language. path like "/" or "/products/rose-reverie" */
export function href(lang, path = '/') {
  const p = path.startsWith('/') ? path : '/' + path;
  if (lang === 'ar') return p === '/' ? '/ar/' : '/ar' + p;
  return p;
}

/** The same page in the other language. */
export function altPath(lang, path) {
  return href(lang === 'ar' ? 'en' : 'ar', path);
}

export function money(n, lang) {
  const v = Number(n).toLocaleString('en-US');
  return lang === 'ar' ? `${v} ج.م` : `EGP ${v}`;
}

/** "40×50 cm" → "40×50 سم" on Arabic pages */
export const cm = (s, lang) => (lang === 'ar' ? String(s).replace(/cm/g, 'سم') : s);

export function absolute(path) {
  return new URL(path, settings.site_url).toString();
}
