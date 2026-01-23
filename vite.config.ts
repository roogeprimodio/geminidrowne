import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    root: 'src',
    base: './', // Important for Electron file protocol
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        manifest: true
    },
    server: {
        port: 5173,
        strictPort: true,
        open: false
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src')
        }
    }
});
