import { createRoundsService } from "./rounds-core.ts";
import { apiRequest } from "./request.ts";

export const { submitSharedRound } = createRoundsService({ request: apiRequest });
