"use client";

import { useCallback, useState } from "react";
import { AdminDashboard } from "./AdminDashboard";
import type { RegionConfig } from "@/lib/types";

/**
 * Client wrapper for the Admin dashboard on its own /admin route.
 *
 * The dashboard writes straight to Postgres (import + manual add). After a
 * write we just re-fetch the region list so a newly-added region is reflected;
 * the public Zonal Insights page reads fresh from the DB on its next load.
 */
export function AdminPage({ initialRegions }: { initialRegions: ReadonlyArray<RegionConfig> }) {
  const [regions, setRegions] = useState<ReadonlyArray<RegionConfig>>(initialRegions);

  const onDataChanged = useCallback(async () => {
    try {
      const res = await fetch("/api/regions");
      if (!res.ok) return;
      const body = (await res.json()) as { regions: Array<RegionConfig> };
      setRegions(body.regions);
    } catch {
      // non-fatal
    }
  }, []);

  return (
    <main className="page">
      <header className="masthead">
        <div>
          <h1>Zonal data admin</h1>
          <p className="subtitle">
            Import a CSV or add rows — both write to the database and appear in Zonal Insights.
          </p>
        </div>
        <nav className="viewnav" aria-label="Views">
          <a className="viewnav-tab" href="/">
            ← Zonal Insights
          </a>
        </nav>
      </header>
      <AdminDashboard regions={regions} onDataChanged={onDataChanged} />
    </main>
  );
}
