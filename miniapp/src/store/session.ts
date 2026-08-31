import Taro from "@tarojs/taro";

import { createSessionStore } from "./session-core";

export const sessionStore = createSessionStore(Taro);
export const loadSession = sessionStore.loadSession;
export const saveSession = sessionStore.saveSession;
export const clearSession = sessionStore.clearSession;
export const loadMembership = sessionStore.loadMembership;
export const saveMembership = sessionStore.saveMembership;
export const clearMembership = sessionStore.clearMembership;
