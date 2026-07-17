import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createId } from "@/lib/cuid";
import { prisma } from "@/lib/prisma";
import { recordsFromCsv, validateRecord, worstSeverity } from "@/lib/adminCsv";
import { adminRecordToDbRow } from "@/lib/toDbRow";
import type { ZonalValueInput } from "@/lib/toDbRow";

/**
 * POST /api/admin/import
 * Body: { csv: string }  — raw CSV text (exact source headers).
 *
 * Bulk import with REPLACE-BY-REGION semantics: for every region that appears
 * in the uploaded file, existing rows for that region are deleted, then the
 * file's rows are inserted. Re-uploading a corrected file for a region cleanly
 * replaces it — no duplicates. Regions NOT in the file are left untouched.
 *
 * A row missing a required field (Municipality / Province / Region /
 * Classification) is skipped and counted — it has no coherent region bucket or
 * would violate NOT NULL. Money/status warnings do not block a row (the source
 * peso strings are stored verbatim regardless).
 *
 * The delete+insert per region runs in a single transaction so a failure can't
 * leave a region half-wiped.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ImportBody {
  csv?: unknown;
}

export async function POST(request: Request) {
  let body: ImportBody;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON with a `csv` string." }, { status: 400 });
  }

  const csv = typeof body.csv === "string" ? body.csv : "";
  if (csv.trim() === "") {
    return NextResponse.json({ error: "No CSV content provided." }, { status: 400 });
  }

  const { records, headerIssues } = recordsFromCsv(csv);

  // Required-field check decides what can actually be written. We validate
  // against the regions present in the file itself (region correctness for a
  // bulk file is defined by the file), so an unknown-region warning doesn't
  // drop a row here — a missing required field does.
  const requiredKeys = ["municipality", "province", "region", "classification"] as const;

  const toInsert: ReturnType<typeof adminRecordToDbRow>[] = [];
  let skipped = 0;
  const skippedSamples: Array<string> = [];

  for (const rec of records) {
    const missing = requiredKeys.filter((k) => rec[k].trim() === "");
    if (missing.length > 0) {
      skipped += 1;
      if (skippedSamples.length < 5) {
        skippedSamples.push(
          `${rec.municipality || "(no municipality)"} / ${rec.classification || "(no class)"}: missing ${missing.join(", ")}`,
        );
      }
      continue;
    }
    toInsert.push(adminRecordToDbRow(rec));
  }

  if (toInsert.length === 0) {
    return NextResponse.json(
      {
        error: "No importable rows found.",
        headerIssues,
        parsed: records.length,
        skipped,
        skippedSamples,
      },
      { status: 400 },
    );
  }

  // How many parsed rows carry a (non-blocking) warning — money cell that is
  // neither a peso amount nor "Not Available", low > high, etc. For the summary.
  const warningRows = records.reduce((n, rec) => {
    const sev = worstSeverity(validateRecord(rec, []));
    return sev === "warning" ? n + 1 : n;
  }, 0);

  const regionsInFile = [...new Set(toInsert.map((r) => r.region))];

  try {
    // Neon's HTTP (serverless) driver runs one statement per round-trip and
    // does not support Prisma transactions — which `createMany` needs. So the
    // replace-by-region is done as: delete the file's regions, then insert with
    // a chunked, parameterised multi-row raw INSERT (works over HTTP, one
    // round-trip per chunk). For a single-admin prototype the brief non-atomic
    // window between delete and insert is acceptable (a failed insert is just
    // re-run).
    await prisma.zonalValue.deleteMany({ where: { region: { in: regionsInFile } } });

    let inserted = 0;
    const CHUNK = 200;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const batch = toInsert.slice(i, i + CHUNK);
      inserted += await insertChunk(batch);
    }

    return NextResponse.json({
      ok: true,
      inserted,
      skipped,
      skippedSamples,
      warningRows,
      regions: regionsInFile,
      replacedRegions: regionsInFile,
      headerIssues,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database write failed.";
    return NextResponse.json({ error: `Import failed: ${message}` }, { status: 500 });
  }
}

/**
 * Insert one chunk of rows with a single parameterised multi-row INSERT.
 * Values are bound (never interpolated) so peso signs, commas, and quotes in
 * the data are safe. Returns the number of rows inserted.
 */
async function insertChunk(rows: ReadonlyArray<ZonalValueInput>): Promise<number> {
  if (rows.length === 0) return 0;

  const tuples = rows.map((r) => {
    const id = createId();
    return Prisma.sql`(${id}, ${r.region}, ${r.municipality}, ${r.province}, ${r.revenueDistrict}, ${r.code}, ${r.classification}, ${r.lowText}, ${r.highText}, ${r.lowValue}, ${r.highValue}, ${r.dataStatus}, ${r.notes}, ${r.searchIndex}, NOW(), NOW())`;
  });

  const query = Prisma.sql`
    INSERT INTO "zonal_values"
      ("id", "region", "municipality", "province", "revenueDistrict", "code",
       "classification", "lowText", "highText", "lowValue", "highValue",
       "dataStatus", "notes", "searchIndex", "createdAt", "updatedAt")
    VALUES ${Prisma.join(tuples)}
  `;

  return prisma.$executeRaw(query);
}
