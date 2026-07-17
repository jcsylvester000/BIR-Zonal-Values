"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * OpenStreetMap (Leaflet) map for Zonal Insights.
 *
 * The map LOCATES the selected municipality — it computes nothing. When a
 * geocoded point is provided, it centres and drops a marker there, clearly
 * captioned as the *municipality area*, never a parcel. No API key (OSM tiles +
 * Nominatim geocoding are free).
 */

export interface GeoPoint {
  lat: number;
  lon: number;
  label: string;
}

// Leaflet's default marker icons reference image files by URL that don't
// resolve under a bundler. Point them at the CDN copies so the pin shows.
const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Philippines-ish default view when nothing is selected.
const PH_CENTER: [number, number] = [12.8797, 121.774];
const PH_ZOOM = 5;

function Recenter({ point }: { point: GeoPoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (point) {
      map.setView([point.lat, point.lon], 11, { animate: true });
    } else {
      map.setView(PH_CENTER, PH_ZOOM, { animate: true });
    }
    // Leaflet needs a size recalc after its container becomes visible.
    setTimeout(() => map.invalidateSize(), 100);
  }, [point, map]);
  return null;
}

export default function ZonalMap({ point }: { point: GeoPoint | null }) {
  return (
    <MapContainer
      center={PH_CENTER}
      zoom={PH_ZOOM}
      scrollWheelZoom
      className="zi-map"
      attributionControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Recenter point={point} />
      {point && (
        <Marker position={[point.lat, point.lon]} icon={markerIcon}>
          <Popup>
            <strong>{point.label}</strong>
            <br />
            Municipality area (approximate centre)
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
