import type { CityName, DecisionKind } from "./couju.ts";

export function buildAmapPlaceSearchUrl(input: {
  key: string;
  city: CityName;
  kind: DecisionKind;
  interest: string;
  page: number;
  center: { lng: number; lat: number } | null;
}) {
  const params = new URLSearchParams({
    key: input.key,
    keywords: input.interest,
    show_fields: "business,photos",
    page_size: "6",
    page_num: String(input.page),
    output: "json",
  });
  if (input.kind === "dining") params.set("types", "050000");
  if (input.center) {
    params.set("location", `${input.center.lng},${input.center.lat}`);
    params.set("radius", "50000");
    return `https://restapi.amap.com/v5/place/around?${params}`;
  }
  params.set("region", `${input.city}市`);
  params.set("city_limit", "true");
  return `https://restapi.amap.com/v5/place/text?${params}`;
}
