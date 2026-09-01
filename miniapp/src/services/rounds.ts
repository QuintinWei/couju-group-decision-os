import { createRoundsService } from "./rounds-core.ts";
import { apiRequest } from "./request.ts";

export const {
  advanceRound,
  loadExplanation,
  loadRoundInsight,
  nominatePrivateCandidate,
  requestPrivateDiscovery,
  submitSharedRound,
} = createRoundsService({ request: apiRequest });
