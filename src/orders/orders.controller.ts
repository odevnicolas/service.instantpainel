import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { env } from '../env';
import { Prisma, type OrderStage } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

const UPLOADS = `${env.PUBLIC_URL}/uploads/`;
/** Only files sent to /uploads first, PNG (art) or SVG (cut file). */
const file = z
  .string()
  .trim()
  .refine(
    (v) =>
      v.startsWith(UPLOADS) &&
      /^[\w-]+\.(png|svg)$/.test(v.slice(UPLOADS.length)),
    'Envie os arquivos (PNG ou SVG) pelo painel.',
  );
const createBody = z.object({
  name: z.string().trim().min(1, 'Informe o cliente.').max(100),
  /** Sent from "Plaquinhas": the batch these plates belong to */
  batchId: z.uuid().optional(),
  plateType: z.string().trim().min(1, 'Informe o tipo de placa.').max(100),
  quantity: z
    .number()
    .int()
    .min(1, 'A quantidade deve ser pelo menos 1.')
    .max(100_000),
  dueDate: z.iso.date('Informe o prazo.'),
  files: z
    .array(file)
    .max(501) // one PNG per plate of a batch (up to 500) + the SVG
    .refine((f) => f.some((v) => v.endsWith('.png')), 'Envie o PNG da arte.'),
});
const listBody = z.object({ ready: z.stringbool().default(false) });

/** The stage each production job works on. Finishing it moves the order to the next. */
const QUEUE = { CUTTING: 'CUTTING', PRINTING: 'PRINTING' } as const;
const NEXT: Record<OrderStage, OrderStage | undefined> = {
  CUTTING: 'PRINTING',
  PRINTING: 'READY',
  READY: undefined,
};

/**
 * ERP (erp.<domain>). Admins and "cadastro" (ORDERS) register orders and follow all of them;
 * the cutter and the printer only see the orders waiting on their stage.
 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentUser() me: AuthUser,
    @Query(new ZodPipe(listBody)) q: z.output<typeof listBody>,
  ) {
    const job = this.job(me);
    const stage =
      job === 'ADMIN' || job === 'ORDERS'
        ? q.ready
          ? 'READY'
          : { not: 'READY' as const }
        : QUEUE[job];
    // ponytail: last 200, no pagination; add it when ready orders pile up
    const items = await this.prisma.order.findMany({
      where: { stage },
      orderBy: q.ready
        ? { updatedAt: 'desc' }
        : [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    // The cutter only gets the format, the quantity and the SVG cut files
    return {
      items:
        job === 'CUTTING'
          ? items.map(({ name: _, ...o }) => ({
              ...o,
              files: o.files.filter((f) => f.endsWith('.svg')),
            }))
          : items,
    };
  }

  @Post()
  async create(
    @CurrentUser() me: AuthUser,
    @Body(new ZodPipe(createBody)) body: z.output<typeof createBody>,
  ) {
    this.registers(me);
    try {
      return await this.prisma.order.create({
        data: { ...body, dueDate: new Date(body.dueDate) },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002')
          throw new ConflictException(
            'Este lote já foi enviado para produção.',
          );
        if (e.code === 'P2003')
          throw new NotFoundException('Lote não encontrado.');
      }
      throw e;
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.registers(me);
    const { count } = await this.prisma.order.deleteMany({ where: { id } });
    if (!count) throw new NotFoundException('Pedido não encontrado.');
  }

  /** "Finalizar etapa": the cutter finishes cutting, the printer marks it ready for delivery. Admins finish any stage. */
  @Post(':id/done')
  async done(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const job = this.job(me);
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    const next = NEXT[order.stage];
    if (
      job === 'ORDERS' ||
      !next ||
      (job !== 'ADMIN' && order.stage !== QUEUE[job])
    )
      throw new ForbiddenException('Este pedido não está na sua etapa.');
    return this.prisma.order.update({ where: { id }, data: { stage: next } });
  }

  private job(me: AuthUser) {
    if (me.role === 'ADMIN') return 'ADMIN';
    if (!me.erpRole)
      throw new ForbiddenException('Você não tem acesso à produção.');
    return me.erpRole;
  }

  private registers(me: AuthUser) {
    const job = this.job(me);
    if (job !== 'ADMIN' && job !== 'ORDERS')
      throw new ForbiddenException('Só o cadastro cria e exclui pedidos.');
  }
}
