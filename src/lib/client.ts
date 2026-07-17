import type { ZonalRow } from "./types";

/**
 * Client-side fetcher for a region's rows. Wraps the /api/zonal-values seam so
 * components never build URLs or shape-check the response themselves. Signal is
 * threaded through so a region switch can abort an in-flight request, exactly
 * as the original AbortController pattern did.
 */
export async function fetchRegionRows(
  regionId: string,
  signal: AbortSignal,
): Promise<Array<ZonalRow>> {
  const url = `/api/zonal-values?region=${encodeURIComponent(regionId)}`;

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new Error("Could not reach the server. Check your network connection.");
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }

  const body = (await response.json()) as { region: string; rows: Array<ZonalRow> };
  return body.rows;
}
