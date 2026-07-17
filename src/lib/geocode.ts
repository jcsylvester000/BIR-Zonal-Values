import type { GeoPoint } from "@/components/zonal/ZonalMap";

/**
 * Geocode a municipality via OpenStreetMap's Nominatim (free, no API key).
 *
 * This only LOCATES a place — it returns the approximate centre of the named
 * municipality so the map can centre there. It is not parcel-precise and the UI
 * says so. Returns null on any failure (network, no match) so the caller can
 * degrade gracefully: the rest of Zonal Insights works without a map fix.
 *
 * We scope the query to the Philippines and pass municipality + province +
 * region for a better hit. Nominatim asks callers to identify themselves; a
 * descriptive query is enough for prototype volumes.
 */
export async function geocodeMunicipality(
  municipality: string,
  province: string,
  region: string,
): Promise<GeoPoint | null> {
  const q = [municipality, province, region, "Philippines"]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");

  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&q=" +
    encodeURIComponent(q);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    const hit = data[0];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lon = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, label: `${municipality}, ${province}` };
  } catch {
    return null;
  }
}
