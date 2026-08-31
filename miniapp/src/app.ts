import "./app.scss";
import { createElement, useCallback, useEffect, useState, type PropsWithChildren } from "react";

import AppState from "./components/AppState";
import { loginWithWechat } from "./services/auth";

export default function App({ children }: PropsWithChildren) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  const authenticate = useCallback(async () => {
    setState("loading");
    setMessage("");
    try {
      await loginWithWechat();
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "请检查网络后重试");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void authenticate();
  }, [authenticate]);

  if (state === "loading") return createElement(AppState, { title: "正在连接微信" });
  if (state === "error") return createElement(AppState, {
    title: "微信登录失败",
    message,
    onRetry: () => void authenticate(),
  });
  return children;
}
