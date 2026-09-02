import { Button, Picker, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState } from "react";

import AppState from "../../components/AppState";
import BrandHeader from "../../components/BrandHeader";
import PrimaryButton from "../../components/PrimaryButton";
import { buildAvailabilityIntervals, enumerateDates, validateAvailabilityDraft, type AvailabilityDraftRange } from "../../domain/availability.ts";
import { normalizeRoomCode } from "../../domain/session.ts";
import { getParticipantRoom, resolveRoomMembership, submitAvailability } from "../../services/members.ts";
import { isParticipantSelfMember, type Membership, type ParticipantRoom } from "../../types/api.ts";
import "./index.scss";

export default function AvailabilityPage() {
  const [roomCode, setRoomCode] = useState("");
  const [membership, setMembership] = useState<Membership | null>(null);
  const [room, setRoom] = useState<ParticipantRoom | null>(null);
  const [draft, setDraft] = useState<AvailabilityDraftRange[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function load(code: string) {
    setLoading(true); setMessage("");
    try {
      const identity = await resolveRoomMembership(code);
      const latestRoom = await getParticipantRoom(identity);
      const current = latestRoom.members.find((item) => item.id === identity.memberId);
      setMembership(identity);
      setRoom(latestRoom);
      setDraft(current && isParticipantSelfMember(current) && current.availability?.length ? current.availability.map(fromServerInterval) : defaultRanges(latestRoom));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "空闲时间加载失败");
    } finally { setLoading(false); }
  }

  useLoad((query) => {
    const code = normalizeRoomCode(query.room || "");
    setRoomCode(code);
    void load(code);
  });

  const update = (index: number, value: AvailabilityDraftRange) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  const addRange = (date: string) => setDraft((current) => {
    const previous = current.filter((item) => item.date === date).at(-1) || (room ? defaultRange(room, date) : { date, start: "18:00", end: "20:00" });
    return [...current, { date, start: previous.end, end: laterTime(previous.end) }];
  });
  const removeRange = (index: number) => setDraft((current) => current.filter((unused, itemIndex) => itemIndex !== index));

  const submit = async () => {
    if (!room || !membership) return;
    const validation = validateAvailabilityDraft(draft, room.config.dateRange);
    if (!validation.ok) { setMessage(validation.message); return; }
    setSubmitting(true); setMessage("");
    try {
      const response = await submitAvailability(membership, room.currentRound, buildAvailabilityIntervals(draft));
      if (response.resolution.status === "partial") {
        setMessage("目前没有所有人都能参加的共同时间，请调整选择后重新提交");
        return;
      }
      await Taro.redirectTo({ url: `/pages/room/index?room=${room.code}` });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "空闲时间提交失败，请稍后重试");
    } finally { setSubmitting(false); }
  };

  if (loading) return <AppState title="正在加载时间范围" />;
  if (!room || !membership) return <AppState title="无法填写空闲时间" message={message} onRetry={() => void load(roomCode)} />;

  return <View className="availability-page">
    <BrandHeader eyebrow="AVAILABILITY" title="你什么时候有空？" detail={`${room.config.dateRange.start} 至 ${room.config.dateRange.end}，可以添加多段不重叠的时间。`} />
    <View className="setup-card">
      <Text className="setup-hint">每段时间用日期、开始和结束选择器填写，无需在时间网格里逐个点选。</Text>
      <View className="range-list">{enumerateDates(room.config.dateRange).map((date) => {
        const ranges = draft.map((interval, index) => ({ interval, index })).filter((item) => item.interval.date === date);
        return <View className="range-day" key={date}>
          <Text className="range-day-title">{formatDate(date)}</Text>
          {ranges.map(({ interval, index }, dayIndex) => <View className="range-card" key={`${index}-${interval.date}`}>
            <View className="range-heading"><Text>第 {dayIndex + 1} 段</Text>{draft.length > 1 ? <Button className="remove-button" onClick={() => removeRange(index)}>删除</Button> : null}</View>
            <Text className="field-label">日期</Text>
            <Picker mode="date" start={room.config.dateRange.start} end={room.config.dateRange.end} value={interval.date} onChange={(event) => update(index, { ...interval, date: String(event.detail.value) })}><View className="picker-value">{interval.date} ›</View></Picker>
            <View className="time-row">
              <View className="time-field"><Text className="field-label">开始</Text><Picker mode="time" value={interval.start} onChange={(event) => update(index, { ...interval, start: String(event.detail.value) })}><View className="picker-value">{interval.start}</View></Picker></View>
              <View className="time-field"><Text className="field-label">结束</Text><Picker mode="time" value={interval.end} onChange={(event) => update(index, { ...interval, end: String(event.detail.value) })}><View className="picker-value">{interval.end}</View></Picker></View>
            </View>
          </View>)}
          <Button className="add-range-button" onClick={() => addRange(date)}>+ {ranges.length ? "添加另一段时间" : "添加这天的时间"}</Button>
        </View>;
      })}</View>
      {message ? <Text className="setup-message">{message}</Text> : null}
    </View>
    <View className="setup-action"><PrimaryButton loading={submitting} onClick={() => void submit()}>保存空闲时间</PrimaryButton></View>
  </View>;
}

function fromServerInterval(interval: { startAt: string; endAt: string }): AvailabilityDraftRange {
  return { date: interval.startAt.slice(0, 10), start: interval.startAt.slice(11, 16), end: interval.endAt.slice(11, 16) };
}

function defaultRange(room: ParticipantRoom, date: string): AvailabilityDraftRange {
  const period = room.config.preferredPeriods[0];
  if (period === "morning") return { date, start: "08:00", end: "12:00" };
  if (period === "afternoon") return { date, start: "13:00", end: "18:00" };
  return { date, start: "18:00", end: "22:00" };
}

function defaultRanges(room: ParticipantRoom) {
  return enumerateDates(room.config.dateRange).map((date) => defaultRange(room, date));
}

function laterTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  const total = Math.min(23 * 60 + 30, hour * 60 + minute + 120);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function formatDate(value: string) {
  return `${Number(value.slice(5, 7))} 月 ${Number(value.slice(8, 10))} 日`;
}
