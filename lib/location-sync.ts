import { SUPPORTED_CITIES, type CityName } from "./couju.ts";

type LocatedPoint = {
  city: string | null;
  location: { lng: number; lat: number };
  label: string;
};

export function synchronizeDetectedLocation<T extends { city: CityName }>(config: T, detected: LocatedPoint) {
  const city = detected.city && SUPPORTED_CITIES.includes(detected.city as CityName)
    ? detected.city as CityName
    : config.city;
  const nextConfig = city === config.city ? config : { ...config, city };
  return {
    config: nextConfig,
    candidateRequest: { city, location: detected.location },
    label: detected.label,
  };
}
