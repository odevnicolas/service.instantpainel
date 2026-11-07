import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

const DAY = 86_400_000;
const TZ = 'America/Sao_Paulo';
// ponytail: fixed UTC-3 for day boundaries (Brazil dropped DST in 2019); use a tz library if that ever changes
const OFFSET = '-03:00';

/** "YYYY-MM-DD" of `date` in São Paulo. */
const ymd = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: TZ });
/** Start of a São Paulo day, as an instant. */
const startOf = (day: string) => new Date(`${day}T00:00:00${OFFSET}`);

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The last `days` days in São Paulo, today included, plus the same-length period right before. */
  period(days: number, now = new Date()) {
    const start = startOf(ymd(new Date(now.getTime() - (days - 1) * DAY)));
    return {
      start,
      previousStart: new Date(start.getTime() - days * DAY),
      end: now,
    };
  }

  /**
   * Accesses per day for one product ("Ver acessos"), oldest first, zero-filled: its plate's scans plus
   * direct visits to the page it leads to. `count` is both, `link` the direct visits among them.
   */
  async daily(plate: { code: string; pageId: string | null }, days: number) {
    const { start } = this.period(days);
    const rows = await this.prisma.$queryRaw<
      { day: string; count: number; link: number }[]
    >(Prisma.sql`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day,
        count(*)::int AS count, count(*) FILTER (WHERE "plateCode" IS NULL)::int AS link
      FROM "Hit"
      WHERE ("plateCode" = ${plate.code} OR ("plateCode" IS NULL AND "pageId" = ${plate.pageId})) AND "createdAt" >= ${start}
      GROUP BY 1`);
    const byDay = new Map(rows.map((r) => [r.day, r]));
    return Array.from({ length: days }, (_, i) => {
      const date = ymd(
        new Date(start.getTime() + i * DAY + 12 * 60 * 60 * 1000),
      ); // noon: safe from offset edges
      const row = byDay.get(date);
      return { date, count: row?.count ?? 0, link: row?.link ?? 0 };
    });
  }

  /** Hits per plate in the current and previous period (plates with no hits are left out). */
  async counts(codes: string[], days: number) {
    const { start, previousStart } = this.period(days);
    const group = (gte: Date, lt?: Date) =>
      this.prisma.hit.groupBy({
        by: ['plateCode'],
        where: { plateCode: { in: codes }, createdAt: { gte, lt } },
        _count: true,
      });
    const [current, previous] = await Promise.all([
      group(start),
      group(previousStart, start),
    ]);
    return {
      current: new Map(current.map((g) => [g.plateCode, g._count])),
      previous: new Map(previous.map((g) => [g.plateCode, g._count])),
    };
  }
}
