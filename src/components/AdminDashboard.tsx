"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  DATA_STATUSES,
  FIELDS,
  emptyRecord,
  recordsFromCsv,
  templateCsv,
  toCsv,
  toJson,
  validateRecord,
  worstSeverity,
} from "@/lib/adminCsv";
import type { AdminFieldKey, AdminRecord, Issue } from "@/lib/adminCsv";
import { formatRange } from "@/lib/parsePeso";
import { toTitleCase } from "@/lib/toTitleCase";
import type { RegionConfig } from "@/lib/types";

export interface StagedRecord {
  id: string;
  data: AdminRecord;
}

export interface SaveOutcome {
  saved: number;
  skipped: number;
  regionLabels: Array<string>;
}

interface Props {
  regions: ReadonlyArray<RegionConfig>;
  records: Array<StagedRecord>;
  setRecords: Dispatch<SetStateAction<Array<StagedRecord>>>;
  /**
   * Commit staged rows into the in-memory Search dataset (a quick local
   * preview); returns what happened. `targetRegionId` routes every row there;
   * `null` falls back to matching each row's own Region field.
   */
  onSave: (records: ReadonlyArray<AdminRecord>, targetRegionId: string | null) => SaveOutcome;
  /**
   * Called after a live database write (CSV import or single-row insert) so the
   * app can refresh regions and reload the current region's rows from Postgres.
   */
  onDataChanged: () => void | Promise<void>;
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `stg-${idSeq}`;
}

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

const ALL_REGIONS = "__all__";
const MATCH_PER_ROW = "__match__";

// UTF-8 BOM so ₱ survives when the CSV is opened in Excel.
const BOM = "﻿";

export function AdminDashboard({ regions, records, setRecords, onSave, onDataChanged }: Props) {
  const defaultRegion = regions[0]?.label ?? "";
  const knownRegions = useMemo(() => regions.map((r) => r.label), [regions]);

  const [form, setForm] = useState<AdminRecord>(() => emptyRecord({ region: defaultRegion }));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [importNote, setImportNote] = useState<{ added: number; headerIssues: Array<string> } | null>(
    null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  // --- Live database write state -------------------------------------------
  const [dbBusy, setDbBusy] = useState(false);
  const [dbMsg, setDbMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMsg, setManualMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saveTargetId, setSaveTargetId] = useState<string>(regions[0]?.id ?? "");
  const [exportRegion, setExportRegion] = useState<string>(ALL_REGIONS);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    setSaveError(null);
    const target = saveTargetId === MATCH_PER_ROW ? null : saveTargetId;
    const outcome = onSave(
      records.map((r) => r.data),
      target,
    );
    if (outcome.saved === 0) {
      setSaveError(
        "Nothing was added to Search. With “Each row’s Region field” selected, the " +
          "Region column must match a configured region exactly — pick a specific region above " +
          "instead to route every row there.",
      );
    }
    // On success App switches to the Search tab and reveals the rows.
  };

  // Validation for every staged row, recomputed only when rows change.
  const validations = useMemo(
    () => records.map((r) => validateRecord(r.data, knownRegions)),
    [records, knownRegions],
  );
  const liveIssues = useMemo(() => validateRecord(form, knownRegions), [form, knownRegions]);

  const errorRows = validations.filter((v) => v.some((i) => i.severity === "error")).length;
  const warnRows = validations.filter(
    (v) => !v.some((i) => i.severity === "error") && v.length > 0,
  ).length;

  const setField = (key: AdminFieldKey, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const resetForm = () => {
    setForm(emptyRecord({ region: defaultRegion }));
    setEditingId(null);
  };

  const submitForm = () => {
    if (editingId) {
      setRecords((rs) => rs.map((r) => (r.id === editingId ? { ...r, data: form } : r)));
    } else {
      setRecords((rs) => [...rs, { id: nextId(), data: form }]);
    }
    resetForm();
  };

  const editRow = (row: StagedRecord) => {
    setForm(row.data);
    setEditingId(row.id);
    setImportNote(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeRow = (id: string) => {
    setRecords((rs) => rs.filter((r) => r.id !== id));
    if (editingId === id) resetForm();
  };

  const importText = (text: string) => {
    const { records: recs, headerIssues } = recordsFromCsv(text);
    setRecords((rs) => [...rs, ...recs.map((data) => ({ id: nextId(), data }))]);
    setImportNote({ added: recs.length, headerIssues });
  };

  // --- Live database writes -------------------------------------------------

  /**
   * Send raw CSV text straight to the database. Replace-by-region: the server
   * deletes existing rows for each region in the file, then inserts the file's
   * rows. This is the bulk-import path.
   */
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
        headerIssues?: Array<string>;
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
        body.warningRows ? ` · ${body.warningRows} with warnings` : "",
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

  /** Insert the single manual-entry form row directly into the database. */
  const saveFormToDb = async () => {
    setManualMsg(null);
    const localIssues = validateRecord(form, knownRegions);
    if (localIssues.some((i) => i.severity === "error")) {
      setManualMsg({ kind: "error", text: "Fix the required-field errors above first." });
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

  const exportRecords = useMemo(() => {
    const all = records.map((r) => r.data);
    return exportRegion === ALL_REGIONS ? all : all.filter((d) => d.region === exportRegion);
  }, [records, exportRegion]);

  const downloadCsv = () =>
    download("zonal-values.csv", BOM + toCsv(exportRecords), "text/csv;charset=utf-8");
  const downloadJson = () =>
    download("zonal-values.json", toJson(exportRecords), "application/json");
  const downloadTemplate = () =>
    download("zonal-template.csv", BOM + templateCsv(defaultRegion), "text/csv;charset=utf-8");

  return (
    <div className="admin">
      <p className="admin-intro">
        Add zonal-value rows by hand or import a CSV — both write straight to the Postgres
        database, so the Search tab sees them right away. A CSV import{" "}
        <strong>replaces</strong> existing rows for each region in the file. Staging and export
        below are optional helpers.
      </p>

      {/* Manual entry --------------------------------------------------- */}
      <section className="admin-section">
        <h2 className="admin-h2">{editingId ? "Edit row" : "Add a row"}</h2>
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
              {editingId && (
                <button type="button" className="btn btn-ghost" onClick={resetForm}>
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                title="Add to the staging table below (not yet saved to the database)"
                onClick={submitForm}
              >
                {editingId ? "Update staged row" : "Stage row"}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={manualBusy}
              >
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

      {/* Bulk CSV import to database ------------------------------------- */}
      <section className="admin-section">
        <h2 className="admin-h2">Bulk import CSV to database</h2>
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
              {dbBusy ? "Importing…" : "Import pasted CSV to database"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pasted.trim() === ""}
              title="Add to the staging table instead of writing to the database"
              onClick={() => {
                importText(pasted);
                setPasted("");
              }}
            >
              Stage instead
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
        {importNote && (
          <div className={`notice ${importNote.headerIssues.length > 0 ? "notice-error" : ""}`}>
            <p>
              <strong>
                Staged {importNote.added} {importNote.added === 1 ? "row" : "rows"} (not yet in the
                database).
              </strong>
            </p>
            {importNote.headerIssues.map((issue, i) => (
              <p key={i}>{issue}</p>
            ))}
          </div>
        )}
      </section>

      {/* Staged rows ---------------------------------------------------- */}
      <section className="admin-section">
        <div className="admin-staged-head">
          <h2 className="admin-h2">
            Staged rows{" "}
            <span className="admin-count">
              {records.length} · {errorRows} with errors · {warnRows} with warnings
            </span>
          </h2>
          {records.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setRecords([])}>
              Clear all
            </button>
          )}
        </div>

        {records.length === 0 ? (
          <p className="admin-empty">No rows staged yet. Add one above or import a CSV.</p>
        ) : (
          <table className="results admin-table">
            <thead>
              <tr>
                <th scope="col" className="col-toggle">
                  <span className="visually-hidden">Status</span>
                </th>
                <th scope="col">Municipality / City</th>
                <th scope="col">Province</th>
                <th scope="col">Region</th>
                <th scope="col">Classification</th>
                <th scope="col">Range (₱/sqm)</th>
                <th scope="col">Status</th>
                <th scope="col" className="admin-col-actions">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {records.map((row, index) => {
                const issues: Array<Issue> = validations[index] ?? [];
                const severity = worstSeverity(issues);
                const expanded = expandedId === row.id;
                const badgeLabel =
                  severity === "error"
                    ? `${issues.length} ⚠`
                    : severity === "warning"
                      ? `${issues.length} !`
                      : "OK";
                return (
                  <Fragment key={row.id}>
                    <tr className={expanded ? "result-row is-expanded" : "result-row"}>
                      <td className="col-toggle">
                        {issues.length > 0 ? (
                          <button
                            type="button"
                            className="toggle"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "Hide" : "Show"} ${issues.length} issue(s)`}
                            onClick={() => setExpandedId(expanded ? null : row.id)}
                          >
                            {expanded ? "−" : "+"}
                          </button>
                        ) : (
                          <span className="visually-hidden">No issues</span>
                        )}
                      </td>
                      <td>{row.data.municipality || <span className="muted">—</span>}</td>
                      <td>{row.data.province ? toTitleCase(row.data.province) : <span className="muted">—</span>}</td>
                      <td>{row.data.region || <span className="muted">—</span>}</td>
                      <td>{row.data.classification || <span className="muted">—</span>}</td>
                      <td className="col-range">{formatRange(row.data.lowText, row.data.highText)}</td>
                      <td>
                        <span className={`badge badge-${severity ?? "ok"}`}>{badgeLabel}</span>
                      </td>
                      <td className="admin-col-actions">
                        <button type="button" className="linkbtn" onClick={() => editRow(row)}>
                          Edit
                        </button>
                        <button type="button" className="linkbtn linkbtn-danger" onClick={() => removeRow(row.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                    {expanded && issues.length > 0 && (
                      <tr className="detail-row">
                        <td colSpan={8}>
                          <ul className="admin-issue-list">
                            {issues.map((issue, i) => (
                              <li key={i} className={`issue issue-${issue.severity}`}>
                                {issue.message}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Save to Search ------------------------------------------------- */}
      <section className="admin-section admin-save">
        <h2 className="admin-h2">Add to Search</h2>
        <p className="admin-help">
          Save the staged rows into this session&rsquo;s Search data so they appear in the Search
          tab right away. Pick which region they belong to below. This is <strong>in-memory
          only</strong> — it does not write to the database yet, and the rows clear on a page
          refresh. To keep an import-ready copy, export the CSV below.
        </p>
        <div className="admin-save-bar">
          <div className="field admin-save-target">
            <label className="field-label" htmlFor="save-target">
              Add these rows to
            </label>
            <select
              id="save-target"
              className="field-select"
              value={saveTargetId}
              onChange={(e) => setSaveTargetId(e.target.value)}
            >
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
              <option value={MATCH_PER_ROW}>Each row&rsquo;s Region field</option>
            </select>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={records.length === 0}
            onClick={handleSave}
          >
            Save {records.length} {records.length === 1 ? "row" : "rows"} to Search
          </button>
        </div>
        {saveError && <p className="admin-warn-note">{saveError}</p>}
      </section>

      {/* Export --------------------------------------------------------- */}
      <section className="admin-section admin-export">
        <h2 className="admin-h2">Export</h2>
        <p className="admin-help">
          Export one region at a time to get an import-ready CSV or JSON for that region.
        </p>
        <div className="admin-export-bar">
          <div className="field admin-export-region">
            <label className="field-label" htmlFor="export-region">
              Region to export
            </label>
            <select
              id="export-region"
              className="field-select"
              value={exportRegion}
              onChange={(e) => setExportRegion(e.target.value)}
            >
              <option value={ALL_REGIONS}>All regions ({records.length})</option>
              {regions.map((r) => (
                <option key={r.id} value={r.label}>
                  {r.label} ({records.filter((row) => row.data.region === r.label).length})
                </option>
              ))}
            </select>
          </div>
          <div className="admin-export-buttons">
            <button
              type="button"
              className="btn btn-primary"
              disabled={exportRecords.length === 0}
              onClick={downloadCsv}
            >
              Download CSV ({exportRecords.length})
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={exportRecords.length === 0}
              onClick={downloadJson}
            >
              Download JSON
            </button>
          </div>
        </div>
        {errorRows > 0 && (
          <p className="admin-warn-note">
            {errorRows} staged {errorRows === 1 ? "row has" : "rows have"} required-field errors.
            You can still export, but those cells will import blank.
          </p>
        )}
      </section>
    </div>
  );
}
