# service.instantpainel

API do InstantPainel (NestJS + Prisma + PostgreSQL). Atende o painel (`instantpainel`) e o frontend público das páginas de links.

## Rodando local

```bash
npm install            # também gera o Prisma Client (postinstall)
cp .env.example .env   # preencha JWT_SECRET, ADMIN_EMAIL e ADMIN_PASSWORD
npm run db:up          # Postgres 17 no Docker, porta 5433 (cria também o banco de teste)
npm run db:deploy      # aplica as migrações
npm run seed           # cria o primeiro admin (ADMIN_EMAIL / ADMIN_PASSWORD)
npm run start:dev      # http://localhost:3333
```

- Mudou o `prisma/schema.prisma`? `npm run db:migrate -- --name <nome>` e depois `npx prisma generate`.
- Testes e2e (fluxo completo num banco separado, `instantpainel_test`): `npm run test:e2e`.

## Conceitos

| Painel | API / banco |
|---|---|
| Plaquinha | `Plate` (código de 4 caracteres, sem 0/O/1/I). Vazia até ser ativada. |
| Produto | `Plate` ativada: tem dono e aponta para uma página ou para um link próprio. |
| Página | `Page`: `slug`, `title` e o resto da configuração (`content`, JSON). |
| Acesso | `Hit`: cada leitura do QR/NFC (`GET /r/:code`). |

**Produção (ERP):** `User.erpRole` é separado do nível do painel: `ORDERS` (cadastro de pedidos), `CUTTING` (corte do plástico) ou `PRINTING` (impressão e montagem); só o admin define. Um `Order` passa por `CUTTING` → `PRINTING` → `READY` (pronto para entrega) → `DELIVERED` (entregue) e normalmente nasce de um lote de plaquinhas ("Enviar para produção"), um pedido por lote. Cada mudança de etapa grava um `OrderEvent` (etapa, quem, quando): o tempo de cada etapa vai de um evento ao seguinte.

**Níveis:** `ADMIN` vê tudo e gera plaquinhas. `RESELLER` (revendedor) vê o que é seu, dos clientes que gerencia e o que foi compartilhado com ele. `CLIENT` vê o que é seu e o que foi compartilhado.

O formato da página espelha o painel (`app/painel/_pagina/config.ts`) e é validado em `src/pages/page.schema.ts`; mantenha os dois iguais. O subtítulo (HTML) é sanitizado no servidor: só negrito, itálico, sublinhado e cor. Arquivos (logo, fundo, PDF, imagens) precisam ser enviados antes em `POST /uploads`; URLs `blob:` são recusadas.

## Autenticação

`POST /auth/login` devolve `{ token, expiresIn, user }`. Mande `Authorization: Bearer <token>` em todas as rotas, exceto as públicas. "Lembrar login" (`remember: true`) dá 30 dias; sem ele, 12 horas. Login limitado a 5 tentativas por minuto por IP. Usuário suspenso perde a sessão na hora.

Erros vêm como `{ message, statusCode }` em português, prontos para mostrar na tela; erros de validação trazem também `issues: [{ path, message }]`.

## Endpoints

Listas aceitam `?search=&page=1&perPage=20` e devolvem `{ items, total }`.

### Conta
| Método | Rota | Tela | Corpo / observações |
|---|---|---|---|
| POST | `/auth/login` | Login | `{ email, password, remember? }` · público |
| GET | `/me` | Barra lateral, Minha conta | `impersonating: true` durante "Logar como" |
| PATCH | `/me` | Minha conta | `{ name }` |
| POST | `/me/password` | Minha conta | `{ current, next }` |

### Usuários (ADMIN, RESELLER)
| Método | Rota | Tela | Corpo / observações |
|---|---|---|---|
| GET | `/users` | Usuários | `?role=CLIENT\|RESELLER` · cada item traz `pages` |
| POST | `/users` | Criar usuário | `{ name, email, password, role?, erpRole? }` · revendedor só cria `CLIENT`; `erpRole` só o admin |
| POST | `/users/link` | Relacionar usuário existente | `{ email }` |
| PATCH | `/users/:id` | Editar | `{ name?, password?, role? (só admin) }` |
| POST | `/users/:id/suspend` · `/activate` | Suspender | |
| DELETE | `/users/:id` | Excluir | apaga as páginas do usuário; as plaquinhas ficam sem dono |
| POST | `/users/:id/impersonate` | Logar como | devolve `{ token }` de 2 horas |

### Plaquinhas e produtos
| Método | Rota | Tela | Corpo / observações |
|---|---|---|---|
| POST | `/plates` | Plaquinhas (admin) | `{ name, count, baseUrl, google?, art?, layout? }` (1–500) → `{ batch, codes }` · `art` (de `/uploads`) e `layout` (formato, posição, tamanho e cor do QR, PIX) ficam salvos para redesenhar as plaquinhas depois |
| GET | `/plates/batches` | Histórico de geração | cada lote traz `name`, `art`, `layout` e `order: { id, stage } \| null` |
| GET | `/public/plates/:code` | Ativar / Configurar | público · `{ status: "empty" \| "active" }` |
| POST | `/plates/:code/activate` | Ativar / Configurar | `{ link }` ou `{ page: slug }`, e `google?` |
| GET | `/products` | Meus produtos | cada item: `page`, `owner`, `views`, `description`… |
| GET | `/products/:code` | Editar produto | traz `users` (dono primeiro) |
| PATCH | `/products/:code` | Editar produto / descrição interna | `{ title?, link?, reviewFilter?, description?, users? }` |
| POST | `/products/:code/unlink` | Desvincular | |
| GET | `/products/:code/stats` | Ver acessos | `?days=7\|30\|90` → `{ days: [{ date, count }] }` (dias de São Paulo) |
| GET | `/ranking` | Ranking de acessos | `?days=7\|30\|90` → `items` com `current`/`previous`, `summary`, `period` |

### Páginas
| Método | Rota | Tela | Corpo / observações |
|---|---|---|---|
| GET | `/pages` | Minhas páginas | `?onlyMine=true` · itens: `slug, title, owner, products, views` |
| GET | `/pages/:slug` | Editar página | a configuração completa (LinkPage) |
| POST | `/pages` | Criar página | LinkPage · 409 se o link já existir |
| PUT | `/pages/:slug` | Editar página | LinkPage (pode trocar o `slug`) |
| DELETE | `/pages/:slug` | Excluir | só dono, quem o gerencia ou admin; plaquinhas ficam sem página |
| GET | `/pages/:slug/plates` | Vincular | códigos vinculados |
| POST | `/pages/:slug/plates` | Vincular | `{ code }`: código ou link da plaquinha; plaquinha vazia é ativada para você |
| POST | `/pages/:slug/plates/unlink` | Desvincular selecionados / todos | `{ codes: [] }` |

### Produção (ERP)
Admin faz tudo. Os demais precisam de `erpRole` (senão 403).

| Método | Rota | Quem | Corpo / observações |
|---|---|---|---|
| GET | `/orders` | todos | admin e cadastro: o quadro (todos os não entregues + os 50 últimos entregues), cada um com `events: [{ stage, at, user }]`; corte e impressão só a fila da sua etapa, por prazo. O corte recebe só os SVGs e não recebe `name` |
| POST | `/orders` | admin, cadastro | `{ name, batchId?, plateType, quantity, dueDate: "AAAA-MM-DD", files }` · arquivos de `/uploads`, PNG obrigatório · com `batchId`, o `name` vira o nome do lote · 409 se o lote já foi enviado |
| POST | `/orders/:id/done` | corte, impressão, cadastro, admin | conclui a etapa atual: corte → impressão → pronto → entregue (a entrega é do cadastro) · 409 se outra pessoa já mudou a etapa |
| DELETE | `/orders/:id` | admin, cadastro | o lote volta a poder ser enviado |

### Público e arquivos
| Método | Rota | Uso |
|---|---|---|
| GET | `/r/:code` | Leitura do QR/NFC: conta o acesso e redireciona (página → `LINKS_URL/slug`, link próprio, ou `APP_URL/configurar/:code` se vazia) |
| GET | `/public/pages/:slug` | O que o frontend público renderiza (sem a lista de usuários) |
| POST | `/uploads` | `multipart/form-data`, campo `file` (até 10 MB; PNG, JPG, WEBP, GIF, SVG ou PDF, conferido pelo conteúdo) → `{ url }` |
| GET | `/uploads/:arquivo` | Arquivo enviado (SVG servido em sandbox) · `?download=nome.png` força o download |

## Pendências conhecidas

- **Uploads em disco local** (`UPLOAD_DIR`): troque por armazenamento de objetos (S3, Vercel Blob…) antes de rodar mais de uma instância.
- **Contagem de acessos sem filtro** de robôs ou de leituras repetidas.
- **"Configurações" do usuário** e **"Bloco Dinâmico"/"Rodapé"**: ainda sem definição no painel, então sem API.
- A **busca de empresas no Google** continua no painel (server action com cache), não passa por aqui.
