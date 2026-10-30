import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const routes = new Map([
  ['/', [new URL('../browser/fixture.html', import.meta.url), 'text/html']],
  ['/card.js', [new URL('../dist/apexcharts-card.js', import.meta.url), 'text/javascript']],
]);

createServer(async (request, response) => {
  const route = routes.get(request.url);
  if (!route) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(route[0]);
    response.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store' }).end(body);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end('Build the card before running browser tests.');
  }
}).listen(4178, '127.0.0.1');
