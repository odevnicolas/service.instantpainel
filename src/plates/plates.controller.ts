import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../common/auth';
import { Scope } from '../common/scope';
import { newPlateCode, normalizeUrl } from '../common/urls';
import { ZodPipe, email, listQuery, paginate } from '../common/zod';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { StatsService } from '../stats/stats.service';

const days = z.coerce
  .number()
  .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
  .default(30);
const link = z
  .string()
  .trim()
  .max(2000)
  .transform(
    (v, ctx) =>
      normalizeUrl(v) ??
      (ctx.addIssue({ code: 'custom', message: 'Informe um link válido.' }),
      z.NEVER),
  );

const batchBody = z.object({
  count: z.number().int().min(1).max(500),
  /** Site the printed QR codes will point to (the painel's NEXT_PUBLIC_SITE_URL) */
  baseUrl: z
    .url({ protocol: /^https?$/, error: 'Link base inválido.' })
    .transform((v) => v.replace(/\/+$/, '')),
  google: z.boolean().default(false),
});
const activateBody = z
  .object({
    link: link.optional(),
    page: z.string().trim().optional(),
    google: z.boolean().default(false),
  })
  .refine(
    (b) => Boolean(b.link) !== Boolean(b.page),
    'Informe um link ou uma página (um dos dois).',
  );
const updateBody = z.object({
  title: z.string().trim().max(100).nullish(),
  link: z.union([z.literal(''), link]).optional(),
  reviewFilter: z.boolean().optional(),
  description: z.string().trim().max(200).nullish(),
  /** "Usuários com acesso" of the product; the owner may be included, it's ignored */
  users: z.array(email).max(50).optional(),
});
const rankingQuery = listQuery.extend({ days });
export const GOOGLE_ONLY =
  'Esta plaquinha é de avaliações no Google: ela só pode levar para o link de avaliação.';

const productSelect = {
  code: true,
  title: true,
  description: true,
  google: true,
  link: true,
  reviewFilter: true,
  page: { select: { slug: true, title: true } },
  owner: { select: { email: true, name: true } },
  _count: { select: { hits: true } },
} as const;
const view = ({
  _count,
  ...p
}: Prisma.PlateGetPayload<{ select: typeof productSelect }>) => ({
  ...p,
  views: _count.hits,
});

@Controller()
export class PlatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: Scope,
    private readonly stats: StatsService,
  ) {}

  /** "Plaquinhas" (admin): creates `count` empty plates, returns their codes for printing. */
  @Post('plates')
  @Roles('ADMIN')
  async createBatch(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(batchBody)) body: z.output<typeof batchBody>,
  ) {
    const codes = new Set<string>();
    // Random codes; anything already taken is skipped and drawn again
    while (codes.size < body.count) {
      const batch = Array.from(
        { length: (body.count - codes.size) * 2 },
        newPlateCode,
      ).filter((c) => !codes.has(c));
      const taken = await this.prisma.plate.findMany({
        where: { code: { in: batch } },
        select: { code: true },
      });
      for (const code of batch)
        if (codes.size < body.count && !taken.some((t) => t.code === code))
          codes.add(code);
    }
    // Batch and plates together: a failed batch leaves no log entry behind
    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.plateBatch.create({
        data: {
          count: codes.size,
          baseUrl: body.baseUrl,
          google: body.google,
          createdById: me.id,
        },
      });
      const { count } = await tx.plate.createMany({
        data: [...codes].map((code) => ({ code, batchId: created.id })),
        skipDuplicates: true,
      });
      if (count !== codes.size)
        throw new ConflictException(
          'Conflito ao gerar códigos, tente novamente.',
        ); // a concurrent batch took one
      return created;
    });
    return { batch, codes: [...codes] };
  }

  /** "Plaquinhas" history (admin): every generation, newest first, with how many got activated. */
  @Get('plates/batches')
  @Roles('ADMIN')
  async batches(@Query(new ZodPipe(listQuery)) q: z.output<typeof listQuery>) {
    const [items, total] = await Promise.all([
      this.prisma.plateBatch.findMany({
        select: {
          id: true,
          count: true,
          baseUrl: true,
          google: true,
          createdAt: true,
          createdBy: { select: { name: true, email: true } },
          _count: {
            select: { plates: { where: { activatedAt: { not: null } } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.plateBatch.count(),
    ]);
    return {
      items: items.map(({ _count, ...b }) => ({
        ...b,
        activated: _count.plates,
      })),
      total,
    };
  }

  /** One batch's plates: the code, the link its QR/NFC carries, and what became of it. */
  @Get('plates/batches/:id')
  @Roles('ADMIN')
  async batch(@Param('id', ParseUUIDPipe) id: string) {
    const batch = await this.prisma.plateBatch.findUnique({
      where: { id },
      select: {
        id: true,
        count: true,
        baseUrl: true,
        google: true,
        createdAt: true,
        createdBy: { select: { name: true, email: true } },
        plates: {
          orderBy: { code: 'asc' },
          select: {
            code: true,
            activatedAt: true,
            owner: { select: { name: true, email: true } },
            page: { select: { slug: true, title: true } },
            link: true,
          },
        },
      },
    });
    if (!batch) throw new NotFoundException('Lote não encontrado.');
    return {
      ...batch,
      plates: batch.plates.map((p) => ({
        ...p,
        url: `${batch.baseUrl}/p/${p.code}`,
        status: p.activatedAt ? 'active' : 'empty',
      })),
    };
  }

  /** "Excluir lote" (admin): the batch and its plates. Only while none is in use: a client's live plate is never deleted by accident. */
  @Delete('plates/batches/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  async removeBatch(@Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.plateBatch.findUnique({ where: { id } })))
        throw new NotFoundException('Lote não encontrado.');
      // Guarded on activatedAt (like activate): an activation racing this one either wins and blocks the delete, or finds no plate
      await tx.plate.deleteMany({ where: { batchId: id, activatedAt: null } });
      if (await tx.plate.count({ where: { batchId: id } }))
        throw new ConflictException(
          'Este lote tem plaquinhas ativadas. Resete-as antes de excluir o lote.',
        );
      await tx.plateBatch.delete({ where: { id } });
    });
  }

  /** "Excluir plaquinha" (admin): one empty plate out of its batch; the batch goes too when it was the last one. */
  @Delete('plates/:code')
  @Roles('ADMIN')
  @HttpCode(204)
  async removePlate(@Param('code') raw: string) {
    const code = raw.toUpperCase();
    await this.prisma.$transaction(async (tx) => {
      const plate = await tx.plate.findUnique({ where: { code } });
      if (!plate) throw new NotFoundException('Código não encontrado.');
      const { count } = await tx.plate.deleteMany({
        where: { code, activatedAt: null },
      });
      if (!count)
        throw new ConflictException(
          'Esta plaquinha está ativada. Resete-a antes de excluir.',
        );
      if (!plate.batchId) return;
      const batch = await tx.plateBatch.update({
        where: { id: plate.batchId },
        data: { count: { decrement: 1 } },
      });
      if (!batch.count) await tx.plateBatch.delete({ where: { id: batch.id } });
    });
  }

  /** "Ativar produto" / "Configurar plaquinha": first setup of an empty plate, to a link or one of the caller's pages. */
  @Post('plates/:code/activate')
  async activate(
    @CurrentUser() me: AuthUser,
    @Param('code') raw: string,
    @Body(new ZodPipe(activateBody)) body: z.output<typeof activateBody>,
  ) {
    const code = raw.toUpperCase();
    const plate = await this.prisma.plate.findUnique({
      where: { code },
      include: { batch: { select: { google: true } } },
    });
    if (!plate) throw new NotFoundException('Código não encontrado.');
    if (plate.activatedAt)
      throw new ConflictException('Esta plaquinha já foi configurada.');
    const googleOnly = plate.batch?.google ?? false;
    if (googleOnly && body.page) throw new BadRequestException(GOOGLE_ONLY);

    let pageId: string | undefined;
    if (body.page) {
      const page = await this.prisma.page.findFirst({
        where: { AND: [{ slug: body.page }, await this.scope.pages(me)] },
      });
      if (!page) throw new NotFoundException('Página não encontrada.');
      pageId = page.id;
    }
    // Guarded on activatedAt so two simultaneous activations can't both win
    const { count } = await this.prisma.plate.updateMany({
      where: { code, activatedAt: null },
      data: {
        ownerId: me.id,
        activatedAt: new Date(),
        link: body.link,
        pageId,
        google: body.google || googleOnly,
      },
    });
    if (!count)
      throw new ConflictException('Esta plaquinha já foi configurada.');
    return view(
      await this.prisma.plate.findUniqueOrThrow({
        where: { code },
        select: productSelect,
      }),
    );
  }

  /** "Meus produtos". */
  @Get('products')
  async list(
    @CurrentUser() me: AuthUser,
    @Query(new ZodPipe(listQuery)) q: z.output<typeof listQuery>,
  ) {
    const where = await this.productWhere(me, q.search);
    const [items, total] = await Promise.all([
      this.prisma.plate.findMany({
        where,
        select: productSelect,
        orderBy: { activatedAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.plate.count({ where }),
    ]);
    return { items: items.map(view), total };
  }

  /** "Editar produto". `users` = owner first, then shared. */
  @Get('products/:code')
  async get(@CurrentUser() me: AuthUser, @Param('code') code: string) {
    const plate = await this.find(me, code);
    const access = await this.prisma.plateAccess.findMany({
      where: { plateCode: plate.code },
      select: { user: { select: { email: true } } },
    });
    return {
      ...view(plate),
      users: [
        ...(plate.owner ? [plate.owner.email] : []),
        ...access.map((a) => a.user.email),
      ],
    };
  }

  @Patch('products/:code')
  async update(
    @CurrentUser() me: AuthUser,
    @Param('code') code: string,
    @Body(new ZodPipe(updateBody)) body: z.output<typeof updateBody>,
  ) {
    const plate = await this.find(me, code);
    let access: Prisma.PlateUpdateInput['access'];
    if (body.users) {
      const { ids, missing } = await this.scope.userIds(
        body.users.filter((e) => e !== plate.owner?.email),
      );
      if (missing.length)
        throw new BadRequestException(
          `Usuário não encontrado: ${missing.join(', ')}.`,
        );
      access = { deleteMany: {}, create: ids.map((userId) => ({ userId })) };
    }
    const updated = await this.prisma.plate.update({
      where: { code: plate.code },
      data: {
        title: body.title,
        link: body.link === '' ? null : body.link,
        reviewFilter: body.reviewFilter,
        description: body.description,
        access,
      },
      select: productSelect,
    });
    return view(updated);
  }

  /** "Desvincular": the plate stays the user's, without a page. */
  @Post('products/:code/unlink')
  async unlink(@CurrentUser() me: AuthUser, @Param('code') code: string) {
    const plate = await this.find(me, code);
    if (!plate.page)
      throw new BadRequestException(
        'Este produto não está vinculado a nenhuma página.',
      );
    return view(
      await this.prisma.plate.update({
        where: { code: plate.code },
        data: { pageId: null },
        select: productSelect,
      }),
    );
  }

  /** "Resetar": back to an empty plate (owner, destination, shared access, title and access history gone) so it can be activated again. */
  @Post('products/:code/reset')
  async reset(@CurrentUser() me: AuthUser, @Param('code') code: string) {
    const { code: plateCode } = await this.find(me, code);
    const { ownerId } = await this.prisma.plate.findUniqueOrThrow({
      where: { code: plateCode },
      select: { ownerId: true },
    });
    // Sharing is not enough: only the owner (or whoever controls them) and admins reset
    if (!(await this.scope.controls(me, ownerId)))
      throw new ForbiddenException(
        'Só o dono da plaquinha ou um admin pode resetá-la.',
      );
    await this.prisma.$transaction([
      this.prisma.plateAccess.deleteMany({ where: { plateCode } }),
      this.prisma.hit.deleteMany({ where: { plateCode } }),
      this.prisma.plate.update({
        where: { code: plateCode },
        data: {
          ownerId: null,
          pageId: null,
          link: null,
          google: false,
          reviewFilter: false,
          title: null,
          description: null,
          activatedAt: null,
        },
      }),
    ]);
    return { code: plateCode, status: 'empty' };
  }

  /** "Ver acessos": accesses per day. */
  @Get('products/:code/stats')
  async daily(
    @CurrentUser() me: AuthUser,
    @Param('code') code: string,
    @Query('days', new ZodPipe(days)) n: 7 | 30 | 90,
  ) {
    const plate = await this.find(me, code);
    return { days: await this.stats.daily(plate.code, n) };
  }

  /** "Ranking de acessos": every visible product, current vs previous period. */
  @Get('ranking')
  async ranking(
    @CurrentUser() me: AuthUser,
    @Query(new ZodPipe(rankingQuery)) q: z.output<typeof rankingQuery>,
  ) {
    const plates = await this.prisma.plate.findMany({
      where: await this.productWhere(me, q.search),
      select: {
        code: true,
        page: { select: { slug: true, title: true } },
        owner: { select: { email: true, name: true } },
      },
    });
    const { current, previous } = await this.stats.counts(
      plates.map((p) => p.code),
      q.days,
    );
    // ponytail: ranks in memory over all visible plates; move to SQL (ORDER BY count LIMIT) past ~tens of thousands
    const ranked = plates
      .map((p) => ({
        ...p,
        current: current.get(p.code) ?? 0,
        previous: previous.get(p.code) ?? 0,
      }))
      .sort((a, b) => b.current - a.current || a.code.localeCompare(b.code));
    const total = ranked.reduce((s, p) => s + p.current, 0);
    const { start, end } = this.stats.period(q.days);
    return {
      period: { start, end },
      summary: {
        total,
        previousTotal: ranked.reduce((s, p) => s + p.previous, 0),
        withAccess: ranked.filter((p) => p.current > 0).length,
        products: ranked.length,
      },
      /** First 10 overall, for the highlights and the top-10 chart */
      top: ranked.slice(0, 10),
      items: ranked.slice((q.page - 1) * q.perPage, q.page * q.perPage),
      total: ranked.length,
    };
  }

  private async productWhere(
    me: AuthUser,
    search: string,
  ): Promise<Prisma.PlateWhereInput> {
    const contains = {
      contains: search.replace(/^\//, ''),
      mode: 'insensitive',
    } as const;
    return {
      AND: [
        await this.scope.plates(me),
        search
          ? {
              OR: [
                { code: contains },
                { title: contains },
                { description: contains },
                { page: { title: contains } },
                { page: { slug: contains } },
                { owner: { email: contains } },
              ],
            }
          : {},
      ],
    };
  }

  private async find(me: AuthUser, code: string) {
    const plate = await this.prisma.plate.findFirst({
      where: {
        AND: [{ code: code.toUpperCase() }, await this.scope.plates(me)],
      },
      select: productSelect,
    });
    if (!plate) throw new NotFoundException('Produto não encontrado.');
    return plate;
  }
}
