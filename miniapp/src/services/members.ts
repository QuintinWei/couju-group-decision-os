import { createMembersService, resolveRoomMembership as resolveRoomMembershipCore } from "./members-core.ts";
import { apiRequest } from "./request.ts";
import { loadMembership, saveMembership } from "../store/session.ts";

export const { getParticipantRoom, relaxCommute, restoreMembership, submitAvailability, submitConstraints } = createMembersService({
  request: apiRequest,
  saveMembership,
});

export const resolveRoomMembership = (roomCode: string) => resolveRoomMembershipCore(roomCode, { loadMembership, restoreMembership });
