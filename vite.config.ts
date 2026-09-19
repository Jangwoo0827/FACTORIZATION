import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build can be dropped on itch.io / GitHub Pages unchanged.
  base: './',
  server: {
    // Exposes the dev server on the LAN so the game can be opened on a real phone.
    host: true,
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
