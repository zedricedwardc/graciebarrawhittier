// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://gbwhittier.com',
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/kickstart') && !page.includes('/congrats'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  image: {
    // Enable modern image formats by default
    // (Astro's <Image> component handles WebP/AVIF automatically when format is set)
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
});
