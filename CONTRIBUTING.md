# Contributing to Slotter

Thanks for your interest in improving Slotter. This is a small, focused project — contributions that keep it simple and self-hostable are especially welcome.

## Getting set up

1. Fork and clone the repo.
2. `npm install`
3. Create a free Supabase project, run `db/schema.sql` then `db/seed.sql` in its SQL editor.
4. `cp .env.example .env.local` and fill in the required values (see the README's environment reference). Keep `APP_MODE=demo` for local work.
5. `npm run dev`

## Before you open a pull request

- **Run the tests.** `npm run test` (unit) and `npx playwright test` (end-to-end) should both pass.
- **Keep demo mode working.** Every feature must be fully exercisable in `demo` mode with no external services — that's what lets people evaluate the project in five minutes. If you add a `prod` integration, add a matching `demo` adapter.
- **Don't break the security model.** All database access goes through the anon key + `x-bh-key` header, enforced by RLS and the guarded `SECURITY DEFINER` functions. New tables need an RLS policy; new write paths should go through a guarded function.
- **Match the existing style.** TypeScript, small pure functions where possible (see `lib/engine/`), no new heavy dependencies without a good reason.

## Reporting bugs

Open an issue with steps to reproduce, what you expected, and what happened. If it's a booking-logic or timezone bug, a failing test case is the most helpful thing you can include.

## Scope

Slotter aims to cover roughly the 80% of small-business booking needs — appointments, callbacks, deposits, and group classes — without becoming a heavyweight scheduling platform. Features that serve that core well are in scope; large, niche additions may be better as a fork.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
