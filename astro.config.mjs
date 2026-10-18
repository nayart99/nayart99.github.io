import { defineConfig } from 'astro/config';
import settings from './src/data/settings.json' with { type: 'json' };

export default defineConfig({
  site: settings.site_url,
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
});
