import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/auth';
import { env } from '../env';
import { PrismaService } from '../prisma.service';

/** No login: what plates (QR/NFC) and the public links frontend call. */
@Public()
@Controller()
export class PublicController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Target of every plate: counts the access and redirects to the linked page, the plate's own link,
   * or the setup screen when the plate is still empty (or active without a destination).
   * The painel's /p/[id] route forwards here, so printed QR codes keep pointing at the painel domain.
   */
  @Get('r/:code')
  async redirect(@Param('code') raw: string, @Res() res: Response) {
    const code = raw.toUpperCase();
    const plate = await this.prisma.plate.findUnique({
      where: { code },
      select: {
        code: true,
        activatedAt: true,
        link: true,
        page: { select: { id: true, slug: true } },
      },
    });
    if (!plate)
      return res.status(404).type('text').send('Plaquinha não encontrada.');

    const target = !plate.activatedAt
      ? undefined
      : plate.page
        ? `${env.LINKS_URL}/${plate.page.slug}`
        : plate.link;
    if (!target) return res.redirect(302, `${env.APP_URL}/configurar/${code}`);

    // ponytail: every request counts (no bot or repeat filtering); dedupe by IP/time window if numbers look inflated
    await this.prisma.hit.create({
      data: { plateCode: code, pageId: plate.page?.id },
    });
    res.setHeader('Cache-Control', 'no-store'); // each scan must reach us to be counted
    return res.redirect(302, target);
  }

  /** Plate status for "Ativar produto" / "Configurar plaquinha". */
  @Get('public/plates/:code')
  async plate(@Param('code') raw: string) {
    const plate = await this.prisma.plate.findUnique({
      where: { code: raw.toUpperCase() },
      select: {
        code: true,
        activatedAt: true,
        batch: { select: { google: true } },
      },
    });
    if (!plate) throw new NotFoundException('Código não encontrado.');
    return {
      code: plate.code,
      status: plate.activatedAt ? 'active' : 'empty',
      /** Google review plate: activation only offers the review link */
      google: plate.batch?.google ?? false,
    };
  }

  /** What the public links frontend renders (LinkPage without the access list). */
  @Get('public/pages/:slug')
  async page(@Param('slug') slug: string) {
    const page = await this.prisma.page.findUnique({
      where: { slug },
      select: { slug: true, title: true, content: true, updatedAt: true },
    });
    if (!page) throw new NotFoundException('Página não encontrada.');
    return {
      ...(page.content as object),
      slug: page.slug,
      title: page.title,
      updatedAt: page.updatedAt,
    };
  }
}
