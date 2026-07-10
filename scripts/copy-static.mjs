import { cpSync, mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('dist/public/src/assets', { recursive: true });
copyFileSync('index.html', 'dist/public/index.html');
copyFileSync('src/styles.css', 'dist/public/src/styles.css');
copyFileSync('dist/src/app/main.js', 'dist/public/src/main.js');
cpSync('src/assets', 'dist/public/src/assets', { recursive: true });
