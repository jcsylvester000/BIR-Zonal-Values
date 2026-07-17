"use client";

import { Fragment, useState } from "react";
import { formatRange } from "@/lib/parsePeso";
import { toTitleCase } from "@/lib/toTitleCase";
import type { ZonalRow } from "@/lib/types";

interface Props {
  rows: ReadonlyArray<ZonalRow>;
}

const COLUMN_COUNT = 7;

function statusClass(status: string): string {
  const key = status.toLowerCase().replace(/[^a-z]+/g, "-");
  return `status status-${key || "unknown"}`;
}

function RowDetail({ row }: { row: ZonalRow }) {
  const { commentary, governingOrder } = row.notes;
  const hasNotes = commentary !== null || governingOrder !== null;

  return (
    <tr className="detail-row">
      <td colSpan={COLUMN_COUNT}>
        <dl className="detail">
          <div>
            <dt>Low</dt>
            <dd>{row.lowText || "—"}</dd>
          </div>
          <div>
            <dt>High</dt>
            <dd>{row.highText || "—"}</dd>
          </div>
          <div>
            <dt>Data status</dt>
            <dd>
              <span className={statusClass(row.dataStatus)}>{row.dataStatus || "Unknown"}</span>
            </dd>
          </div>
          <div className="detail-wide">
            <dt>Notes</dt>
            <dd>
              {hasNotes ? (
                <>
                  {commentary !== null && <p>{commentary}</p>}
                  {governingOrder !== null && <p className="detail-order">{governingOrder}</p>}
                </>
              ) : (
                <p className="detail-empty">No notes recorded for this row.</p>
              )}
            </dd>
          </div>
        </dl>
      </td>
    </tr>
  );
}

export function ResultsTable({ rows }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <table className="results">
      <thead>
        <tr>
          <th scope="col" className="col-toggle">
            <span className="visually-hidden">Expand</span>
          </th>
          <th scope="col">Municipality / City</th>
          <th scope="col">Province</th>
          <th scope="col">Code</th>
          <th scope="col">Classification</th>
          <th scope="col">Range (₱/sqm)</th>
          <th scope="col">RDO</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const expanded = expandedId === row.id;
          return (
            <Fragment key={row.id}>
              <tr className={expanded ? "result-row is-expanded" : "result-row"}>
                <td className="col-toggle">
                  <button
                    type="button"
                    className="toggle"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Hide" : "Show"} details for ${row.municipality}, ${row.classification}`}
                    onClick={() => setExpandedId(expanded ? null : row.id)}
                  >
                    {expanded ? "−" : "+"}
                  </button>
                </td>
                <td>{row.municipality}</td>
                {/* Province display normalised (BARMM ships UPPERCASE); the raw
                    value on the row is untouched and is what filtering uses. */}
                <td>{toTitleCase(row.province)}</td>
                <td>
                  {row.code ? <code>{row.code}</code> : <span className="muted">—</span>}
                </td>
                <td>{row.classification}</td>
                {/* The original strings, verbatim — never reformatted, never averaged. */}
                <td className="col-range">{formatRange(row.lowText, row.highText)}</td>
                <td className="col-rdo">{row.revenueDistrict}</td>
              </tr>
              {expanded && <RowDetail row={row} />}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
