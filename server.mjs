import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const port = Number(process.env.PORT || 4173);
const host = '0.0.0.0';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

function safeResolve(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0]);
  const requestedPath = cleanPath === '/' ? '/index.html' : cleanPath;
  const resolvedPath = path.resolve(rootDir, `.${requestedPath}`);

  if (!resolvedPath.startsWith(rootDir)) {
    return path.join(rootDir, 'index.html');
  }

  return resolvedPath;
}

const server = http.createServer(async (req, res) => {
  try {
    const filePath = safeResolve(req.url || '/');
    const fileStat = await stat(filePath).catch(() => null);
    const finalPath = fileStat?.isFile() ? filePath : path.join(rootDir, 'index.html');
    const extension = path.extname(finalPath);

    res.writeHead(200, {
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });

    createReadStream(finalPath).pipe(res);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Error interno del servidor');
  }
});

server.listen(port, host, () => {
  console.log(`TRV Gestión Inmobiliaria disponible en http://${host}:${port}`);
});
