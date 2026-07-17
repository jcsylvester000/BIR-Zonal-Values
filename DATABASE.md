# Database — Neon Postgres + Prisma

The app is now connected to a **Neon Postgres** database via **Prisma**.

## What's set up

- **Prisma 6** with the **Neon serverless (HTTP) driver adapter**. Prisma talks
  to Neon over **HTTPS (443)** rather than a raw Postgres socket (5432). This
  works in environments where 5432 is blocked and is the recommended path for
  serverless deploys.
- **One unified table `zonal_values`** (see `prisma/schema.prisma`) with a
  `region` column — it replaces the three separate Airtable bases. It stores
  both the verbatim money strings (`lowText` / `highText`) and their parsed
  numbers (`lowValue` / `highValue`), plus `dataStatus`, `notes`, and a
  `searchIndex`, mirroring the app's `ZonalRow` domain model.
- The table is **already created in your Neon database** and verified with a
  live insert/read/delete round-trip. It currently has **0 rows** — ready for
  the CSV import step.

## Files

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | The `ZonalValue` model + Neon datasource |
| `src/lib/prisma.ts` | Prisma client singleton, Neon HTTP adapter |
| `.env` | `DATABASE_URL` (gitignored — never commit) |
| `.env.example` | Template for the connection string |

## Setup on your machine

```bash
npm install        # also runs `prisma generate` (postinstall)
npm run dev
```

`.env` already contains the Neon connection string, so it works out of the box.

Handy scripts:

```bash
npm run db:push    # apply schema changes to Neon
npm run db:studio  # open Prisma Studio to browse the data
```

## Security

The connection string was shared in chat, so **rotate the Neon password** once
the prototype is working (Neon dashboard → your project → Roles → reset
password), then update `DATABASE_URL` in `.env`. The string never enters the
committed code or the browser bundle — it is read server-side only.

## What's next

1. **CSV import (admin side)** — an admin endpoint that takes the uploaded CSV,
   builds `ZonalValue` rows using the existing `parsePeso` / `parseNotes` /
   `buildSearchIndex` helpers, and inserts them into `zonal_values`.
2. **Front end reads from Postgres** — swap the mock call in
   `src/app/api/zonal-values/route.ts` for a Prisma query (filtered by region).
3. **Simple admin login** — gate the admin dashboard.
