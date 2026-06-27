# Build & Config Review

Scope reviewed:
- `package.json`
- `tsconfig.json`
- `tsconfig.app.json`
- `vite.config.ts`
- `biome.json`
- `vitest.config.ts`
- `playwright.config.ts`
- `postcss.config.mjs`
- `wrangler.toml`
- `.npmrc`
- `.nvmrc`
- `index.html`

Verification performed:
- Installed dependencies with `npm ci` so local build/test tools resolved from this repository.
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm test` passed: 129 files, 1337 passed, 16 skipped.
- `npm run build` passed and generated PWA assets.
- `npx wrangler deploy --dry-run` passed, but exercised the Worker/static-assets path rather than a Cloudflare Pages config path.
- A temporary Vitest probe confirmed `MOCK_EDGE_FUNCTIONS=false` is overwritten to `true` by `vitest.config.ts`; the probe file was removed.
- `./node_modules/.bin/biome check vitest.config.ts playwright.config.ts postcss.config.mjs wrangler.toml package.json tsconfig.json tsconfig.app.json index.html` processed 0 files because `biome.json` ignores those paths.

## package.json

### Finding 1
- Category: bug
- Severity: high
- Line numbers: `package.json:21-22`, `vitest.config.ts:34-36`
- Description: `test:sync:live` sets `MOCK_EDGE_FUNCTIONS=false` and `SYNC_LIVE_TESTS=true`, but `vitest.config.ts` unconditionally injects `MOCK_EDGE_FUNCTIONS: "true"` into every Vitest run. A temporary probe run with `MOCK_EDGE_FUNCTIONS=false` printed `MOCK_EDGE_FUNCTIONS=true`, confirming that the live-sync script still runs mocked. This creates false confidence around the only script intended to hit live Edge Functions/Supabase behavior.
- Suggested fix direction: Make the Vitest default conditional, for example `MOCK_EDGE_FUNCTIONS: process.env.MOCK_EDGE_FUNCTIONS ?? "true"`, or move the default into the non-live npm scripts so explicit caller environment wins.

## tsconfig.json

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: `tsconfig.json:2-5`, `tsconfig.app.json:25`
- Description: The root TypeScript project references only `tsconfig.app.json`, and the app config includes only `src`. Build/test/deployment config files such as `vite.config.ts`, `vitest.config.ts`, and `playwright.config.ts` are therefore outside the normal `npm run typecheck` coverage. Since these files control production build, tests, and E2E execution, type errors or stale API usage in them can evade the standard typecheck gate.
- Suggested fix direction: Add a separate Node/config TypeScript project such as `tsconfig.node.json` covering `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, and relevant scripts, then reference it from the root `tsconfig.json` or run it in `npm run typecheck`.

## tsconfig.app.json

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: `tsconfig.app.json:23`
- Description: Application source is compiled with `"types": ["vitest/globals", "vite-plugin-pwa/react"]`. This makes test globals such as `describe`, `it`, `expect`, and `vi` visible to all production `src` files. A mistaken test-only global reference in application code can typecheck successfully even though it is not a runtime browser global.
- Suggested fix direction: Remove `vitest/globals` from the application tsconfig and place it in a dedicated test tsconfig or Vitest-only type setup. Keep production app types limited to browser/Vite/PWA runtime types.

## vite.config.ts

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: `vite.config.ts:173-181`
- Description: `vite.config.ts` contains a `test` block even though the repository also has `vitest.config.ts`, and the two configurations drift. The Vite config only includes `src/**/*` and `tests/security/**/*`, while `vitest.config.ts` includes `tests/**/*`, inlines `body-muscles`, sets coverage, and injects mock env. If an IDE, developer command, or future CI path accidentally uses `vite.config.ts` as the Vitest config, it can silently run a narrower/different test suite.
- Suggested fix direction: Keep Vitest settings in one place. Remove the `test` block from `vite.config.ts`, or import shared constants from a single test-config module so both entry points cannot drift.

## biome.json

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: `biome.json:8-10`
- Description: The Biome file set is restricted to `src/**/*.ts`, `src/**/*.tsx`, and `vite.config.ts`. Running Biome directly against the assigned build/config files processed 0 files and reported that `vitest.config.ts`, `playwright.config.ts`, `postcss.config.mjs`, `wrangler.toml`, `package.json`, `tsconfig*.json`, and `index.html` were ignored. As a result, the `npm run lint` gate does not actually lint or format most build, test, deployment, and HTML configuration reviewed here.
- Suggested fix direction: Expand `files.includes` to cover all lintable config files, for example `*.config.ts`, `*.config.mjs`, `package.json`, `tsconfig*.json`, `index.html`, and any supported deployment config files. If some files must remain unlinted, document the exclusion explicitly.

## vitest.config.ts

Cross-file issue: see `package.json` Finding 1 for the high-severity live-sync bug caused by `vitest.config.ts:34-36` overriding `MOCK_EDGE_FUNCTIONS=false` from `package.json:22`.

## playwright.config.ts

No findings identified in this file during this pass.

## postcss.config.mjs

No findings identified in this file during this pass.

## wrangler.toml

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: `wrangler.toml:1`, `wrangler.toml:7-12`
- Description: The file is labeled as Cloudflare Pages configuration, but it uses Workers/static-assets keys (`[assets] directory = "./dist"`) and does not declare the Pages-specific `pages_build_output_dir = "./dist"`. Cloudflare Pages documentation says Pages Wrangler configuration uses `pages_build_output_dir`; without it, a Pages project can continue relying on dashboard-only settings or treat the file as local-only, creating deployment drift between source control and production.
- Suggested fix direction: If this is intended to be a Pages project config, replace the Workers assets block with `pages_build_output_dir = "./dist"` and migrate the full Pages config into source control. If this is intended for Workers static assets, update comments/naming so operators do not assume it governs Pages Git deployments.

### Finding 2
- Category: failure-point
- Severity: medium
- Line numbers: `wrangler.toml:11-12`
- Description: The configured deployment build command runs `npm run build && npm run assert:no-sourcemaps && npm run assert:supabase-config`, but it skips `npm run typecheck` and `npm run lint`. Vite production builds transpile TypeScript but do not provide the same type-safety gate as `tsc --noEmit`, so a direct Wrangler deployment can ship code that would fail the repository's stronger `verify` script.
- Suggested fix direction: Use the same quality gate for deploy builds, for example `npm run lint && npm run typecheck && npm run build && npm run assert:no-sourcemaps && npm run assert:supabase-config`, or delegate to a deploy-safe variant of `npm run verify`.

## .npmrc

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: `.npmrc:1`
- Description: `legacy-peer-deps=true` disables npm's peer-dependency conflict enforcement for every install. That can be useful as a temporary compatibility workaround, but it also allows incompatible React/Vite/testing-library peer combinations to install silently and makes CI less likely to catch dependency graph regressions.
- Suggested fix direction: Document why this is required and periodically test `npm ci --legacy-peer-deps=false` in CI or a scheduled dependency job. Remove the setting once upstream peer ranges support the chosen stack.

## .nvmrc

No findings identified in this file during this pass.

## index.html

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: `index.html:14`
- Description: `og:image` is configured as a relative path (`/phoenix-hero.png`). Some Open Graph/Twitter/social crawlers require an absolute URL and can fail to render preview images correctly when only a relative URL is provided.
- Suggested fix direction: Use an absolute canonical URL such as `https://portal.phoenixproject.app/phoenix-hero.png`, and consider adding `twitter:image` with the same absolute URL.

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: `index.html:22-23`
- Description: The Google Fonts CSS is requested twice: once as `rel="preload" as="style"` and again immediately as `rel="stylesheet"` with the same URL. Depending on browser/preload behavior, this can waste an extra request or make the preload ineffective rather than improving first render.
- Suggested fix direction: Either remove the preload and keep the stylesheet, or use the standard preload-to-stylesheet pattern with an `onload` swap plus a `noscript` fallback if the extra complexity is justified.

## Summary

Findings count: 10

Severity breakdown:
- Critical: 0
- High: 1
- Medium: 5
- Low: 4
