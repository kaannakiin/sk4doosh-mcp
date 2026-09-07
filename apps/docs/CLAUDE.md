# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Scope: `apps/docs`, the sk-mcp documentation site. The repo-root `CLAUDE.md` still applies — this
file adds what is specific to this app and overrides it where stated.

## Commands

Run from the repo root:

- `pnpm --filter @sk-mcp/docs dev` — dev server on `http://localhost:5180`
- `pnpm turbo run build --filter=@sk-mcp/docs` — production build into `dist/`
- `pnpm --filter @sk-mcp/docs start` — serve the SSR build (requires a build first)
- `pnpm --filter @sk-mcp/docs lint` / `check-types`

Use turbo for `build` so `^build` dependencies resolve; `dev` and `start` do not need it. There
are no tests in this app.

## Writing documentation

**Read [dokuman-kurallari.md](dokuman-kurallari.md) before adding or editing any page.** It is the
binding convention: Diátaxis four-mode taxonomy, one page = one mode, reference is generated not
written, RFC 2119 keywords stay in `packages/spec`, every code example must have been run.

Pages are markdown under `src/content/`. The directory is the Diátaxis mode:
`tutorial/`, `how-to/`, `reference/`, `explanation/`, plus ungrouped top-level orientation pages.
Order comes from the numeric filename prefix, the title from the first `#` line, the slug from the
filename with that prefix stripped. Slugs must be unique across all directories — the route is a
flat `/docs/$slug`.

Nothing registers a page. `src/lib/content.ts` globs the tree at build time and derives the
sidebar; adding a file is the whole operation.

## Language

Site content and UI strings are **English** — this site is sk-mcp's public face. This overrides the
root CLAUDE.md's Turkish-prose rule, which governs `docs/` and `packages/spec/`. `dokuman-kurallari.md`
is internal and stays Turkish. There is no i18n layer, by design.

## Style layers — the one thing that breaks silently

`src/styles/app.css` is three lines and all three matter:

```css
@layer theme, base, components, mantine, utilities;
@import "tailwindcss" source("../");
@import "@mantine/core/styles.layer.css";
```

Tailwind preflight lives in `base`, ahead of `mantine`, so it cannot flatten Mantine component
styles. Tailwind utilities live in `utilities`, after `mantine`, so `<Button className="mt-4">`
works. The `@layer` statement must precede the `@import`s (CSS spec), and the first declaration is
what fixes the order.

Import `@mantine/core/styles.layer.css`, never `styles.css`, and never both — Mantine's own docs
forbid the pair. If a Mantine component ever looks unstyled, check this file first.

## Gotchas

- **Router links inside Mantine components**: use Mantine's `renderRoot`, not TanStack's
  `createLink`. `createLink` cannot infer props through Mantine's polymorphic `<C = "a">` generic
  and the component loses its own prop types. See `src/routes/docs.tsx`.
- **`src/routeTree.gen.ts` is generated and committed.** TanStack Router writes it on dev/build.
  Turbo runs `check-types` in parallel with `build`, not after it, so a clean checkout needs the
  file present or `tsc --noEmit` fails. Do not hand-edit it.
- **`viteReact()` must come after `tanstackStart()`** in `vite.config.ts`. Reversing them breaks
  the build.
- **`postcss.config.js` is not for Tailwind.** Tailwind goes through `@tailwindcss/vite`. The
  PostCSS config exists only so `.module.css` files can use Mantine mixins (`@mixin dark`, `rem()`).
- **`tsconfig.json` overrides the shared base to `moduleResolution: Bundler`** because
  `@sk-mcp/typescript-config/base.json` is `NodeNext` and TanStack Start requires Bundler. Leave
  `verbatimModuleSyntax` off — Start's docs warn it can leak server bundles into the client.
