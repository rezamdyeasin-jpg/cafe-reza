declare module "*.css";
declare module "*.mjs" {
  export function mapsSearchUrl(place: { label?: string; venue?: string; address?: string; locality?: string; region?: string; country?: string; lat?: number; lng?: number; source?: string }): string | null;
  export function mapsDirectionsUrl(destination: { label?: string; venue?: string; address?: string; locality?: string; region?: string; country?: string; lat?: number; lng?: number; source?: string }, options?: { origin?: { lat: number; lng: number }; travelmode?: string }): string | null;
}
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.png";
declare module "*.webp";
declare module "*.mp4";
