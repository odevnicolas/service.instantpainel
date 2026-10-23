import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/auth.service';
import { env } from '../src/env';
import { PrismaService } from '../src/prisma.service';

// The whole painel flow on a real database: users and scopes, plates, pages, redirects, stats, uploads.
// Runs on instantpainel_test (see test-env.ts). Login is limited to 5/min per IP: this file stays at 4.

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000',
  'hex',
);

const page = (slug: string, overrides: object = {}) => ({
  slug,
  title: 'Pizzaria Bella Napoli',
  subtitle:
    '<b>Oi</b><script>alert(1)</script><img src=x onerror="alert(2)"><font color="#ff0000">vermelho</font>',
  subtitleStyle: { size: 12, lineHeight: 1.55, align: 'center' },
  users: [] as string[],
  logo: { src: '', shape: 'circle', size: 50 },
  background: { image: '', blur: 0, overlay: 'none' },
  colors: {
    top: '#4a7ff9',
    base: '#f4f5f9',
    button: '#1c50ca',
    buttonText: '#ffffff',
    accent: '#ffffff',
    card: '#ffffff',
    cardText: '#151924',
  },
  buttons: { shape: 'pill', style: 'solid' },
  blocks: [
    {
      id: '1',
      type: 'review',
      label: 'Avalie no Google',
      url: 'https://g.page/r/abc/review',
    },
    { id: '2', type: 'pix', keyType: 'cpf', key: '924.203.623-49' },
    { id: '3', type: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' },
  ],
  ...overrides,
});

describe('InstantPainel API (e2e)', () => {
  let app: NestExpressApplication;
  let http: App;
  let prisma: PrismaService;
  const token = { admin: '', reseller: '', client: '' };
  const users = {
    reseller: { id: '', email: 'revenda@teste.com' },
    client: { id: '', email: 'cliente@teste.com' },
  };
  let codes: string[];

  const as = (who: keyof typeof token) => ({
    Authorization: `Bearer ${token[who]}`,
  });
  const login = (email: string, password: string) =>
    request(http).post('/auth/login').send({ email, password });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Order", "Hit", "PlateAccess", "PageAccess", "Plate", "Page", "User" CASCADE',
    );
    await prisma.user.create({
      data: {
        email: 'admin@teste.com',
        name: 'Admin',
        role: 'ADMIN',
        passwordHash: await hashPassword('senha-admin-123'),
      },
    });
  });

  afterAll(() => app.close());

  it('logs in and manages users within each role', async () => {
    expect((await request(http).get('/me')).status).toBe(401);
    const admin = await login(' ADMIN@teste.com ', 'senha-admin-123').expect(
      200,
    );
    token.admin = admin.body.token;

    // Admin creates a reseller; the reseller can only create clients, managed by itself
    const reseller = await request(http)
      .post('/users')
      .set(as('admin'))
      .send({
        name: 'Revenda',
        email: users.reseller.email,
        password: 'senha-revenda',
        role: 'RESELLER',
      })
      .expect(201);
    users.reseller.id = reseller.body.id;
    token.reseller = (
      await login(users.reseller.email, 'senha-revenda').expect(200)
    ).body.token;

    await request(http)
      .post('/users')
      .set(as('reseller'))
      .send({
        name: 'X',
        email: 'x@teste.com',
        password: 'senha-xxxx',
        role: 'RESELLER',
      })
      .expect(403);
    const client = await request(http)
      .post('/users')
      .set(as('reseller'))
      .send({
        name: 'Cliente',
        email: users.client.email,
        password: 'senha-cliente',
      })
      .expect(201);
    users.client.id = client.body.id;
    expect(client.body).toMatchObject({
      role: 'CLIENT',
      status: 'ACTIVE',
      pages: 0,
    });
    await request(http)
      .post('/users')
      .set(as('reseller'))
      .send({
        name: 'Dup',
        email: users.client.email,
        password: 'senha-cliente',
      })
      .expect(409);

    const list = await request(http)
      .get('/users')
      .set(as('reseller'))
      .expect(200);
    expect(list.body.items.map((u: { email: string }) => u.email)).toEqual([
      users.client.email,
    ]);
    token.client = (
      await login(users.client.email, 'senha-cliente').expect(200)
    ).body.token;
    await request(http).get('/users').set(as('client')).expect(403);
  });

  it('creates plates (admin only) and activates one with a link', async () => {
    await request(http)
      .post('/plates')
      .set(as('reseller'))
      .send({ name: 'Pizzaria', count: 3, baseUrl: 'https://painel.teste.com' })
      .expect(403);
    await request(http)
      .post('/plates')
      .set(as('admin'))
      .send({ name: 'Pizzaria', count: 3, baseUrl: 'javascript:alert(1)' })
      .expect(400);
    codes = (
      await request(http)
        .post('/plates')
        .set(as('admin'))
        .send({
          name: 'Pizzaria',
          count: 3,
          baseUrl: 'https://painel.teste.com/',
        })
        .expect(201)
    ).body.codes;
    expect(codes).toHaveLength(3);
    expect(new Set(codes).size).toBe(3);

    const [p1] = codes;
    expect(
      (await request(http).get(`/public/plates/${p1}`).expect(200)).body.status,
    ).toBe('empty');
    // Empty plate: goes to setup, nothing counted
    expect(
      (await request(http).get(`/r/${p1}`).expect(302)).headers.location,
    ).toBe(`${env.APP_URL}/configurar/${p1}`);

    const active = await request(http)
      .post(`/plates/${p1.toLowerCase()}/activate`)
      .set(as('reseller'))
      .send({ link: 'www.loja.com.br' })
      .expect(201);
    expect(active.body).toMatchObject({
      code: p1,
      link: 'https://www.loja.com.br/',
      views: 0,
    });
    await request(http)
      .post(`/plates/${p1}/activate`)
      .set(as('client'))
      .send({ link: 'outra.com' })
      .expect(409);

    expect(
      (await request(http).get(`/r/${p1}`).expect(302)).headers.location,
    ).toBe('https://www.loja.com.br/');
  });

  it('creates a links page with sanitized subtitle and shared access', async () => {
    // Files must be uploads of this API: blob: (not uploaded yet) and third-party URLs are rejected
    await request(http)
      .post('/pages')
      .set(as('reseller'))
      .send(
        page('bella', {
          logo: {
            src: 'https://outro.site/logo.png',
            shape: 'circle',
            size: 50,
          },
        }),
      )
      .expect(400);
    const bad = page('bella', {
      blocks: [
        {
          id: '1',
          type: 'image',
          src: 'blob:http://localhost:3000/abc',
          url: '',
        },
      ],
    });
    await request(http)
      .post('/pages')
      .set(as('reseller'))
      .send(bad)
      .expect(400);
    await request(http)
      .post('/pages')
      .set(as('reseller'))
      .send(page('bella', { users: ['ninguem@teste.com'] }))
      .expect(400);

    const created = await request(http)
      .post('/pages')
      .set(as('reseller'))
      .send(
        page('bella', {
          users: [users.client.email],
          logo: {
            src: `${env.PUBLIC_URL}/uploads/logo.png`,
            shape: 'circle',
            size: 50,
          },
        }),
      )
      .expect(201);
    expect(created.body.subtitle).toBe(
      '<b>Oi</b><font color="#ff0000">vermelho</font>',
    );
    expect(created.body.users).toEqual([
      users.reseller.email,
      users.client.email,
    ]);
    await request(http)
      .post('/pages')
      .set(as('admin'))
      .send(page('bella'))
      .expect(409);

    // Shared with the client: can open and edit, can't delete
    await request(http).get('/pages/bella').set(as('client')).expect(200);
    await request(http)
      .put('/pages/bella')
      .set(as('client'))
      .send(
        page('bella', { title: 'Bella Napoli', users: [users.client.email] }),
      )
      .expect(200);
    await request(http).delete('/pages/bella').set(as('client')).expect(403);

    const pub = await request(http).get('/public/pages/bella').expect(200);
    expect(pub.body).toMatchObject({ slug: 'bella', title: 'Bella Napoli' });
    expect(pub.body.users).toBeUndefined();
    expect(pub.body.blocks).toHaveLength(3);
  });

  it('links plates to the page and redirects scans there', async () => {
    const [p1, p2, p3] = codes;
    // By URL (as pasted in "Vincular"); an empty plate gets activated for the caller
    await request(http)
      .post('/pages/bella/plates')
      .set(as('reseller'))
      .send({ code: `http://localhost:3000/p/${p1}` })
      .expect(201);
    await request(http)
      .post('/pages/bella/plates')
      .set(as('reseller'))
      .send({ code: p2 })
      .expect(201);
    await request(http)
      .post('/pages/bella/plates')
      .set(as('reseller'))
      .send({ code: p2 })
      .expect(409);
    await request(http)
      .post('/pages/bella/plates')
      .set(as('reseller'))
      .send({ code: 'ZZZZ' })
      .expect(404);
    expect(
      (
        await request(http)
          .get('/pages/bella/plates')
          .set(as('reseller'))
          .expect(200)
      ).body,
    ).toEqual([p1, p2].sort());

    // p3 activated by the admin: the reseller can't take it
    await request(http)
      .post(`/plates/${p3}/activate`)
      .set(as('admin'))
      .send({ link: 'admin.com' })
      .expect(201);
    await request(http)
      .post('/pages/bella/plates')
      .set(as('reseller'))
      .send({ code: p3 })
      .expect(403);

    expect(
      (await request(http).get(`/r/${p1}`).expect(302)).headers.location,
    ).toBe(`${env.LINKS_URL}/bella`);
    await request(http).get(`/r/${p1}`).expect(302);

    const pages = await request(http)
      .get('/pages')
      .set(as('reseller'))
      .expect(200);
    expect(pages.body.items).toEqual([
      {
        slug: 'bella',
        title: 'Bella Napoli',
        owner: users.reseller.email,
        products: 2,
        views: 2,
      },
    ]);
  });

  it('logs each generated batch with its plates and their fate (admin only)', async () => {
    await request(http).get('/plates/batches').set(as('reseller')).expect(403);
    const batches = await request(http)
      .get('/plates/batches')
      .set(as('admin'))
      .expect(200);
    expect(batches.body.total).toBe(1);
    // p1 activated with a link, p2 via "Vincular", p3 by the admin
    expect(batches.body.items[0]).toMatchObject({
      name: 'Pizzaria',
      count: 3,
      activated: 3,
      baseUrl: 'https://painel.teste.com',
      createdBy: { email: 'admin@teste.com' },
    });

    const detail = await request(http)
      .get(`/plates/batches/${batches.body.items[0].id}`)
      .set(as('admin'))
      .expect(200);
    const p1 = detail.body.plates.find(
      (p: { code: string }) => p.code === codes[0],
    );
    expect(p1).toMatchObject({
      url: `https://painel.teste.com/p/${codes[0]}`,
      status: 'active',
      owner: { email: users.reseller.email },
      page: { slug: 'bella' },
    });

    // Plates in use are never deleted: neither alone nor with their batch
    await request(http)
      .delete(`/plates/batches/${batches.body.items[0].id}`)
      .set(as('admin'))
      .expect(409);
    await request(http)
      .delete(`/plates/${codes[0]}`)
      .set(as('admin'))
      .expect(409);

    const extra = (
      await request(http)
        .post('/plates')
        .set(as('admin'))
        .send({
          name: 'Pizzaria',
          count: 3,
          baseUrl: 'https://painel.teste.com',
        })
        .expect(201)
    ).body;
    await request(http)
      .delete(`/plates/${extra.codes[0]}`)
      .set(as('reseller'))
      .expect(403);
    await request(http)
      .delete(`/plates/${extra.codes[0].toLowerCase()}`)
      .set(as('admin'))
      .expect(204);
    await request(http)
      .delete(`/plates/${extra.codes[0]}`)
      .set(as('admin'))
      .expect(404);
    expect(
      (
        await request(http)
          .get(`/plates/batches/${extra.batch.id}`)
          .set(as('admin'))
          .expect(200)
      ).body,
    ).toMatchObject({ count: 2, plates: [{}, {}] });

    await request(http)
      .delete(`/plates/batches/${extra.batch.id}`)
      .set(as('admin'))
      .expect(204);
    await request(http).get(`/public/plates/${extra.codes[1]}`).expect(404);
    expect(
      (await request(http).get('/plates/batches').set(as('admin')).expect(200))
        .body.total,
    ).toBe(1);
  });

  it('keeps Google batches on Google: no page, always flagged as Google', async () => {
    const {
      codes: [g],
      batch,
    } = (
      await request(http)
        .post('/plates')
        .set(as('admin'))
        .send({
          name: 'Pizzaria',
          count: 1,
          baseUrl: 'https://painel.teste.com',
          google: true,
        })
        .expect(201)
    ).body;
    expect(
      (await request(http).get(`/public/plates/${g}`).expect(200)).body,
    ).toMatchObject({ status: 'empty', google: true });

    await request(http)
      .post(`/plates/${g}/activate`)
      .set(as('reseller'))
      .send({ page: 'bella' })
      .expect(400);
    await request(http)
      .post('/pages/bella/plates')
      .set(as('reseller'))
      .send({ code: g })
      .expect(400);
    const active = await request(http)
      .post(`/plates/${g}/activate`)
      .set(as('reseller'))
      .send({ link: 'https://g.page/r/abc/review' })
      .expect(201);
    expect(active.body.google).toBe(true);

    // Back to how it was, so the counts in the next tests don't change
    await request(http)
      .post(`/products/${g}/reset`)
      .set(as('reseller'))
      .expect(201);
    await request(http)
      .delete(`/plates/batches/${batch.id}`)
      .set(as('admin'))
      .expect(204);
  });

  it('lists products, daily stats and ranking within scope', async () => {
    const [p1, p2] = codes;
    const products = await request(http)
      .get('/products')
      .set(as('reseller'))
      .expect(200);
    expect(products.body.total).toBe(2);
    // p1: 1 hit via its own link + 2 via the page
    expect(
      products.body.items.find((p: { code: string }) => p.code === p1),
    ).toMatchObject({ views: 3, page: { slug: 'bella' } });
    // Not shared with the client
    expect(
      (await request(http).get('/products').set(as('client')).expect(200)).body
        .total,
    ).toBe(0);
    await request(http).get(`/products/${p1}`).set(as('client')).expect(404);

    const stats = await request(http)
      .get(`/products/${p1}/stats?days=7`)
      .set(as('reseller'))
      .expect(200);
    expect(stats.body.days).toHaveLength(7);
    expect(stats.body.days.at(-1).count).toBe(3);
    await request(http)
      .get(`/products/${p1}/stats?days=5`)
      .set(as('reseller'))
      .expect(400);

    const ranking = await request(http)
      .get('/ranking?days=7')
      .set(as('reseller'))
      .expect(200);
    expect(
      ranking.body.items.map((i: { code: string; current: number }) => [
        i.code,
        i.current,
      ]),
    ).toEqual([
      [p1, 3],
      [p2, 0],
    ]);
    expect(ranking.body.top).toHaveLength(2);
    expect(ranking.body.summary).toEqual({
      total: 3,
      previousTotal: 0,
      withAccess: 1,
      products: 2,
    });
    // Admin sees every product, including its own p3
    expect(
      (await request(http).get('/ranking').set(as('admin')).expect(200)).body
        .total,
    ).toBe(3);

    const edited = await request(http)
      .patch(`/products/${p1}`)
      .set(as('reseller'))
      .send({ description: 'Mesa 4', users: [users.client.email] })
      .expect(200);
    expect(edited.body.description).toBe('Mesa 4');
    expect(
      (await request(http).get(`/products/${p1}`).set(as('client')).expect(200))
        .body.users,
    ).toEqual([users.reseller.email, users.client.email]);

    await request(http)
      .post('/pages/bella/plates/unlink')
      .set(as('reseller'))
      .send({ codes: [p2] })
      .expect(201);
    expect(
      (
        await request(http)
          .post(`/products/${p1}/unlink`)
          .set(as('reseller'))
          .expect(201)
      ).body.page,
    ).toBeNull();
    await request(http)
      .post(`/products/${p1}/unlink`)
      .set(as('reseller'))
      .expect(400);
  });

  it('stores uploads by content, not by the declared type', async () => {
    const ok = await request(http)
      .post('/uploads')
      .set(as('reseller'))
      .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    const path = new URL(ok.body.url).pathname;
    const file = await request(http).get(path).expect(200);
    expect(file.headers['content-security-policy']).toContain('sandbox');
    await request(http)
      .post('/uploads')
      .set(as('reseller'))
      .attach('file', Buffer.from('<html><script>alert(1)</script>'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(400);
  });

  it('suspends, impersonates and deletes', async () => {
    await request(http)
      .post(`/users/${users.client.id}/suspend`)
      .set(as('reseller'))
      .expect(201);
    await request(http).get('/me').set(as('client')).expect(401); // old session dies at once
    await login(users.client.email, 'senha-cliente').expect(403);
    await request(http)
      .post(`/users/${users.client.id}/impersonate`)
      .set(as('reseller'))
      .expect(400);

    await request(http)
      .post(`/users/${users.client.id}/activate`)
      .set(as('reseller'))
      .expect(201);
    const imp = await request(http)
      .post(`/users/${users.client.id}/impersonate`)
      .set(as('reseller'))
      .expect(201);
    const me = await request(http)
      .get('/me')
      .set({ Authorization: `Bearer ${imp.body.token}` })
      .expect(200);
    expect(me.body).toMatchObject({
      email: users.client.email,
      impersonating: true,
    });

    await request(http).delete('/pages/bella').set(as('reseller')).expect(204);
    await request(http).get('/public/pages/bella').expect(404);
    expect(
      (await request(http).get('/products').set(as('reseller')).expect(200))
        .body.total,
    ).toBe(2); // plates survive
    await request(http)
      .delete(`/users/${users.reseller.id}`)
      .set(as('reseller'))
      .expect(404); // can't delete itself
  });

  it('runs an order through cutting and printing (ERP)', async () => {
    // ERP workers get their token straight from the JWT service: login is rate limited (see top)
    const jwt = app.get(JwtService);
    const worker = async (erpRole: 'ORDERS' | 'CUTTING' | 'PRINTING') => {
      const u = await prisma.user.create({
        data: {
          email: `${erpRole}@erp.com`,
          name: erpRole,
          erpRole,
          passwordHash: '-',
        },
      });
      return { Authorization: `Bearer ${await jwt.signAsync({ sub: u.id })}` };
    };
    const orders = await worker('ORDERS');
    const cutter = await worker('CUTTING');
    const printer = await worker('PRINTING');
    await request(http).get('/orders').set(as('reseller')).expect(403);

    const up = async (buf: Buffer, name: string) =>
      (
        await request(http)
          .post('/uploads')
          .set(orders)
          .attach('file', buf, name)
          .expect(201)
      ).body.url as string;
    const png = await up(PNG, 'arte.png');
    const svg = await up(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      'corte.svg',
    );
    // Sent from "Plaquinhas": tied to the batch, named after the client
    const { batch } = (
      await request(http)
        .post('/plates')
        .set(as('admin'))
        .send({
          name: 'Padaria Sol',
          count: 2,
          baseUrl: 'https://painel.teste.com',
        })
        .expect(201)
    ).body;
    const body = {
      name: 'Padaria Sol',
      batchId: batch.id,
      plateType: 'Placa 8x8 cm',
      quantity: 50,
      dueDate: '2026-11-04',
      files: [png, svg],
    };
    await request(http).post('/orders').set(cutter).send(body).expect(403);
    await request(http)
      .post('/orders')
      .set(orders)
      .send({ ...body, files: [svg] })
      .expect(400); // PNG required
    await request(http)
      .post('/orders')
      .set(orders)
      .send({ ...body, files: ['https://x.com/a.png'] })
      .expect(400);
    const { id } = (
      await request(http).post('/orders').set(orders).send(body).expect(201)
    ).body;
    await request(http).post('/orders').set(orders).send(body).expect(409); // one order per batch
    const batchStage = async () =>
      (
        (
          await request(http)
            .get('/plates/batches')
            .set(as('admin'))
            .expect(200)
        ).body.items as { id: string; order: object | null }[]
      ).find((b) => b.id === batch.id)?.order;
    expect(await batchStage()).toEqual({ id, stage: 'CUTTING' });

    // Each job sees only its own queue; the cutter gets just the SVG
    const queue = async (who: Record<string, string>, q = '') =>
      (await request(http).get(`/orders${q}`).set(who).expect(200)).body
        .items as object[];
    const [cut] = await queue(cutter);
    expect(cut).toMatchObject({
      id,
      quantity: 50,
      files: [svg],
      dueDate: '2026-11-04T00:00:00.000Z',
    });
    expect(cut).not.toHaveProperty('name');
    expect(await queue(printer)).toEqual([]);
    await request(http).post(`/orders/${id}/done`).set(printer).expect(403);
    await request(http).post(`/orders/${id}/done`).set(orders).expect(403);
    await request(http).post(`/orders/${id}/done`).set(cutter).expect(201);
    await request(http).post(`/orders/${id}/done`).set(cutter).expect(403); // not its stage anymore
    expect(await queue(printer)).toMatchObject([
      { id, name: 'Padaria Sol', files: [png, svg] },
    ]);
    await request(http).post(`/orders/${id}/done`).set(printer).expect(201);
    expect(await queue(orders)).toEqual([]);
    expect(await queue(orders, '?ready=true')).toMatchObject([
      { id, stage: 'READY' },
    ]);
    await request(http).post(`/orders/${id}/done`).set(as('admin')).expect(403); // nothing after "pronto"

    const dl = await request(http)
      .get(`/uploads/${png.split('/').pop()}?download=pedido-${id}.png"x`)
      .expect(200);
    expect(dl.headers['content-disposition']).toBe(
      `attachment; filename="pedido-${id}.pngx"`,
    );

    await request(http).delete(`/orders/${id}`).set(printer).expect(403);
    expect(await batchStage()).toEqual({ id, stage: 'READY' });
    await request(http).delete(`/orders/${id}`).set(orders).expect(204);
    expect(await batchStage()).toBeNull();
  });
});
