import { AdminPage } from "@/components/AdminPage";
import { getRegions } from "@/lib/regions";

/**
 * Admin route — the CSV import + manual-add dashboard, on its own page.
 * The public home page (/) is the read-only GRID Zonal Insights surface, so the
 * data-entry tools live here.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Zonal data admin",
};

export default async function AdminRoutePage() {
  const regions = await getRegions();
  return <AdminPage initialRegions={regions} />;
}
