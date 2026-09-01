import { Button, Image, Text, View } from "@tarojs/components";
import Taro, { useLoad, useShareAppMessage } from "@tarojs/taro";
import { useState } from "react";

import AppState from "../../components/AppState";
import BrandHeader from "../../components/BrandHeader";
import PrimaryButton from "../../components/PrimaryButton";
import {
  diagnoseParticipantConflict,
  deterministicRoundInsight,
  isCompletedParticipantRound,
  participantRankings,
  pendingRecoveryMessage,
  resultAction,
  resultWaitMessage,
  roomShareCard,
  suggestParticipantCommuteRelaxation,
  type ParticipantRanking,
  type ResultAction,
} from "../../domain/result-action.ts";
import { normalizeRoomCode } from "../../domain/session.ts";
import { candidateImageUrl } from "../../domain/swipe.ts";
import { getParticipantRoom, relaxCommute, resolveRoomMembership } from "../../services/members.ts";
import { advanceRound, loadExplanation, loadRoundInsight } from "../../services/rounds.ts";
import type { AiExplanation, Membership, ParticipantRoom, RoundInsight } from "../../types/api.ts";
import "./index.scss";

export default function ResultPage() {
  const [roomCode, setRoomCode] = useState("");
  const [membership, setMembership] = useState<Membership | null>(null);
  const [room, setRoom] = useState<ParticipantRoom | null>(null);
  const [rankings, setRankings] = useState<ParticipantRanking[]>([]);
  const [action, setAction] = useState<ResultAction>("wait");
  const [insight, setInsight] = useState<RoundInsight | null>(null);
  const [explanation, setExplanation] = useState<AiExplanation | null>(null);
  const [insightFallback, setInsightFallback] = useState(false);
  const [insightLoading, setInsightLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useShareAppMessage(() => roomShareCard(roomCode, room?.config.kind ?? "activity"));

  async function load(code: string, identity?: Membership) {
    setLoading(true); setMessage("");
    try {
      const currentIdentity = identity ?? await resolveRoomMembership(code);
      const latestRoom = await getParticipantRoom(currentIdentity);
      const nextRankings = participantRankings(latestRoom);
      const completed = isCompletedParticipantRound(latestRoom);
      setMembership(currentIdentity); setRoom(latestRoom); setRankings(nextRankings);
      setAction(resultAction(latestRoom, currentIdentity.memberId));
      setInsight(nextRankings.length || !completed ? null : deterministicRoundInsight(latestRoom));
      setInsightFallback(false); setExplanation(null);
      if (completed) {
        if (nextRankings.length) {
          void loadExplanation(currentIdentity, latestRoom, nextRankings).then(setExplanation).catch(() => undefined);
        } else {
          void loadRoundInsight(currentIdentity)
            .then((remoteInsight) => remoteInsight ? setInsight(remoteInsight) : setInsightFallback(true))
            .catch(() => setInsightFallback(true));
        }
      }
    } catch (error) {
      setMessage(errorMessage(error, "本轮结果加载失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }

  useLoad((query) => {
    const code = normalizeRoomCode(query.room || "");
    setRoomCode(code);
    void load(code);
  });

  async function confirmCommute(minutes: number) {
    if (!membership || !room || submitting) return;
    setSubmitting(true); setMessage("");
    try {
      await relaxCommute(membership, room.currentRound, minutes);
      await load(room.code, membership);
    } catch (error) {
      setMessage(errorMessage(error, "通勤调整失败，请重试"));
    } finally {
      setSubmitting(false);
    }
  }

  async function advance() {
    if (!membership || !room || action !== "advance" || submitting) return;
    const previousRound = room.currentRound;
    setSubmitting(true); setMessage("");
    try {
      await advanceRound(membership, previousRound);
      const latestRoom = await getParticipantRoom(membership);
      if (latestRoom.currentRound !== previousRound + 1) throw new Error("下一轮已请求，但房间状态尚未更新，请刷新重试");
      await Taro.redirectTo({ url: `/pages/room/index?room=${room.code}` });
    } catch (error) {
      const failure = errorMessage(error, "下一轮生成失败，请重试");
      await load(room.code, membership);
      setMessage(failure);
    } finally {
      setSubmitting(false);
    }
  }

  async function retryInsight() {
    if (!membership || insightLoading) return;
    setInsightLoading(true);
    try {
      const remoteInsight = await loadRoundInsight(membership);
      if (remoteInsight) {
        setInsight(remoteInsight);
        setInsightFallback(false);
      } else {
        setInsightFallback(true);
      }
    } catch {
      setInsightFallback(true);
    } finally {
      setInsightLoading(false);
    }
  }

  if (loading) return <AppState title="正在汇总本轮" message="保护每个人的底线，再寻找真实交集…" />;
  if (!room || !membership) return <AppState title="无法查看本轮结果" message={message} onRetry={() => void load(roomCode)} />;
  if (rankings[0]) return <FinalResult room={room} recommendation={rankings[0]} explanation={explanation} />;
  if (!isCompletedParticipantRound(room)) return <View className="result-page result-waiting-page">
    <BrandHeader eyebrow="ROUND IN PROGRESS" title="等待大家完成本轮选择" detail="有人先提交并不会提前形成结果；全部完成后才会计算共同答案。" />
    <View className="result-waiting-card">
      <Text className="result-section-title">当前进度</Text>
      <Text className="result-wait-copy">{pendingRecoveryMessage(room)}</Text>
      {message ? <Text className="result-message">{message}</Text> : null}
      <Button className="result-reload" onClick={() => void load(room.code, membership)}>刷新状态</Button>
    </View>
  </View>;

  const conflicts = diagnoseParticipantConflict(room).slice(0, 3);
  const commute = suggestParticipantCommuteRelaxation(room);
  return <View className="result-page result-empty-page">
    <BrandHeader eyebrow="NO SHARED RESULT" title="这一轮没有共同答案" detail="系统不会用一个不满足底线的地点假装达成共识。" />

    <View className="result-learning-card">
      <Text className="result-section-title">AI 学到了什么</Text>
      <Text className="result-learning-copy">{insight?.learned}</Text>
      {insight?.nextRound ? <Text className="result-learning-next">{insight.nextRound}</Text> : null}
      {insightFallback ? <View className="result-insight-fallback">
        <Text>AI 总结暂不可用，已展示本地确定性摘要。</Text>
        <Button disabled={insightLoading} onClick={() => void retryInsight()}>{insightLoading ? "正在重试…" : "重试 AI 总结"}</Button>
      </View> : null}
    </View>

    <View className="result-conflict-card">
      <Text className="result-section-title">确定性冲突诊断</Text>
      {conflicts.length ? conflicts.map((conflict, index) => <View className="result-conflict-row" key={`${conflict.type}-${conflict.memberId || index}`}>
        <Text className="result-conflict-index">{index + 1}</Text><Text>{conflict.message}</Text>
      </View>) : <Text className="result-conflict-empty">没有单一边界独自阻断结果，建议一起讨论预算、通勤或活动类型。</Text>}
    </View>

    {commute ? <View className="result-commute-card">
      <Text className="result-section-title">最小通勤调整</Text>
      <Text>{commute.memberName} 将上限从 {commute.currentMinutes} 调到 {commute.suggestedMinutes} 分钟，可恢复 {commute.restoredCandidateCount} 个候选。</Text>
      {commute.memberId === membership.memberId
        ? <Button className="result-confirm-commute" disabled={submitting} onClick={() => void confirmCommute(commute.suggestedMinutes)}>{room.currentRound < 3 ? "可选：" : ""}我确认增加 {commute.addedMinutes} 分钟</Button>
        : <Text className="result-commute-wait">{room.currentRound < 3 ? `这是给 ${commute.memberName} 的可选建议，不影响私人发现或开启下一轮。` : `等待 ${commute.memberName} 本人确认`}</Text>}
    </View> : null}

    {message ? <Text className="result-message">{message}</Text> : null}
    <View className="result-next-action">
      {action === "private-discovery" ? <PrimaryButton onClick={() => void Taro.navigateTo({ url: `/pages/discovery/index?room=${room.code}` })}>查看我的 3 张私人发现卡</PrimaryButton> : null}
      {action === "advance" ? <PrimaryButton loading={submitting} onClick={() => void advance()}>房主：汇总反馈并开启下一轮</PrimaryButton> : null}
      {action === "wait" ? <Text className="result-wait-copy">{resultWaitMessage(room)}</Text> : null}
      {action !== "private-discovery" && action !== "advance" ? <Button className="result-reload" disabled={submitting} onClick={() => void load(room.code, membership)}>刷新状态</Button> : null}
    </View>
  </View>;
}

function FinalResult({ room, recommendation, explanation }: { room: ParticipantRoom; recommendation: ParticipantRanking; explanation: AiExplanation | null }) {
  const schedule = room.config.resolvedSchedule;
  const conciseExplanation = explanation
    ? `${explanation.headline}。${explanation.reasoning}${explanation.tradeoff ? `；${explanation.tradeoff}` : ""}`
    : recommendation.explanation;
  return <View className="result-page">
    <BrandHeader eyebrow="FINAL RESULT" title="共同方案已经找到" detail="只展示本轮群体最优的一项，不用再从多个答案里二次选择。" />
    <View className="result-winner-card">
      <Image className="result-winner-image" src={candidateImageUrl(recommendation.image, process.env.TARO_APP_API_BASE)} mode="aspectFill" />
      <View className="result-winner-body">
        <Text className="result-winner-type">{recommendation.type} · {recommendation.district}</Text>
        <Text className="result-winner-name">{recommendation.name}</Text>
        <View className="result-facts">
          <Text>{schedule ? formatSchedule(schedule.startAt, schedule.endAt) : "共同时间待确认"}</Text>
          <Text>{recommendation.priceLabel}</Text>
          <Text>群体匹配 {recommendation.groupFit}</Text>
        </View>
        <View className="result-explanation"><Text className="result-section-title">为什么推荐它</Text><Text>{conciseExplanation}</Text></View>
      </View>
    </View>
    <View className="result-member-card">
      <Text className="result-section-title">成员满意度</Text>
      {recommendation.memberUtilities.map((member) => <View className="result-member-row" key={member.memberId}>
        <Text>{member.name}</Text>
        <Text>{member.travelMinutes === null ? "通勤待确认" : `约 ${member.travelMinutes} 分钟`}</Text>
        <Text className="result-member-score">{member.utility}</Text>
      </View>)}
    </View>
    <Button className="result-share" openType="share">分享这个房间</Button>
  </View>;
}

function formatSchedule(startAt: string, endAt: string) {
  return `${startAt.slice(5, 10).replace("-", " 月 ")} 日 ${startAt.slice(11, 16)}–${endAt.slice(11, 16)}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
