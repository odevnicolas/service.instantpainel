import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { env } from './env';

/** HTTP setup shared by main.ts and the e2e tests. */
export function setupApp(app: NestExpressApplication) {
  app.enableCors({ origin: [env.APP_URL, env.LINKS_URL] });
  app.useBodyParser('json', { limit: '1mb' }); // page configs with many blocks; files go through /uploads
  app.set('trust proxy', 1); // real client IP behind a proxy, for the rate limiter

  app.useStaticAssets(resolve(env.UPLOAD_DIR), {
    prefix: '/uploads/',
    immutable: true,
    maxAge: '365d', // names are random UUIDs, never overwritten
    setHeaders: (res: ServerResponse) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Uploaded SVGs can carry scripts: opened directly, they run sandboxed with nothing allowed
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // shown as <img> by the painel and the links frontend
      // ?download=pedido-12.svg (ERP buttons): save instead of opening. Cross-origin links ignore <a download>.
      const name = new URL(res.req.url ?? '', 'http://x').searchParams
        .get('download')
        ?.replace(/[^\w.-]/g, '');
      if (name)
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    },
  });
  return app;
}
