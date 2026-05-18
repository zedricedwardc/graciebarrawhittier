// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import dotenv from 'dotenv';

// Load .env into process.env for local dev — Vercel injects production env automatically.
dotenv.config();

export default defineConfig({
  site: 'https://graciebarrawhittier.com',
  output: 'server',
  adapter: vercel({
    webAnalytics: {
      enabled: true,
    },
  }),
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/kickstart') &&
        !page.includes('/back-to-the-mats') &&
        !page.includes('/rebook') &&
        !page.includes('/offer'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  image: {
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
});
