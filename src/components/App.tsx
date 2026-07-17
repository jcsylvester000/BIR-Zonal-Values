"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminDashboard } from "./AdminDashboard";
import type { SaveOutcome, StagedRecord } from "./AdminDashboard";
import { ALL, FilterPanel } from "./FilterPanel";
import type { FilterState } from "./FilterPanel";
import { ResultsTable } from "./ResultsTable";
import { fetchRegionRows } from "@/lib/client";
import { adminRecordToZonalRow } from "@/lib/adminCsv";
import type { AdminRecord } from "@/lib/adminCsv";
import { searchRows } from "@/lib/search";
import type { RegionConfig, ZonalRow } from "@/lib/types";

type View = "search" | "admin";

/**
 * The frozen output of one submit. `null` means "no search has been run yet",
 * which is a different state from "a search ran and matched nothing".
 */
interface Results {
  query: string;
  rows: Array<ZonalRow>;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; rows: Array<ZonalRow> }
  | { status: "error"; message: string };

const EMPTY_FILTERS: FilterState = {
  province: ALL,
  municipality: ALL,
  classification: ALL,
  text: "",
};

/**
 * Apply the dropdown filters as exact matches on the raw field values, on top
 * of whatever the text matcher already narrowed to. Raw values, so province
 * matching stays case-exact against the stored "LANAO DEL SUR" — the title-cased
 * form is display only and never reaches here.
 */
function applyFilters(rows: Array<ZonalRow>, filters: FilterState): Array<ZonalRow> {
  return rows.filter(
    (row) =>
      (filters.province === ALL || row.province === filters.province) &&
      (filters.municipality === ALL || row.municipality === filters.municipality) &&
      (filters.classification === ALL || row.classification === filters.classification),
  );
}

export function App({ initialRegions }: { initialRegions: ReadonlyArray<RegionConfig> }) {
  // Regions are data-driven and can change after an admin import, so they live
  // in state (seeded from the server) rather than being a fixed prop.
  const [regions, setRegions] = useState<ReadonlyArray<RegionConfig>>(initialRegions);
  const firstRegion = regions[0];

  const [view, setView] = useState<View>(firstRegion ? "search" : "admin");
  const [regionId, setRegionId] = useState<string>(firstRegion?.id ?? "");

  // Pull the current region list from the DB — called after an import so a
  // newly-added region appears without a full page reload.
  const refreshRegions = useCallback(async () => {
    try {
      const res = await fetch("/api/regions");
      if (!res.ok) return;
      const body = (await res.json()) as { regions: Array<RegionConfig> };
      setRegions(body.regions);
      // If nothing is selected yet (DB was empty), select the first region now.
      setRegionId((cur) => cur || body.regions[0]?.id || "");
    } catch {
      // non-fatal; the dropdown just keeps its current list
    }
  }, []);
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const [results, setResults] = useState<Results | null>(null);

  // Draft filter selections. These are the "controls' own state": changing any
  // of them re-renders the panel but never recomputes `results`.
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  // Rows saved from the admin dashboard, in memory only, keyed by region id.
  // They are merged into the searchable set alongside the fetched rows.
  const [localByRegion, setLocalByRegion] = useState<Record<string, Array<ZonalRow>>>({});
  // Staged admin rows are lifted here so switching tabs doesn't discard them.
  const [stagedRecords, setStagedRecords] = useState<Array<StagedRecord>>([]);
  // After a save, reveal the saved region's rows once its data is ready.
  const [pendingReveal, setPendingReveal] = useState<string | null>(null);

  /**
   * One cache entry per region, so re-selecting a region you already loaded is
   * instant and costs no request. A ref, not state: writing to it must never
   * schedule a render.
   */
  const cache = useRef<Map<string, Array<ZonalRow>>>(new Map());

  const region = regions.find((r) => r.id === regionId) ?? firstRegion ?? null;

  // Fetched rows plus any saved-from-admin rows for this region. `[]` until the
  // region's fetch resolves. Memoised so a plain re-render doesn't hand
  // FilterPanel a fresh array and force its option lists to recompute.
  const searchableRows = useMemo<Array<ZonalRow>>(
    () => (load.status === "ready" ? [...load.rows, ...(localByRegion[regionId] ?? [])] : []),
    [load, localByRegion, regionId],
  );

  // The ONLY data effect. Fetches (and caches) on region change. Deliberately
  // not keyed on `filters` — a second effect there would quietly turn this into
  // a live-filtering UI, which is exactly what it must not be. Keyed on
  // `regionId` (a stable string), not the region object, so a regions-list
  // refresh doesn't retrigger a fetch for the same region.
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
        const message =
          error instanceof Error
            ? error.message
            : "Something went wrong while loading this region.";
        setLoad({ status: "error", message });
      });

    return () => controller.abort();
  }, [regionId]);

  /**
   * One-shot reveal after a save. Not filter-driven — it fires only while a
   * `pendingReveal` is set (by handleSave), lists the region's full merged set
   * once, then clears itself. It never runs on a dropdown change.
   */
  useEffect(() => {
    if (pendingReveal === null || regionId !== pendingReveal || load.status !== "ready") return;
    setResults({ query: "", rows: [...load.rows, ...(localByRegion[regionId] ?? [])] });
    setPendingReveal(null);
  }, [pendingReveal, regionId, load, localByRegion]);

  /**
   * Region change is the one input that does more than update its own control:
   * it drops the frozen results and clears downstream selections, so XIII rows
   * never appear under a XII heading and a stale province filter can't survive.
   */
  const handleRegion = useCallback((id: string) => {
    setRegionId(id);
    setResults(null);
    setFilters(EMPTY_FILTERS);
  }, []);

  // Cascading resets: changing a parent clears its now-stale children so the
  // narrowed option lists stay coherent. This is a control-level concern only;
  // no results recompute here.
  const handleProvince = useCallback((province: string) => {
    setFilters((prev) => ({ ...prev, province, municipality: ALL, classification: ALL }));
  }, []);

  const handleMunicipality = useCallback((municipality: string) => {
    setFilters((prev) => ({ ...prev, municipality, classification: ALL }));
  }, []);

  const handleClassification = useCallback((classification: string) => {
    setFilters((prev) => ({ ...prev, classification }));
  }, []);

  const handleText = useCallback((text: string) => {
    setFilters((prev) => ({ ...prev, text }));
  }, []);

  const handleReset = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setResults(null);
  }, []);

  /**
   * The only path to a new result set. Runs against the in-memory array
   * (fetched rows plus any saved-from-admin rows for this region) — text
   * matcher first, dropdown filters exact-matched on top.
   */
  const handleSubmit = useCallback(() => {
    if (load.status !== "ready") return;
    const base = [...load.rows, ...(localByRegion[regionId] ?? [])];
    const matched = applyFilters(searchRows(base, filters.text), filters);
    setResults({ query: filters.text.trim(), rows: matched });
  }, [load, filters, localByRegion, regionId]);

  /**
   * Commit staged admin rows into the in-memory Search dataset, grouped by the
   * region each row names. Unmatched-region rows are skipped and reported. On
   * success we jump to the Search tab, select the first saved region, and let
   * the reveal effect list the rows.
   */
  const handleSave = useCallback(
    (recs: ReadonlyArray<AdminRecord>, targetRegionId: string | null): SaveOutcome => {
      const additions: Record<string, Array<ZonalRow>> = {};
      const savedRegionIds: Array<string> = [];
      let saved = 0;
      let skipped = 0;

      recs.forEach((rec) => {
        // Explicit target routes every row there; otherwise fall back to a
        // case-insensitive match on the row's own Region field.
        const target = targetRegionId
          ? regions.find((r) => r.id === targetRegionId)
          : regions.find((r) => r.label.toLowerCase() === rec.region.trim().toLowerCase());
        if (!target) {
          skipped += 1;
          return;
        }
        const row = adminRecordToZonalRow(rec);
        // When a region is chosen explicitly, stamp it so the row is coherent
        // with the bucket it now lives in.
        if (targetRegionId) row.region = target.label;
        (additions[target.id] ??= []).push(row);
        saved += 1;
        if (!savedRegionIds.includes(target.id)) savedRegionIds.push(target.id);
      });

      const reveal = savedRegionIds[0];
      if (saved > 0 && reveal) {
        setLocalByRegion((prev) => {
          const next = { ...prev };
          for (const rid of Object.keys(additions)) {
            next[rid] = [...(next[rid] ?? []), ...(additions[rid] ?? [])];
          }
          return next;
        });
        setStagedRecords([]);
        setView("search");
        setRegionId(reveal);
        setFilters(EMPTY_FILTERS);
        setResults(null);
        setPendingReveal(reveal);
      }

      const regionLabels = savedRegionIds.map(
        (id) => regions.find((r) => r.id === id)?.label ?? id,
      );
      return { saved, skipped, regionLabels };
    },
    [regions],
  );

  /**
   * Called after a live DB write from Admin (import or single insert). Drops
   * the per-region cache so the next region view re-fetches fresh data, and
   * refreshes the region list so a newly-imported region appears. If the
   * currently-selected region was just replaced, its cache entry is gone, so
   * switching back to it (or staying on it) reloads.
   */
  const handleDataChanged = useCallback(async () => {
    cache.current.clear();
    await refreshRegions();
    // Force the current region to reload by nudging the load state; the fetch
    // effect keys on regionId, so re-selecting the same id won't refire. Clear
    // results and mark idle→loading via a cache miss on next selection instead:
    if (regionId) {
      setLoad({ status: "loading" });
      const controller = new AbortController();
      try {
        const rows = await fetchRegionRows(regionId, controller.signal);
        cache.current.set(regionId, rows);
        setLoad({ status: "ready", rows });
      } catch {
        setLoad({ status: "idle" });
      }
    }
  }, [refreshRegions, regionId]);

  const ready = load.status === "ready";
  const regionLabel = region?.label ?? "this region";
  const hasRegions = regions.length > 0;

  return (
    <main className="page">
      <header className="masthead">
        <div>
          <h1>BIR zonal value search</h1>
          <p className="subtitle">
            Land valuations in ₱ per square metre, by municipality and classification.
          </p>
        </div>
        <nav className="viewnav" aria-label="Views">
          <button
            type="button"
            className={view === "search" ? "viewnav-tab is-active" : "viewnav-tab"}
            aria-current={view === "search"}
            onClick={() => setView("search")}
          >
            Search
          </button>
          <button
            type="button"
            className={view === "admin" ? "viewnav-tab is-active" : "viewnav-tab"}
            aria-current={view === "admin"}
            onClick={() => setView("admin")}
          >
            Admin
          </button>
        </nav>
      </header>

      {view === "admin" ? (
        <AdminDashboard
          regions={regions}
          records={stagedRecords}
          setRecords={setStagedRecords}
          onSave={handleSave}
          onDataChanged={handleDataChanged}
        />
      ) : (
        <>
          <div className="layout">
            <FilterPanel
              regions={regions}
              regionId={regionId}
              rows={searchableRows}
              loading={load.status === "loading"}
              ready={ready}
              filters={filters}
              onRegionChange={handleRegion}
              onProvinceChange={handleProvince}
              onMunicipalityChange={handleMunicipality}
              onClassificationChange={handleClassification}
              onTextChange={handleText}
              onSubmit={handleSubmit}
              onReset={handleReset}
            />

            <section className="results-panel" aria-live="polite">
              {!hasRegions && (
                <div className="notice notice-empty">
                  <p>
                    <strong>No data yet.</strong>
                  </p>
                  <p className="muted">
                    Go to the <strong>Admin</strong> tab to import a CSV or add a row, then it will
                    appear here.
                  </p>
                </div>
              )}

              {hasRegions && load.status === "loading" && (
                <p className="notice">Loading {regionLabel}…</p>
              )}

              {hasRegions && load.status === "error" && (
                <div className="notice notice-error" role="alert">
                  <strong>Could not load {regionLabel}.</strong>
                  <p>{load.message}</p>
                </div>
              )}

              {hasRegions && ready && results === null && (
                <div className="notice notice-empty">
                  <p>
                    <strong>
                      {searchableRows.length} rows loaded for {regionLabel}.
                    </strong>
                  </p>
                  <p className="muted">
                    Narrow with the dropdowns, or search a municipality, a code (<code>CR</code>), or
                    a classification — then press <strong>Run Zonal</strong>.
                  </p>
                </div>
              )}

              {hasRegions && ready && results !== null && (
                <>
                  <p className="count">
                    {results.rows.length === 0
                      ? results.query === ""
                        ? "No results"
                        : `No results for “${results.query}”`
                      : `${results.rows.length} ${results.rows.length === 1 ? "result" : "results"}`}
                  </p>
                  {results.rows.length > 0 && <ResultsTable rows={results.rows} />}
                </>
              )}
            </section>
          </div>

          <footer className="footnote">
            <p>
              Each row is a range across barangays, not a single value. The low and high are
              different locations — don’t average them or quote either as the municipality’s
              zonal value.
            </p>
          </footer>
        </>
      )}
    </main>
  );
}
