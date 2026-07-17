"use client";

import { useMemo, useRef, useState } from "react";
import {
  DATA_STATUSES,
  FIELDS,
  emptyRecord,
  templateCsv,
  validateRecord,
} from "@/lib/adminCsv";
import type { AdminFieldKey, AdminRecord } from "@/lib/adminCsv";
import type { RegionConfig } from "@/lib/types";

interface Props {
  regions: ReadonlyArray<RegionConfig>;
  /**
   * Called after a live database write (CSV import or single-row insert) so the
   * app can refresh regions and reload the current region's rows from Postgres.
   */
  onDataChanged: () => void | Promise<void>;
}

// UTF-8 BOM so ₱ survives when the template CSV is opened in Excel.
const BOM = "﻿";

function download(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function AdminDashboard({ regions, onDataChanged }: Props) {
  const defaultRegion = regions[0]?.label ?? "";
  const knownRegions = useMemo(() => regions.map((r) => r.label), [regions]);

  const [form, setForm] = useState<AdminRecord>(() => emptyRecord({ region: defaultRegion }));

  // Manual single-row insert state.
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMsg, setManualMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Bulk import state.
  const [pasted, setPasted] = useState("");
  const [dbBusy, setDbBusy] = useState(false);
  const [dbMsg, setDbMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const liveIssues = useMemo(() => validateRecord(form, knownRegions), [form, knownRegions]);

  const setField = (key: AdminFieldKey, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const resetForm = () => setForm(emptyRecord({ region: defaultRegion }));

  // --- Manual: save one row to the database --------------------------------

  const saveFormToDb = async () => {
    setManualMsg(null);
    if (liveIssues.some((i) => i.severity === "error")) {
      setManualMsg({ kind: "error", text: "Fill in the required fields first." });
      return;
    }
    setManualBusy(true);
    try {
      const res = await fetch("/api/admin/rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setManualMsg({ kind: "error", text: body.error ?? `Insert failed (HTTP ${res.status}).` });
        return;
      }
      setManualMsg({
        kind: "ok",
        text: `Saved ${form.municipality || "row"} (${form.classification}) to the database.`,
      });
      resetForm();
      await onDataChanged();
    } catch (err) {
      setManualMsg({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not reach the server.",
      });
    } finally {
      setManualBusy(false);
    }
  };

  // --- Bulk: import CSV to the database ------------------------------------

  const importCsvToDb = async (text: string) => {
    if (text.trim() === "") {
      setDbMsg({ kind: "error", text: "No CSV content to import." });
      return;
    }
    setDbBusy(true);
    setDbMsg(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        inserted?: number;
        skipped?: number;
        regions?: Array<string>;
        warningRows?: number;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setDbMsg({ kind: "error", text: body.error ?? `Import failed (HTTP ${res.status}).` });
        return;
      }
      const parts = [
        `Imported ${body.inserted} row${body.inserted === 1 ? "" : "s"} into the database`,
        body.regions && body.regions.length ? ` for ${body.regions.join(", ")}` : "",
        body.skipped ? ` · ${body.skipped} skipped (missing required fields)` : "",
        ". Existing rows for those regions were replaced.",
      ];
      setDbMsg({ kind: "ok", text: parts.join("") });
      await onDataChanged();
    } catch (err) {
      setDbMsg({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not reach the server.",
      });
    } finally {
      setDbBusy(false);
    }
  };

  const onFileToDb = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void importCsvToDb(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const downloadTemplate = () =>
    download("zonal-template.csv", BOM + templateCsv(defaultRegion), "text/csv;charset=utf-8");

  return (
    <div className="admin">
      <p className="admin-intro">
        Add zonal-value rows by hand or import a CSV — both write straight to the Postgres
        database, so the Search tab sees them right away. A CSV import{" "}
        <strong>replaces</strong> existing rows for each region in the file.
      </p>

      {/* Manual entry --------------------------------------------------- */}
      <section className="admin-section">
        <h2 className="admin-h2">Add a row</h2>
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveFormToDb();
          }}
        >
          {FIELDS.map((f) => {
            const value = form[f.key];
            const labelText = f.required ? `${f.header} *` : f.header;
            if (f.control === "region") {
              return (
                <div className="field" key={f.key}>
                  <label className="field-label" htmlFor={`f-${f.key}`}>
                    {labelText}
                  </label>
                  <select
                    id={`f-${f.key}`}
                    className="field-select"
                    value={value}
                    onChange={(e) => setField(f.key, e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {regions.map((r) => (
                      <option key={r.id} value={r.label}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            if (f.control === "status") {
              return (
                <div className="field" key={f.key}>
                  <label className="field-label" htmlFor={`f-${f.key}`}>
                    {labelText}
                  </label>
                  <select
                    id={`f-${f.key}`}
                    className="field-select"
                    value={value}
                    onChange={(e) => setField(f.key, e.target.value)}
                  >
                    <option value="">—</option>
                    {DATA_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            if (f.control === "notes") {
              return (
                <div className="field admin-field-wide" key={f.key}>
                  <label className="field-label" htmlFor={`f-${f.key}`}>
                    {labelText}
                  </label>
                  <textarea
                    id={`f-${f.key}`}
                    className="field-textarea"
                    rows={2}
                    value={value}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                </div>
              );
            }
            return (
              <div className="field" key={f.key}>
                <label className="field-label" htmlFor={`f-${f.key}`}>
                  {labelText}
                </label>
                <input
                  id={`f-${f.key}`}
                  className="field-input"
                  type="text"
                  autoComplete="off"
                  value={value}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </div>
            );
          })}

          <div className="admin-form-actions">
            {liveIssues.length > 0 && (
              <ul className="admin-live-issues">
                {liveIssues.map((issue, i) => (
                  <li key={i} className={`issue issue-${issue.severity}`}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="admin-form-buttons">
              <button type="submit" className="btn btn-primary" disabled={manualBusy}>
                {manualBusy ? "Saving…" : "Save to database"}
              </button>
            </div>
            {manualMsg && (
              <p className={manualMsg.kind === "ok" ? "admin-ok-note" : "admin-warn-note"}>
                {manualMsg.text}
              </p>
            )}
          </div>
        </form>
      </section>

      {/* Bulk CSV import ------------------------------------------------- */}
      <section className="admin-section">
        <h2 className="admin-h2">Bulk import CSV</h2>
        <p className="admin-help">
          Columns match the source headers ({FIELDS.map((f) => f.header).join(", ")}). Unknown
          columns are ignored; header order doesn&rsquo;t matter. Importing a file{" "}
          <strong>replaces all existing rows for each region in that file</strong> — re-upload a
          corrected sheet to cleanly replace it. Rows missing a required field are skipped.
        </p>
        <div className="admin-import">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="admin-file"
            disabled={dbBusy}
            onChange={(e) => {
              onFileToDb(e.target.files?.[0]);
              if (fileInput.current) fileInput.current.value = "";
            }}
          />
          <button type="button" className="btn btn-ghost" onClick={downloadTemplate}>
            Download template
          </button>
        </div>
        <details className="admin-paste">
          <summary>or paste CSV text</summary>
          <textarea
            className="field-textarea"
            rows={4}
            placeholder="Municipality / City,Province,Region,…"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <div className="admin-import">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pasted.trim() === "" || dbBusy}
              onClick={() => {
                void importCsvToDb(pasted).then(() => setPasted(""));
              }}
            >
              {dbBusy ? "Importing…" : "Import pasted CSV"}
            </button>
          </div>
        </details>
        {dbBusy && <p className="admin-help">Writing to the database…</p>}
        {dbMsg && (
          <div className={`notice ${dbMsg.kind === "error" ? "notice-error" : ""}`}>
            <p>
              <strong>{dbMsg.text}</strong>
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
