import { Button, Input, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState } from "react";

import BrandHeader from "../../components/BrandHeader";
import PrimaryButton from "../../components/PrimaryButton";
import ProfileNickname from "../../components/ProfileNickname";
import { resolveLaunchRoom } from "../../domain/session.ts";
import { locateCurrentOrigin } from "../../services/location.ts";
import { joinRoom } from "../../services/rooms.ts";
import "./index.scss";

export default function HomePage() {
  const [roomCode, setRoomCode] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const [originLocation, setOriginLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useLoad((query) => {
    const launchRoom = resolveLaunchRoom(query);
    if (launchRoom) {
      setRoomCode(launchRoom);
      setJoinOpen(true);
    }
  });

  const startCreate = (kind: "dining" | "activity") => {
    void Taro.navigateTo({ url: `/pages/create/index?kind=${kind}` });
  };

  const locate = async () => {
    setLocating(true);
    setMessage("");
    try {
      const resolved = await locateCurrentOrigin();
      setOrigin(resolved.label);
      setOriginLocation(resolved.location);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "定位失败，请手动填写出发地");
    } finally {
      setLocating(false);
    }
  };

  const submitJoin = async () => {
    setSubmitting(true);
    setMessage("");
    try {
      const membership = await joinRoom(roomCode, origin, originLocation);
      await Taro.navigateTo({ url: `/pages/room/index?room=${membership.roomCode}` });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加入失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return <View className="home-page">
    <BrandHeader eyebrow="COUJU" title="不知道干啥？别再纠结了" detail="叫上朋友，一起决定吃什么、玩什么。" />
    <ProfileNickname />
    <View className="home-choice-list">
      <Button className="choice-card choice-card-orange" onClick={() => startCreate("dining")}>
        <Text className="choice-icon">🍜</Text><Text className="choice-card-title">一起吃饭</Text><Text className="choice-card-copy">选个都愿意去的地方</Text>
      </Button>
      <Button className="choice-card choice-card-purple" onClick={() => startCreate("activity")}>
        <Text className="choice-icon">🎲</Text><Text className="choice-card-title">出去玩</Text><Text className="choice-card-copy">从周末灵感开始</Text>
      </Button>
    </View>
    <View className="join-card">
      <View className="join-heading"><Text>加入好友的局</Text><Button className="link-button" onClick={() => setJoinOpen((current) => !current)}>{joinOpen ? "收起" : "展开"}</Button></View>
      <Input className="room-code-input" value={roomCode} maxlength={6} placeholder="输入 6 位房间码" onInput={(event) => setRoomCode(event.detail.value.toUpperCase())} onFocus={() => setJoinOpen(true)} />
      {joinOpen ? <View className="join-panel">
        <Text className="field-label">从哪里出发</Text>
        <View className="location-row"><Input className="form-input" value={origin} maxlength={40} placeholder="地铁站 / 商圈" onInput={(event) => { setOrigin(event.detail.value); setOriginLocation(null); }} /><Button className="location-button" loading={locating} onClick={() => void locate()}>定位</Button></View>
        {message ? <Text className="form-message">{message}</Text> : null}
        <PrimaryButton loading={submitting} onClick={() => void submitJoin()}>加入这个局</PrimaryButton>
      </View> : null}
    </View>
  </View>;
}
