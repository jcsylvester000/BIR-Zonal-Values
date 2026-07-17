import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emptyRecord } from "@/lib/adminCsv";
import type { AdminFieldKey, AdminRecord } from "@/lib/adminCsv";
import { adminRecordToDbRow, dbRowToZonalRow } from "@/lib/toDbRow";

/**
 * POST /api/admin/rows
 * Body: a partial AdminRecord (the manual-entry form's fields).
 *
 * Inserts ONE row directly into Postgres — the "admin adds a value" flow. It
 * shows up in front-end search immediately. Required fields (Municipality /
 * Province / Region / Classification) are enforced; everything else is
 * optional and stored as given. Money is stored verbatim AND parsed, via the
 * shared row builder, so a manually-added row is identical to an imported or
 * fetched one.
 */

export const dynamic = "force-dynamic";

const REQUIRED: ReadonlyArray<AdminFieldKey> = [
  "municipality",
  "province",
  "region",
  "classification",
];

function coerceRecord(input: unknown): AdminRecord {
  const src = (input ?? {}) as Partial<Record<AdminFieldKey, unknown>>;
  const rec = emptyRecord();
  (Object.keys(rec) as Array<AdminFieldKey>).forEach((k) => {
    const v = src[k];
    if (typeof v === "string") rec[k] = v;
  });
  return rec;
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
  }

  const rec = coerceRecord(raw);

  const missing = REQUIRED.filter((k) => rec[k].trim() === "");
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required field(s): ${missing.join(", ")}.` },
      { status: 400 },
    );
  }

  try {
    const created = await prisma.zonalValue.create({ data: adminRecordToDbRow(rec) });
    return NextResponse.json({ ok: true, row: dbRowToZonalRow(created) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database write failed.";
    return NextResponse.json({ error: `Insert failed: ${message}` }, { status: 500 });
  }
}
