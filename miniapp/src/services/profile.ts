import { sessionStore } from "../store/session";
import { createProfileService } from "./profile-core";
import { apiRequest } from "./request";

export const { updateNickname } = createProfileService({
  request: apiRequest,
  loadSession: sessionStore.loadSession,
  saveSession: sessionStore.saveSession,
});
