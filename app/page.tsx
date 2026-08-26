/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIVITY_INTERESTS,
  DINING_INTERESTS,
  PREFERENCE_FLOW,
  SUPPORTED_CITIES,
  estimateTravelBetween,
  getDemoCandidates,
  rankGroupCandidates as rankCandidates,
  type Candidate,
  type Choice,
  type CityName,
  type DataMode,
  type DecisionKind,
  type PreferenceExtraction,
  type RankedCandidate,
  type RoomConfig,
  type Stage,
} from "../lib/couju";
import { requestBrowserPosition } from "../lib/browser-location";
import { synchronizeDetectedLocation } from "../lib/location-sync";
import type { StoredMember, StoredRoom } from "../lib/room-store";
import type { JoinRoomDto } from "../lib/public-room";
import { diagnoseRoundConflict, suggestMinimumCommuteRelaxation } from "../lib/rounds";
import { getPreferenceEntryStage, getRefreshRequestControl, getRoundControlVisibility, reconcileAuthoritativeRound } from "../lib/round-client-state";
import { getRoomReadiness } from "../lib/room-readiness";
import { canRequestPrivateDiscovery, privateDiscoveryFailure, privateDiscoveryRequestPlan, privateNominationAction, togglePrivateNomination, type RoundClientAction } from "../lib/private-discovery-flow";
import { rejectionReasonOptions, type RejectionReasonCode, type RejectionReasonRecord } from "../lib/rejection-feedback";

type CandidateMeta = { mode: DataMode; label: string; fetchedAt: string; disclaimer?: string; keywords?: string[]; avoid?: string[]; page?: number; center?: GeoPoint | null; seed?: string; focused?: boolean; strategy?: "explore" | "focused" | "learn" | "private"; commuteWindow?: string; groupIntersection?: boolean };
type AiExplanation = { headline: string; reasoning: string; tradeoff: string };
type ClientStage = Stage | "availability" | "private-discovery";
const stageOrder: ClientStage[] = ["create", "availability", "room", ...PREFERENCE_FLOW, "private-discovery", "ranking", "results", "locked"];
type MemberIdentity = { id: string; token: string };
type GeoPoint = { lng: number; lat: number };
type LocationResponse = { location?: GeoPoint; label?: string; city?: CityName | null; error?: string };
type AdvanceAction = { action: "advance" };

class RoundActionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RoundActionError";
  }
}
// 旧版“演示成员样本”已移除；当前计算只接受真实加入并提交的成员。

function browserLocationError(error: GeolocationPositionError) {
  if (error.code === 1) return "浏览器未授权定位，请在地址栏权限中允许后重试；也可输入地铁站或商圈";
  if (error.code === 2) return "系统暂时无法取得位置，请检查系统定位服务或网络；也可手动输入";
  if (error.code === 3) return "定位请求超时，请重试或输入地铁站或商圈";
  return "暂时无法取得当前位置，请重试或手动输入地铁站或商圈";
}

function createDefaultConfig(): RoomConfig {
  const start = shanghaiDate(1);
  return { kind: "dining", city: "上海", dateRange: { start, end: start }, preferredPeriods: ["evening"], durationMinutes: 180, resolvedSchedule: null, date: start, startTime: "", endTime: "", people: 4 };
}

const PERIOD_LABELS = { morning: "上午", afternoon: "下午", evening: "晚上" } as const;
const PERIOD_ORDER = ["morning", "afternoon", "evening"] as const;
const PERIOD_RANGES = { morning: ["08:00", "12:00"], afternoon: ["12:00", "18:00"], evening: ["18:00", "24:00"] } as const;
const DURATION_OPTIONS = [{ value: 120, label: "2 小时" }, { value: 180, label: "3 小时" }, { value: 240, label: "4 小时" }, { value: "240_plus", label: "4 小时以上" }, { value: null, label: "不确定" }] as const;

function shanghaiDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function formatDate(date: string) {
  if (!date) return "日期待定";
  const parsed = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return "日期待定";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", weekday: "short" }).format(parsed);
}

function formatSourceTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function roomTitle(kind: DecisionKind) {
  return kind === "dining" ? "这顿饭吃什么" : "周末去哪玩";
}

export default function Home() {
  const [stage, setStage] = useState<ClientStage>("home");
  const [config, setConfig] = useState<RoomConfig>(() => createDefaultConfig());
  const configRef = useRef(config);
  const [candidates, setCandidates] = useState<Candidate[]>(() => getDemoCandidates("上海", "dining"));
  const [candidateMeta, setCandidateMeta] = useState<CandidateMeta>({ mode: "demo", label: "凑局演示候选库", fetchedAt: "2026-08-21T00:00:00.000Z", disclaimer: "当前为演示候选，不代表实时商户、价格或可订状态。" });
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [creatorName, setCreatorName] = useState("Jay");
  const [creatorOrigin, setCreatorOrigin] = useState("静安寺地铁站");
  const [creatorLocation, setCreatorLocation] = useState<GeoPoint | null>(null);
  const [locationStatus, setLocationStatus] = useState("输入后会识别地铁站或商圈，并用于通勤估算");
  const [locating, setLocating] = useState(false);
  const [ideaMode, setIdeaMode] = useState(false);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [avoid, setAvoid] = useState("");
  const [room, setRoom] = useState<StoredRoom | null>(null);
  const [joinRoomSummary, setJoinRoomSummary] = useState<JoinRoomDto | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [identity, setIdentity] = useState<MemberIdentity | null>(null);
  const identityRef = useRef<MemberIdentity | null>(null);
  const [roomError, setRoomError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<AiExplanation | null>(null);
  const [lockedResult, setLockedResult] = useState<RankedCandidate | null>(null);
  const [vetoTarget, setVetoTarget] = useState<RankedCandidate | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [swipes, setSwipes] = useState<Record<string, Choice>>({});
  const [rejectionReasons, setRejectionReasons] = useState<RejectionReasonRecord>({});
  const [pendingRejectionId, setPendingRejectionId] = useState<string | null>(null);
  const [budget, setBudget] = useState("≤ ¥150");
  const [commute, setCommute] = useState("≤ 60 分钟");
  const [setting, setSetting] = useState("都可以");
  const [note, setNote] = useState("");
  const [extraction, setExtraction] = useState<PreferenceExtraction | null>(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [parseError, setParseError] = useState("");
  const [rankingStep, setRankingStep] = useState(0);
  const [vetoOpen, setVetoOpen] = useState(false);
  const [vetoReason, setVetoReason] = useState("太辣了");
  const [appliedVetoReason, setAppliedVetoReason] = useState("");
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [privateCandidates, setPrivateCandidates] = useState<Candidate[]>([]);
  const [privateNominationId, setPrivateNominationId] = useState<string | null>(null);
  const [privateActionLoading, setPrivateActionLoading] = useState(false);
  const [privateError, setPrivateError] = useState("");
  const [advanceConfirmOpen, setAdvanceConfirmOpen] = useState(false);
  const [advanceLoading, setAdvanceLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const pointerStart = useRef<number | null>(null);
  const knownRoundRef = useRef<number | null>(null);

  const ranked = useMemo(() => rankCandidates(candidates, room?.members ?? [], config, excludedIds, appliedVetoReason), [candidates, room?.members, config, excludedIds, appliedVetoReason]);
  const mainResult = ranked[0] ?? null;
  const currentMember = room?.members.find((member) => member.id === identity?.id) ?? null;
  const readyMembers = room?.members.filter((member) => member.submittedAt) ?? [];

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { identityRef.current = identity; }, [identity]);

  useEffect(() => {
    if (stage !== "ranking") return;
    const timers = [1, 2, 3, 4].map((value, index) => window.setTimeout(() => setRankingStep(value), 500 + index * 450));
    timers.push(window.setTimeout(() => setStage("results"), 2300));
    return () => timers.forEach(window.clearTimeout);
  }, [stage]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refreshRoom = useCallback(async (code: string, quiet = false, auth?: MemberIdentity | null) => {
    const activeAuth = auth === undefined ? identityRef.current : auth;
    if (!activeAuth) return null;
    if (!quiet) setSyncing(true);
    try {
      const query = new URLSearchParams({ code });
      query.set("memberId", activeAuth.id); query.set("token", activeAuth.token);
      const response = await fetch(`/api/rooms?${query}`, { cache: "no-store" });
      const payload = await response.json() as { room?: StoredRoom; error?: string };
      if (!response.ok || !payload.room) throw new Error(payload.error || "房间加载失败");
      const roundTransition = reconcileAuthoritativeRound({ knownRound: knownRoundRef.current, nextRound: payload.room.currentRound });
      knownRoundRef.current = payload.room.currentRound;
      setRoom(payload.room); setConfig(payload.room.config); setCandidates(payload.room.candidates); setCandidateMeta(payload.room.meta); setRoomError("");
      if (roundTransition.resetRoundScopedState) {
        setCardIndex(0); setSwipes({}); setRejectionReasons({}); setPendingRejectionId(null); setPrivateCandidates([]); setPrivateNominationId(null); setPrivateError("");
        setRankingStep(0); setAiExplanation(null); setVetoOpen(false); setVetoTarget(null); setExcludedIds([]); setAppliedVetoReason(""); setLockedResult(null); setAdvanceConfirmOpen(false);
        if (roundTransition.nextStage) setStage(roundTransition.nextStage);
        setToast(`房间已进入第 ${payload.room.currentRound}/3 轮，请重新选择这 12 张卡`);
      }
      return payload.room;
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : "房间加载失败");
      return null;
    } finally { if (!quiet) setSyncing(false); }
  }, []);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("room")?.trim().toUpperCase() || "";
    if (!code) return;
    const timer = window.setTimeout(() => {
      setRoomCode(code);
      let saved: MemberIdentity | null = null;
      try { saved = JSON.parse(window.localStorage.getItem(`couju-room-${code}`) || "null") as MemberIdentity | null; } catch { saved = null; }
      setIdentity(saved);
      if (saved) {
        void refreshRoom(code, false, saved).then((loaded) => { const member = loaded?.members.find((item) => item.id === saved.id); if (member) setStage(member.availability === null ? "availability" : "room"); else if (loaded) setStage("join"); });
      } else {
        void fetch(`/api/rooms?code=${encodeURIComponent(code)}`, { cache: "no-store" })
          .then(async (response) => ({ response, payload: await response.json() as { room?: JoinRoomDto; error?: string } }))
          .then(({ response, payload }) => {
            if (!response.ok || !payload.room) throw new Error(payload.error || "房间加载失败");
            setJoinRoomSummary(payload.room); setConfig((current) => ({ ...current, kind: payload.room!.kind, city: payload.room!.city, dateRange: payload.room!.dateRange, preferredPeriods: payload.room!.preferredPeriods, durationMinutes: payload.room!.durationMinutes, resolvedSchedule: payload.room!.resolvedSchedule, date: payload.room!.date, startTime: payload.room!.startTime, endTime: payload.room!.endTime, people: payload.room!.targetCount })); setStage("join");
          })
          .catch((cause) => setRoomError(cause instanceof Error ? cause.message : "房间加载失败"));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshRoom]);

  useEffect(() => {
    if (!roomCode || !["availability", "room", "setup", "swipe", "constraints", "private-discovery", "ranking", "results", "locked"].includes(stage)) return;
    const timer = window.setInterval(() => { void refreshRoom(roomCode, true); }, 4000);
    return () => window.clearInterval(timer);
  }, [roomCode, stage, refreshRoom]);

  const resetSession = () => {
    const next = createDefaultConfig();
    setStage("home"); setConfig(next); setCandidates(getDemoCandidates(next.city, next.kind)); setRoom(null); setJoinRoomSummary(null); setRoomCode(""); setIdentity(null); setRoomError(""); knownRoundRef.current = null;
    window.history.replaceState({}, "", window.location.pathname);
    setCandidateMeta({ mode: "demo", label: "凑局演示候选库", fetchedAt: "2026-08-21T00:00:00.000Z", disclaimer: "当前为演示候选，不代表实时商户、价格或可订状态。" });
    setCardIndex(0); setSwipes({}); setBudget("≤ ¥150"); setCommute("≤ 60 分钟"); setSetting("都可以");
    setNote(""); setExtraction(null); setExcludedIds([]); setAppliedVetoReason(""); setLockedResult(null); setVetoTarget(null); setPrivateCandidates([]); setPrivateNominationId(null); setPrivateError("");
    setCreatorLocation(null); setLocationStatus("输入后会识别地铁站或商圈，并用于通勤估算"); setIdeaMode(false); setSelectedInterests([]); setAvoid("");
  };

  const updateConfig = (next: RoomConfig) => {
    const kindChanged = next.kind !== config.kind;
    const cityChanged = next.city !== config.city;
    configRef.current = next; setConfig(next);
    if (cityChanged) { setCreatorLocation(null); setLocationStatus("城市已更改，请重新输入出发区域或使用定位"); }
    if (!kindChanged) return;
    setBudget(next.kind === "dining" ? "≤ ¥150" : "≤ ¥200");
    setSetting("都可以");
    setNote("");
    setVetoReason(next.kind === "dining" ? "太辣了" : "太吵了");
    setExtraction(null); setSwipes({}); setCardIndex(0); setSelectedInterests([]); setIdeaMode(false); setAvoid("");
  };

  const resolveOrigin = async (origin: string) => {
    const response = await fetch("/api/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city: config.city, origin }) });
    const payload = await response.json() as { location?: GeoPoint; label?: string; error?: string };
    if (!response.ok || !payload.location) throw new Error(payload.error || `没有识别出“${origin}”，请换成完整地铁站或商圈名`);
    return { location: payload.location, label: payload.label || origin };
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setLocationStatus("当前浏览器不支持系统定位，请输入地铁站或商圈"); return; }
    setLocating(true); setLocationStatus("正在请求系统定位…");
    requestBrowserPosition(navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)).then(async (position) => {
      try {
        const response = await fetch("/api/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city: config.city, lat: position.coords.latitude, lng: position.coords.longitude }) });
        const payload = await response.json() as LocationResponse;
        if (!response.ok || !payload.location) throw new Error(payload.error || "暂时无法识别当前位置");
        const detectedCity = typeof payload.city === "string" && SUPPORTED_CITIES.includes(payload.city as CityName) ? payload.city as CityName : null;
        const synchronized = synchronizeDetectedLocation(configRef.current, { city: detectedCity, location: payload.location, label: payload.label || "当前位置（估算）" });
        setCreatorLocation(payload.location);
        setCreatorOrigin(payload.label || "当前位置（估算）");
        if (detectedCity && detectedCity !== configRef.current.city) {
          configRef.current = synchronized.config; setConfig(synchronized.config);
          setLocationStatus(`已定位 · 已自动切换到${detectedCity}，会用于你的通勤估算`);
        } else if (detectedCity) {
          setLocationStatus("已定位 · 会用于你的通勤估算");
        } else {
          setLocationStatus("已定位 · 暂未识别到支持城市，仍使用当前城市和当前位置坐标");
        }
      } catch (error) { setLocationStatus(error instanceof Error ? error.message : "定位服务暂时不可用，请手动输入地铁站或商圈"); }
    }).catch((error) => {
      setLocationStatus(browserLocationError(error as GeolocationPositionError));
    }).finally(() => setLocating(false));
  };

  const loadCandidates = async (input: { city: CityName; kind: DecisionKind; location: GeoPoint; strategy: "explore" | "focused" | "learn"; interests?: string[]; avoid?: string[]; exclude?: string[]; page?: number }) => {
    const query = new URLSearchParams({ city: input.city, kind: input.kind, strategy: input.strategy, seed: crypto.randomUUID(), location: `${input.location.lng},${input.location.lat}`, page: String(input.page || 1) });
    if (input.interests?.length) query.set("interests", input.interests.join(","));
    if (input.avoid?.length) query.set("avoid", input.avoid.join(","));
    if (input.exclude?.length) query.set("exclude", input.exclude.join(","));
    const response = await fetch(`/api/candidates?${query}`, { cache: "no-store" });
    const payload = await response.json() as { candidates?: Candidate[]; meta?: CandidateMeta; error?: string };
    if (!response.ok || !Array.isArray(payload.candidates) || payload.candidates.length < 1 || !payload.meta) throw new Error(payload.error || "没有找到合适候选，请换个出发区域再试");
    return { candidates: payload.candidates, meta: payload.meta };
  };

  const createRoom = async () => {
    setCandidateLoading(true); setRoomError(""); setExcludedIds([]); setAppliedVetoReason(""); setSwipes({}); setCardIndex(0);
    try {
      const activeConfig = configRef.current;
      const resolved = creatorLocation ? { location: creatorLocation, label: creatorOrigin } : await resolveOrigin(creatorOrigin);
      setCreatorLocation(resolved.location); setLocationStatus(`已识别 ${resolved.label} · 会用于你的通勤估算`);
      const payload = await loadCandidates({ city: activeConfig.city, kind: activeConfig.kind, location: resolved.location, strategy: ideaMode && selectedInterests.length ? "focused" : "explore", interests: ideaMode ? selectedInterests : undefined, avoid: avoid.split(/[，,、;；]+/).map((item) => item.trim()).filter(Boolean) });
      const roomResponse = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: activeConfig, candidates: payload.candidates, meta: payload.meta, creatorName, creatorOrigin: resolved.label, creatorOriginLocation: resolved.location }) });
      const roomPayload = await roomResponse.json() as { identity?: { code: string; memberId: string; memberToken: string }; error?: string };
      if (!roomResponse.ok || !roomPayload.identity) throw new Error(roomPayload.error || "房间创建失败");
      const nextIdentity = { id: roomPayload.identity.memberId, token: roomPayload.identity.memberToken };
      window.localStorage.setItem(`couju-room-${roomPayload.identity.code}`, JSON.stringify(nextIdentity));
      window.history.replaceState({}, "", `?room=${roomPayload.identity.code}`);
      setRoomCode(roomPayload.identity.code); setIdentity(nextIdentity); setCandidates(payload.candidates); setCandidateMeta(payload.meta);
      await refreshRoom(roomPayload.identity.code, false, nextIdentity); setStage("availability");
    } catch (error) { setRoomError(error instanceof Error ? error.message : "房间创建失败"); }
    finally { setCandidateLoading(false); }
  };

  const joinRoom = async (name: string, origin: string, originLocation: GeoPoint | null) => {
    setSyncing(true); setRoomError("");
    try {
      const response = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode, name, origin, originLocation }) });
      const payload = await response.json() as { identity?: MemberIdentity; error?: string };
      if (!response.ok || !payload.identity) throw new Error(payload.error || "加入失败");
      setIdentity(payload.identity); window.localStorage.setItem(`couju-room-${roomCode}`, JSON.stringify(payload.identity));
      await refreshRoom(roomCode, true, payload.identity); setStage("availability");
    } catch (error) { setRoomError(error instanceof Error ? error.message : "加入失败"); }
    finally { setSyncing(false); }
  };

  const submitAvailability = async () => {
    if (!identity || !room) return;
    setSyncing(true); setRoomError("");
    try {
      const intervals = slotsToIntervals(availableSlots);
      const response = await fetch("/api/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode, memberId: identity.id, token: identity.token, expectedRound: room.currentRound, intervals }) });
      const payload = await response.json() as { error?: string; resolution?: { status: "incomplete" | "resolved" | "partial"; unavailableMemberIds?: string[] } };
      if (!response.ok) throw new Error(payload.error || "空闲时间提交失败");
      await refreshRoom(roomCode, true);
      if (payload.resolution?.status === "partial") { setRoomError("目前没有所有人都能参加的共同时间，请调整选择后重新提交"); return; }
      setStage("room"); setToast(payload.resolution?.status === "resolved" ? "已算出共同时间" : "空闲时间已提交，等待其他成员");
    } catch (error) { setRoomError(error instanceof Error ? error.message : "空闲时间提交失败"); }
    finally { setSyncing(false); }
  };

  const saveStartingConstraints = async () => {
    if (!identity || !room) return;
    setSyncing(true); setRoomError("");
    try {
      const response = await fetch("/api/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "constraints", roomCode, memberId: identity.id, token: identity.token, budgetLabel: budget, commuteLabel: commute, setting }) });
      const payload = await response.json() as { ready?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "通勤边界提交失败");
      await refreshRoom(roomCode, true);
      setStage("room"); setToast(payload.ready ? "已按全体通勤上限生成共享卡池" : "边界已提交，等待其他成员");
    } catch (error) { setRoomError(error instanceof Error ? error.message : "通勤边界提交失败"); }
    finally { setSyncing(false); }
  };

  const advanceCard = () => {
    if (cardIndex === candidates.length - 1) setStage("constraints"); else setCardIndex((value) => value + 1);
  };

  const chooseCard = (choice: Choice) => {
    const current = candidates[cardIndex];
    if (!current) return;
    setSwipes((old) => ({ ...old, [current.id]: choice }));
    if (choice === "no") setPendingRejectionId(current.id);
    else advanceCard();
  };

  const finishRejection = (code: RejectionReasonCode | null, detail = "") => {
    if (pendingRejectionId && code) setRejectionReasons((old) => ({ ...old, [pendingRejectionId]: { code, ...(detail.trim() ? { detail: detail.trim().slice(0, 120) } : {}) } }));
    setPendingRejectionId(null);
    advanceCard();
  };

  const saveCurrentChoices = async () => {
    if (!identity || !roomCode) throw new Error("成员身份已失效，请重新加入");
    const response = await fetch("/api/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomCode, memberId: identity.id, token: identity.token, expectedRound: room?.currentRound, budgetLabel: budget, commuteLabel: commute, setting, note, extraction, choices: swipes, rejectionReasons }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error || "提交失败");
    await refreshRoom(roomCode, true);
  };

  const postRoundAction = async (body: RoundClientAction | AdvanceAction) => {
    if (!identity || !roomCode || !room) throw new Error("成员身份已失效，请重新加入");
    const response = await fetch("/api/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomCode, memberId: identity.id, token: identity.token, expectedRound: room.currentRound, ...body }),
    });
    const payload = await response.json() as { candidates?: Candidate[]; error?: string };
    if (!response.ok) throw new RoundActionError(payload.error || "本轮请求失败", response.status);
    return payload;
  };

  const requestNextRound = async () => {
    if (!currentMember?.submittedAt || !room) return;
    const requested = currentMember.refreshRequestRound === room.currentRound;
    setSyncing(true); setRoomError("");
    try {
      await postRoundAction({ action: "request", requested: !requested });
      await refreshRoom(roomCode, true);
      setToast(requested ? "已取消换一批请求" : "已告诉房主：你希望根据全体反馈换一批");
    } catch (error) {
      if (error instanceof RoundActionError && error.status === 409) await refreshRoom(roomCode, true);
      setRoomError(error instanceof Error ? error.message : "请求换一批失败，请重试");
    } finally {
      setSyncing(false);
    }
  };

  const acceptCommuteRelaxation = async (minutes: number) => {
    if (!identity || !room) return;
    setSyncing(true); setRoomError("");
    try {
      const response = await fetch("/api/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "relax-commute", roomCode, memberId: identity.id, token: identity.token, expectedRound: room.currentRound, minutes }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "调整失败");
      await refreshRoom(roomCode, true); setCommute(`≤ ${minutes} 分钟`); setToast(`已确认本轮通勤上限为 ${minutes} 分钟`); setStage("room");
    } catch (error) { setRoomError(error instanceof Error ? error.message : "调整失败"); }
    finally { setSyncing(false); }
  };

  const advanceRound = async () => {
    if (!room) return;
    setAdvanceLoading(true); setRoomError("");
    try {
      await postRoundAction({ action: "advance" });
      const nextRoom = await refreshRoom(roomCode, true);
      if (!nextRoom || nextRoom.currentRound !== room.currentRound + 1) throw new Error("下一轮已生成，但房间状态未能刷新，请稍后重试");
      setCardIndex(0); setSwipes({}); setRejectionReasons({}); setPendingRejectionId(null); setPrivateCandidates([]); setPrivateNominationId(null); setPrivateError("");
      setAdvanceConfirmOpen(false); setStage("room");
      setToast(`第 ${nextRoom.currentRound}/3 轮已开启，所有人重新选择这 12 张卡`);
    } catch (error) {
      if (error instanceof RoundActionError && error.status === 409) {
        await refreshRoom(roomCode, true);
        setToast("房间状态已变化，已刷新当前轮次");
      } else {
        setRoomError(error instanceof Error ? error.message : "开启下一轮失败，请重试");
      }
      setAdvanceConfirmOpen(false);
    } finally {
      setAdvanceLoading(false);
    }
  };

  const requestPrivateDiscovery = async () => {
    setPrivateActionLoading(true); setPrivateError(""); setParseError("");
    try {
      const [first, request, discovery] = privateDiscoveryRequestPlan();
      if (first === "save-choices" && !currentMember?.submittedAt) await saveCurrentChoices();
      await postRoundAction(request);
      const payload = await postRoundAction(discovery);
      if (!Array.isArray(payload.candidates) || payload.candidates.length !== 3) throw new Error("私人发现未能返回三张候选，请重试");
      setPrivateCandidates(payload.candidates);
      setPrivateNominationId(null);
      setStage("private-discovery");
    } catch (error) {
      const failure = privateDiscoveryFailure(error instanceof Error ? error.message : "私人发现暂时不可用，请重试");
      setParseError(failure.message); setStage(failure.stage);
    } finally {
      setPrivateActionLoading(false);
    }
  };

  const submitPrivateNomination = async (candidateId: string | null) => {
    setPrivateActionLoading(true); setPrivateError("");
    try {
      await postRoundAction(privateNominationAction(candidateId));
      setPrivateNominationId(candidateId);
      await refreshRoom(roomCode, true);
      setStage("room");
      setToast(candidateId ? "已提名到下一轮共享评选" : "已跳过私人发现，换一批请求已保留");
    } catch (error) {
      setPrivateError(error instanceof Error ? error.message : "提交私人发现失败，请重试");
    } finally {
      setPrivateActionLoading(false);
    }
  };

  const parsePreference = async () => {
    setParseLoading(true); setParseError("");
    try {
      const response = await fetch("/api/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note, kind: config.kind, city: config.city, date: config.date, startTime: config.startTime, endTime: config.endTime, roomCode, memberId: identity?.id, token: identity?.token }) });
      const payload = await response.json() as { extraction?: PreferenceExtraction; error?: string };
      if (!response.ok || !payload.extraction) throw new Error(payload.error || "解析失败");
      setExtraction(payload.extraction);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "偏好解析暂时不可用");
    } finally {
      setParseLoading(false);
    }
  };

  const removeSignal = (id: string) => setExtraction((current) => current ? { ...current, hardConstraints: current.hardConstraints.filter((item) => item.id !== id), softPreferences: current.softPreferences.filter((item) => item.id !== id) } : current);
  const startRanking = () => {
    if (!room || room.members.length !== room.config.people) return setToast(`等待全部 ${room?.config.people ?? config.people} 位成员加入`);
    if (readyMembers.length !== room.config.people) return setToast("等待所有成员完成本轮选择");
    setRankingStep(0); setAiExplanation(null); setStage("ranking");
    const top = ranked.slice(0, 3).map((candidate) => ({ name: candidate.name, groupFit: candidate.groupFit, minUtility: candidate.minUtility, meanUtility: candidate.meanUtility, geoMean: candidate.geoMean, evidence: candidate.evidence }));
    const people = readyMembers.map((member) => ({ budget: member.budgetLabel, commute: member.commuteLabel }));
    if (top.length > 0) void fetch("/api/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city: config.city, kind: config.kind, members: people, candidates: top, roomCode, memberId: identity?.id, token: identity?.token }) }).then((response) => response.json()).then((payload: { explanation?: AiExplanation | null }) => { if (payload.explanation) setAiExplanation(payload.explanation); }).catch(() => undefined);
  };
  const confirmConstraints = async () => {
    if (!identity || !roomCode) return;
    setSyncing(true);
    try {
      await saveCurrentChoices();
      await refreshRoom(roomCode, true); setStage("room"); setToast(extraction ? `偏好已提交 · ${extraction.mode === "deepseek" ? "DeepSeek 理解" : "规则理解"}` : "偏好已提交");
    } catch (error) { setParseError(error instanceof Error ? error.message : "提交失败"); }
    finally { setSyncing(false); }
  };
  const applyVeto = () => {
    const target = vetoTarget || mainResult;
    if (target) setExcludedIds((old) => [...new Set([...old, target.id])]);
    setAppliedVetoReason(vetoReason); setVetoOpen(false); setVetoTarget(null); setToast(`“${vetoReason}”已加入本轮重排`); startRanking();
  };

  const copyShare = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?room=${roomCode}`); setToast("房间链接已复制，朋友打开即可加入"); }
    catch { setToast("浏览器未允许复制，请从地址栏复制链接"); }
  };

  const addCalendar = () => {
    const calendarResult = lockedResult || mainResult;
    if (!calendarResult) return;
    const compactDate = config.date.replaceAll("-", ""); const start = config.startTime.replace(":", ""); const end = config.endTime.replace(":", "");
    const location = calendarResult.source.mode === "live" ? `${config.city}市${calendarResult.address}` : `${config.city} · 地点需确认`;
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Couju//Group Decision OS//CN\nBEGIN:VEVENT\nUID:${Date.now()}@couju.demo\nDTSTAMP:${compactDate}T000000Z\nDTSTART:${compactDate}T${start}00\nDTEND:${compactDate}T${end}00\nSUMMARY:凑局｜${calendarResult.name}\nLOCATION:${location}\nDESCRIPTION:数据来源：${calendarResult.source.label}；到店前请确认价格、营业与可订状态。\nEND:VEVENT\nEND:VCALENDAR`;
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `凑局-${config.date}.ics`; link.click(); URL.revokeObjectURL(url); setToast("日历文件已生成");
  };

  const currentProgress = Math.max(0, stageOrder.indexOf(stage));
  const vetoReasons = config.kind === "dining" ? ["太辣了", "不吃生食", "还是太远", "价格超预期"] : ["太吵了", "不想运动", "还是太远", "价格超预期"];

  return <main className={`app ${stage === "home" ? "home-mode" : "demo-mode"}`}>
    <header className="app-header"><button className="brand" onClick={() => stage !== "home" && resetSession()} aria-label="返回凑局首页"><span className="brand-mark">凑</span><span>凑局</span><small>COUJU</small></button>{stage === "home" ? <span className="privacy-pill"><i /> 十城地点已上线</span> : <div className="demo-header-right"><div className="step-dots" aria-label={`Demo 进度 ${currentProgress + 1}/${stageOrder.length}`}>{stageOrder.map((item, index) => <span key={item} className={index <= currentProgress ? "active" : ""} />)}</div><span className={`demo-badge mode-${candidateMeta.mode}`}>{candidateMeta.mode === "live" ? "地点推荐" : "演示数据"}</span><button className="quiet-button" onClick={resetSession}>退出</button></div>}</header>
    {stage === "home" && <HomeScreen onStart={() => setStage("create")} />}
    {stage === "create" && <CreateScreen config={config} creatorName={creatorName} creatorOrigin={creatorOrigin} creatorLocation={creatorLocation} locationStatus={locationStatus} locating={locating} ideaMode={ideaMode} selectedInterests={selectedInterests} avoid={avoid} setCreatorName={setCreatorName} setCreatorOrigin={(value) => { setCreatorOrigin(value); setCreatorLocation(null); setLocationStatus("输入后会识别地铁站或商圈，并用于通勤估算"); }} setIdeaMode={setIdeaMode} setSelectedInterests={setSelectedInterests} setAvoid={setAvoid} onLocate={useCurrentLocation} error={roomError} onChange={updateConfig} onBack={() => setStage("home")} onCreate={createRoom} loading={candidateLoading} />}
    {stage === "join" && joinRoomSummary && <JoinScreen room={joinRoomSummary} loading={syncing} error={roomError} onJoin={joinRoom} />}
    {stage === "availability" && room && <AvailabilityScreen config={room.config} selected={availableSlots} setSelected={setAvailableSlots} loading={syncing} error={roomError} onSubmit={submitAvailability} />}
    {stage === "room" && room && <RoomScreen room={room} currentMember={currentMember} syncing={syncing} error={roomError} onShare={copyShare} onPreference={() => { setCardIndex(0); setSwipes(currentMember?.choices ?? {}); setRejectionReasons(currentMember?.rejectionReasons ?? {}); setBudget(currentMember?.budgetLabel || budget); setCommute(currentMember?.commuteLabel || commute); setSetting(currentMember?.setting || setting); setNote(currentMember?.note || ""); setExtraction(currentMember?.extraction ?? null); setPrivateCandidates([]); setPrivateNominationId(null); setPrivateError(""); setStage(getPreferenceEntryStage({ currentRound: room.currentRound, constraintsReady: Boolean(currentMember?.constraintsReady), groupIntersection: room.meta.groupIntersection })); }} onRank={startRanking} onRequestNextRound={requestNextRound} onOpenAdvance={() => setAdvanceConfirmOpen(true)} />}
    {stage === "setup" && <PreferenceSetupScreen config={config} budget={budget} commute={commute} setting={setting} setBudget={setBudget} setCommute={setCommute} setSetting={setSetting} onBack={() => setStage("room")} onContinue={saveStartingConstraints} loading={syncing} />}
    {stage === "swipe" && <SwipeScreen config={config} cards={candidates} index={cardIndex} choices={swipes} pendingRejection={Boolean(pendingRejectionId)} travelMinutes={estimateTravelBetween(currentMember?.originLocation ?? null, candidates[cardIndex]?.location ?? null) ?? candidates[cardIndex]?.estimatedTravelMinutes ?? null} onChoose={chooseCard} onRejection={finishRejection} onBack={() => setStage("setup")} onPointerDown={(x) => { pointerStart.current = x; }} onPointerUp={(x) => { if (pointerStart.current === null || pendingRejectionId) return; const delta = x - pointerStart.current; if (delta > 65) chooseCard("like"); else if (delta < -65) chooseCard("no"); pointerStart.current = null; }} />}
    {stage === "constraints" && <PreferenceDetailsScreen config={config} note={note} extraction={extraction} loading={parseLoading} submitting={syncing} error={parseError} allRejected={canRequestPrivateDiscovery(candidates, swipes)} privateLoading={privateActionLoading} setNote={(value) => { setNote(value); setExtraction(null); }} onParse={parsePreference} onRemoveSignal={removeSignal} onBack={() => setStage("swipe")} onConfirm={confirmConstraints} onRequestPrivate={requestPrivateDiscovery} />}
    {stage === "private-discovery" && room && currentMember && <PrivateDiscoveryScreen config={config} cards={privateCandidates} selectedId={privateNominationId} member={currentMember} loading={privateActionLoading} error={privateError} onSelect={setPrivateNominationId} onSubmit={() => submitPrivateNomination(privateNominationId)} onSkip={() => submitPrivateNomination(null)} onBack={() => setStage("constraints")} />}
    {stage === "ranking" && <RankingScreen config={config} step={rankingStep} candidates={candidates} ranked={ranked} meta={candidateMeta} />}
    {stage === "results" && room && <ResultsScreen config={config} room={room} currentMember={currentMember} ranked={ranked} meta={candidateMeta} members={readyMembers} aiExplanation={aiExplanation} error={roomError} advancing={advanceLoading} privateLoading={privateActionLoading} onPrivateDiscovery={requestPrivateDiscovery} onAcceptCommute={acceptCommuteRelaxation} onVeto={(selected) => { setVetoTarget(selected); setVetoOpen(true); }} onLock={(selected) => { setLockedResult(selected); setStage("locked"); }} onAdjust={() => setStage("setup")} onDiscuss={() => setStage("room")} onRequestNextRound={requestNextRound} onOpenAdvance={() => setAdvanceConfirmOpen(true)} />}
    {stage === "locked" && (lockedResult || mainResult) && <LockedScreen config={config} result={(lockedResult || mainResult)!} onCalendar={addCalendar} onReset={resetSession} onShare={copyShare} />}
    {vetoOpen && <div className="modal-backdrop"><button className="modal-dismiss-layer" onClick={() => setVetoOpen(false)} aria-label="关闭否决弹窗" /><section className="veto-modal" role="dialog" aria-modal="true" aria-labelledby="veto-title"><button className="modal-close" onClick={() => setVetoOpen(false)} aria-label="关闭">×</button><span className="modal-icon">!</span><h2 id="veto-title">什么让你无法接受？</h2><p>当前方案会被排除，所选原因会进入下一轮确定性重排。</p><div className="reason-grid">{vetoReasons.map((reason) => <button key={reason} className={vetoReason === reason ? "selected" : ""} onClick={() => setVetoReason(reason)}>{reason}</button>)}</div><button className="full-dark-button" onClick={applyVeto}>加入本轮约束并重排 <span>→</span></button></section></div>}
    {advanceConfirmOpen && room && <div className="modal-backdrop"><button className="modal-dismiss-layer" onClick={() => !advanceLoading && setAdvanceConfirmOpen(false)} aria-label="关闭开启下一轮确认" /><section className="advance-modal" role="dialog" aria-modal="true" aria-labelledby="advance-title"><button className="modal-close" onClick={() => !advanceLoading && setAdvanceConfirmOpen(false)} aria-label="关闭">×</button><span className="modal-icon">↻</span><h2 id="advance-title">确认开启下一轮？</h2><p>会保留预算、通勤和已确认偏好；明确拒绝的地点不会重复出现。</p><div className="advance-modal-note"><b>下一轮 12 张卡</b><span>{room.members.filter((member) => member.nominatedCandidate).length} 张成员提名 · {8 - Math.min(8, room.members.filter((member) => member.nominatedCandidate).length)} 张反馈学习 · 4 张新类型探索</span></div><button className="full-dark-button" onClick={advanceRound} disabled={advanceLoading}>{advanceLoading ? "正在生成下一轮…" : "汇总提名与反馈，开启下一轮"} <span>→</span></button></section></div>}
    {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
  </main>;
}

function HomeScreen({ onStart }: { onStart: () => void }) {
  return <><section className="hero"><div className="hero-copy"><div className="eyebrow"><i /> AI GROUP DECISION</div><h1>不是猜一个答案，<br /><em>是算出交集。</em></h1><p>说出每个人的预算、时间和偏好，凑局会从真实地点中找到大家都能接受的方案。</p><div className="hero-actions"><button className="primary-button" onClick={onStart}>开始创建 <span>→</span></button><span className="city-coverage"><b>已支持 10 座城市</b><small>上海、北京、广州、深圳、杭州<br />成都、南京、重庆、苏州、合肥</small></span></div><div className="hero-proof"><div className="proof-faces"><i>懂</i><i>算</i><i>选</i></div><span><b>理解每个人，再匹配共同选择</b><small>预算、距离和底线都会改变结果</small></span></div></div><div className="decision-card" aria-label="凑局推荐预览"><div className="floating-chat chat-one"><b>人均 150</b><small>进入预算筛选</small></div><div className="floating-chat chat-two"><b>别太辣</b><small>AI 理解偏好</small></div><div className="card-topline"><span><i /> 周末聚餐</span><b>GROUP FIT</b></div><div className="trust-stack"><div><span>01</span><p><b>选城市</b><small>十座城市均可使用</small></p><em>地点</em></div><div><span>02</span><p><b>说偏好</b><small>AI 理解自然语言</small></p><em>理解</em></div><div><span>03</span><p><b>一起选</b><small>兼顾每个人的底线</small></p><em>公平</em></div></div><div className="place-result"><div className="result-visual photo-preview"><img src="/candidates/food-yunnan.jpg" alt="聚餐候选示例" /><span>PREVIEW</span></div><div><small>结果随输入变化</small><h3>Group Fit 动态计算</h3><p>预算 · 距离 · 偏好 · 底线</p></div><strong>ƒ(x)<small>FAIRMIX</small></strong></div><div className="fit-line"><i>✓</i><span><b>不是少数服从多数</b><small>先保证每个人都能接受，再寻找整体最优</small></span></div></div></section><section className="how-strip"><div><b>01</b><span>选择城市与场景</span><small>十城餐厅与活动均可选择</small></div><div className="arrow">→</div><div><b>02</b><span>告诉 AI 你的底线</span><small>自然语言会变成可确认条件</small></div><div className="arrow">→</div><div><b>03</b><span>一起找到交集</span><small>每条推荐都有清楚理由</small></div></section></>;
}

function ScreenTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) { return <div className="screen-title"><span>{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>; }

function dateRangeDays(start: string, end: string) {
  const result: string[] = [];
  for (let cursor = new Date(`${start}T00:00:00+08:00`).getTime(), last = new Date(`${end}T00:00:00+08:00`).getTime(); cursor <= last && result.length < 14; cursor += 86_400_000) result.push(new Date(cursor + 8 * 60 * 60_000).toISOString().slice(0, 10));
  return result;
}

function slotsToIntervals(slots: string[]) {
  const sorted = [...new Set(slots)].sort();
  const result: Array<{ startAt: string; endAt: string }> = [];
  for (const slot of sorted) {
    const start = new Date(slot).getTime(); const end = start + 30 * 60_000;
    const previous = result.at(-1);
    if (previous && new Date(previous.endAt).getTime() === start) previous.endAt = new Date(end).toISOString().replace(".000Z", "+00:00");
    else result.push({ startAt: slot, endAt: new Date(end).toISOString().replace(".000Z", "+00:00") });
  }
  return result;
}

type AvailabilityRange = { id: string; date: string; start: string; end: string };

function defaultAvailabilityRanges(config: RoomConfig) {
  const periods = PERIOD_ORDER.filter((period) => config.preferredPeriods.includes(period));
  const start = PERIOD_RANGES[periods[0] ?? "evening"][0];
  const end = PERIOD_RANGES[periods.at(-1) ?? "evening"][1];
  return dateRangeDays(config.dateRange.start, config.dateRange.end).map((date, index) => ({ id: `${date}-${index}`, date, start, end }));
}

function rangesToSlots(ranges: AvailabilityRange[]) {
  return ranges.flatMap((range) => {
    const [startHour, startMinute] = range.start.split(":").map(Number);
    const [endHour, endMinute] = range.end.split(":").map(Number);
    const start = startHour * 60 + startMinute; const end = endHour * 60 + endMinute;
    if (end <= start) return [];
    const slots: string[] = [];
    for (let minute = start; minute < end; minute += 30) slots.push(`${range.date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00+08:00`);
    return slots;
  });
}

function AvailabilityScreen({ config, selected, setSelected, loading, error, onSubmit }: { config: RoomConfig; selected: string[]; setSelected: (value: string[]) => void; loading: boolean; error: string; onSubmit: () => void }) {
  const [ranges, setRanges] = useState<AvailabilityRange[]>(() => defaultAvailabilityRanges(config));
  const timeOptions = useMemo(() => Array.from({ length: 33 }, (_, index) => { const minute = 8 * 60 + index * 30; return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`; }), []);
  useEffect(() => { setSelected(rangesToSlots(ranges)); }, [ranges, setSelected]);
  const updateRange = (id: string, patch: Partial<AvailabilityRange>) => setRanges((current) => current.map((range) => range.id === id ? { ...range, ...patch } : range));
  const addRange = (date: string) => setRanges((current) => [...current, { id: `${date}-${Date.now()}`, date, start: "18:00", end: "21:00" }]);
  const applyPreset = (date: string, period: keyof typeof PERIOD_LABELS) => setRanges((current) => [...current.filter((range) => range.date !== date), { id: `${date}-${period}`, date, start: PERIOD_RANGES[period][0], end: PERIOD_RANGES[period][1] }].sort((a, b) => a.date.localeCompare(b.date)));
  const invalid = ranges.some((range) => range.end <= range.start);
  return <section className="flow-page create-page availability-page"><ScreenTitle eyebrow="YOUR AVAILABILITY" title="你什么时候有空？" detail={`${formatDate(config.dateRange.start)} 至 ${formatDate(config.dateRange.end)} · 直接填写可以参加的时间范围`} /><div className="form-card availability-card"><div className="availability-toolbar"><p>房主倾向：{PERIOD_ORDER.filter((period) => config.preferredPeriods.includes(period)).map((item) => PERIOD_LABELS[item]).join("、")}</p><span>支持添加多段不连续时间</span></div><div className="range-days">{dateRangeDays(config.dateRange.start, config.dateRange.end).map((date) => <section className="range-day" key={date}><div className="range-day-head"><b>{formatDate(date)}</b><div>{PERIOD_ORDER.map((period) => <button type="button" key={period} onClick={() => applyPreset(date, period)}>{PERIOD_LABELS[period]}</button>)}</div></div>{ranges.filter((range) => range.date === date).map((range, index) => <div className="time-range-row" key={range.id}><label><span>开始时间</span><select value={range.start} onChange={(event) => updateRange(range.id, { start: event.target.value })}>{timeOptions.slice(0, -1).map((time) => <option key={time}>{time}</option>)}</select></label><i>至</i><label><span>结束时间</span><select value={range.end} onChange={(event) => updateRange(range.id, { end: event.target.value })}>{timeOptions.slice(1).map((time) => <option key={time}>{time}</option>)}</select></label>{index > 0 && <button type="button" className="remove-range" aria-label="删除这段时间" onClick={() => setRanges((current) => current.filter((item) => item.id !== range.id))}>×</button>}</div>)}<button type="button" className="add-range" onClick={() => addRange(date)}>＋ 添加另一段时间</button></section>)}</div>{invalid && <p className="form-error">结束时间需要晚于开始时间</p>}{error && <p className="form-error">{error}</p>}<button className="full-dark-button" disabled={loading || selected.length === 0 || invalid} onClick={onSubmit}>{loading ? "正在提交…" : `提交 ${ranges.length} 段空闲时间`} <span>→</span></button><p className="privacy-note">你的具体空闲时间不会展示给其他成员；系统只用这些范围计算大家都能参加的交集。</p></div></section>;
}

function CreateScreen(props: { config: RoomConfig; creatorName: string; creatorOrigin: string; creatorLocation: GeoPoint | null; locationStatus: string; locating: boolean; ideaMode: boolean; selectedInterests: string[]; avoid: string; setCreatorName: (value: string) => void; setCreatorOrigin: (value: string) => void; setIdeaMode: (value: boolean) => void; setSelectedInterests: (value: string[]) => void; setAvoid: (value: string) => void; onLocate: () => void; error: string; onChange: (config: RoomConfig) => void; onBack: () => void; onCreate: () => void; loading: boolean }) {
  const [error, setError] = useState("");
  const update = <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => { props.onChange({ ...props.config, [key]: value }); setError(""); };
  const interests = props.config.kind === "dining" ? DINING_INTERESTS : ACTIVITY_INTERESTS;
  const toggleInterest = (value: string) => props.setSelectedInterests(props.selectedInterests.includes(value) ? props.selectedInterests.filter((item) => item !== value) : [...props.selectedInterests, value].slice(-6));
  const submit = () => {
    if (!props.creatorName.trim() || !props.creatorOrigin.trim()) return setError("请填写昵称，并输入出发区域或使用系统定位");
    if (!props.config.dateRange.start || !props.config.dateRange.end || !props.config.preferredPeriods.length) return setError("请选择日期范围和大概时段");
    if (props.config.dateRange.start < shanghaiDate() || props.config.dateRange.end < props.config.dateRange.start) return setError("日期范围无效");
    props.onCreate();
  };
  return <section className="flow-page create-page">
    <button className="back-button" onClick={props.onBack}>← 返回</button>
    <ScreenTitle eyebrow="CREATE A REAL ROOM" title="先发一手灵感牌" detail="没想好也没关系：默认从全城跨类型随机发现；每个人稍后单独设置可接受的通勤上限。" />
    <div className="create-layout single-card"><div className="form-card">
      <fieldset><legend>这次想决定什么？</legend><div className="option-pair"><button className={props.config.kind === "activity" ? "selected" : ""} onClick={() => update("kind", "activity")}><b>✦</b><span>周末活动<small>娱乐、运动、手作、放松</small></span></button><button className={props.config.kind === "dining" ? "selected" : ""} onClick={() => update("kind", "dining")}><b>♨</b><span>一起聚餐<small>跨菜系随机发现</small></span></button></div></fieldset>
      <div className="field-grid"><label><span>你的昵称</span><input className="form-control" value={props.creatorName} maxLength={18} onChange={(event) => props.setCreatorName(event.target.value)} placeholder="例如：Jay" /></label><label><span>城市</span><select className="form-control" value={props.config.city} onChange={(event) => update("city", event.target.value as CityName)}>{SUPPORTED_CITIES.map((city) => <option key={city} value={city}>{city}</option>)}</select></label><label className="location-field"><span>从哪里出发</span><div className="location-input-row"><input className="form-control" value={props.creatorOrigin} maxLength={40} onChange={(event) => props.setCreatorOrigin(event.target.value)} placeholder="地铁站 / 商圈" /><button type="button" onClick={props.onLocate} disabled={props.locating}>{props.locating ? "定位中" : "⌖ 定位"}</button></div><small className={props.creatorLocation ? "location-ok" : ""}>{props.locationStatus}</small></label><label><span>最早日期</span><input className="form-control" type="date" min={shanghaiDate()} value={props.config.dateRange.start} onChange={(event) => update("dateRange", { ...props.config.dateRange, start: event.target.value })} /></label><label><span>最晚日期</span><input className="form-control" type="date" min={props.config.dateRange.start} value={props.config.dateRange.end} onChange={(event) => update("dateRange", { ...props.config.dateRange, end: event.target.value })} /></label></div>
      <fieldset><legend>大概什么时段？可多选</legend><div className="number-row schedule-choice-row">{PERIOD_ORDER.map((value) => <button type="button" key={value} className={props.config.preferredPeriods.includes(value) ? "selected" : ""} onClick={() => update("preferredPeriods", props.config.preferredPeriods.includes(value) ? props.config.preferredPeriods.filter((item) => item !== value) : PERIOD_ORDER.filter((item) => [...props.config.preferredPeriods, value].includes(item)))}>{PERIOD_LABELS[value]}</button>)}</div></fieldset>
      <fieldset><legend>大概玩多久？</legend><div className="number-row duration-choice-row">{DURATION_OPTIONS.map((option) => <button type="button" key={String(option.value)} className={props.config.durationMinutes === option.value ? "selected" : ""} onClick={() => update("durationMinutes", option.value)}>{option.label}</button>)}</div><p className="privacy-note">具体开始和结束时间将在成员提交空闲时间后自动确定。</p></fieldset>
      <fieldset className="discovery-field"><legend>推荐方式</legend><div className="discovery-toggle"><button className={!props.ideaMode ? "selected" : ""} onClick={() => props.setIdeaMode(false)}><b>给我灵感</b><small>默认 · 跨类型随机发现</small></button><button className={props.ideaMode ? "selected" : ""} onClick={() => props.setIdeaMode(true)}><b>我有点想法</b><small>可选 1–6 个倾向</small></button></div>{props.ideaMode && <><div className="interest-cloud">{interests.map((interest) => <button key={interest} className={props.selectedInterests.includes(interest) ? "selected" : ""} onClick={() => toggleInterest(interest)}>{interest}</button>)}</div><label className="avoid-field"><span>这次明确不想要（可选）</span><input className="form-control" value={props.avoid} onChange={(event) => props.setAvoid(event.target.value)} placeholder={props.config.kind === "activity" ? "例如：不要景点、不要太吵" : "例如：不要连锁、不要辣"} /></label></>}</fieldset>
      <fieldset><legend>预计几个人？</legend><div className="number-row">{[2, 3, 4, 5, 6].map((number) => <button key={number} className={number === props.config.people ? "selected" : ""} onClick={() => update("people", number)}>{number}</button>)}</div></fieldset>
      {(error || props.error) && <p className="form-error" role="alert">{error || props.error}</p>}<button className="full-dark-button" onClick={submit} disabled={props.loading}>{props.loading ? "正在准备候选…" : `创建${props.config.kind === "dining" ? "聚餐" : "活动"}房间`} <span>→</span></button>
    </div></div>
  </section>;
}

function JoinScreen({ room, loading, error, onJoin }: { room: JoinRoomDto; loading: boolean; error: string; onJoin: (name: string, origin: string, originLocation: GeoPoint | null) => void }) {
  const [name, setName] = useState(""); const [origin, setOrigin] = useState(""); const [originLocation, setOriginLocation] = useState<GeoPoint | null>(null); const [locating, setLocating] = useState(false); const [locationMessage, setLocationMessage] = useState("输入地铁站/商圈，或授权系统定位");
  const locate = () => {
    if (!navigator.geolocation) return setLocationMessage("当前浏览器不支持定位，请手动输入");
    setLocating(true); setLocationMessage("正在定位…");
    requestBrowserPosition(navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)).then(async (position) => {
      try {
        const response = await fetch("/api/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city: room.city, lat: position.coords.latitude, lng: position.coords.longitude }) });
        const payload = await response.json() as LocationResponse;
        if (!response.ok || !payload.location) throw new Error(payload.error || "定位服务暂时不可用");
        setOrigin(payload.label || "当前位置附近"); setOriginLocation(payload.location); setLocationMessage("已定位 · 会参与你的通勤计算");
      } catch (cause) { setLocationMessage(cause instanceof Error ? cause.message : "定位服务暂时不可用，请手动输入"); }
    }).catch((error) => { setLocationMessage(browserLocationError(error as GeolocationPositionError)); }).finally(() => setLocating(false));
  };
  return <section className="flow-page create-page join-page"><ScreenTitle eyebrow={`ROOM ${room.code}`} title={`加入“${room.title}”`} detail={`${room.city} · ${formatDate(room.date)} · 已有 ${room.joinedCount}/${room.targetCount} 人加入`} /><div className="join-card"><div className="join-summary"><span>{room.kind === "dining" ? "♨" : "✦"}</span><div><b>{room.startTime}–{room.endTime}</b><small>{room.city} · 加入后查看 12 张共享候选</small></div></div><label><span>你的昵称</span><input className="form-control" value={name} maxLength={18} onChange={(event) => setName(event.target.value)} placeholder="朋友会看到这个名字" /></label><label><span>从哪里出发</span><div className="location-input-row"><input className="form-control" value={origin} maxLength={40} onChange={(event) => { setOrigin(event.target.value); setOriginLocation(null); setLocationMessage("提交时会识别这个地铁站或商圈"); }} placeholder="不用填写精确住址" /><button type="button" onClick={locate} disabled={locating}>{locating ? "定位中" : "⌖ 定位"}</button></div><small className={originLocation ? "location-ok" : ""}>{locationMessage}</small></label>{error && <p className="form-error">{error}</p>}<button className="full-dark-button" disabled={loading || !name.trim() || !origin.trim() || room.status === "full"} onClick={() => onJoin(name, origin, originLocation)}>{room.status === "full" ? "房间人数已满" : loading ? "正在加入…" : "加入房间"} <span>→</span></button><p className="privacy-note">系统定位只在你点击并授权后使用；手输地铁站或商圈也会参与通勤计算。</p></div></section>;
}

function RoomScreen({ room, currentMember, syncing, error, onShare, onPreference, onRank, onRequestNextRound, onOpenAdvance }: { room: StoredRoom; currentMember: StoredMember | null; syncing: boolean; error: string; onShare: () => void; onPreference: () => void; onRank: () => void; onRequestNextRound: () => void; onOpenAdvance: () => void }) {
  const { config, meta } = room;
  const availabilityCount = room.members.filter((member) => member.availability !== null).length;
  const readiness = getRoomReadiness({ targetCount: config.people, members: room.members });
  const scheduleReady = Boolean(config.resolvedSchedule) && readiness.canStartSelection;
  const doneCount = room.members.filter((member) => member.submittedAt).length;
  const enough = doneCount === config.people;
  const allSubmitted = readiness.groupComplete && doneCount === config.people;
  const controls = getRoundControlVisibility({ currentRound: room.currentRound, creatorId: room.members[0]?.id, memberId: currentMember?.id, allSubmitted, submitted: Boolean(currentMember?.submittedAt) });
  const refreshControl = getRefreshRequestControl({ canRequestRefresh: controls.canRequestRefresh, requested: currentMember?.refreshRequestRound === room.currentRound });
  const isCreator = controls.isCreator;
  const requestCount = room.members.filter((member) => member.refreshRequestRound === room.currentRound).length;
  const canAdvance = controls.canAdvance;
  const waitingMessage = !readiness.groupComplete
    ? `还需 ${config.people - room.members.length} 位成员加入；全员到齐并提交出发地和空闲时间后才能选卡。`
    : !readiness.locationsComplete ? "仍有成员缺少有效出发地，暂不能按多人位置计算。" : "所有成员提交空闲时间后，才能开始选择地点。";
  return <section className="flow-page room-page"><div className="room-kicker"><span>{config.city} · {config.kind === "dining" ? "聚餐" : "活动"}</span><b>房间 {room.code}</b></div><ScreenTitle eyebrow={`${config.kind === "dining" ? "DINNER" : "WEEKEND"} IN ${config.city.toUpperCase()}`} title={roomTitle(config.kind)} detail={scheduleReady ? `${formatDate(config.date)} · ${config.startTime}–${config.endTime} · ${config.city}` : `${formatDate(config.dateRange.start)} 至 ${formatDate(config.dateRange.end)} · 等待全员到齐并提交时间`} /><div className="data-audit-strip"><span className={`source-dot ${meta.mode}`} /><b>{room.candidates.length} 个候选 · {meta.label}</b><span>{room.members.length}/{config.people} 人已加入</span><span>{availabilityCount}/{config.people} 人已提交时间</span><span>{syncing ? "同步中" : "每 4 秒同步"}</span></div><div className="room-grid"><div className="room-main-card"><div className="room-card-head"><div><span>真实成员</span><strong>{doneCount}/{config.people} 已提交偏好</strong></div><i>{scheduleReady ? "共同时间已确定" : !readiness.groupComplete ? `等待 ${config.people - room.members.length} 人加入` : "等待成员提交空闲时间"}</i></div><div className="member-list">{room.members.map((member) => <div key={member.id} className={member.submittedAt ? "member done" : "member pending"}><div className="avatar">{member.name.slice(0, 1).toUpperCase()}{member.availability !== null && <span>✓</span>}</div><div><b>{member.name}{member.id === currentMember?.id ? " · 你" : ""}</b><small>{member.origin} · {member.availability !== null ? member.submittedAt ? "时间与偏好已提交" : "空闲时间已提交" : "等待空闲时间"}</small></div><em>{member.availability !== null ? "时间完成" : "待提交"}</em></div>)}</div>{!scheduleReady ? <p className="form-error">{waitingMessage}</p> : !currentMember?.submittedAt ? <button className="full-dark-button pulse" onClick={onPreference}>开始划这批候选 <span>→</span></button> : <div className="room-actions"><button className="quiet-button" onClick={onPreference}>修改我的偏好</button><button className="full-dark-button lime-button" onClick={onRank} disabled={!enough || !allSubmitted}>计算真实交集 <span>✦</span></button></div>}<p className="privacy-note">⌾ 具体空闲时间仅用于服务端求交集，不会展示给其他成员。</p></div><aside className="invite-card"><span className="big-source-mark live">{room.code}</span><h3>把链接发给朋友</h3><p>对方不需要注册，填写昵称、出发地与空闲时间后即可参与。</p><button onClick={onShare}>复制房间链接 <span>↗</span></button><small>{room.members.length < config.people ? `还可加入 ${config.people - room.members.length} 人` : "房间人数已满"}</small>{error && <p className="form-error">{error}</p>}</aside></div><section className="round-status-card" aria-label="本轮协作状态"><div><span>共享卡池</span><b>第 {room.currentRound}/3 轮</b><small>{doneCount}/{config.people} 人已提交 · {requestCount} 人请求换一批</small></div>{room.currentRound >= 3 ? <p>已经完成三轮探索；若仍没有交集，系统会说明最需要调整的边界。</p> : canAdvance ? <button className="full-dark-button" onClick={onOpenAdvance}>根据全体反馈开启下一轮 <span>→</span></button> : refreshControl.visible ? <button className="round-request-button" aria-pressed={refreshControl.requested} onClick={onRequestNextRound}>{refreshControl.label}</button> : <p>{isCreator ? "全员提交后，才可以根据反馈开启下一轮。" : "提交本轮选择后，可以请求房主换一批。"}</p>}</section><div className="public-constraint"><b>本轮配置</b><span>{scheduleReady ? `${formatDate(config.date)} ${config.startTime}–${config.endTime}` : `${formatDate(config.dateRange.start)} 至 ${formatDate(config.dateRange.end)}`}</span><span>{config.city}市</span><span>{config.preferredPeriods.map((item) => PERIOD_LABELS[item]).join("、")}</span><span>目标 {config.people} 人</span><i>{meta.focused ? `按想法：${meta.keywords?.join("、")}` : "探索模式 · 全城召回后按个人通勤上限筛选"}</i></div></section>;
}

function PreferenceSetupScreen(props: { config: RoomConfig; budget: string; commute: string; setting: string; setBudget: (value: string) => void; setCommute: (value: string) => void; setSetting: (value: string) => void; onBack: () => void; onContinue: () => void; loading: boolean }) {
  const dining = props.config.kind === "dining";
  return <section className="flow-page constraints-page"><button className="back-button" onClick={props.onBack}>← 返回房间</button><ScreenTitle eyebrow="YOUR STARTING POINT" title="先设定你的选择边界" detail="预算和通勤会先提交；全员完成后，系统只生成每个人都可达的共享卡片。" /><div className="constraint-layout preference-setup-layout"><div className="constraint-card"><div className="constraint-label"><span>01</span><div><b>人均预算</b><small>超过上限的已知价格候选不会进入最终结果</small></div></div><ChipGroup label="人均预算" values={dining ? ["≤ ¥100", "≤ ¥150", "≤ ¥200", "不限"] : ["≤ ¥100", "≤ ¥200", "≤ ¥300", "不限"]} selected={props.budget} onSelect={props.setBudget} /><div className="constraint-label"><span>02</span><div><b>最远单程通勤</b><small>从你的出发地到每个候选分别计算，并与其他成员求交集</small></div></div><ChipGroup label="最远单程通勤" values={["≤ 30 分钟", "≤ 60 分钟", "≤ 1.5 小时", "不限"]} selected={props.commute} onSelect={props.setCommute} /><div className="constraint-label"><span>03</span><div><b>{dining ? "用餐氛围" : "场景偏好"}</b><small>这是软偏好，只影响卡片顺序和最终得分</small></div></div><ChipGroup label={dining ? "用餐氛围" : "场景偏好"} values={dining ? ["安静聊天", "热闹聚会", "都可以"] : ["室内优先", "户外优先", "都可以"]} selected={props.setting} onSelect={props.setSetting} /></div></div><button className="confirm-preference" disabled={props.loading} onClick={props.onContinue}>{props.loading ? "正在计算多人可达交集…" : "提交我的选择边界"} <span>→</span></button></section>;
}

function SwipeScreen({ config, cards, index, choices, pendingRejection, travelMinutes, onChoose, onRejection, onBack, onPointerDown, onPointerUp }: { config: RoomConfig; cards: Candidate[]; index: number; choices: Record<string, Choice>; pendingRejection: boolean; travelMinutes: number | null; onChoose: (choice: Choice) => void; onRejection: (reason: RejectionReasonCode | null, detail?: string) => void; onBack: () => void; onPointerDown: (x: number) => void; onPointerUp: (x: number) => void }) {
  const [otherOpen, setOtherOpen] = useState(false); const [otherReason, setOtherReason] = useState("");
  const card = cards[index]; if (!card) return null;
  const finish = (code: RejectionReasonCode | null, detail = "") => { setOtherOpen(false); setOtherReason(""); onRejection(code, detail); };
  return <section className="flow-page swipe-page"><div className="mobile-frame"><div className="mobile-top"><button onClick={onBack} aria-label="返回选择边界">×</button><span>{config.kind === "dining" ? "你的餐厅偏好" : "你的活动偏好"}</span><b>{index + 1}<small> / {cards.length}</small></b></div><div className="progress-line"><i style={{ width: `${((index + 1) / cards.length) * 100}%` }} /></div><div className="swipe-prompt"><span>边选边发现，不要求提前想好</span><h2>{config.kind === "dining" ? "这家，你想和朋友一起吃吗？" : "这个周末，你想去吗？"}</h2><p>喜欢与拒绝会影响下一批候选</p></div><div className="card-stack"><div className="ghost-card ghost-two" /><div className="ghost-card ghost-one" /><button className="swipe-card photo-card" disabled={pendingRejection} onPointerDown={(event) => onPointerDown(event.clientX)} onPointerUp={(event) => onPointerUp(event.clientX)} onKeyDown={(event) => { if (event.key === "ArrowRight") onChoose("like"); if (event.key === "ArrowLeft") onChoose("no"); }} aria-label={`${card.name}，左方向键不想去，右方向键喜欢`}><div className="activity-art"><img src={card.image} alt={card.name} draggable={false} referrerPolicy="no-referrer" /><div className="image-shade" /><span className="category-chip">{card.matchedInterest || card.type}</span><i>{card.source.mode === "live" ? "高德地点" : "演示候选"}</i></div><div className="activity-info"><span>{card.source.label}</span><h3>{card.name}</h3><p>{card.priceLabel} · {card.durationLabel} · {card.meta}</p><div><small>{card.rating ? `评分 ${card.rating.toFixed(1)}` : "评分待确认"}</small><small>{travelMinutes ? `从你的位置通勤约 ${travelMinutes} 分钟` : "通勤待确认"}</small><small>{card.openToday ? `今日 ${card.openToday}` : "营业/可订需确认"}</small></div></div></button></div><div className="swipe-actions"><button className="no" disabled={pendingRejection} onClick={() => onChoose("no")} aria-label="不想去">×<small>不想去</small></button><button className="okay" disabled={pendingRejection} onClick={() => onChoose("okay")} aria-label="还行">−<small>还行</small></button><button className="yes" disabled={pendingRejection} onClick={() => onChoose("like")} aria-label="喜欢">♥<small>喜欢</small></button></div><p className="gesture-hint">← 左滑排除 · 右滑提高个人效用 →</p><div className="choice-history" aria-label={`${Object.keys(choices).length} 张卡已完成`} /></div>{pendingRejection && <div className="rejection-sheet" role="dialog" aria-label="为什么不喜欢"><b>主要是哪里不合适？</b><small>可跳过，不会打断选卡</small><div>{rejectionReasonOptions(config.kind).map((item) => <button key={item.code} onClick={() => finish(item.code)}>{item.label}</button>)}</div>{otherOpen ? <div className="other-reason"><input autoFocus maxLength={120} value={otherReason} onChange={(event) => setOtherReason(event.target.value)} placeholder="一句话补充，可选" /><button onClick={() => finish("other", otherReason)} disabled={!otherReason.trim()}>提交</button></div> : <button className="other-reason-trigger" onClick={() => setOtherOpen(true)}>其他原因</button>}<button className="skip-reason" onClick={() => finish(null)}>跳过原因，下一张</button></div>}</section>;
}

function ChipGroup({ label, values, selected, onSelect }: { label: string; values: string[]; selected: string; onSelect: (value: string) => void }) { return <div className="chip-group" role="group" aria-label={label}>{values.map((value) => <button key={value} className={selected === value ? "selected" : ""} onClick={() => onSelect(value)}>{value}</button>)}</div>; }

function PrivateDiscoveryScreen({ config, cards, selectedId, member, loading, error, onSelect, onSubmit, onSkip, onBack }: { config: RoomConfig; cards: Candidate[]; selectedId: string | null; member: StoredMember; loading: boolean; error: string; onSelect: (id: string | null) => void; onSubmit: () => void; onSkip: () => void; onBack: () => void }) {
  return <section className="flow-page private-discovery-page"><button className="back-button" onClick={onBack} disabled={loading}>← 返回补充要求</button><ScreenTitle eyebrow="PRIVATE DISCOVERY" title="再给你三张，只由你决定" detail="这不是最终结果：最多提名一张，下一轮会交给所有成员共同评价。" /><div className="private-notice" role="status"><span>🔒</span><b>仅你可见 · 提名后进入下一轮共享评选</b><small>不会在当前房间候选或同步数据中展示</small></div><div className="private-card-grid">{cards.map((card) => {
    const selected = selectedId === card.id;
    const minutes = estimateTravelBetween(member.originLocation, card.location) ?? card.estimatedTravelMinutes ?? null;
    return <article key={card.id} className={`private-card ${selected ? "selected" : ""}`}><img src={card.image} alt="" aria-hidden="true" referrerPolicy="no-referrer" /><div className="private-card-content"><span>{card.matchedInterest || card.type}</span><h2>{card.name}</h2><p>{card.priceLabel} · {card.durationLabel}</p><small>{minutes ? `从你的出发地约 ${minutes} 分钟` : "你的通勤时间待确认"}</small><button type="button" aria-pressed={selected} onClick={() => onSelect(togglePrivateNomination(selectedId, card.id))}>{selected ? "已选中，取消提名" : "提名这张"}</button></div></article>;
  })}</div>{error && <p className="form-error private-error" role="alert">{error}</p>}<div className="private-discovery-actions"><button className="confirm-preference" onClick={onSubmit} disabled={loading || !selectedId}>{loading ? "正在提交…" : "提名进入下一轮"} <span>→</span></button><button className="private-secondary-button" onClick={onSkip} disabled={loading}>三张都不合适，跳过</button></div><p className="private-discovery-footnote">{config.kind === "dining" ? "餐厅" : "活动"}卡只会作为下一轮共享卡池的一部分，不会跳过其他成员的选择。</p></section>;
}

function PreferenceDetailsScreen(props: { config: RoomConfig; note: string; extraction: PreferenceExtraction | null; loading: boolean; submitting: boolean; error: string; allRejected: boolean; privateLoading: boolean; setNote: (value: string) => void; onParse: () => void; onRemoveSignal: (id: string) => void; onBack: () => void; onConfirm: () => void; onRequestPrivate: () => void }) {
  const signals = props.extraction ? [...props.extraction.hardConstraints.map((item) => ({ id: item.id, kind: "hard", label: item.label })), ...props.extraction.softPreferences.map((item) => ({ id: item.id, kind: "soft", label: item.label }))] : [];
  const examples = props.config.kind === "dining" ? "例如：有人海鲜过敏、不要排队、想要包间、晚上九点前结束" : "例如：不能剧烈运动、下雨也能去、不要排队、晚上八点前离开";
  return <section className="flow-page constraints-page"><button className="back-button" onClick={props.onBack}>← 返回滑卡</button><ScreenTitle eyebrow="OPTIONAL DETAILS" title="还有没有漏掉的要求？" detail="这里只补充固定选项覆盖不了的细节；没有额外要求也可以直接提交。" /><div className="constraint-layout details-only-layout"><div className="natural-card"><div className="natural-head"><span>AI</span><div><b>可选的自然语言补充</b><small>DeepSeek 只把文字转换成可确认字段</small></div></div><label className="sr-only" htmlFor="preference-note">自然语言补充</label><textarea id="preference-note" value={props.note} maxLength={500} onChange={(event) => props.setNote(event.target.value)} placeholder={examples} /><button onClick={props.onParse} disabled={props.loading || !props.note.trim()}>{props.loading ? "正在抽取字段…" : "让 AI 理解这段补充"} <span>↗</span></button>{props.error && <p className="parse-error" role="alert">{props.error}</p>}{props.extraction && <div className="parsed-box"><div><span>✓</span><b>已生成，请确认</b><em className={`extract-mode ${props.extraction.mode}`}>{props.extraction.mode === "deepseek" ? `DeepSeek · ${props.extraction.model}` : "规则降级"}</em></div>{signals.length > 0 ? <section>{signals.map((signal) => <button key={signal.id} onClick={() => props.onRemoveSignal(signal.id)} title={`删除：${signal.label}`}>{signal.kind === "hard" ? "底线" : "偏好"} · {signal.label} <i>×</i></button>)}</section> : <p>没有识别到额外字段，可直接提交现有选择。</p>}{props.extraction.clarificationQuestion && <p>{props.extraction.clarificationQuestion}</p>}{props.extraction.warning && <p className="mode-warning">{props.extraction.warning}</p>}</div>}<p className="ai-privacy-copy">只有点击“让 AI 理解”时才会发送这段补充；不填写也不会影响提交。</p></div></div>{props.allRejected ? <div className="all-rejected-actions"><p>你已拒绝本轮全部 12 张。可以请求一批只给你看的补救候选；它们不会直接成为最终结果。</p><button className="confirm-preference" onClick={props.onRequestPrivate} disabled={props.submitting || props.privateLoading}>{props.privateLoading ? "正在准备私人发现…" : "这批都没感觉，请求换一批"} <span>→</span></button><button className="private-secondary-button" onClick={props.onConfirm} disabled={props.submitting || props.privateLoading}>仍提交本轮选择</button></div> : <button className="confirm-preference" onClick={props.onConfirm} disabled={props.submitting}>{props.submitting ? "正在提交…" : props.note.trim() && !props.extraction ? "不解析补充，直接提交" : "确认并提交我的选择"} <span>→</span></button>}</section>;
}

function RankingScreen({ config, step, candidates, ranked, meta }: { config: RoomConfig; step: number; candidates: Candidate[]; ranked: RankedCandidate[]; meta: CandidateMeta }) {
  const memberCount = ranked[0]?.memberUtilities.length ?? 0;
  const rows = [{ n: candidates.length, title: "地点候选已加载", detail: `${config.city} · ${meta.label}` }, { n: ranked.length, title: "共同底线过滤完成", detail: "任一成员明确拒绝即排除" }, { n: memberCount, title: "真实成员效用已计算", detail: "滑卡、预算和 AI 字段全部进入计算" }, { n: ranked[0]?.groupFit ?? 0, title: "公平排序完成", detail: "满意度门槛 · Pareto · Nash 福利" }];
  return <section className="flow-page ranking-page"><div className="ranking-orbit"><span className="pulse-core">凑</span><i className="orbit-one" /><i className="orbit-two" /></div><div className="ranking-copy"><span>FAIR GROUP DECISION ENGINE</span><h1>正在计算大家的真实交集</h1><p>先保护每个人的底线，再从 Pareto 前沿中寻找 Nash 群体福利最高的方案。</p></div><div className="ranking-funnel">{rows.map((row, index) => <div key={row.title} className={step > index ? "done" : step === index ? "active" : ""}><span>{step > index ? "✓" : index + 1}</span><strong>{step > index || step === index ? row.n : "—"}</strong><section><b>{row.title}</b><small>{row.detail}</small></section><em>{step > index ? "完成" : step === index ? "计算中" : "等待"}</em></div>)}</div><div className="ranking-privacy">⌾ 本轮只包含 {memberCount} 位已提交成员，没有虚拟样本</div></section>;
}

function ResultsScreen({ config, room, currentMember, ranked, meta, members, aiExplanation, error, advancing, privateLoading, onPrivateDiscovery, onAcceptCommute, onVeto, onLock, onAdjust, onDiscuss, onRequestNextRound, onOpenAdvance }: { config: RoomConfig; room: StoredRoom; currentMember: StoredMember | null; ranked: RankedCandidate[]; meta: CandidateMeta; members: StoredMember[]; aiExplanation: AiExplanation | null; error: string; advancing: boolean; privateLoading: boolean; onPrivateDiscovery: () => void; onAcceptCommute: (minutes: number) => void; onVeto: (selected: RankedCandidate) => void; onLock: (selected: RankedCandidate) => void; onAdjust: () => void; onDiscuss: () => void; onRequestNextRound: () => void; onOpenAdvance: () => void }) {
  const main = ranked[0];
  const allSubmitted = room.members.length > 0 && room.members.every((member) => Boolean(member.submittedAt));
  const controls = getRoundControlVisibility({ currentRound: room.currentRound, creatorId: room.members[0]?.id, memberId: currentMember?.id, allSubmitted, submitted: Boolean(currentMember?.submittedAt) });
  const refreshControl = getRefreshRequestControl({ canRequestRefresh: controls.canRequestRefresh, requested: currentMember?.refreshRequestRound === room.currentRound });
  const isCreator = controls.isCreator;
  const requestCount = room.members.filter((member) => member.refreshRequestRound === room.currentRound).length;
  const canAdvance = controls.canAdvance;
  if (!main) {
    const reasons = room.currentRound >= 3 ? diagnoseRoundConflict(room.candidates, room.members, config).slice(0, 2) : [];
    const commuteSuggestion = suggestMinimumCommuteRelaxation(room.candidates, room.members);
    return <section className="flow-page results-page no-solution"><span className="no-solution-icon">∅</span><h1>{room.currentRound >= 3 ? "已经完成三轮探索" : "没有交集，先补充每个人的发现"}</h1><p>{room.currentRound >= 3 ? "系统不会强行给出一个不合适的答案。下面是本轮最影响交集的边界。" : "每个人可以从三张仅自己可见的卡里提名一张，也可以明确跳过；提名会进入下一轮共享评选。"}</p>{room.currentRound >= 3 ? <div className="conflict-panel" role="status"><b>本轮冲突诊断</b>{reasons.length ? <ul>{reasons.map((reason) => <li key={`${reason.type}-${reason.memberId || "group"}`}>{reason.message}</li>)}</ul> : <p>没有单一硬约束阻断结果；建议一起调整预算、通勤或场景偏好。</p>}{commuteSuggestion && <div className="negotiation-suggestion"><strong>最小调整建议</strong><span>{commuteSuggestion.memberName} 将通勤上限从 {commuteSuggestion.currentMinutes} 调到 {commuteSuggestion.suggestedMinutes} 分钟，可恢复 {commuteSuggestion.restoredCandidateCount} 个候选。</span>{currentMember?.id === commuteSuggestion.memberId ? <button onClick={() => onAcceptCommute(commuteSuggestion.suggestedMinutes)}>我同意本轮增加 {commuteSuggestion.addedMinutes} 分钟</button> : <small>等待 {commuteSuggestion.memberName} 本人确认</small>}</div>}</div> : <div className="zero-result-actions"><button className="full-dark-button" onClick={onPrivateDiscovery} disabled={privateLoading}>{privateLoading ? "正在准备三张私人卡…" : currentMember?.refreshRequestRound === room.currentRound ? "重新查看我的私人发现" : "查看我的 3 张私人发现卡"} <span>→</span></button>{canAdvance && requestCount === room.config.people ? <button className="round-request-button" onClick={onOpenAdvance} disabled={advancing}>{advancing ? "正在准备下一轮…" : "房主：汇总提名并开启下一轮"}</button> : null}<small>{requestCount}/{room.config.people} 人已完成私人发现或请求换批</small></div>}{room.currentRound >= 3 ? <div className="conflict-actions"><button className="full-dark-button" onClick={onAdjust}>调整我的边界 <span>→</span></button><button className="round-request-button" onClick={onDiscuss}>返回房间讨论</button></div> : null}{error && <p className="form-error" role="alert">{error}</p>}</section>;
  }
  const selected = main;
  return <section className="flow-page results-page">
    <div className="result-heading"><div><span>✓ {members.length} 位真实成员参与计算</span><h1>群体最优解</h1><p>{ranked.length} 个候选通过共同底线；系统综合最低满意度、Nash 福利、通勤与预算后给出一个答案。</p></div><div className={`verified-badge ${meta.mode}`}><i>{meta.mode === "live" ? "高" : "D"}</i><span>{meta.label}<small>{formatSourceTime(meta.fetchedAt)}</small></span></div></div>
    <div className="result-layout"><article className="winner-card"><div className="winner-art photo-winner"><img src={selected.image} alt={selected.name} referrerPolicy="no-referrer" /><div className="image-shade" /><div className="rank-ribbon">GROUP OPTIMUM · PARETO</div><span>{config.city} · {selected.district}</span></div><div className="winner-body"><div className="winner-title"><div><span>群体最优解</span><h2>{selected.name}</h2><small className="source-inline">来源：{selected.source.label}</small></div><div className="group-score"><strong>{selected.groupFit}</strong><span>GROUP FIT<small>真实成员排序分</small></span></div></div><div className="facts-row"><span><i>◷</i><b>{selected.durationLabel}</b><small>{formatDate(config.date)} · {config.startTime}</small></span><span><i>¥</i><b>{selected.priceLabel}</b><small>{selected.priceValue === null ? "价格未参与硬过滤" : "已进入预算过滤"}</small></span><span><i>⌖</i><b>{selected.meanTravelMinutes ? `人均估算 ${selected.meanTravelMinutes} 分钟` : "距离未参与"}</b><small>从各成员出发区域计算</small></span></div><div className="score-breakdown"><span>最低满意度 <b>{selected.minUtility}</b></span><span>群体均值 <b>{selected.meanUtility}</b></span><span>Nash 福利 <b>{selected.geoMean}</b></span><span>Pareto <b>{selected.onParetoFrontier ? "是" : "否"}</b></span></div><div className="why-box"><span>{aiExplanation ? `DeepSeek：${aiExplanation.headline}` : "为什么是群体最优解？"}</span><p>{aiExplanation ? `${aiExplanation.reasoning} ${aiExplanation.tradeoff}` : selected.explanation}</p></div></div></article><aside className="response-panel"><div className="response-head"><span>成员满意度</span><b>{members.length} 人</b></div><div className="utility-list">{selected.memberUtilities.map((item) => <div key={item.memberId}><span>{item.name.slice(0, 1)}</span><p><b>{item.name}</b><small>{members.find((member) => member.id === item.memberId)?.origin}{item.travelMinutes ? ` · 约 ${item.travelMinutes} 分钟` : ""}</small></p><strong>{item.utility}</strong></div>)}</div><p>排序先保护每个人的底线，再比较整体福利与执行成本。</p><button className="accept-button" onClick={() => onLock(selected)}>锁定群体最优解</button><button className="veto-button" onClick={() => onVeto(selected)}>否决这个方案并重新计算</button></aside></div>
  </section>;
}

function LockedScreen({ config, result, onCalendar, onReset, onShare }: { config: RoomConfig; result: RankedCandidate; onCalendar: () => void; onReset: () => void; onShare: () => void }) {
  const day = config.date.slice(-2); const month = Number(config.date.slice(5, 7));
  const openMap = () => window.open(result.source.url || `https://uri.amap.com/search?keyword=${encodeURIComponent(config.city + result.name)}`, "_blank", "noopener,noreferrer");
  return <section className="flow-page locked-page"><div className="locked-burst"><span>✓</span></div><div className="locked-title"><span>PLAN LOCKED</span><h1>本轮方案已锁定</h1><p>这张行动卡可以直接发到群里。</p></div><article className="action-card"><div className="action-map action-photo"><img src={result.image} alt={result.name} referrerPolicy="no-referrer" /><div className="image-shade" /><span className="map-pin">✓</span><i>{config.city}</i><i>{result.district}</i></div><div className="action-content"><div className="action-date"><strong>{day}</strong><span>{month} 月<small>{formatDate(config.date).split("日")[1]}</small></span></div><div className="action-name"><span>群体最优解 · {result.source.label}</span><h2>{result.name}</h2><p>{result.source.mode === "live" ? result.address : `${config.city} · 演示候选`}</p></div><div className="locked-score">{result.groupFit}<small>GROUP FIT</small></div><div className="action-facts"><span><i>◷</i><b>{config.startTime} 集合</b><small>{config.endTime} 前结束</small></span><span><i>¥</i><b>{result.priceLabel}</b><small>本轮预算匹配</small></span><span><i>⌖</i><b>{result.meanTravelMinutes ? `人均约 ${result.meanTravelMinutes} 分钟` : "距离未参与"}</b><small>从成员出发区域估算</small></span></div><div className="action-buttons"><button onClick={openMap}>⌖ {result.source.mode === "live" ? "打开地点" : "在高德中搜索"}</button><button onClick={onCalendar}>＋ 加入日历</button><button onClick={onShare}>↗ 分享房间</button></div></div></article><button className="restart-button" onClick={onReset}>创建新房间 ↺</button></section>;
}
