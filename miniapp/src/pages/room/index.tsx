import { Button, Text, View } from "@tarojs/components";
import Taro, { useDidHide, useDidShow, useLoad, useShareAppMessage, useUnload } from "@tarojs/taro";
import { useCallback, useRef, useState } from "react";

import AppState from "../../components/AppState";
import BrandHeader from "../../components/BrandHeader";
import PrimaryButton from "../../components/PrimaryButton";
import ProfileNickname from "../../components/ProfileNickname";
import { createVisibleRoomPoller } from "../../domain/room-polling.ts";
import { roomShareCard } from "../../domain/result-action.ts";
import { memberSetupProgress, nextRequiredPage, type RoomPage } from "../../domain/room-stage.ts";
import { normalizeRoomCode } from "../../domain/session.ts";
import { getParticipantRoom, resolveRoomMembership } from "../../services/members.ts";
import { loadMembership, loadSession } from "../../store/session.ts";
import type { Membership, ParticipantRoom } from "../../types/api.ts";
import "./index.scss";

export default function RoomPage() {
  const roomCodeRef = useRef("");
  const pollerRef = useRef<ReturnType<typeof createVisibleRoomPoller> | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [membership, setMembership] = useState<Membership | null>(null);
  const [room, setRoom] = useState<ParticipantRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const code = roomCodeRef.current;
    if (!code) return;
    try {
      if (!loadSession()) throw new Error("微信登录状态不可用，请返回首页重试");
      const identity = await resolveRoomMembership(code);
      setMembership(identity);
      const latestRoom = await getParticipantRoom(identity);
      setRoom(latestRoom);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "房间刷新失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad((query) => {
    const code = normalizeRoomCode(query.room || "");
    roomCodeRef.current = code;
    setRoomCode(code);
    const stored = loadMembership(code);
    setMembership(stored);
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setMessage("房间号无效");
      setLoading(false);
    }
  });
  useDidShow(() => {
    if (!pollerRef.current) pollerRef.current = createVisibleRoomPoller({ refresh });
    pollerRef.current.start();
  });
  useDidHide(() => pollerRef.current?.stop());
  useUnload(() => pollerRef.current?.stop());

  useShareAppMessage(() => roomShareCard(roomCode, room?.config.kind ?? "activity"));

  if (loading) return <AppState title="正在进入房间" message="同步大家的最新进度…" />;
  if (!room || !membership) return <AppState title="暂时无法进入房间" message={message} onRetry={() => void refresh()} />;

  const progress = memberSetupProgress(room, membership.memberId);
  const nextPage = nextRequiredPage(room, membership.memberId);
  const next = nextAction(nextPage, room, membership.memberId);
  const schedule = room.config.resolvedSchedule;

  return <View className="room-page">
    <BrandHeader eyebrow={room.config.kind === "dining" ? "DINNER ROOM" : "WEEKEND ROOM"} title={room.config.kind === "dining" ? "这顿饭吃什么" : "周末去哪玩"} detail={`${room.config.city} · 第 ${room.currentRound} 轮`} />
    <ProfileNickname />

    <View className="room-code-card">
      <View><Text className="room-code-label">房间码</Text><Text className="room-code">{room.code}</Text></View>
      <View className="room-code-actions">
        <Button className="quiet-button" onClick={() => void Taro.setClipboardData({ data: room.code })}>复制</Button>
        <Button className="share-button" openType="share">分享给好友</Button>
      </View>
    </View>

    <View className="progress-card">
      <View className="progress-heading"><Text>成员进度</Text><Text>{room.members.length} / {room.config.people}</Text></View>
      <View className="progress-meter"><View className="progress-meter-fill" style={{ width: `${Math.min(100, room.members.length / room.config.people * 100)}%` }} /></View>
      <View className="member-list">
        {progress.map((item) => <View className="member-row" key={item.id}>
          <View className="member-name-wrap"><Text className="member-avatar">{item.name.slice(0, 1)}</Text><Text className="member-name">{item.name}{item.isSelf ? "（你）" : ""}</Text></View>
          <View className="member-statuses">
            <Text className={item.availabilityReady ? "status-ready" : "status-pending"}>{item.availabilityReady ? "时间 ✓" : "待填时间"}</Text>
            <Text className={item.constraintsReady ? "status-ready" : "status-pending"}>{item.constraintsReady ? "边界 ✓" : "待填边界"}</Text>
          </View>
        </View>)}
      </View>
    </View>

    {schedule ? <View className="schedule-card"><Text className="section-kicker">已找到共同时间</Text><Text className="schedule-value">{formatSchedule(schedule.startAt, schedule.endAt)}</Text></View> : null}
    {message ? <Text className="room-message">{message}</Text> : null}

    <View className="room-next">
      <Text className="next-caption">{next.caption}</Text>
      <PrimaryButton disabled={next.disabled} onClick={() => next.url && void Taro.navigateTo({ url: next.url })}>{next.label}</PrimaryButton>
    </View>
  </View>;
}

function nextAction(page: RoomPage, room: ParticipantRoom, memberId: string) {
  const query = `room=${room.code}`;
  if (page === "availability") {
    const current = room.members.find((member) => member.id === memberId);
    const editing = Array.isArray(current?.availability);
    return { label: editing ? "调整空闲时间" : "填写空闲时间", caption: editing ? "目前还没有所有人都能参加的共同时间。" : "先圈出你能参加的时间。", url: `/pages/availability/index?${query}`, disabled: false };
  }
  if (page === "constraints") {
    const current = room.members.find((member) => member.id === memberId);
    return { label: current?.constraintsReady ? "调整通勤上限" : "填写个人边界", caption: current?.constraintsReady ? "共同可达地点不足，请放宽通勤时间后重试。" : "再告诉我们你的预算和通勤底线。", url: `/pages/constraints/index?${query}`, disabled: false };
  }
  if (page === "swipe") return { label: "开始看共享卡片", caption: "大家已就位，共同候选已准备好。", url: `/pages/swipe/index?${query}`, disabled: false };
  if (page === "result") return { label: "查看本轮结果", caption: "所有成员都完成了选择。", url: `/pages/result/index?${query}`, disabled: false };
  return { label: "等待其他成员", caption: room.members.length < room.config.people ? "分享房间码，等大家进来。" : "房间会每 4 秒自动更新进度。", url: "", disabled: true };
}

function formatSchedule(startAt: string, endAt: string) {
  return `${startAt.slice(5, 10).replace("-", " 月 ")} 日 ${startAt.slice(11, 16)}–${endAt.slice(11, 16)}`;
}
