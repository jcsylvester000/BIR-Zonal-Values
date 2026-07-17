import { ZonalInsights } from "@/components/zonal/ZonalInsights";
import { getRegions } from "@/lib/regions";
import "./zonal-insights/zonal.css";

/**
 * Home page IS the GRID-styled Zonal Insights surface. Resolves the region list
 * from Postgres on the server and hands it to the client component. Opening the
 * app root shows the navy/copper Zonal Insights design directly.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const regions = await getRegions();
  return <ZonalInsights initialRegions={regions} />;
}
