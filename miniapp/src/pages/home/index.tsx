import { View, Text } from "@tarojs/components";

import "./index.scss";

export default function HomePage() {
  return (
    <View className="home-page">
      <View className="home-logo" aria-label="Couju">
        C
      </View>
      <Text className="home-title">Couju</Text>
      <Text className="home-subtitle">一起更轻松地决定去哪里</Text>
      <View className="choice-card choice-card-purple" aria-disabled>
        <Text className="choice-card-title">发起一个聚会</Text>
        <Text className="choice-card-copy">邀请朋友，一起做决定</Text>
      </View>
      <View className="choice-card choice-card-blue" aria-disabled>
        <Text className="choice-card-title">加入一个聚会</Text>
        <Text className="choice-card-copy">输入邀请码，进入朋友的房间</Text>
      </View>
      <Text className="loading-label">正在准备你的聚会空间…</Text>
    </View>
  );
}
