import { Button, Input, Picker, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useMemo, useState } from "react";

import BrandHeader from "../../components/BrandHeader";
import PrimaryButton from "../../components/PrimaryButton";
import { activityTendencies, diningTendencies, initialCreateDraft, supportedCities, toggleTendencySelection, type CreateDraft, type DiscoveryMode, type DurationChoice, type TimePeriod } from "../../domain/create-room.ts";
import { locateCurrentOrigin } from "../../services/location.ts";
import { createRoom } from "../../services/rooms.ts";
import { loadSession } from "../../store/session.ts";
import "./index.scss";

const periodOptions: Array<{ value: TimePeriod; label: string }> = [{ value: "morning", label: "上午" }, { value: "afternoon", label: "下午" }, { value: "evening", label: "晚上" }];
const durationOptions: Array<{ value: DurationChoice; label: string }> = [{ value: 120, label: "2 小时" }, { value: 180, label: "3 小时" }, { value: 240, label: "4 小时" }, { value: "240_plus", label: "4 小时+" }, { value: null, label: "不确定" }];

export default function CreatePage() {
  const [draft, setDraft] = useState<CreateDraft>(() => initialCreateDraft("dining"));
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  useLoad((query) => setDraft(initialCreateDraft(query.kind === "activity" ? "activity" : "dining")));

  const tendencies = useMemo(() => draft.kind === "dining" ? diningTendencies : activityTendencies, [draft.kind]);
  const update = <K extends keyof CreateDraft>(key: K, value: CreateDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const togglePeriod = (period: TimePeriod) => update("preferredPeriods", draft.preferredPeriods.includes(period) ? draft.preferredPeriods.filter((item) => item !== period) : [...draft.preferredPeriods, period]);
  const toggleTendency = (item: string) => {
    const result = toggleTendencySelection(draft.tendencies, item);
    update("tendencies", result.tendencies);
    setMessage(result.message || "");
  };

  const locate = async () => {
    setLocating(true); setMessage("");
    try {
      const resolved = await locateCurrentOrigin();
      setDraft((current) => ({ ...current, city: resolved.city && supportedCities.includes(resolved.city) ? resolved.city : current.city, origin: resolved.label, originLocation: resolved.location }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "定位失败，请手动填写出发地");
    } finally { setLocating(false); }
  };

  const submit = async () => {
    const session = loadSession();
    if (!session) { setMessage("微信登录状态不可用，请返回后重试"); return; }
    setSubmitting(true); setMessage("");
    try {
      const membership = await createRoom(draft, session.user);
      await Taro.redirectTo({ url: `/pages/room/index?room=${membership.roomCode}` });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败，请稍后重试");
    } finally { setSubmitting(false); }
  };

  return <View className="create-page">
    <BrandHeader eyebrow={draft.kind === "dining" ? "DINNER" : "WEEKEND"} title={draft.kind === "dining" ? "发起一顿饭" : "发起一次出游"} detail="先定个大概，具体时间由大家的空闲时间决定。" />
    <View className="profile-row"><Text>当前昵称</Text><Text>{loadSession()?.user.nickname || "微信用户"}</Text><Input className="nickname-input" type="nickname" placeholder="使用微信昵称（可选）" /></View>
    <View className="form-card">
      <Text className="field-label">城市</Text><Picker mode="selector" range={[...supportedCities]} value={supportedCities.indexOf(draft.city)} onChange={(event) => update("city", supportedCities[Number(event.detail.value)])}><View className="picker-value">{draft.city}　›</View></Picker>
      <Text className="field-label">从哪里出发</Text><View className="location-row"><Input className="form-input" value={draft.origin} maxlength={40} placeholder="地铁站 / 商圈" onInput={(event) => { update("origin", event.detail.value); update("originLocation", null); }} /><Button className="location-button" loading={locating} onClick={() => void locate()}>定位</Button></View>
      <View className="date-row"><View className="date-field"><Text className="field-label">最早日期</Text><Picker mode="date" value={draft.dateRange.start} onChange={(event) => update("dateRange", { ...draft.dateRange, start: event.detail.value })}><View className="picker-value">{draft.dateRange.start}</View></Picker></View><View className="date-field"><Text className="field-label">最晚日期</Text><Picker mode="date" start={draft.dateRange.start} value={draft.dateRange.end} onChange={(event) => update("dateRange", { ...draft.dateRange, end: event.detail.value })}><View className="picker-value">{draft.dateRange.end}</View></Picker></View></View>
      <Text className="field-label">大概什么时段？可多选</Text><ChoiceRow options={periodOptions} selected={draft.preferredPeriods} onToggle={(value) => togglePeriod(value as TimePeriod)} />
      <Text className="field-label">大概持续多久？</Text><ChoiceRow options={durationOptions} selected={[draft.durationMinutes]} onToggle={(value) => update("durationMinutes", value as DurationChoice)} />
      <Text className="field-label">这次怎么找灵感？</Text><ChoiceRow options={[{ value: "inspiration" as DiscoveryMode, label: "给我点灵感" }, { value: "ideas" as DiscoveryMode, label: "我有点想法" }]} selected={[draft.discoveryMode]} onToggle={(value) => update("discoveryMode", value as DiscoveryMode)} />
      {draft.discoveryMode === "ideas" ? <View className="idea-panel"><Text className="field-label">想尝试什么？最多选 6 个</Text><ChoiceRow options={tendencies.map((value) => ({ value, label: value }))} selected={draft.tendencies} onToggle={(value) => toggleTendency(String(value))} /><Input className="form-input" value={draft.avoid} maxlength={120} placeholder="不想要什么？（可选）" onInput={(event) => update("avoid", event.detail.value)} /></View> : null}
      <Text className="field-label">预计几个人？</Text><View className="people-row"><Button className="stepper-button" disabled={draft.people <= 2} onClick={() => update("people", draft.people - 1)}>−</Button><Text>{draft.people} 人</Text><Button className="stepper-button" disabled={draft.people >= 6} onClick={() => update("people", draft.people + 1)}>＋</Button></View>
      {message ? <Text className="form-message">{message}</Text> : null}
      <PrimaryButton loading={submitting} onClick={() => void submit()}>生成我的房间</PrimaryButton>
    </View>
  </View>;
}

function ChoiceRow({ options, selected, onToggle }: { options: Array<{ value: string | number | null; label: string }>; selected: Array<string | number | null>; onToggle: (value: string | number | null) => void }) {
  return <View className="choice-row">{options.map((option) => <Button key={String(option.value)} className={`choice-chip ${selected.includes(option.value) ? "choice-chip-selected" : ""}`} onClick={() => onToggle(option.value)}>{option.label}</Button>)}</View>;
}
