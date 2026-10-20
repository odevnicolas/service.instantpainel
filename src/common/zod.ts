import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/** `@Body(new ZodPipe(schema))`: validates and returns the parsed (trimmed, defaulted) value. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success)
      throw new BadRequestException({
        message: 'Dados inválidos.',
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    return result.data;
  }
}

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('E-mail inválido.'));
export const password = z
  .string()
  .min(8, 'A senha deve ter pelo menos 8 caracteres.')
  .max(200);

export const listQuery = z.object({
  search: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListQuery = z.output<typeof listQuery>;

export const paginate = ({ page, perPage }: ListQuery) => ({
  skip: (page - 1) * perPage,
  take: perPage,
});
