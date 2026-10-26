# Contributing to Clew

Thanks for taking the time to contribute. This document covers the practical
details: how to run the project, what a change needs before it is merged, and
the sign-off we ask for.

## Before you start

- **Bugs and feature ideas:** open an issue first for anything larger than a
  small fix, so we can agree on scope before you write code.
- **Security issues:** do not open a public issue. Follow [SECURITY.md](./SECURITY.md).
- **Licensing:** by contributing you agree that your contribution is licensed
  under the [Apache License 2.0](./LICENSE), the same license as the project.
  There is no separate CLA.

## Development setup

Prerequisites: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node.js 20+ and npm.

```bash
cp .env.example .env          # change SECRET_KEY and ADMIN_PASSWORD first

cd backend
uv sync
uv run uvicorn clew.main:app --reload
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The first boot creates the admin account from `.env`. To load demo data:

```bash
cd backend
uv run python -m clew.seed_demo
```

## What a change must pass

Run the checks that match what you touched; a pull request is not ready until
they pass locally.

```bash
# backend
cd backend && uv run pytest

# frontend
cd frontend && npm run build

# end-to-end API flow (requires the backend running)
node scripts/api-e2e.mjs
```

If you changed the database schema, the import pipeline, the API contract or
the AI tool surface, update the matching document under `docs/03_dev/` in the
same pull request. The design documents under `docs/01_design/` are the single
source of truth for behavior; if implementation and design disagree, say which
one you are changing and why.

## Pull requests

- Keep the scope of a pull request to one change. Separate refactors from
  behavior changes.
- Explain the problem first, then the approach, then how you verified it.
  Screenshots or a short recording help for UI changes.
- Match the surrounding code style; do not reformat unrelated files.
- Never commit `.env`, real credentials, production data or personal data.
  The repository ignores `.env` and `data/`; keep it that way.

## Commit messages

Commit subjects are written in Simplified Chinese, short and imperative, for
example:

```text
补齐字段定位器的 409 校验
修复 XLSX 合并表头高亮偏移
```

Use the body for the reason behind the change when it is not obvious.

## Developer Certificate of Origin

Every commit must be signed off, which certifies that you wrote the change or
otherwise have the right to submit it under the project license. Add the
sign-off automatically with:

```bash
git commit -s
```

This appends a line to the commit message:

```text
Signed-off-by: Your Name <your@email>
```

Use your real name and a valid email. Pull requests with unsigned commits are
asked to amend before review.

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
