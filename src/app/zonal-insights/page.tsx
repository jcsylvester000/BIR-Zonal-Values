import { ZonalInsights } from "@/components/zonal/ZonalInsights";
import { getRegions } from "@/lib/regions";
import "./zonal.css";

/**
 * Standalone Zonal Insights page, GRID-styled. Reads the region list from
 * Postgres on the server and hands it to the client component. This is the
 * panel that drops into GRID's existing "Zonal Insights" tab — it does not
 * render GRID's own nav/header/footer.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Zonal Insights",
};

export default async function ZonalInsightsPage() {
  const regions = await getRegions();
  return <ZonalInsights initialRegions={regions} />;
}
