import type { Express } from 'express';
import type { AddressInfo } from 'node:net';

/** Starts an Express app on an ephemeral port for HTTP-level tests. */
export async function listen(app: Express) {
  const server = await new Promise<import('node:http').Server>(resolve => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
