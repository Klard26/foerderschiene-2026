import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Props {
  lat: number;
  lng: number;
  label?: string;
  zoom?: number;
  className?: string;
}

export function StandortMap({ lat, lng, label, zoom = 16, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [lat, lng],
      zoom,
      scrollWheelZoom: false,
    });
    L.tileLayer("/api/geo/tiles/{z}/{x}/{y}", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap-Mitwirkende",
    }).addTo(map);

    const icon = L.divIcon({
      className: "klard-map-pin",
      html: '<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:hsl(20 90% 48%);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);transform:rotate(-45deg)"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 18],
    });
    const marker = L.marker([lat, lng], { icon }).addTo(map);
    if (label) marker.bindPopup(label);

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    map.setView([lat, lng], zoom);
    marker.setLatLng([lat, lng]);
    if (label) marker.bindPopup(label);
  }, [lat, lng, zoom, label]);

  return (
    <div
      ref={containerRef}
      className={className ?? "h-[360px] w-full rounded-lg border border-border"}
      style={{ zIndex: 0 }}
      data-testid="standort-map"
    />
  );
}
