import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { email } from '../common/zod';
import { isHttpUrl, youtubeId } from '../common/urls';
import { env } from '../env';

// Mirror of the painel's LinkPage contract (instantpainel: app/painel/_pagina/config.ts). Keep both in sync.

const url = z
  .string()
  .trim()
  .max(2000)
  .refine(isHttpUrl, 'Endereço inválido: use um link http(s) completo.');
const optionalUrl = z.union([z.literal(''), url]);
/** Logo, background, PDF and images: only files uploaded here first (POST /uploads); local blob: or third-party URLs are rejected. */
export const file = z
  .string()
  .trim()
  .refine(
    (v) => v.startsWith(`${env.PUBLIC_URL}/uploads/`) && !v.includes('..'),
    'Envie o arquivo pelo painel antes de salvar.',
  );
const optionalFile = z.union([z.literal(''), file]);
const text = (max: number) => z.string().trim().max(max);
const label = text(80).min(1, 'Informe o texto do botão.');
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'Cor inválida.');

const block = <T extends z.ZodRawShape>(type: string, shape: T) =>
  z.object({ id: z.string().min(1).max(64), type: z.literal(type), ...shape });

export const blockSchema = z.discriminatedUnion('type', [
  block('link', { label, url }),
  block('whatsapp', {
    label,
    phone: text(30).min(8, 'Informe o WhatsApp com DDD.'),
    message: text(500),
  }),
  block('instagram', { label, user: text(60).min(1) }),
  block('review', { label, url }),
  block('pix', {
    keyType: z.enum(['cpf', 'cnpj', 'email', 'telefone', 'aleatoria']),
    key: text(120).min(1),
  }),
  block('text', { text: text(2000).min(1) }),
  block('contact', {
    label,
    name: text(100).min(1),
    phone: text(30),
    email: z.union([z.literal(''), email]),
  }).refine(
    (b) => b.phone || b.email,
    'Informe telefone ou e-mail no contato.',
  ),
  block('wifi', {
    ssid: text(64).min(1),
    password: z.string().max(64),
    security: z.enum(['WPA', 'WEP', 'nopass']),
  }),
  block('youtube', {
    url: url.refine(
      (v) => Boolean(youtubeId(v)),
      'Link do YouTube não reconhecido.',
    ),
  }),
  block('pdf', { label, file }),
  block('product', {
    name: text(100).min(1),
    price: text(30),
    description: text(1000),
    image: optionalFile,
    url: optionalUrl,
    buttonLabel: text(40),
  }),
  block('spacer', { height: z.number().int().min(8).max(96) }),
  block('image', { src: file, url: optionalUrl }),
  block('gallery', { images: z.array(file).min(1).max(10) }),
]);

/** Subtitle rich text: basic formatting and text color only (what the painel's editor produces). */
const sanitizeSubtitle = (html: string) =>
  sanitizeHtml(html, {
    allowedTags: [
      'b',
      'i',
      'u',
      'strong',
      'em',
      'br',
      'div',
      'p',
      'span',
      'font',
    ],
    allowedAttributes: {
      font: ['color'],
      span: ['style'],
      div: ['style'],
      p: ['style'],
    },
    allowedStyles: {
      '*': { color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*[\d.\s,%]+\)$/i] },
    },
  });

export const pageSchema = z.object({
  slug: z
    .string()
    .max(60)
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'Use letras minúsculas, números e hífen no link da página.',
    ),
  title: text(100).min(1, 'Informe o título.'),
  subtitle: z.string().max(10_000).transform(sanitizeSubtitle),
  subtitleStyle: z.object({
    size: z.number().int().min(8).max(32),
    lineHeight: z.number().min(0.8).max(3),
    align: z.enum(['left', 'center', 'right', 'justify']),
  }),
  /** "Usuários com acesso"; the owner may be included, it's ignored. Every e-mail must belong to an existing user. */
  users: z.array(email).max(50).default([]),
  logo: z.object({
    src: optionalFile,
    shape: z.enum(['original', 'circle', 'rounded']),
    size: z.union([z.literal(30), z.literal(50), z.literal(70)]),
  }),
  background: z.object({
    image: optionalFile,
    blur: z.number().int().min(0).max(20),
    overlay: z.enum(['none', 'dark', 'light']),
  }),
  colors: z.object({
    top: hex,
    base: hex,
    button: hex,
    buttonText: hex,
    accent: hex,
    card: hex,
    cardText: hex,
  }),
  buttons: z.object({
    shape: z.enum(['pill', 'rounded', 'square']),
    style: z.enum(['solid', 'outline', 'glass']),
  }),
  blocks: z.array(blockSchema).max(50),
});
export type PageBody = z.output<typeof pageSchema>;
