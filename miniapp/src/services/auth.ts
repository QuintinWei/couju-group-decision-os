import Taro from "@tarojs/taro";

import { sessionStore } from "../store/session";
import { apiRequest } from "./request";
import { createWechatLogin } from "./auth-core";

export const loginWithWechat = createWechatLogin({
  login: () => Taro.login(),
  apiRequest,
  saveSession: sessionStore.saveSession,
});
