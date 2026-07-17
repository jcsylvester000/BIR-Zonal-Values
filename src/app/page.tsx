import { App } from "@/components/App";
import { getRegions } from "@/lib/regions";

/**
 * Server component shell. Resolves the region list from Postgres on the server
 * and hands it to the interactive client `App`. Data-driven — whatever regions
 * have been imported show up here.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const regions = await getRegions();
  return <App initialRegions={regions} />;
}
