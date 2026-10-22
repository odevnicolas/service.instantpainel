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
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth';
import { Scope } from '../common/scope';
import { plateCode } from '../common/urls';
import { ZodPipe, listQuery, paginate } from '../common/zod';
import { Prisma } from '../generated/prisma/client';
import { GOOGLE_ONLY } from '../plates/plates.controller';
import { PrismaService } from '../prisma.service';
import { pageSchema, type PageBody } from './page.schema';

const listBody = listQuery.extend({ onlyMine: z.stringbool().default(false) });
const linkBody = z.object({ code: z.string().trim().min(1).max(500) });
const unlinkBody = z.object({
  codes: z.array(z.string().trim().toUpperCase()).min(1).max(500),
});

const pageInclude = {
  owner: { select: { email: true } },
  access: { select: { user: { select: { email: true } } } },
} as const;
type FullPage = Prisma.PageGetPayload<{ include: typeof pageInclude }>;

/** Page as the editor expects it (LinkPage): content spread back, users = owner first, then shared. */
const toLinkPage = (p: FullPage) => ({
  ...(p.content as object),
  slug: p.slug,
  title: p.title,
  users: [p.owner.email, ...p.access.map((a) => a.user.email)],
});

@Controller('pages')
export class PagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: Scope,
  ) {}

  /** "Minhas páginas" table. */
  @Get()
  async list(
    @CurrentUser() me: AuthUser,
    @Query(new ZodPipe(listBody)) q: z.output<typeof listBody>,
  ) {
    const where: Prisma.PageWhereInput = {
      AND: [
        await this.scope.pages(me),
        q.onlyMine ? { ownerId: me.id } : {},
        q.search
          ? {
              OR: [
                { title: { contains: q.search, mode: 'insensitive' } },
                { slug: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    const [pages, total] = await Promise.all([
      this.prisma.page.findMany({
        where,
        select: {
          slug: true,
          title: true,
          owner: { select: { email: true } },
          _count: { select: { plates: true, hits: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.page.count({ where }),
    ]);
    return {
      items: pages.map((p) => ({
        slug: p.slug,
        title: p.title,
        owner: p.owner.email,
        products: p._count.plates,
        views: p._count.hits,
      })),
      total,
    };
  }

  @Get(':slug')
  async get(@CurrentUser() me: AuthUser, @Param('slug') slug: string) {
    return toLinkPage(await this.find(me, slug));
  }

  @Post()
  async create(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(pageSchema)) body: PageBody,
  ) {
    const access = await this.accessIds(body.users, me.email);
    const page = await this.unique(() =>
      this.prisma.page.create({
        data: {
          ...this.data(body),
          owner: { connect: { id: me.id } },
          access: { create: access.map((userId) => ({ userId })) },
        },
        include: pageInclude,
      }),
    );
    return toLinkPage(page);
  }

  @Put(':slug')
  async update(
    @CurrentUser() me: AuthUser,
    @Param('slug') slug: string,
    @Body(new ZodPipe(pageSchema)) body: PageBody,
  ) {
    const current = await this.find(me, slug);
    const access = await this.accessIds(body.users, current.owner.email);
    const page = await this.unique(() =>
      this.prisma.page.update({
        where: { id: current.id },
        data: {
          ...this.data(body),
          access: {
            deleteMany: {},
            create: access.map((userId) => ({ userId })),
          },
        },
        include: pageInclude,
      }),
    );
    return toLinkPage(page);
  }

  /** Deletes the page; its plates stay, unlinked ("sem página"). */
  @Delete(':slug')
  @HttpCode(204)
  async remove(@CurrentUser() me: AuthUser, @Param('slug') slug: string) {
    const page = await this.find(me, slug);
    if (!(await this.scope.controls(me, page.ownerId)))
      throw new ForbiddenException('Só o dono da página pode excluí-la.');
    await this.prisma.page.delete({ where: { id: page.id } });
  }

  /** "Dispositivos vinculados". */
  @Get(':slug/plates')
  async plates(@CurrentUser() me: AuthUser, @Param('slug') slug: string) {
    const page = await this.find(me, slug);
    const plates = await this.prisma.plate.findMany({
      where: { pageId: page.id },
      select: { code: true },
      orderBy: { code: 'asc' },
    });
    return plates.map((p) => p.code);
  }

  /**
   * "Vincular página": accepts the code or the plate URL. An empty plate gets activated for the caller;
   * an active one must be the caller's (or shared with it) and moves to this page.
   */
  @Post(':slug/plates')
  async linkPlate(
    @CurrentUser() me: AuthUser,
    @Param('slug') slug: string,
    @Body(new ZodPipe(linkBody)) body: z.output<typeof linkBody>,
  ) {
    const page = await this.find(me, slug);
    const code = plateCode(body.code);
    const plate =
      code &&
      (await this.prisma.plate.findUnique({
        where: { code },
        include: { batch: { select: { google: true } } },
      }));
    if (!code || !plate)
      throw new NotFoundException(
        'Código não encontrado. Confira o código impresso na plaquinha.',
      );
    if (plate.batch?.google) throw new BadRequestException(GOOGLE_ONLY);
    if (plate.pageId === page.id)
      throw new ConflictException(
        'Este produto já está vinculado a esta página.',
      );
    if (plate.activatedAt) {
      const visible = await this.prisma.plate.count({
        where: { AND: [{ code }, await this.scope.plates(me)] },
      });
      if (!visible)
        throw new ForbiddenException('Este produto pertence a outra conta.');
      await this.prisma.plate.update({
        where: { code },
        data: { pageId: page.id },
      });
    } else {
      // Guarded on activatedAt: two people linking the same empty plate at once can't both win
      const { count } = await this.prisma.plate.updateMany({
        where: { code, activatedAt: null },
        data: { pageId: page.id, ownerId: me.id, activatedAt: new Date() },
      });
      if (!count)
        throw new ConflictException(
          'Esta plaquinha acabou de ser ativada por outra conta.',
        );
    }
    return { code };
  }

  /** "Desvincular" / "Desvincular selecionados" / "Desvincular todos". */
  @Post(':slug/plates/unlink')
  async unlinkPlates(
    @CurrentUser() me: AuthUser,
    @Param('slug') slug: string,
    @Body(new ZodPipe(unlinkBody)) body: z.output<typeof unlinkBody>,
  ) {
    const page = await this.find(me, slug);
    const { count } = await this.prisma.plate.updateMany({
      where: { pageId: page.id, code: { in: body.codes } },
      data: { pageId: null },
    });
    return { unlinked: count };
  }

  private async find(me: AuthUser, slug: string) {
    const page = await this.prisma.page.findFirst({
      where: { AND: [{ slug }, await this.scope.pages(me)] },
      include: pageInclude,
    });
    if (!page) throw new NotFoundException('Página não encontrada.');
    return page;
  }

  private data({ slug, title, users, ...content }: PageBody) {
    return { slug, title, content };
  }

  private async accessIds(emails: string[], ownerEmail: string) {
    const { ids, missing } = await this.scope.userIds(
      emails.filter((e) => e !== ownerEmail),
    );
    if (missing.length)
      throw new BadRequestException(
        `Usuário não encontrado: ${missing.join(', ')}. Crie o usuário antes de dar acesso.`,
      );
    return ids;
  }

  /** Runs a create/update and turns a slug clash into a readable 409. */
  private async unique<T>(run: () => Promise<T>) {
    try {
      return await run();
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException(
          'Este link já está em uso por outra página.',
        );
      throw e;
    }
  }
}
