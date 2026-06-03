# Durak App

Web "Translated Durak" card game. TypeScript monorepo (pnpm workspaces).

## Layout

```
apps/
  api/         NestJS + Fastify backend
  web/         (next phase — frontend)
packages/
  shared-types/  (next phase)
  game-engine/   (next phase)
docker/        compose + Dockerfiles + nginx config
```

## Phase 1 — Foundation (backend)

What is implemented:

- NestJS + Fastify API (`@durak/api`)
- Postgres via Prisma (User / Session / RatingHistory / GameSettingsTemplate)
- Redis-backed sessions with HttpOnly cookies
- Auth: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`
- First-admin bootstrap: `GET /api/admin/setup/status`, `POST /api/admin/setup`
- Admin CRUD: `GET/POST/PATCH/DELETE /api/admin/users` + `POST /api/admin/users/:id/reset-password`
- Self profile: `PATCH /api/me`
- Healthcheck: `GET /api/health`
- Argon2id password hashing
- Per-IP throttling on auth endpoints
- Global error filter returning `{ error: { code, message } }`

### Local development

Prerequisites: Node 20+, pnpm 9.15.0 (via corepack), Docker.

```bash
# 1. Install dependencies
corepack enable
pnpm install

# 2. Copy env
cp .env.example .env
# (edit SESSION_SECRET / COOKIE_SECRET to strong random values)

# 3. Start infra
pnpm docker:up
# (or just: docker compose -f docker/docker-compose.yml up -d postgres redis)

# 4. Run migrations
pnpm prisma:generate
pnpm prisma:migrate

# 5. Start API (in another terminal)
pnpm dev:api
```

### Creating the first admin

The setup endpoint is available **only** while there are zero admins in the DB.
After the first admin is created it returns 404 to outside callers.

```bash
# Check availability
curl http://localhost:3000/api/admin/setup/status

# Create the admin (response sets the session cookie)
curl -X POST http://localhost:3000/api/admin/setup \
  -H 'Content-Type: application/json' \
  -d '{"login":"admin","password":"changeme123","nickname":"Admin"}' \
  -c cookies.txt
```

### Tests

```bash
pnpm --filter @durak/api test
```

### Docker (full stack)

```bash
pnpm docker:up
# Nginx listens on $HTTP_PORT (default 80) and proxies /api -> api:3000,
# /socket.io -> api:3000 (WS), everything else -> web (placeholder in Phase 1).
```

## Phase 1 — Foundation (frontend)

What is implemented:

- React 18 + Vite + TypeScript SPA (`@durak/web`)
- Tailwind CSS dark theme, mobile-first
- TanStack Query + axios (cookie-session, `withCredentials: true`)
- Zustand auth store + react-router protected routes
- i18next (ru only) wiring for all UI strings
- Pages: `/login`, `/admin/setup`, `/change-password`, `/`, `/profile`, `/admin`
- Admin users: search (debounced) + pagination + create/reset-password/toggle admin/disable-restore
- Smoke test (`LoginPage.test.tsx`) via vitest + Testing Library
- Shared workspace types in `@durak/shared-types`

### Local development (frontend)

The Vite dev server proxies `/api` to the API (defaults to
`http://localhost:3000`; override with `VITE_API_PROXY_TARGET`).

```bash
# In one terminal — API
pnpm dev:api

# In another — web
pnpm dev:web
# Open http://localhost:5173
```

### Docker

In `docker compose`, the `web` service runs the production Vite build behind
nginx (`docker/Dockerfile.web`). For active frontend development run
`pnpm dev:web` separately; only the API + DB + Redis need to live in compose
during that loop.

```bash
pnpm --filter @durak/web build
pnpm --filter @durak/web test
pnpm --filter @durak/web lint
```

## Phase 2+

Lobby, WebSocket gateway, game engine, TrueSkill rating, avatar upload,
card-back UI — all coming next.
