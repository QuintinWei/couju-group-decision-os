import { Button, Text, View } from "@tarojs/components";

import "./index.scss";

type AppStateProps = {
  title: string;
  message?: string;
  onRetry?: () => void;
};

export default function AppState({ title, message, onRetry }: AppStateProps) {
  return (
    <View className="app-state">
      <Text className="app-state__title">{title}</Text>
      {message ? <Text className="app-state__message">{message}</Text> : null}
      {onRetry ? <Button className="app-state__retry" onClick={onRetry}>重试</Button> : null}
    </View>
  );
}
