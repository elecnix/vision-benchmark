import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  outDir: '.', // Output directly to repo root for gh-pages
});
