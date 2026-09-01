import { Button, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState } from "react";

import AppState from "../../components/AppState";
import BrandHeader from "../../components/BrandHeader";
import PrimaryButton from "../../components/PrimaryButton";
import { constraintErrorState, type ConstraintErrorState } from "../../domain/constraints.ts";
import { normalizeRoomCode } from "../../domain/session.ts";
import { getParticipantRoom, resolveRoomMembership, submitConstraints } from "../../services/members.ts";
import type { Membership, ParticipantRoom } from "../../types/api.ts";
import "./index.scss";

const commutes = ["≤ 30 分钟", "≤ 60 分钟", "≤ 90 分钟", "不限"];

export default function ConstraintsPage() {
  const [roomCode, setRoomCode] = useState("");
  const [membership, setMembership] = useState<Membership | null>(null);
  const [room, setRoom] = useState<ParticipantRoom | null>(null);
  const [budgetLabel, setBudgetLabel] = useState("不限");
  const [commuteLabel, setCommuteLabel] = useState("≤ 60 分钟");
  const [setting, setSetting] = useState("都可以");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<ConstraintErrorState | null>(null);

  async function load(code: string) {
    setLoading(true); setFailure(null);
    try {
      const identity = await resolveRoomMembership(code);
      const latestRoom = await getParticipantRoom(identity);
      const current = latestRoom.members.find((item) => item.id === identity.memberId);
      setMembership(identity); setRoom(latestRoom);
      if (current?.constraintsReady) {
        setBudgetLabel(current.budgetLabel);
        setCommuteLabel(current.commuteLabel);
        setSetting(current.setting);
      } else {
        setBudgetLabel(latestRoom.config.kind === "dining" ? "≤ ¥150" : "≤ ¥200");
      }
    } catch (error) {
      setFailure(constraintErrorState(error));
    } finally { setLoading(false); }
  }

  useLoad((query) => {
    const code = normalizeRoomCode(query.room || "");
    setRoomCode(code);
    void load(code);
  });

  const submit = async () => {
    if (!room || !membership) return;
    setSubmitting(true); setFailure(null);
    try {
      await submitConstraints(membership, { budgetLabel, commuteLabel, setting });
      await Taro.redirectTo({ url: `/pages/room/index?room=${room.code}` });
    } catch (error) {
      setFailure(constraintErrorState(error));
    } finally { setSubmitting(false); }
  };

  if (loading) return <AppState title="正在加载个人边界" />;
  if (!room || !membership) return <AppState title="无法填写个人边界" message={failure?.message} onRetry={() => void load(roomCode)} />;

  if (failure?.canEditCommute) return <View className="constraints-page">
    <BrandHeader eyebrow="NO INTERSECTION" title="这个通勤范围还找不齐 12 个地点" detail="没有卡住，放宽一档通勤上限就可以重试。" />
    <View className="shortage-card"><Text className="shortage-message">{failure.message}</Text><Button className="edit-commute-button" onClick={() => setFailure(null)}>编辑通勤上限</Button></View>
  </View>;

  const scenes = sceneOptions(room.config.kind);
  const budgets = budgetOptions(room.config.kind);
  return <View className="constraints-page">
    <BrandHeader eyebrow="BOUNDARIES" title="你的个人边界" detail="这些条件会用来构建所有人都可达、都买得起的共享卡片。" />
    <View className="setup-card">
      <ChoiceField label="人均预算" options={budgets} value={budgetLabel} onChange={setBudgetLabel} />
      <ChoiceField label="单程通勤上限" options={commutes} value={commuteLabel} onChange={setCommuteLabel} />
      <ChoiceField label="场景偏好" options={scenes} value={setting} onChange={setSetting} />
      {failure ? <Text className="setup-message">{failure.message}</Text> : null}
    </View>
    <View className="setup-action"><PrimaryButton loading={submitting} onClick={() => void submit()}>保存并尝试构建共同候选</PrimaryButton></View>
  </View>;
}

function ChoiceField({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return <View className="constraint-field"><Text className="field-label">{label}</Text><View className="constraint-options">{options.map((option) => <Button key={option} className={`constraint-option ${option === value ? "constraint-option-selected" : ""}`} onClick={() => onChange(option)}>{option}</Button>)}</View></View>;
}

function sceneOptions(kind: ParticipantRoom["config"]["kind"]) {
  return kind === "dining" ? ["安静聊天", "热闹聚会", "都可以"] : ["室内优先", "户外优先", "都可以"];
}

function budgetOptions(kind: ParticipantRoom["config"]["kind"]) {
  return kind === "dining" ? ["≤ ¥100", "≤ ¥150", "≤ ¥200", "不限"] : ["≤ ¥100", "≤ ¥200", "≤ ¥300", "不限"];
}
