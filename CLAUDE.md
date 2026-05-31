# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**BYOS (Build Your Own Server) for TRMNL** — a Next.js 16 / React 19 server that manages TRMNL e-ink devices, schedules playlist-driven content, and renders 1-bit BMPs for those devices. The TRMNL device firmware polls this server's `/api/setup`, `/api/display`, `/api/log`, and `/api/bitmap/...` endpoints.

Stack: Next.js 16 (App Router, Turbopack, `cacheComponents` on, `standalone` output) · React 19 · Tailwind v4 · TypeScript · Kysely + `pg` against Postgres · better-auth · Biome for lint/format. Package manager is **pnpm** (lockfile is `pnpm-lock.yaml`).

## Commands

```bash
pnpm dev          # generates SQL artifacts, then `next dev --turbopack`
pnpm build        # runs prebuild (generate:sql) then `next build`
pnpm start        # serve production build
pnpm lint         # biome check on app/components/lib/utils/hooks
pnpm lint:fix     # biome check --write --unsafe
pnpm format       # biome format --write
pnpm typecheck    # tsc --noEmit
pnpm generate:sql # regenerate lib/database/sql-statements.ts from migrations/*.sql (runs automatically before dev/build)
pnpm generate:types  # kysely-codegen → lib/database/db.d.ts (needs live DATABASE_URL)
```

There is no test runner configured.

The browser renderer requires a headless Chrome sidecar: `docker-compose -f docker-compose.yml -f docker-compose.browser.yml up -d`.

## Architecture

### Routing layout (App Router with route groups)
- `app/(app)/` — authenticated dashboard UI: devices, playlists, recipes, mixup, system-logs, admin, tools, catalog. `proxy.ts` (Next.js middleware) gates these behind better-auth, redirecting to `/sign-in` unless the path is in `PUBLIC_PATHS` or `AUTH_ENABLED=false`.
- `app/(auth)/` — sign-in, sign-up, recover pages (publicly accessible).
- `app/(render)/recipes/` — public preview routes that produce rendered HTML for the browser renderer to screenshot.
- `app/api/` — JSON endpoints. Device-facing routes (`setup`, `display`, `bitmap/[[...slug]]`, `log`) are unauthenticated and identify the device via `ID` (MAC) and `Access-Token` headers. Proxy routes (`categories`, `ips`, `models`, `palettes`, `markup`) serve from a local 24h cache seeded by `data/trmnl/*.json` unless `TRMNL_PROXY_LIVE=true`.
- `app/actions/` — Next.js server actions used by the dashboard UI.

### Database access: RLS is mandatory
The DB layer has two entry points and **picking the wrong one is a tenant-isolation bug**:

- `lib/database/db.ts` — raw Kysely instance using the superuser `DATABASE_URL`. RLS is **bypassed**. Use only for unscoped reads (e.g. shared catalog data with `user_id IS NULL`) or for setup/admin work.
- `lib/database/scoped-db.ts` — `withUserScope` / `withExplicitUserScope` / `withUserScopeTransaction`. These check out a pooled connection, `SET ROLE byos_app` (a non-superuser role created by migration 0009), `SELECT set_config('app.current_user_id', ...)`, run the callback, and then `RESET ROLE` / clear the GUC before releasing. **All runtime paths that touch user-owned rows (devices, playlists, recipes, screen_configs, etc.) must go through one of these wrappers.** A previous incident (commit 2ec7510 "enforce tenant ownership in runtime paths") fixed multiple places where this was missed.

When `AUTH_ENABLED=false` ("mono-user mode"), `getCurrentUserId()` returns `BYOS_MONO_USER_ID` ("byos_mono_user", seeded by migration 0013) so RLS policies still match and FK checks still pass. Do not branch on auth-disabled to skip scoping.

### Migrations
SQL lives in `migrations/NNNN_*.sql` with `-- Title:` / `-- Description:` headers. `scripts/generate-sql-statements.js` parses them into `lib/database/sql-statements.ts` (the in-app "Initialize" button executes these via `app/actions/execute-sql.ts`) and also builds a schema-validation query from every `CREATE TABLE`. **Regenerate (`pnpm generate:sql`) whenever you add or edit a migration** — the prebuild/dev hooks do this automatically, but committed `sql-statements.ts` must match. Migration 0009 introduces the `byos_app` role and RLS; 0014 hardens those policies; 0012 adds a `schema_migrations` tracking table.

### Rendering pipeline
Three rendering backends, selected by `REACT_RENDERER`:
- `takumi` (default) — Rust/WASM Satori-compatible, fast.
- `satori` — original Vercel Satori.
- `browser` — Puppeteer against headless Chromium. Triggers a dynamic import of `lib/recipes/renderers/browser.ts` and screenshots the `/recipes/[slug]/preview` route under `app/(render)/`. Required for full TRMNL Framework UI parity. `next.config.ts` detects `puppeteer-core` / `puppeteer` at build time and adds them to `serverExternalPackages` + `outputFileTracingIncludes`.

Single render pipeline in `lib/recipes/recipe-renderer.ts`: `buildRecipeElement(slug, userId)` resolves either a React recipe (component under `app/(app)/recipes/screens/<slug>/<slug>.tsx`, metadata + optional `getData.ts` loaded from the `recipes` table) or a Liquid recipe (rendered via `lib/recipes/liquid-renderer.ts`) → `renderRecipeOutputs` produces a PNG via the chosen renderer → `utils/render-bmp.ts` Floyd–Steinberg dithers to a 1-bit BMP with TRMNL-specific headers. Outputs at 800×480 by default, optionally rendered 2× and downscaled when `renderSettings.doubleSizeForSharperText` is set.

Recipe `metadata` is JSON on the `recipes` row and conforms to `RecipeConfig` (title, published, params, props, hasDataFetch, renderSettings, tags). React recipe code is co-located with the slug in `app/(app)/recipes/screens/<slug>/` and dynamically imported at render time.

### Caching
- Next.js `cacheComponents: true` is on in `next.config.ts`.
- `cache-handler.js` is a custom Next cache handler that **only activates in development**, providing a memory-backed cache for `/api/bitmap/*` so iteration on screens doesn't constantly re-render. In production it returns null/false and Next's built-in cache takes over.
- `app/api/bitmap/wikipedia.bmp` is wired to a Vercel cron (`vercel.json`, daily at 00:00 UTC) to keep the Wikipedia screen warm.

### Auth
better-auth instance in `lib/auth/auth.ts` is **null** when `AUTH_ENABLED=false`. Always check for null before calling `auth.api.*`. The `admin` plugin promotes whoever signs up with `ADMIN_EMAIL` to the `admin` role. `proxy.ts` (file is named `proxy.ts`, not `middleware.ts`) handles route gating.

## Conventions
- Path alias `@/*` → repo root (`tsconfig.json`).
- Biome formats with **tab indentation** and double quotes — don't reformat to spaces.
- The lint script targets `app components lib utils hooks` only; other dirs (`scripts`, `migrations`, root `*.js`) aren't linted.
- Don't introduce `pnpm test` or new test scripts unless asked — there is no test setup to extend.
