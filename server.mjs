import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { handleApi, serveGenerated } from './server/message-api.mjs';

const dist = resolve('dist');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg' };

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/send-mms') return handleApi(req, res);
  if (url.pathname.startsWith('/generated/')) { req.url = url.pathname.slice(11); return serveGenerated(req, res); }
  let file = join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!existsSync(file) || !statSync(file).isFile()) file = join(dist, 'index.html');
  res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
  createReadStream(file).on('error', () => { res.statusCode = 404; res.end('Not found'); }).pipe(res);
}).listen(process.env.PORT || 4173, () => console.log(`Fourcut server: http://localhost:${process.env.PORT || 4173}`));
