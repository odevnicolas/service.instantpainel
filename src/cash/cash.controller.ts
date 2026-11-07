import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma.service';

const dayQuery = z.object({ date: z.iso.date('Informe o dia.') });
const createBody = z.object({
  date: z.iso.date('Informe o dia.'),
  kind: z.enum(['IN', 'OUT']),
  amount: z
    .number()
    .int()
    .min(1, 'Informe o valor.')
    .max(100_000_000, 'Valor muito alto.'), // R$ 1 milhão; the column is a 32-bit int
  description: z.string().trim().min(1, 'Informe a descrição.').max(200),
});

/** "Caixa": money in and out of each day. Admins only. */
@Controller('cash')
@Roles('ADMIN')
export class CashController {
  constructor(private readonly prisma: PrismaService) {}

  /** The day's entries, oldest first (the painel sums them). */
  @Get()
  async list(
    @Query(new ZodPipe(dayQuery)) { date }: z.output<typeof dayQuery>,
  ) {
    return {
      items: await this.prisma.cashEntry.findMany({
        where: { date: new Date(date) },
        orderBy: { id: 'asc' },
      }),
    };
  }

  @Post()
  create(@Body(new ZodPipe(createBody)) body: z.output<typeof createBody>) {
    return this.prisma.cashEntry.create({
      data: { ...body, date: new Date(body.date) },
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number) {
    const { count } = await this.prisma.cashEntry.deleteMany({ where: { id } });
    if (!count) throw new NotFoundException('Lançamento não encontrado.');
  }
}
