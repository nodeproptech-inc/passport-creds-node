import http from 'node:http';
import { runPassportCredsWorkflow } from './main.js';

const PORT = Number(process.env['PORT'] ?? process.env['CRE_PORT'] ?? '3002');

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/trigger') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { verificationId } = JSON.parse(body) as { verificationId?: string };
        if (!verificationId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing verificationId' }));
          return;
        }

        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ triggered: true, verificationId }));

        // Run async — backend already got the 202 accepted
        runPassportCredsWorkflow({ verificationId }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[CRE server] Workflow error:', message);
        });
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[CRE server] Listening on port ${PORT}`);
});
