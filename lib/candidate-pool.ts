type PoolCandidate = {
  id: string;
  name: string;
  kind: "dining" | "activity";
  rating: number | null;
  source: { providerId?: string };
};

const PAGE_PAIRS = [[1, 2], [3, 4], [5, 1], [2, 3], [4, 5]] as const;

export function amapPagesForBatch(batchIndex: number): number[] {
  return [...PAGE_PAIRS[Math.abs(Math.trunc(batchIndex)) % PAGE_PAIRS.length]];
}

function hash(value: string) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function brandOf(name: string) {
  return name
    .replace(/[（(][^）)]*(?:店|路|区|广场|中心)[^）)]*[）)]/g, "")
    .replace(/[·•].*$/, "")
    .replace(/(?:旗舰|总|分)?店$/, "")
    .trim()
    .toLowerCase();
}

export function selectCandidateBatch<T extends PoolCandidate>(
  candidates: T[],
  options: { excludedIds: Set<string>; batchSize: number; seed: string; kind: "dining" | "activity" },
): T[] {
  const eligible = candidates.filter((candidate) => candidate.kind === options.kind && !options.excludedIds.has(candidate.source.providerId ?? candidate.id));
  const quality = eligible.filter((candidate) => candidate.rating !== null).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || hash(`${options.seed}:${a.id}`) - hash(`${options.seed}:${b.id}`));
  const exploration = eligible.filter((candidate) => candidate.rating === null).sort((a, b) => hash(`${options.seed}:explore:${a.id}`) - hash(`${options.seed}:explore:${b.id}`));
  const qualitySeats = Math.round(options.batchSize * 0.6);
  const result: T[] = [];
  const brands = new Set<string>();
  const addFrom = (source: T[], limit: number) => {
    for (const candidate of source) {
      if (result.length >= limit) break;
      const brand = brandOf(candidate.name);
      if (brands.has(brand)) continue;
      result.push(candidate);
      brands.add(brand);
    }
  };
  addFrom(quality, qualitySeats);
  addFrom(exploration, options.batchSize);
  addFrom([...quality, ...exploration], options.batchSize);
  return result.slice(0, options.batchSize);
}
