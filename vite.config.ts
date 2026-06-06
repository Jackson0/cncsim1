import { defineConfig } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export default defineConfig({
  plugins: [
    {
      name: 'debug-run-writer',
      configureServer(server) {
        server.middlewares.use('/debug-runs/latest-run.json', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('Method Not Allowed');
            return;
          }

          try {
            const body = await readRequestBody(req);
            JSON.parse(body);

            const outDir = path.join(server.config.root, 'debug-runs');
            await mkdir(outDir, { recursive: true });

            const latestPath = path.join(outDir, 'latest-run.json');
            const historyPath = path.join(outDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
            await writeFile(latestPath, body, 'utf8');
            await writeFile(historyPath, body, 'utf8');

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              path: 'debug-runs/latest-run.json',
              historyPath: `debug-runs/${path.basename(historyPath)}`,
            }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        });
      },
    },
  ],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'esnext',
  },
});

function readRequestBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
