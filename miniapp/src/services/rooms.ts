import { createRoomsService } from "./rooms-core.ts";
import { resolveOrigin } from "./location.ts";
import { apiRequest } from "./request.ts";
import { saveMembership } from "../store/session.ts";

export const { createRoom, joinRoom } = createRoomsService({
  request: apiRequest,
  resolveOrigin,
  saveMembership,
  createSeed: () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
});
