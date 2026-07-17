# BIR Zonal Value Search

A web app for searching Philippine **BIR zonal values** (₱ per square metre land
valuations) by municipality and land classification, with an admin side for
uploading and managing the data.

Built with **Next.js (App Router) · React · TypeScript · Prisma · Neon Postgres**.

---

## Features

**Search (public side)**

- Filter by Region → Province → Municipality/City → Classification, plus free-text search.
- Results load only when you press **Run Zonal** (a deliberate, non-live search).
- Each row shows the full price *range* (low–high), never an average — the low and
  high are different locations within the municipality.
- Expand any row for data status and governing-order notes.

**Admin side**

- **Add a row by hand** — writes straight to the database.
- **Bulk-import a CSV** — writes straight to the database. Importing a file
  **replaces** all existing rows for each region in that file, so re-uploading a
  corrected sheet cleanly replaces it (no duplicates).
- Per-row validation, plus optional staging and CSV/JSON export helpers.

Regions are **data-driven**: import a CSV for a new region and it simply appears
in the search dropdown — no code change needed.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| UI | React 18 + TypeScript (strict) |
| Styling | Plain CSS (CSS variables), no UI library |
| ORM | Prisma 6 |
| Database | PostgreSQL on [Neon](https://neon.tech) (serverless HTTP driver) |

Data flows through a single API boundary (`/api/zonal-values`), and all zonal
data lives in one unified `zonal_values` table with a `region` column.

---

## Getting started

### 1. Install

```bash
npm install
```

`postinstall` runs `prisma generate` automatically.

### 2. Configure the database

Copy the example env file and fill in your Neon connection string:

```bash
cp .env.example .env
```

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require&channel_binding=require"
```

> `.env` is gitignored — never commit real credentials.

### 3. Create the table

```bash
npm run db:push
```

This applies `prisma/schema.prisma` to your database.

### 4. Run

```bash
npm run dev        # http://localhost:3000
```

Open the app, go to the **Admin** tab, and import a CSV or add a row. It appears
in **Search** immediately.

---

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (also typechecks) |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` only |
| `npm run db:push` | Apply the Prisma schema to the database |
| `npm run db:studio` | Open Prisma Studio to browse the data |

---

## CSV format

The importer expects these column headers (order doesn't matter; unknown columns
are ignored):

```
Municipality / City, Province, Region, BIR Revenue District, Code,
Classification, Low (₱/sqm), High (₱/sqm), Data Status, Notes
```

Required: **Municipality / City**, **Province**, **Region**, **Classification**.
Money cells may be a peso amount (`₱2,839.3`) or an explicit
`Not Available — Verification Required`. A blank template is available from the
Admin tab (**Download template**).

---

## Project layout

```
src/
  app/
    layout.tsx  page.tsx  globals.css
    api/
      zonal-values/   GET  ?region=<id>   → rows for a region (search)
      regions/        GET                 → distinct regions
      admin/import/   POST { csv }        → bulk import (replace-by-region)
      admin/rows/     POST { record }     → insert one row
  components/         App, FilterPanel, ResultsTable, AdminDashboard
  lib/
    prisma.ts         Prisma client (Neon HTTP adapter)
    regions.ts        data-driven region list
    toDbRow.ts        record ↔ DB row mapping
    parsePeso, notes, search, toTitleCase, adminCsv, types
prisma/schema.prisma
```

---

## Notes

- The Neon **serverless HTTP driver** is used so the app runs anywhere HTTPS is
  available (including serverless/edge) without a raw Postgres socket.
- Database credentials live only in `.env` (server-side) — they never reach the
  browser bundle.
