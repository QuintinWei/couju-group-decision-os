import Taro from "@tarojs/taro";

import { sessionStore } from "../store/session";
import { createApiRequest } from "./request-core";

export { ApiError, requestTimeout, type ApiRequestOptions } from "./request-core";

export const apiRequest = createApiRequest({
  apiBase: process.env.TARO_APP_API_BASE,
  request: (options) => Taro.request(options),
  store: sessionStore,
});
