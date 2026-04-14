# MONGGEUL AGENTS

## Repository role
React/Next.js style front-end + Supabase + Toss payments + deployment readiness.

## Setup / useful commands
- Install: `pnpm install`
- Dev: `pnpm dev`
- Run payment dry drill using project test helpers or `reference/toss_e2e_guide.md`

## Required rules
- Any payment path change must include duplicate-webhook / idempotency handling.
- Any deployment readiness change must include monitor check evidence.
- Do not call Phase 2 complete until revenue readiness evidence bundle exists.

## Domain notes
- Fortune/reading product with checkout -> confirm -> webhook path.

## Layering
This file layers under `.mother/AGENTS.md` and may add repository-specific build/test/deploy guidance.
