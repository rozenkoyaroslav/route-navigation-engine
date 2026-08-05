import type { LatLng } from '../types.js';

/**
 * Encoded Polyline Algorithm Format — the compact string routing providers
 * (Google, Mapbox, Valhalla, OSRM) return route geometry in.
 *
 * Implemented here rather than pulled in as a dependency: it is forty lines,
 * and the alternative is shipping a package that carries its own opinions about
 * coordinate order.
 *
 * Coordinates are stored as deltas between consecutive points, each scaled by
 * `10^precision`, zig-zag encoded so negatives stay small, then written 5 bits
 * at a time with the high bit marking "another chunk follows".
 *
 * `precision` is 5 by default (Google, Mapbox Directions v4). Mapbox Directions
 * v5 and OSRM use 6 — decoding a 6 with a 5 silently yields coordinates off by
 * a factor of ten, which is why it is an explicit argument here.
 */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  if (typeof encoded !== 'string' || encoded.length === 0) return [];

  const factor = 10 ** precision;
  const points: LatLng[] = [];

  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    lat += decodeSignedValue();
    lng += decodeSignedValue();
    points.push({ latitude: lat / factor, longitude: lng / factor });
  }

  return points;

  function decodeSignedValue(): number {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    // Zig-zag: the low bit carries the sign.
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}

/** Inverse of {@link decodePolyline}; round-trips within the encoded precision. */
export function encodePolyline(points: readonly LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let lastLat = 0;
  let lastLng = 0;
  let encoded = '';

  for (const point of points) {
    const lat = Math.round(point.latitude * factor);
    const lng = Math.round(point.longitude * factor);

    encoded += encodeSignedValue(lat - lastLat);
    encoded += encodeSignedValue(lng - lastLng);

    lastLat = lat;
    lastLng = lng;
  }

  return encoded;
}

function encodeSignedValue(value: number): string {
  let zigzag = value < 0 ? ~(value << 1) : value << 1;
  let encoded = '';

  while (zigzag >= 0x20) {
    encoded += String.fromCharCode((0x20 | (zigzag & 0x1f)) + 63);
    zigzag >>= 5;
  }

  return encoded + String.fromCharCode(zigzag + 63);
}
