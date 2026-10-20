import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import type { TokenPayload } from '../common/auth';
import { PrismaService } from '../prisma.service';

// Compared against when the e-mail doesn't exist, so response time doesn't reveal which e-mails are registered
const DUMMY_HASH = hash('not-a-real-password', 10);

export const hashPassword = (password: string) => hash(password, 10);

const DAY = 24 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string, remember: boolean) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await compare(
      password,
      user?.passwordHash ?? (await DUMMY_HASH),
    );
    if (!user || !ok)
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    if (user.status !== 'ACTIVE')
      throw new ForbiddenException(
        'Sua conta está suspensa. Fale com quem gerencia o seu acesso.',
      );

    // "Lembrar login": 30 days; otherwise a work-day session
    const expiresIn = remember ? 30 * DAY : DAY / 2;
    return {
      ...(await this.token({ sub: user.id }, expiresIn)),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async token(payload: TokenPayload, expiresIn: number) {
    return {
      token: await this.jwt.signAsync(payload, { expiresIn }),
      expiresIn,
    };
  }
}
