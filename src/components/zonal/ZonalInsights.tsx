"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { fetchRegionRows } from "@/lib/client";
import { geocodeMunicipality } from "@/lib/geocode";
import { formatRange } from "@/lib/parsePeso";
import { toTitleCase } from "@/lib/toTitleCase";
import type { GeoPoint } from "./ZonalMap";
import type { RegionConfig, ZonalRow } from "@/lib/types";

// Leaflet touches `window`, so the map is client-only (no SSR).
const ZonalMap = dynamic(() => import("./ZonalMap"), {
  ssr: false,
  loading: () => <div className="zi-map-placeholder">Loading map…</div>,
});

const ALL = "";

interface Props {
  initialRegions: ReadonlyArray<RegionConfig>;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; rows: Array<ZonalRow> }
  | { status: "error"; message: string };

/** Distinct, non-empty, sorted by display form. */
function distinct(values: Iterable<string>, display: (v: string) => string): Array<string> {
  const set = new Set<string>();
  for (const v of values) if (v) set.add(v);
  return [...set].sort((a, b) => display(a).localeCompare(display(b)));
}

function statusBadgeClass(status: string): string {
  const key = status.toLowerCase().replace(/[^a-z]+/g, "-");
  return `zi-badge zi-badge-${key || "unknown"}`;
}

const asis = (v: string): string => v;

export function ZonalInsights({ initialRegions }: Props) {
  const [regions] = useState<ReadonlyArray<RegionConfig>>(initialRegions);

  // Draft selections (non-progressive — nothing computes until Run Zonal).
  const [regionId, setRegionId] = useState<string>(initialRegions[0]?.id ?? "");
  const [province, setProvince] = useState<string>(ALL);
  const [municipality, setMunicipality] = useState<string>(ALL);
  const [classification, setClassification] = useState<string>(ALL);

  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const cache = useRef<Map<string, Array<ZonalRow>>>(new Map());

  // The frozen result of one "Run Zonal". null = nothing run yet.
  const [result, setResult] = useState<{
    regionLabel: string;
    province: string;
    municipality: string;
    classification: string;
  } | null>(null);

  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [mapNote, setMapNote] = useState<string>("");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  // Fetch a region's full row set once (same seam as Search). Non-progressive:
  // this is the only effect, keyed on region.
  useEffect(() => {
    if (!regionId) {
      setLoad({ status: "idle" });
      return;
    }
    const cached = cache.current.get(regionId);
    if (cached) {
      setLoad({ status: "ready", rows: cached });
      return;
    }
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetchRegionRows(regionId, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        cache.current.set(regionId, rows);
        setLoad({ status: "ready", rows });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load this region.",
        });
      });
    return () => controller.abort();
  }, [regionId]);

  const rows = load.status === "ready" ? load.rows : [];

  // Cascading option lists (derived, not results).
  const provinceValues = useMemo(
    () => distinct(rows.map((r) => r.province), toTitleCase),
    [rows],
  );
  const municipalityValues = useMemo(() => {
    const scoped = province === ALL ? rows : rows.filter((r) => r.province === province);
    return distinct(scoped.map((r) => r.municipality), asis);
  }, [rows, province]);
  const classificationValues = useMemo(() => {
    let scoped = rows;
    if (province !== ALL) scoped = scoped.filter((r) => r.province === province);
    if (municipality !== ALL) scoped = scoped.filter((r) => r.municipality === municipality);
    return distinct(scoped.map((r) => r.classification), asis);
  }, [rows, province, municipality]);

  const regionLabel = regions.find((r) => r.id === regionId)?.label ?? "";

  const handleRegion = useCallback((id: string) => {
    setRegionId(id);
    setProvince(ALL);
    setMunicipality(ALL);
    setClassification(ALL);
    setResult(null);
    setPoint(null);
    setSelectedRowId(null);
  }, []);

  const handleUndo = useCallback(() => {
    setProvince(ALL);
    setMunicipality(ALL);
    setClassification(ALL);
    setResult(null);
    setPoint(null);
    setSelectedRowId(null);
  }, []);

  const canRun = load.status === "ready";

  const handleRun = useCallback(async () => {
    if (load.status !== "ready") return;
    setResult({ regionLabel, province, municipality, classification });
    setSelectedRowId(null);

    // Locate on the map when a municipality is chosen.
    if (municipality !== ALL) {
      const prov =
        province !== ALL
          ? province
          : rows.find((r) => r.municipality === municipality)?.province ?? "";
      setMapNote("Locating…");
      setPoint(null);
      const p = await geocodeMunicipality(municipality, prov, regionLabel);
      if (p) {
        setPoint(p);
        setMapNote("");
      } else {
        setMapNote(`Couldn't locate “${municipality}” on the map — data below is unaffected.`);
      }
    } else {
      setPoint(null);
      setMapNote("");
    }
  }, [load.status, regionLabel, province, municipality, classification, rows]);

  // --- Derived views for the frozen result --------------------------------

  // All rows matching the frozen selection (municipality required for the
  // comparison table; classification narrows further if chosen).
  const resultRows = useMemo<Array<ZonalRow>>(() => {
    if (!result) return [];
    return rows.filter(
      (r) =>
        (result.province === ALL || r.province === result.province) &&
        (result.municipality === ALL || r.municipality === result.municipality) &&
        (result.classification === ALL || r.classification === result.classification),
    );
  }, [result, rows]);

  // Municipalities-in-province list (when a province is chosen): one entry per
  // municipality with how many classification rows it has.
  const municipalitiesInProvince = useMemo(() => {
    if (!result || result.province === ALL) return [];
    const byMuni = new Map<string, number>();
    for (const r of rows) {
      if (r.province !== result.province) continue;
      byMuni.set(r.municipality, (byMuni.get(r.municipality) ?? 0) + 1);
    }
    return [...byMuni.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [result, rows]);

  const selectedRow = useMemo(
    () => resultRows.find((r) => r.id === selectedRowId) ?? null,
    [resultRows, selectedRowId],
  );

  const showComparison = result !== null && result.municipality !== ALL;
  const showProvinceList = result !== null && result.province !== ALL;

  return (
    <div className="zi">
      {/* Title band (matches GRID) */}
      <div className="zi-band">
        <span className="zi-band-back" aria-hidden>
          ‹
        </span>
        <h1>Zonal Insights</h1>
      </div>

      {/* Toolbar */}
      <div className="zi-toolbar">
        <span className="zi-credits">BIR Zonal Values · read-only</span>
        <div className="zi-toolbar-actions">
          <span className="zi-chip">Saved Locations</span>
          <span className="zi-chip">History</span>
        </div>
      </div>

      <div className="zi-main">
        {/* Picker */}
        <div className="zi-picker">
          <div className="zi-picker-tabs">
            <button type="button" className="zi-picker-tab is-active">
              Zonal Insights
            </button>
            <button type="button" className="zi-picker-tab" disabled title="Not available">
              Input Location
            </button>
          </div>
          <div className="zi-picker-body">
            <div>
              <label className="zi-field-label" htmlFor="zi-region">
                Region
              </label>
              <select
                id="zi-region"
                className="zi-select"
                value={regionId}
                onChange={(e) => handleRegion(e.target.value)}
              >
                {regions.length === 0 && <option value="">No data</option>}
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="zi-field-label" htmlFor="zi-province">
                Province
              </label>
              <select
                id="zi-province"
                className="zi-select"
                value={province}
                disabled={!canRun}
                onChange={(e) => {
                  setProvince(e.target.value);
                  setMunicipality(ALL);
                  setClassification(ALL);
                }}
              >
                <option value={ALL}>All provinces</option>
                {provinceValues.map((v) => (
                  <option key={v} value={v}>
                    {toTitleCase(v)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="zi-field-label" htmlFor="zi-municipality">
                Municipality / City
              </label>
              <select
                id="zi-municipality"
                className="zi-select"
                value={municipality}
                disabled={!canRun}
                onChange={(e) => {
                  setMunicipality(e.target.value);
                  setClassification(ALL);
                }}
              >
                <option value={ALL}>All municipalities</option>
                {municipalityValues.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="zi-field-label" htmlFor="zi-classification">
                Classification
              </label>
              <select
                id="zi-classification"
                className="zi-select"
                value={classification}
                disabled={!canRun}
                onChange={(e) => setClassification(e.target.value)}
              >
                <option value={ALL}>All classifications</option>
                {classificationValues.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            {/* Honest: the data has no barangay/street/vicinity level. */}
            <div>
              <label className="zi-field-label" htmlFor="zi-barangay">
                Barangay
              </label>
              <select id="zi-barangay" className="zi-select" disabled>
                <option>Not available for zonal data</option>
              </select>
              <p className="zi-field-note">
                BIR zonal values are published per municipality — each range already spans the
                barangays within it.
              </p>
            </div>

            <div className="zi-picker-actions">
              <button type="button" className="zi-btn zi-btn-ghost" onClick={handleUndo}>
                Undo
              </button>
              <button
                type="button"
                className="zi-btn zi-btn-primary"
                disabled={!canRun}
                onClick={() => void handleRun()}
              >
                Run Zonal
              </button>
            </div>
          </div>
        </div>

        {/* Right column: map + results */}
        <div className="zi-right">
          <div className="zi-map-wrap">
            <ZonalMap point={point} />
            <div className="zi-map-caption">
              {point
                ? `Showing ${point.label} — municipality area (approximate centre), not a specific parcel.`
                : "Select a municipality and press Run Zonal to locate it on the map."}
              {mapNote ? ` ${mapNote}` : ""}
            </div>
          </div>

          {load.status === "loading" && <div className="zi-empty">Loading {regionLabel}…</div>}
          {load.status === "error" && (
            <div className="zi-notice-error">
              <strong>Could not load data.</strong> {load.message}
            </div>
          )}

          {result === null && load.status === "ready" && (
            <div className="zi-empty">
              Choose a Province and Municipality, then press <strong>Run Zonal</strong> to see the
              published BIR zonal values.
            </div>
          )}

          {/* 1. Classification comparison table for the municipality */}
          {showComparison && (
            <section className="zi-panel">
              <div className="zi-panel-head">
                <h2>
                  {result?.municipality}
                  {result && result.province !== ALL ? `, ${toTitleCase(result.province)}` : ""}
                </h2>
                <span className="zi-panel-sub">
                  {resultRows.length} classification{resultRows.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="zi-panel-body">
                <p className="zi-disclaimer">
                  <span aria-hidden>ⓘ</span>
                  <span>
                    These are <strong>BIR zonal values</strong> — the government tax basis for this
                    area, published as a range across barangays. They are <strong>not</strong> a
                    market or per-lot price.
                  </span>
                </p>
                {resultRows.length === 0 ? (
                  <div className="zi-empty">No published rows for this selection.</div>
                ) : (
                  <table className="zi-table">
                    <thead>
                      <tr>
                        <th>Classification</th>
                        <th>Code</th>
                        <th>Zonal value (₱/sqm)</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultRows.map((r) => (
                        <tr
                          key={r.id}
                          className={
                            r.id === selectedRowId
                              ? "zi-row-clickable zi-row-active"
                              : "zi-row-clickable"
                          }
                          onClick={() => setSelectedRowId(r.id === selectedRowId ? null : r.id)}
                        >
                          <td>{r.classification}</td>
                          <td>
                            {r.code ? <span className="zi-code">{r.code}</span> : <span className="zi-muted">—</span>}
                          </td>
                          <td className="zi-range">{formatRange(r.lowText, r.highText)}</td>
                          <td>
                            <span className={statusBadgeClass(r.dataStatus)}>
                              {r.dataStatus || "Unknown"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="zi-field-note" style={{ marginTop: "0.6rem" }}>
                  Click a row for its full detail and source below.
                </p>
              </div>
            </section>
          )}

          {/* 3. Detail + provenance for the clicked row */}
          {selectedRow && (
            <section className="zi-panel">
              <div className="zi-panel-head">
                <h2>Detail &amp; source</h2>
                <span className="zi-panel-sub">
                  {selectedRow.municipality} · {selectedRow.classification}
                </span>
              </div>
              <div className="zi-panel-body">
                <dl className="zi-detail-grid">
                  <div>
                    <dt>Low (₱/sqm)</dt>
                    <dd className="zi-range">{selectedRow.lowText || "—"}</dd>
                  </div>
                  <div>
                    <dt>High (₱/sqm)</dt>
                    <dd className="zi-range">{selectedRow.highText || "—"}</dd>
                  </div>
                  <div>
                    <dt>Code</dt>
                    <dd>{selectedRow.code || "—"}</dd>
                  </div>
                  <div>
                    <dt>Data status</dt>
                    <dd>
                      <span className={statusBadgeClass(selectedRow.dataStatus)}>
                        {selectedRow.dataStatus || "Unknown"}
                      </span>
                    </dd>
                  </div>
                  <div className="zi-wide">
                    <dt>BIR Revenue District</dt>
                    <dd>{selectedRow.revenueDistrict || "—"}</dd>
                  </div>
                  <div className="zi-wide">
                    <dt>Notes / governing order</dt>
                    <dd>
                      {selectedRow.notes.commentary === null &&
                      selectedRow.notes.governingOrder === null ? (
                        <span className="zi-muted">No notes recorded.</span>
                      ) : (
                        <>
                          {selectedRow.notes.commentary && <p>{selectedRow.notes.commentary}</p>}
                          {selectedRow.notes.governingOrder && (
                            <p className="zi-note-order">{selectedRow.notes.governingOrder}</p>
                          )}
                        </>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>
          )}

          {/* 2. Municipalities-in-province list (context) */}
          {showProvinceList && municipalitiesInProvince.length > 0 && (
            <section className="zi-panel">
              <div className="zi-panel-head">
                <h2>Municipalities in {toTitleCase(result!.province)}</h2>
                <span className="zi-panel-sub">
                  {municipalitiesInProvince.length} with published values
                </span>
              </div>
              <div className="zi-panel-body">
                <table className="zi-table">
                  <thead>
                    <tr>
                      <th>Municipality / City</th>
                      <th>Rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {municipalitiesInProvince.map((m) => (
                      <tr
                        key={m.name}
                        className={
                          m.name === result?.municipality
                            ? "zi-row-clickable zi-row-active"
                            : "zi-row-clickable"
                        }
                        onClick={() => {
                          setMunicipality(m.name);
                          setClassification(ALL);
                          void handleRun();
                        }}
                      >
                        <td>{m.name}</td>
                        <td className="zi-muted">{m.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="zi-field-note" style={{ marginTop: "0.6rem" }}>
                  Click a municipality to load its zonal values.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
