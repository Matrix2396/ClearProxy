# ClearProxy

A browser-in-browser web proxy. Enter any URL in the address bar and browse through the proxy server. Tracks history and lets you save bookmarks.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/web-proxy run dev` — run the frontend (port 21325)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + Tailwind + shadcn/ui

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/` — Drizzle schema (history.ts, bookmarks.ts)
- `artifacts/api-server/src/routes/proxy.ts` — core proxy logic (HTML rewriting, header forwarding)
- `artifacts/api-server/src/routes/history.ts` — history CRUD
- `artifacts/api-server/src/routes/bookmarks.ts` — bookmarks CRUD
- `artifacts/web-proxy/src/` — React frontend

## Architecture decisions

- Proxy runs entirely server-side: the backend fetches the target URL with real browser headers, rewrites all href/src/action/CSS url() attributes to route through `/api/proxy?url=<encoded>`, and returns modified HTML.
- A small injected script in every proxied HTML page sends `postMessage` to the parent frame on navigation, so the address bar stays in sync.
- History and bookmarks stored in PostgreSQL via Drizzle ORM.
- Cookies forwarded via custom `X-Proxy-Cookie` / `X-Proxy-Set-Cookie` headers to work around cross-origin browser restrictions.
- `node-html-parser` used for HTML rewriting (fast, no DOM dependency).

## Product

- Browse any website through the proxy by typing a URL
- Back/forward/refresh browser controls
- Bookmark any page with one click
- Side panel shows full browsing history and bookmarks
- History auto-clears button, bookmark delete actions

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Some sites with heavy bot detection (Cloudflare, etc.) may still block access since the proxy IP is a server, not a residential IP.
- JavaScript-heavy SPAs may not proxy perfectly — static and SSR sites work best.
- After each OpenAPI spec change, re-run codegen: `pnpm --filter @workspace/api-spec run codegen`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
