import http from 'http';

export function startKeepAlive(client) {
  const secret = process.env.UPTIME_SECRET;
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    const sendJSON = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    const okPayload = {
      ok: true,
      ws_status: client.ws?.status ?? null,
      ping_ms: client.ws?.ping ?? null,
      guilds: client.guilds?.cache?.size ?? 0,
    };

    // ✅ Allow free-plan monitors to hit HEAD /
    if (req.method === 'HEAD' && path === '/') {
      res.writeHead(200);
      return res.end();
    }

    // Simple text metrics
    if (req.method === 'GET' && path === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(
        `ok=1 ws=${client.ws?.status ?? ''} ping=${client.ws?.ping ?? ''} guilds=${client.guilds?.cache?.size ?? 0}`
      );
    }

    // JSON health, with optional secret gating
    if (req.method === 'GET' && (path === '/health' || (secret && path === `/health/${secret}`))) {
      if (secret && path !== `/health/${secret}`) {
        res.writeHead(404);
        return res.end();
      }
      return sendJSON(200, okPayload);
    }

    // everything else
    res.writeHead(404);
    res.end();
  });
}
