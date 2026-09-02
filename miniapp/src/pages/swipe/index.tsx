import { Button, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useRef, useState } from "react";

import AppState from "../../components/AppState";
import BrandHeader from "../../components/BrandHeader";
import CandidateCard from "../../components/CandidateCard";
import RejectionSheet from "../../components/RejectionSheet";
import { canSubmitSharedRound, createSubmissionGate, recordChoice, submitWithRoundRecovery, type SwipeState } from "../../domain/swipe.ts";
import { normalizeRoomCode } from "../../domain/session.ts";
import { getParticipantRoom, resolveRoomMembership } from "../../services/members.ts";
import { submitSharedRound } from "../../services/rounds.ts";
import { isParticipantSelfMember, type Candidate, type Membership, type ParticipantRoom, type RejectionReason } from "../../types/api.ts";
import "./index.scss";

const sharedCardCount = 12;
const emptySwipeState: SwipeState = { choices: {}, reasons: {} };

export default function SwipePage() {
  const gateRef = useRef(createSubmissionGate());
  const [roomCode, setRoomCode] = useState("");
  const [membership, setMembership] = useState<Membership | null>(null);
  const [room, setRoom] = useState<ParticipantRoom | null>(null);
  const [swipeState, setSwipeState] = useState<SwipeState>(emptySwipeState);
  const [cardIndex, setCardIndex] = useState(0);
  const [rejectingCandidate, setRejectingCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function load(code: string) {
    setLoading(true); setMessage("");
    try {
      const identity = await resolveRoomMembership(code);
      const latestRoom = await getParticipantRoom(identity);
      if (latestRoom.candidates.length !== sharedCardCount) throw new Error("当前轮尚未准备好 12 张共享卡，请稍后刷新房间");
      setMembership(identity); setRoom(latestRoom); setSwipeState(emptySwipeState); setCardIndex(0); setRejectingCandidate(null);
    } catch (error) {
      setMessage(errorMessage(error, "共享卡加载失败，请稍后重试"));
    } finally { setLoading(false); }
  }

  useLoad((query) => {
    const code = normalizeRoomCode(query.room || "");
    setRoomCode(code);
    void load(code);
  });

  async function reloadCurrentRound() {
    if (!membership) return;
    const latestRoom = await getParticipantRoom(membership);
    if (latestRoom.candidates.length !== sharedCardCount) throw new Error("刷新后没有拿到完整的 12 张共享卡");
    setRoom(latestRoom); setSwipeState(emptySwipeState); setCardIndex(0); setRejectingCandidate(null);
  }

  async function submitChoices(nextState: SwipeState) {
    if (!room || !membership || submitting) return;
    const candidateIds = room.candidates.map((candidate) => candidate.id);
    const member = room.members.find((item) => item.id === membership.memberId);
    if (!member || !isParticipantSelfMember(member) || !canSubmitSharedRound(candidateIds, nextState.choices)) {
      setMessage("请先完成当前 12 张共享卡的选择");
      return;
    }

    setSubmitting(true); setMessage("");
    try {
      const result = await gateRef.current.run(() => submitWithRoundRecovery({
        submit: () => submitSharedRound(membership, room, member, nextState.choices, nextState.reasons),
        reload: reloadCurrentRound,
      }));
      if (result.kind === "stale") {
        gateRef.current = createSubmissionGate();
        setMessage("房间已进入新一轮，已刷新为最新 12 张共享卡。");
        return;
      }
      await Taro.redirectTo({ url: `/pages/result/index?room=${room.code}` });
    } catch (error) {
      setMessage(errorMessage(error, "提交失败，你的选择已保留，可重试提交。"));
    } finally { setSubmitting(false); }
  }

  function advance(nextState: SwipeState) {
    if (cardIndex === sharedCardCount - 1) void submitChoices(nextState);
    else setCardIndex((current) => current + 1);
  }

  function choose(choice: "no" | "okay" | "like") {
    const candidate = room?.candidates[cardIndex];
    if (!candidate || submitting) return;
    const nextState = recordChoice(swipeState, candidate.id, choice);
    setSwipeState(nextState); setMessage("");
    if (choice === "no") setRejectingCandidate(candidate);
    else advance(nextState);
  }

  function closeRejectionSheet() {
    setRejectingCandidate(null);
    advance(swipeState);
  }

  function chooseRejectionReason(reason: RejectionReason) {
    if (!rejectingCandidate) return;
    const nextState = recordChoice(swipeState, rejectingCandidate.id, "no", reason);
    setSwipeState(nextState); setRejectingCandidate(null);
    advance(nextState);
  }

  function retrySubmit() {
    void submitChoices(swipeState);
  }

  if (loading) return <AppState title="正在加载共享卡" message="为你同步这一轮共同候选…" />;
  if (!room || !membership) return <AppState title="无法加载共享卡" message={message} onRetry={() => void load(roomCode)} />;

  const candidate = room.candidates[cardIndex];
  if (!candidate) return <AppState title="当前共享卡不可用" message="请返回房间刷新后重试。" onRetry={() => void load(roomCode)} />;

  return <View className="swipe-page">
    <BrandHeader eyebrow="SHARED CARDS" title="逐张说说你的感觉" detail="每张都选一次；所有选择完成后会一起提交。" />
    <CandidateCard candidate={candidate} current={cardIndex + 1} total={sharedCardCount} disabled={submitting} onChoose={choose} />
    {message ? <View className="swipe-message"><Text>{message}</Text>{Object.keys(swipeState.choices).length === sharedCardCount ? <Button className="swipe-retry" disabled={submitting} onClick={retrySubmit}>重试提交</Button> : null}</View> : null}
    {rejectingCandidate ? <RejectionSheet candidate={rejectingCandidate} onReason={chooseRejectionReason} onClose={closeRejectionSheet} /> : null}
  </View>;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
