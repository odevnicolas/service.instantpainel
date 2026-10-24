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
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { env } from '../env';
import { Prisma, type OrderStage } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

const UPLOADS = `${env.PUBLIC_URL}/uploads/`;
/** Only files sent to /uploads first: PNG or PDF (art; the counter display goes as the print shop's CMYK PDF), SVG (cut file). */
const file = z
  .string()
  .trim()
  .refine(
    (v) =>
      v.startsWith(UPLOADS) &&
      /^[\w-]+\.(png|pdf|svg)$/.test(v.slice(UPLOADS.length)),
    'Envie os arquivos (PNG, PDF ou SVG) pelo painel.',
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
    .max(501) // one art file per plate of a batch (up to 500) + the SVG
    .refine(
      (f) => f.some((v) => /\.(png|pdf)$/.test(v)),
      'Envie a arte (PNG ou PDF).',
    ),
});
/** Stage log, oldest first (admin and "cadastro" only) */
const events = {
  orderBy: { at: 'asc' },
  select: { stage: true, at: true, user: { select: { name: true } } },
} as const;

/** The stage each job finishes ("cadastro" hands ready orders to the client). Finishing it moves the order to the next. */
const QUEUE = {
  CUTTING: 'CUTTING',
  PRINTING: 'PRINTING',
  ORDERS: 'READY',
} as const;
const NEXT: Record<OrderStage, OrderStage | undefined> = {
  CUTTING: 'PRINTING',
  PRINTING: 'READY',
  READY: 'DELIVERED',
  DELIVERED: undefined,
};

/**
 * ERP (erp.<domain>). Admins and "cadastro" (ORDERS) register orders and follow all of them;
 * the cutter and the printer only see the orders waiting on their stage.
 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly prisma: PrismaService) {}

  /** Admin and "cadastro": the board (every order not delivered + the 50 latest delivered, with their stage log). The others: their queue. */
  @Get()
  async list(@CurrentUser() me: AuthUser) {
    const job = this.job(me);
    if (job === 'ADMIN' || job === 'ORDERS') {
      // ponytail: only the 50 latest delivered orders; add a search/archive when older ones are needed
      const [open, delivered] = await Promise.all([
        this.prisma.order.findMany({
          where: { stage: { not: 'DELIVERED' } },
          include: { events },
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.order.findMany({
          where: { stage: 'DELIVERED' },
          include: { events },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        }),
      ]);
      return { items: [...open, ...delivered] };
    }
    const items = await this.prisma.order.findMany({
      where: { stage: QUEUE[job] },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    // The cutter only gets the format, the quantity, the SVG cut files and the print PDFs (bleed for the die)
    return {
      items:
        job === 'CUTTING'
          ? items.map(({ name: _, ...o }) => ({
              ...o,
              files: o.files.filter((f) => /\.(svg|pdf)$/.test(f)),
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
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            ...body,
            dueDate: new Date(body.dueDate),
            events: { create: { stage: 'CUTTING', userId: me.id } },
          },
        });
        // The client typed when sending names the batch too ("Histórico de geração")
        if (body.batchId)
          await tx.plateBatch.update({
            where: { id: body.batchId },
            data: { name: body.name },
          });
        return order;
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

  /** "Finalizar etapa": the cutter finishes cutting, the printer marks it ready, "cadastro" marks it delivered. Admins finish any stage. */
  @Post(':id/done')
  async done(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const job = this.job(me);
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    const next = NEXT[order.stage];
    if (!next || (job !== 'ADMIN' && order.stage !== QUEUE[job]))
      throw new ForbiddenException('Este pedido não está na sua etapa.');
    // Guarded on the stage it was in: two clicks (or two people) can't skip a stage or log it twice
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id, stage: order.stage },
        data: { stage: next },
      });
      if (!count)
        throw new ConflictException(
          'Este pedido já mudou de etapa. Atualize a tela.',
        );
      await tx.orderEvent.create({
        data: { orderId: id, stage: next, userId: me.id },
      });
    });
    return { ...order, stage: next };
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
