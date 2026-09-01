import { Button, Image, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState } from "react";

import AppState from "../../components/AppState";
import BrandHeader from "../../components/BrandHeader";
import PrimaryButton from "../../components/PrimaryButton";
import { canOpenPrivateDiscovery, togglePrivateNomination } from "../../domain/result-action.ts";
import { normalizeRoomCode } from "../../domain/session.ts";
import { candidateImageUrl } from "../../domain/swipe.ts";
import { getParticipantRoom, resolveRoomMembership } from "../../services/members.ts";
import { nominatePrivateCandidate, requestPrivateDiscovery } from "../../services/rounds.ts";
import type { Candidate, Membership, ParticipantRoom } from "../../types/api.ts";
import "./index.scss";

export default function DiscoveryPage() {
  const [roomCode, setRoomCode] = useState("");
  const [membership, setMembership] = useState<Membership | null>(null);
  const [room, setRoom] = useState<ParticipantRoom | null>(null);
  const [cards, setCards] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function load(code: string) {
    setLoading(true); setMessage("");
    try {
      const identity = await resolveRoomMembership(code);
      const latestRoom = await getParticipantRoom(identity);
      if (!canOpenPrivateDiscovery(latestRoom, identity.memberId)) {
        throw new Error("当前状态不能开启私人发现，请返回结果页刷新");
      }
      const privateCards = await requestPrivateDiscovery(identity, latestRoom.currentRound);
      setMembership(identity); setRoom(latestRoom); setCards(privateCards); setSelectedId(null);
    } catch (error) {
      setMessage(errorMessage(error, "私人发现暂时不可用，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }

  useLoad((query) => {
    const code = normalizeRoomCode(query.room || "");
    setRoomCode(code);
    void load(code);
  });

  async function submit(candidateId: string | null) {
    if (!membership || !room || submitting) return;
    setSubmitting(true); setMessage("");
    try {
      await nominatePrivateCandidate(membership, room.currentRound, candidateId);
      await Taro.redirectTo({ url: `/pages/result/index?room=${room.code}` });
    } catch (error) {
      setMessage(errorMessage(error, "私人提名提交失败，请重试"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <AppState title="正在准备私人发现" message="只为你筛选三张补充候选…" />;
  if (!room || !membership || cards.length !== 3) return <AppState title="无法开启私人发现" message={message} onRetry={() => void load(roomCode)} />;

  return <View className="discovery-page">
    <BrandHeader eyebrow="PRIVATE DISCOVERY" title="三张卡，只由你决定" detail="最多提名一张进入下一轮共享评选，也可以直接跳过。" />
    <View className="discovery-private-note">
      <Text className="discovery-lock">仅你可见</Text>
      <Text>其他成员看不到这些卡；只有你提名的候选才可能进入下一轮。</Text>
    </View>
    <View className="discovery-grid">
      {cards.map((card) => {
        const selected = selectedId === card.id;
        return <Button key={card.id} className={`discovery-card${selected ? " discovery-card-selected" : ""}`} disabled={submitting} onClick={() => setSelectedId((current) => togglePrivateNomination(current, card.id))}>
          <Image className="discovery-image" src={candidateImageUrl(card.image, process.env.TARO_APP_API_BASE)} mode="aspectFill" />
          <View className="discovery-copy">
            <Text className="discovery-type">{card.type}</Text>
            <Text className="discovery-name">{card.name}</Text>
            <Text className="discovery-facts">{card.district} · {card.priceValue === null ? "价格待确认" : card.priceLabel}</Text>
          </View>
          <Text className="discovery-select">{selected ? "已选中，再点取消" : "点此提名"}</Text>
        </Button>;
      })}
    </View>
    {message ? <Text className="discovery-message">{message}</Text> : null}
    <View className="discovery-actions">
      <PrimaryButton disabled={!selectedId || submitting} loading={submitting} onClick={() => void submit(selectedId)}>提名这张卡</PrimaryButton>
      <Button className="discovery-skip" disabled={submitting} onClick={() => void submit(null)}>三张都不合适，跳过</Button>
    </View>
  </View>;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
