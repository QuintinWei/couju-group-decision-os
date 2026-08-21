/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIVITY_INTERESTS,
  DINING_INTERESTS,
  SUPPORTED_CITIES,
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
import type { StoredMember, StoredRoom } from "../lib/room-store";

type CandidateMeta = { mode: DataMode; label: string; fetchedAt: string; disclaimer?: string; keywords?: string[]; avoid?: string[]; page?: number; center?: GeoPoint | null; seed?: string; focused?: boolean; strategy?: "explore" | "focused" | "learn"; commuteWindow?: DiscoveryRange };
type AiExplanation = { headline: string; reasoning: string; tradeoff: string };
const stageOrder: Stage[] = ["create", "room", "swipe", "constraints", "ranking", "results", "locked"];
type MemberIdentity = { id: string; token: string };
type GeoPoint = { lng: number; lat: number };
type DiscoveryRange = "全城探索" | "≤ 30 分钟" | "≤ 45 分钟" | "≤ 60 分钟";
type LocationResponse = { location?: GeoPoint; label?: string; city?: CityName | null; error?: string };
// 旧版“演示成员样本”已移除；当前计算只接受真实加入并提交的成员。

function browserLocationError(error: GeolocationPositionError) {
  if (error.code === 1) return "浏览器未授权定位，请在地址栏权限中允许后重试；也可输入附近地铁站";
  if (error.code === 2) return "系统暂时无法取得位置，请检查系统定位服务或网络；也可手动输入";
  if (error.code === 3) return "定位请求超时，请重试或输入附近地铁站";
  return "暂时无法取得当前位置，请重试或手动输入附近地铁站";
}

function createDefaultConfig(): RoomConfig {
  return { kind: "dining", city: "上海", date: shanghaiDate(1), startTime: "18:00", endTime: "21:30", people: 4 };
}

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
  const [stage, setStage] = useState<Stage>("home");
  const [config, setConfig] = useState<RoomConfig>(() => createDefaultConfig());
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
  const [discoveryRange, setDiscoveryRange] = useState<DiscoveryRange>("全城探索");
  const [candidateRefreshing, setCandidateRefreshing] = useState(false);
  const [room, setRoom] = useState<StoredRoom | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [identity, setIdentity] = useState<MemberIdentity | null>(null);
  const [roomError, setRoomError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<AiExplanation | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [swipes, setSwipes] = useState<Record<string, Choice>>({});
  const [budget, setBudget] = useState("≤ ¥150");
  const [commute, setCommute] = useState("≤ 45 分钟");
  const [setting, setSetting] = useState("微辣可以");
  const [note, setNote] = useState("我不太能吃辣，最好安静一点，想坐下来好好聊");
  const [extraction, setExtraction] = useState<PreferenceExtraction | null>(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [parseError, setParseError] = useState("");
  const [rankingStep, setRankingStep] = useState(0);
  const [vetoOpen, setVetoOpen] = useState(false);
  const [vetoReason, setVetoReason] = useState("太辣了");
  const [appliedVetoReason, setAppliedVetoReason] = useState("");
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const pointerStart = useRef<number | null>(null);

  const ranked = useMemo(() => rankCandidates(candidates, room?.members ?? [], config, excludedIds, appliedVetoReason), [candidates, room?.members, config, excludedIds, appliedVetoReason]);
  const mainResult = ranked[0] ?? null;
  const currentMember = room?.members.find((member) => member.id === identity?.id) ?? null;
  const readyMembers = room?.members.filter((member) => member.submittedAt) ?? [];

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

  const refreshRoom = async (code: string, quiet = false) => {
    if (!quiet) setSyncing(true);
    try {
      const response = await fetch(`/api/rooms?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      const payload = await response.json() as { room?: StoredRoom; error?: string };
      if (!response.ok || !payload.room) throw new Error(payload.error || "房间加载失败");
      setRoom(payload.room); setConfig(payload.room.config); setCandidates(payload.room.candidates); setCandidateMeta(payload.room.meta); setRoomError("");
      return payload.room;
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : "房间加载失败");
      return null;
    } finally { if (!quiet) setSyncing(false); }
  };

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("room")?.trim().toUpperCase() || "";
    if (!code) return;
    const timer = window.setTimeout(() => {
      setRoomCode(code);
      let saved: MemberIdentity | null = null;
      try { saved = JSON.parse(window.localStorage.getItem(`couju-room-${code}`) || "null") as MemberIdentity | null; } catch { saved = null; }
      setIdentity(saved);
      void refreshRoom(code).then((loaded) => loaded && setStage(saved && loaded.members.some((member) => member.id === saved?.id) ? "room" : "join"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!roomCode || !["room", "ranking", "results"].includes(stage)) return;
    const timer = window.setInterval(() => { void refreshRoom(roomCode, true); }, 4000);
    return () => window.clearInterval(timer);
  }, [roomCode, stage]);

  const resetSession = () => {
    const next = createDefaultConfig();
    setStage("home"); setConfig(next); setCandidates(getDemoCandidates(next.city, next.kind)); setRoom(null); setRoomCode(""); setIdentity(null); setRoomError("");
    window.history.replaceState({}, "", window.location.pathname);
    setCandidateMeta({ mode: "demo", label: "凑局演示候选库", fetchedAt: "2026-08-21T00:00:00.000Z", disclaimer: "当前为演示候选，不代表实时商户、价格或可订状态。" });
    setCardIndex(0); setSwipes({}); setBudget("≤ ¥150"); setCommute("≤ 45 分钟"); setSetting("微辣可以");
    setNote("我不太能吃辣，最好安静一点，想坐下来好好聊"); setExtraction(null); setExcludedIds([]); setAppliedVetoReason("");
    setCreatorLocation(null); setLocationStatus("输入后会识别地铁站或商圈，并用于通勤估算"); setIdeaMode(false); setSelectedInterests([]); setAvoid(""); setDiscoveryRange("全城探索");
  };

  const updateConfig = (next: RoomConfig) => {
    const kindChanged = next.kind !== config.kind;
    const cityChanged = next.city !== config.city;
    setConfig(next);
    if (cityChanged) { setCreatorLocation(null); setLocationStatus("城市已更改，请重新输入出发区域或使用定位"); }
    if (!kindChanged) return;
    setBudget(next.kind === "dining" ? "≤ ¥150" : "≤ ¥200");
    setSetting(next.kind === "dining" ? "微辣可以" : "室内优先");
    setNote(next.kind === "dining" ? "我不太能吃辣，最好安静一点，想坐下来好好聊" : "我 17:00 后才到，晚上 8 点前得走，不想排队");
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
    if (!navigator.geolocation) { setLocationStatus("当前浏览器不支持系统定位，请输入附近地铁站"); return; }
    setLocating(true); setLocationStatus("正在请求系统定位…");
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const response = await fetch("/api/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city: config.city, lat: position.coords.latitude, lng: position.coords.longitude }) });
        const payload = await response.json() as LocationResponse;
        if (!response.ok || !payload.location) throw new Error(payload.error || "暂时无法识别当前位置");
        const detectedCity = typeof payload.city === "string" && SUPPORTED_CITIES.includes(payload.city as CityName) ? payload.city as CityName : null;
        setCreatorLocation(payload.location);
        setCreatorOrigin(payload.label || "当前位置附近");
        if (detectedCity && detectedCity !== config.city) {
          setConfig((current) => ({ ...current, city: detectedCity }));
          setLocationStatus(`已定位 · 已自动切换到${detectedCity}，会用于候选范围和通勤估算`);
        } else if (detectedCity) {
          setLocationStatus("已定位 · 会用于候选范围和通勤估算");
        } else {
          setLocationStatus("已定位 · 暂未识别到支持城市，仍使用当前城市和附近坐标");
        }
      } catch (error) { setLocationStatus(error instanceof Error ? error.message : "定位服务暂时不可用，请手动输入附近地铁站"); }
      finally { setLocating(false); }
    }, (error) => {
      setLocating(false);
      setLocationStatus(browserLocationError(error));
    }, { enableHighAccuracy: false, timeout: 20000, maximumAge: 600000 });
  };

  const loadCandidates = async (input: { location: GeoPoint; strategy: "explore" | "focused" | "learn"; commuteWindow: DiscoveryRange; interests?: string[]; avoid?: string[]; exclude?: string[]; page?: number }) => {
    const query = new URLSearchParams({ city: config.city, kind: config.kind, strategy: input.strategy, seed: crypto.randomUUID(), location: `${input.location.lng},${input.location.lat}`, commute: input.commuteWindow, page: String(input.page || 1) });
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
      const resolved = creatorLocation ? { location: creatorLocation, label: creatorOrigin } : await resolveOrigin(creatorOrigin);
      setCreatorLocation(resolved.location); setLocationStatus(`已识别 ${resolved.label} · 会用于候选范围和通勤估算`);
      const payload = await loadCandidates({ location: resolved.location, commuteWindow: discoveryRange, strategy: ideaMode && selectedInterests.length ? "focused" : "explore", interests: ideaMode ? selectedInterests : undefined, avoid: avoid.split(/[，,、;；]+/).map((item) => item.trim()).filter(Boolean) });
      const roomResponse = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, candidates: payload.candidates, meta: payload.meta, creatorName, creatorOrigin: resolved.label, creatorOriginLocation: resolved.location }) });
      const roomPayload = await roomResponse.json() as { identity?: { code: string; memberId: string; memberToken: string }; error?: string };
      if (!roomResponse.ok || !roomPayload.identity) throw new Error(roomPayload.error || "房间创建失败");
      const nextIdentity = { id: roomPayload.identity.memberId, token: roomPayload.identity.memberToken };
      window.localStorage.setItem(`couju-room-${roomPayload.identity.code}`, JSON.stringify(nextIdentity));
      window.history.replaceState({}, "", `?room=${roomPayload.identity.code}`);
      setRoomCode(roomPayload.identity.code); setIdentity(nextIdentity); setCandidates(payload.candidates); setCandidateMeta(payload.meta);
      await refreshRoom(roomPayload.identity.code); setStage("room");
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
      await refreshRoom(roomCode, true); setStage("room");
    } catch (error) { setRoomError(error instanceof Error ? error.message : "加入失败"); }
    finally { setSyncing(false); }
  };

  const refreshCandidates = async () => {
    if (!identity || !room || room.members[0]?.id !== identity.id) return;
    setCandidateRefreshing(true); setRoomError("");
    try {
      const activeChoices = { ...(currentMember?.choices || {}), ...swipes };
      const liked = [...new Set(candidates.filter((candidate) => activeChoices[candidate.id] === "like").map((candidate) => candidate.matchedInterest || candidate.type))];
      const dislikedNames = candidates.filter((candidate) => activeChoices[candidate.id] === "no").map((candidate) => candidate.name);
      const center = candidateMeta.center || creatorLocation || currentMember?.originLocation;
      if (!center) throw new Error("请先设置可识别的出发区域，再更换候选");
      const payload = await loadCandidates({ location: center, commuteWindow: candidateMeta.commuteWindow || "全城探索", strategy: "learn", interests: liked.slice(0, 3), avoid: [...(candidateMeta.avoid || []), ...dislikedNames].slice(-8), exclude: candidates.map((candidate) => candidate.id), page: ((candidateMeta.page || 1) % 5) + 1 });
      const response = await fetch("/api/rooms", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode, memberId: identity.id, token: identity.token, candidates: payload.candidates, meta: payload.meta }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "换一批失败");
      setCandidates(payload.candidates); setCandidateMeta(payload.meta); setSwipes({}); setCardIndex(0); setExtraction(null);
      await refreshRoom(roomCode, true); setToast(liked.length ? "已参考你喜欢的类型，同时保留新的探索选项" : "已换成另一组跨类型候选");
    } catch (error) { setRoomError(error instanceof Error ? error.message : "换一批失败"); }
    finally { setCandidateRefreshing(false); }
  };

  const chooseCard = (choice: Choice) => {
    const current = candidates[cardIndex];
    if (!current) return;
    setSwipes((old) => ({ ...old, [current.id]: choice }));
    if (cardIndex === candidates.length - 1) setStage("constraints"); else setCardIndex((value) => value + 1);
  };

  const parsePreference = async () => {
    setParseLoading(true); setParseError("");
    try {
      const response = await fetch("/api/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note, kind: config.kind, city: config.city, date: config.date, startTime: config.startTime, endTime: config.endTime }) });
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
    if (readyMembers.length < 2) return setToast("至少需要 2 位真实成员完成偏好");
    setRankingStep(0); setAiExplanation(null); setStage("ranking");
    const top = ranked.slice(0, 3).map((candidate) => ({ name: candidate.name, groupFit: candidate.groupFit, minUtility: candidate.minUtility, meanUtility: candidate.meanUtility, geoMean: candidate.geoMean, evidence: candidate.evidence }));
    const people = readyMembers.map((member) => ({ name: member.name, origin: member.origin, budget: member.budgetLabel, commute: member.commuteLabel }));
    void fetch("/api/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city: config.city, kind: config.kind, members: people, candidates: top }) }).then((response) => response.json()).then((payload: { explanation?: AiExplanation | null }) => { if (payload.explanation) setAiExplanation(payload.explanation); }).catch(() => undefined);
  };
  const confirmConstraints = async () => {
    if (!identity || !roomCode) return;
    setSyncing(true);
    try {
      const response = await fetch("/api/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode, memberId: identity.id, token: identity.token, budgetLabel: budget, commuteLabel: commute, setting, note, extraction, choices: swipes }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "提交失败");
      await refreshRoom(roomCode, true); setStage("room"); setToast(`偏好已提交 · ${extraction?.mode === "deepseek" ? "DeepSeek 理解" : "规则理解"}`);
    } catch (error) { setParseError(error instanceof Error ? error.message : "提交失败"); }
    finally { setSyncing(false); }
  };
  const applyVeto = () => {
    if (mainResult) setExcludedIds((old) => [...new Set([...old, mainResult.id])]);
    setAppliedVetoReason(vetoReason); setVetoOpen(false); setToast(`“${vetoReason}”已加入本轮重排`); startRanking();
  };

  const copyShare = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?room=${roomCode}`); setToast("房间链接已复制，朋友打开即可加入"); }
    catch { setToast("浏览器未允许复制，请从地址栏复制链接"); }
  };

  const addCalendar = () => {
    if (!mainResult) return;
    const compactDate = config.date.replaceAll("-", ""); const start = config.startTime.replace(":", ""); const end = config.endTime.replace(":", "");
    const location = mainResult.source.mode === "live" ? `${config.city}市${mainResult.address}` : `${config.city} · 地点需确认`;
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Couju//Group Decision OS//CN\nBEGIN:VEVENT\nUID:${Date.now()}@couju.demo\nDTSTAMP:${compactDate}T000000Z\nDTSTART:${compactDate}T${start}00\nDTEND:${compactDate}T${end}00\nSUMMARY:凑局｜${mainResult.name}\nLOCATION:${location}\nDESCRIPTION:数据来源：${mainResult.source.label}；到店前请确认价格、营业与可订状态。\nEND:VEVENT\nEND:VCALENDAR`;
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `凑局-${config.date}.ics`; link.click(); URL.revokeObjectURL(url); setToast("日历文件已生成");
  };

  const currentProgress = Math.max(0, stageOrder.indexOf(stage));
  const vetoReasons = config.kind === "dining" ? ["太辣了", "不吃生食", "还是太远", "价格超预期"] : ["太吵了", "不想运动", "还是太远", "价格超预期"];

  return <main className={`app ${stage === "home" ? "home-mode" : "demo-mode"}`}>
    <header className="app-header"><button className="brand" onClick={() => stage !== "home" && resetSession()} aria-label="返回凑局首页"><span className="brand-mark">凑</span><span>凑局</span><small>COUJU</small></button>{stage === "home" ? <span className="privacy-pill"><i /> 六城地点已上线</span> : <div className="demo-header-right"><div className="step-dots" aria-label={`Demo 进度 ${currentProgress + 1}/7`}>{stageOrder.map((item, index) => <span key={item} className={index <= currentProgress ? "active" : ""} />)}</div><span className={`demo-badge mode-${candidateMeta.mode}`}>{candidateMeta.mode === "live" ? "地点推荐" : "演示数据"}</span><button className="quiet-button" onClick={resetSession}>退出</button></div>}</header>
    {stage === "home" && <HomeScreen onStart={() => setStage("create")} />}
    {stage === "create" && <CreateScreen config={config} creatorName={creatorName} creatorOrigin={creatorOrigin} creatorLocation={creatorLocation} locationStatus={locationStatus} locating={locating} ideaMode={ideaMode} selectedInterests={selectedInterests} avoid={avoid} discoveryRange={discoveryRange} setCreatorName={setCreatorName} setCreatorOrigin={(value) => { setCreatorOrigin(value); setCreatorLocation(null); setLocationStatus("输入后会识别地铁站或商圈，并用于通勤估算"); }} setIdeaMode={setIdeaMode} setSelectedInterests={setSelectedInterests} setAvoid={setAvoid} setDiscoveryRange={setDiscoveryRange} onLocate={useCurrentLocation} error={roomError} onChange={updateConfig} onBack={() => setStage("home")} onCreate={createRoom} loading={candidateLoading} />}
    {stage === "join" && room && <JoinScreen room={room} loading={syncing} error={roomError} onJoin={joinRoom} />}
    {stage === "room" && room && <RoomScreen room={room} currentMember={currentMember} syncing={syncing} isCreator={room.members[0]?.id === identity?.id} refreshing={candidateRefreshing} error={roomError} onRefresh={refreshCandidates} onShare={copyShare} onPreference={() => { setCardIndex(0); setSwipes(currentMember?.choices ?? {}); setBudget(currentMember?.budgetLabel || budget); setCommute(currentMember?.commuteLabel || commute); setSetting(currentMember?.setting || setting); setNote(currentMember?.note || note); setExtraction(currentMember?.extraction ?? null); setStage("swipe"); }} onRank={startRanking} />}
    {stage === "swipe" && <SwipeScreen config={config} cards={candidates} index={cardIndex} choices={swipes} canRefresh={room?.members[0]?.id === identity?.id} refreshing={candidateRefreshing} onRefresh={refreshCandidates} onChoose={chooseCard} onBack={() => setStage("room")} onPointerDown={(x) => { pointerStart.current = x; }} onPointerUp={(x) => { if (pointerStart.current === null) return; const delta = x - pointerStart.current; if (delta > 65) chooseCard("like"); else if (delta < -65) chooseCard("no"); pointerStart.current = null; }} />}
    {stage === "constraints" && <ConstraintsScreen config={config} budget={budget} commute={commute} setting={setting} note={note} extraction={extraction} loading={parseLoading} error={parseError} setBudget={setBudget} setCommute={setCommute} setSetting={setSetting} setNote={(value) => { setNote(value); setExtraction(null); }} onParse={parsePreference} onRemoveSignal={removeSignal} onBack={() => setStage("swipe")} onConfirm={confirmConstraints} />}
    {stage === "ranking" && <RankingScreen config={config} step={rankingStep} candidates={candidates} ranked={ranked} meta={candidateMeta} />}
    {stage === "results" && <ResultsScreen config={config} ranked={ranked} meta={candidateMeta} members={readyMembers} aiExplanation={aiExplanation} onVeto={() => setVetoOpen(true)} onLock={() => setStage("locked")} onAdjust={() => setStage("constraints")} />}
    {stage === "locked" && mainResult && <LockedScreen config={config} result={mainResult} onCalendar={addCalendar} onReset={resetSession} onShare={copyShare} />}
    {vetoOpen && <div className="modal-backdrop"><button className="modal-dismiss-layer" onClick={() => setVetoOpen(false)} aria-label="关闭否决弹窗" /><section className="veto-modal" role="dialog" aria-modal="true" aria-labelledby="veto-title"><button className="modal-close" onClick={() => setVetoOpen(false)} aria-label="关闭">×</button><span className="modal-icon">!</span><h2 id="veto-title">什么让你无法接受？</h2><p>当前方案会被排除，所选原因会进入下一轮确定性重排。</p><div className="reason-grid">{vetoReasons.map((reason) => <button key={reason} className={vetoReason === reason ? "selected" : ""} onClick={() => setVetoReason(reason)}>{reason}</button>)}</div><button className="full-dark-button" onClick={applyVeto}>加入本轮约束并重排 <span>→</span></button></section></div>}
    {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
  </main>;
}

function HomeScreen({ onStart }: { onStart: () => void }) {
  return <><section className="hero"><div className="hero-copy"><div className="eyebrow"><i /> AI GROUP DECISION</div><h1>不是猜一个答案，<br /><em>是算出交集。</em></h1><p>说出每个人的预算、时间和偏好，凑局会从真实地点中找到大家都能接受的方案。</p><div className="hero-actions"><button className="primary-button" onClick={onStart}>开始创建 <span>→</span></button><span><b>上海 · 北京 · 深圳</b><br />杭州 · 成都 · 广州</span></div><div className="hero-proof"><div className="proof-faces"><i>懂</i><i>算</i><i>选</i></div><span><b>理解每个人，再匹配共同选择</b><small>预算、距离和底线都会改变结果</small></span></div></div><div className="decision-card" aria-label="凑局推荐预览"><div className="floating-chat chat-one"><b>人均 150</b><small>进入预算筛选</small></div><div className="floating-chat chat-two"><b>别太辣</b><small>AI 理解偏好</small></div><div className="card-topline"><span><i /> 周末聚餐</span><b>GROUP FIT</b></div><div className="trust-stack"><div><span>01</span><p><b>选城市</b><small>六座城市均可使用</small></p><em>地点</em></div><div><span>02</span><p><b>说偏好</b><small>AI 理解自然语言</small></p><em>理解</em></div><div><span>03</span><p><b>一起选</b><small>兼顾每个人的底线</small></p><em>公平</em></div></div><div className="place-result"><div className="result-visual photo-preview"><img src="/candidates/food-yunnan.jpg" alt="聚餐候选示例" /><span>PREVIEW</span></div><div><small>结果随输入变化</small><h3>Group Fit 动态计算</h3><p>预算 · 距离 · 偏好 · 底线</p></div><strong>ƒ(x)<small>FAIRMIX</small></strong></div><div className="fit-line"><i>✓</i><span><b>不是少数服从多数</b><small>先保证每个人都能接受，再寻找整体最优</small></span></div></div></section><section className="how-strip"><div><b>01</b><span>选择城市与场景</span><small>六城餐厅与活动均可选择</small></div><div className="arrow">→</div><div><b>02</b><span>告诉 AI 你的底线</span><small>自然语言会变成可确认条件</small></div><div className="arrow">→</div><div><b>03</b><span>一起找到交集</span><small>每条推荐都有清楚理由</small></div></section></>;
}

function ScreenTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) { return <div className="screen-title"><span>{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>; }

function CreateScreen(props: { config: RoomConfig; creatorName: string; creatorOrigin: string; creatorLocation: GeoPoint | null; locationStatus: string; locating: boolean; ideaMode: boolean; selectedInterests: string[]; avoid: string; discoveryRange: DiscoveryRange; setCreatorName: (value: string) => void; setCreatorOrigin: (value: string) => void; setIdeaMode: (value: boolean) => void; setSelectedInterests: (value: string[]) => void; setAvoid: (value: string) => void; setDiscoveryRange: (value: DiscoveryRange) => void; onLocate: () => void; error: string; onChange: (config: RoomConfig) => void; onBack: () => void; onCreate: () => void; loading: boolean }) {
  const [error, setError] = useState("");
  const update = <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => { props.onChange({ ...props.config, [key]: value }); setError(""); };
  const interests = props.config.kind === "dining" ? DINING_INTERESTS : ACTIVITY_INTERESTS;
  const toggleInterest = (value: string) => props.setSelectedInterests(props.selectedInterests.includes(value) ? props.selectedInterests.filter((item) => item !== value) : [...props.selectedInterests, value].slice(-6));
  const submit = () => {
    if (!props.creatorName.trim() || !props.creatorOrigin.trim()) return setError("请填写昵称，并输入出发区域或使用系统定位");
    if (!props.config.date || !props.config.startTime || !props.config.endTime) return setError("请完整填写日期和时间");
    if (props.config.date < shanghaiDate()) return setError("日期不能早于今天");
    if (props.config.endTime <= props.config.startTime) return setError("结束时间需要晚于开始时间");
    props.onCreate();
  };
  return <section className="flow-page create-page">
    <button className="back-button" onClick={props.onBack}>← 返回</button>
    <ScreenTitle eyebrow="CREATE A REAL ROOM" title="先发一手灵感牌" detail="没想好也没关系：默认跨类型随机发现；你有想法时再选倾向。" />
    <div className="create-layout single-card"><div className="form-card">
      <fieldset><legend>这次想决定什么？</legend><div className="option-pair"><button className={props.config.kind === "activity" ? "selected" : ""} onClick={() => update("kind", "activity")}><b>✦</b><span>周末活动<small>娱乐、运动、手作、放松</small></span></button><button className={props.config.kind === "dining" ? "selected" : ""} onClick={() => update("kind", "dining")}><b>♨</b><span>一起聚餐<small>跨菜系随机发现</small></span></button></div></fieldset>
      <div className="field-grid"><label><span>你的昵称</span><input className="form-control" value={props.creatorName} maxLength={18} onChange={(event) => props.setCreatorName(event.target.value)} placeholder="例如：Jay" /></label><label><span>城市</span><select className="form-control" value={props.config.city} onChange={(event) => update("city", event.target.value as CityName)}>{SUPPORTED_CITIES.map((city) => <option key={city} value={city}>{city}</option>)}</select></label><label className="location-field"><span>从哪里出发</span><div className="location-input-row"><input className="form-control" value={props.creatorOrigin} maxLength={40} onChange={(event) => props.setCreatorOrigin(event.target.value)} placeholder="地铁站 / 商圈" /><button type="button" onClick={props.onLocate} disabled={props.locating}>{props.locating ? "定位中" : "⌖ 定位"}</button></div><small className={props.creatorLocation ? "location-ok" : ""}>{props.locationStatus}</small></label><label><span>日期</span><input className="form-control" type="date" min={shanghaiDate()} value={props.config.date} onChange={(event) => update("date", event.target.value)} /></label><label><span>开始时间</span><input className="form-control" type="time" value={props.config.startTime} onChange={(event) => update("startTime", event.target.value)} /></label><label><span>最晚结束</span><input className="form-control" type="time" value={props.config.endTime} onChange={(event) => update("endTime", event.target.value)} /></label></div>
      <fieldset className="discovery-field"><legend>推荐方式</legend><div className="discovery-toggle"><button className={!props.ideaMode ? "selected" : ""} onClick={() => props.setIdeaMode(false)}><b>给我灵感</b><small>默认 · 跨类型随机发牌</small></button><button className={props.ideaMode ? "selected" : ""} onClick={() => props.setIdeaMode(true)}><b>我有点想法</b><small>可选 1–6 个倾向</small></button></div>{props.ideaMode && <><div className="interest-cloud">{interests.map((interest) => <button key={interest} className={props.selectedInterests.includes(interest) ? "selected" : ""} onClick={() => toggleInterest(interest)}>{interest}</button>)}</div><label className="avoid-field"><span>这次明确不想要（可选）</span><input className="form-control" value={props.avoid} onChange={(event) => props.setAvoid(event.target.value)} placeholder={props.config.kind === "activity" ? "例如：不要景点、不要太吵" : "例如：不要连锁、不要辣"} /></label></>}</fieldset>
      <fieldset className="commute-discovery"><legend>候选范围</legend><p>默认看全城；选择通勤时间后，才会围绕你的出发地控制首批候选范围。</p><div className="range-options">{(["全城探索", "≤ 30 分钟", "≤ 45 分钟", "≤ 60 分钟"] as DiscoveryRange[]).map((value) => <button key={value} className={props.discoveryRange === value ? "selected" : ""} onClick={() => props.setDiscoveryRange(value)}>{value}</button>)}</div></fieldset>
      <fieldset><legend>预计几个人？</legend><div className="number-row">{[2, 3, 4, 5, 6].map((number) => <button key={number} className={number === props.config.people ? "selected" : ""} onClick={() => update("people", number)}>{number}</button>)}</div></fieldset>
      {(error || props.error) && <p className="form-error" role="alert">{error || props.error}</p>}<button className="full-dark-button" onClick={submit} disabled={props.loading}>{props.loading ? "正在准备候选…" : `创建${props.config.kind === "dining" ? "聚餐" : "活动"}房间`} <span>→</span></button>
    </div></div>
  </section>;
}

function JoinScreen({ room, loading, error, onJoin }: { room: StoredRoom; loading: boolean; error: string; onJoin: (name: string, origin: string, originLocation: GeoPoint | null) => void }) {
  const [name, setName] = useState(""); const [origin, setOrigin] = useState(""); const [originLocation, setOriginLocation] = useState<GeoPoint | null>(null); const [locating, setLocating] = useState(false); const [locationMessage, setLocationMessage] = useState("输入地铁站/商圈，或授权系统定位");
  const locate = () => {
    if (!navigator.geolocation) return setLocationMessage("当前浏览器不支持定位，请手动输入");
    setLocating(true); setLocationMessage("正在定位…");
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const response = await fetch("/api/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city: room.config.city, lat: position.coords.latitude, lng: position.coords.longitude }) });
        const payload = await response.json() as LocationResponse;
        if (!response.ok || !payload.location) throw new Error(payload.error || "定位服务暂时不可用");
        setOrigin(payload.label || "当前位置附近"); setOriginLocation(payload.location); setLocationMessage("已定位 · 会参与你的通勤计算");
      } catch (cause) { setLocationMessage(cause instanceof Error ? cause.message : "定位服务暂时不可用，请手动输入"); }
      finally { setLocating(false); }
    }, (error) => { setLocating(false); setLocationMessage(browserLocationError(error)); }, { enableHighAccuracy: false, timeout: 20000, maximumAge: 600000 });
  };
  return <section className="flow-page create-page join-page"><ScreenTitle eyebrow={`ROOM ${room.code}`} title={`加入“${roomTitle(room.config.kind)}”`} detail={`${room.config.city} · ${formatDate(room.config.date)} · 已有 ${room.members.length}/${room.config.people} 人加入`} /><div className="join-card"><div className="join-summary"><span>{room.config.kind === "dining" ? "♨" : "✦"}</span><div><b>{room.config.startTime}–{room.config.endTime}</b><small>{room.config.city} · {room.candidates.length} 个候选</small></div></div><label><span>你的昵称</span><input className="form-control" value={name} maxLength={18} onChange={(event) => setName(event.target.value)} placeholder="朋友会看到这个名字" /></label><label><span>从哪里出发</span><div className="location-input-row"><input className="form-control" value={origin} maxLength={40} onChange={(event) => { setOrigin(event.target.value); setOriginLocation(null); setLocationMessage("提交时会识别这个地铁站或商圈"); }} placeholder="不用填写精确住址" /><button type="button" onClick={locate} disabled={locating}>{locating ? "定位中" : "⌖ 定位"}</button></div><small className={originLocation ? "location-ok" : ""}>{locationMessage}</small></label>{error && <p className="form-error">{error}</p>}<button className="full-dark-button" disabled={loading || !name.trim() || !origin.trim()} onClick={() => onJoin(name, origin, originLocation)}>{loading ? "正在加入…" : "加入房间"} <span>→</span></button><p className="privacy-note">系统定位只在你点击并授权后使用；手输地铁站也会真正参与通勤计算。</p></div></section>;
}

function RoomScreen({ room, currentMember, syncing, isCreator, refreshing, error, onRefresh, onShare, onPreference, onRank }: { room: StoredRoom; currentMember: StoredMember | null; syncing: boolean; isCreator: boolean; refreshing: boolean; error: string; onRefresh: () => void; onShare: () => void; onPreference: () => void; onRank: () => void }) {
  const { config, meta } = room; const doneCount = room.members.filter((member) => member.submittedAt).length; const enough = doneCount >= 2;
  return <section className="flow-page room-page"><div className="room-kicker"><span>{config.city} · {config.kind === "dining" ? "聚餐" : "活动"}</span><b>房间 {room.code}</b></div><ScreenTitle eyebrow={`${config.kind === "dining" ? "DINNER" : "WEEKEND"} IN ${config.city.toUpperCase()}`} title={roomTitle(config.kind)} detail={`${formatDate(config.date)} · ${config.startTime}–${config.endTime} · ${config.city}`} /><div className="data-audit-strip"><span className={`source-dot ${meta.mode}`} /><b>{room.candidates.length} 个候选 · {meta.label}</b><span>{room.members.length}/{config.people} 人已加入</span><span>{syncing ? "同步中" : "每 4 秒同步"}</span></div><div className="room-grid"><div className="room-main-card"><div className="room-card-head"><div><span>真实成员</span><strong>{doneCount}/{room.members.length} 已提交</strong></div><i>{enough ? "可以计算真实交集" : "至少 2 人提交后可计算"}</i></div><div className="member-list">{room.members.map((member) => <div key={member.id} className={member.submittedAt ? "member done" : "member pending"}><div className="avatar">{member.name.slice(0, 1).toUpperCase()}{member.submittedAt && <span>✓</span>}</div><div><b>{member.name}{member.id === currentMember?.id ? " · 你" : ""}</b><small>{member.origin} · {member.submittedAt ? "偏好已提交" : "等待提交"}</small></div><em>{member.submittedAt ? "完成" : "待完成"}</em></div>)}</div>{!currentMember?.submittedAt ? <button className="full-dark-button pulse" onClick={onPreference}>开始划这批候选 <span>→</span></button> : <div className="room-actions"><button className="quiet-button" onClick={onPreference}>修改我的偏好</button><button className="full-dark-button lime-button" onClick={onRank} disabled={!enough}>计算真实交集 <span>✦</span></button></div>}<p className="privacy-note">⌾ 位置用于候选范围和通勤估算；每个人的通勤上限仍会作为最终硬筛选。</p></div><aside className="invite-card"><span className="big-source-mark live">{room.code}</span><h3>把链接发给朋友</h3><p>对方不需要注册，填写昵称和大致出发地后就能独立选择。</p><button onClick={onShare}>复制房间链接 <span>↗</span></button>{isCreator && <button className="refresh-button" onClick={onRefresh} disabled={refreshing}>{refreshing ? "正在发现新候选…" : "这批没感觉，换一批"} <span>↻</span></button>}<small>{room.members.length < config.people ? `还可加入 ${config.people - room.members.length} 人` : "房间人数已满"}</small>{error && <p className="form-error">{error}</p>}</aside></div><div className="public-constraint"><b>本轮配置</b><span>{formatDate(config.date)} {config.startTime}–{config.endTime}</span><span>{config.city}市</span><span>{meta.commuteWindow || "全城探索"}</span><span>目标 {config.people} 人</span><i>{meta.focused ? `按想法：${meta.keywords?.join("、")}` : "探索模式 · 跨类别随机发现"}</i></div></section>;
}

function SwipeScreen({ config, cards, index, choices, canRefresh, refreshing, onRefresh, onChoose, onBack, onPointerDown, onPointerUp }: { config: RoomConfig; cards: Candidate[]; index: number; choices: Record<string, Choice>; canRefresh: boolean; refreshing: boolean; onRefresh: () => void; onChoose: (choice: Choice) => void; onBack: () => void; onPointerDown: (x: number) => void; onPointerUp: (x: number) => void }) {
  const card = cards[index]; if (!card) return null;
  return <section className="flow-page swipe-page"><div className="mobile-frame"><div className="mobile-top"><button onClick={onBack} aria-label="返回房间">×</button><span>{config.kind === "dining" ? "你的餐厅偏好" : "你的活动偏好"}</span><b>{index + 1}<small> / {cards.length}</small></b></div><div className="progress-line"><i style={{ width: `${((index + 1) / cards.length) * 100}%` }} /></div><div className="swipe-prompt"><span>边选边发现，不要求提前想好</span><h2>{config.kind === "dining" ? "这家，你想和朋友一起吃吗？" : "这个周末，你想去吗？"}</h2><p>喜欢与拒绝会影响下一批候选</p></div><div className="card-stack"><div className="ghost-card ghost-two" /><div className="ghost-card ghost-one" /><button className="swipe-card photo-card" onPointerDown={(event) => onPointerDown(event.clientX)} onPointerUp={(event) => onPointerUp(event.clientX)} onKeyDown={(event) => { if (event.key === "ArrowRight") onChoose("like"); if (event.key === "ArrowLeft") onChoose("no"); }} aria-label={`${card.name}，左方向键不想去，右方向键喜欢`}><div className="activity-art"><img src={card.image} alt={card.name} draggable={false} referrerPolicy="no-referrer" /><div className="image-shade" /><span className="category-chip">{card.matchedInterest || card.type}</span><i>{card.source.mode === "live" ? "高德地点" : "演示候选"}</i></div><div className="activity-info"><span>{card.source.label}</span><h3>{card.name}</h3><p>{card.priceLabel} · {card.durationLabel} · {card.meta}</p><div><small>{card.rating ? `评分 ${card.rating.toFixed(1)}` : "评分待确认"}</small><small>{card.estimatedTravelMinutes ? `附近估算 ${card.estimatedTravelMinutes} 分钟` : "通勤待确认"}</small><small>{card.openToday ? `今日 ${card.openToday}` : "营业/可订需确认"}</small></div></div></button></div><div className="swipe-actions"><button className="no" onClick={() => onChoose("no")} aria-label="不想去">×<small>不想去</small></button><button className="okay" onClick={() => onChoose("okay")} aria-label="还行">−<small>还行</small></button><button className="yes" onClick={() => onChoose("like")} aria-label="喜欢">♥<small>喜欢</small></button></div><p className="gesture-hint">← 左滑排除 · 右滑提高个人效用 →</p>{canRefresh && Object.keys(choices).length >= 3 && <button className="swipe-refresh" onClick={onRefresh} disabled={refreshing}>{refreshing ? "正在换…" : "这批没感觉，按刚才的选择换一批"}</button>}<div className="choice-history" aria-label={`${Object.keys(choices).length} 张卡已完成`} /></div></section>;
}

function ChipGroup({ label, values, selected, onSelect }: { label: string; values: string[]; selected: string; onSelect: (value: string) => void }) { return <div className="chip-group" role="group" aria-label={label}>{values.map((value) => <button key={value} className={selected === value ? "selected" : ""} onClick={() => onSelect(value)}>{value}</button>)}</div>; }

function ConstraintsScreen(props: { config: RoomConfig; budget: string; commute: string; setting: string; note: string; extraction: PreferenceExtraction | null; loading: boolean; error: string; setBudget: (value: string) => void; setCommute: (value: string) => void; setSetting: (value: string) => void; setNote: (value: string) => void; onParse: () => void; onRemoveSignal: (id: string) => void; onBack: () => void; onConfirm: () => void }) {
  const dining = props.config.kind === "dining";
  const signals = [...(props.extraction?.hardConstraints ?? []).map((item) => ({ ...item, kind: "hard" as const })), ...(props.extraction?.softPreferences ?? []).map((item) => ({ ...item, kind: "soft" as const }))];
  return <section className="flow-page constraints-page"><button className="back-button" onClick={props.onBack}>← 返回滑卡</button><ScreenTitle eyebrow="YOUR BOUNDARIES" title="把底线变成可计算字段" detail="显式选项直接进入过滤；自由文本由 DeepSeek 或规则抽取，确认后才参与排名。" /><div className="constraint-layout"><div className="constraint-card"><div className="constraint-label"><span>01</span><div><b>人均预算</b><small>候选价格超过上限会被排除</small></div></div><ChipGroup label="人均预算" values={dining ? ["≤ ¥100", "≤ ¥150", "≤ ¥200", "不限"] : ["≤ ¥100", "≤ ¥200", "≤ ¥300", "不限"]} selected={props.budget} onSelect={props.setBudget} /><div className="constraint-label"><span>02</span><div><b>最远单程通勤</b><small>当前为城市中心点估算，不冒充路线规划</small></div></div><ChipGroup label="最远单程通勤" values={["≤ 30 分钟", "≤ 45 分钟", "≤ 60 分钟", "不限"]} selected={props.commute} onSelect={props.setCommute} /><div className="constraint-label"><span>03</span><div><b>{dining ? "辣度底线" : "空间偏好"}</b><small>{dining ? "未知是否可做不辣时会标记待确认" : "作为软偏好进入个人效用"}</small></div></div><ChipGroup label={dining ? "辣度底线" : "空间偏好"} values={dining ? ["不吃辣", "微辣可以", "都可以"] : ["室内优先", "户外优先", "都可以"]} selected={props.setting} onSelect={props.setSetting} /></div><div className="natural-card"><div className="natural-head"><span>AI</span><div><b>还有什么想说的？</b><small>DeepSeek V4 Flash · 只做字段抽取</small></div></div><label className="sr-only" htmlFor="preference-note">自然语言偏好</label><textarea id="preference-note" value={props.note} maxLength={500} onChange={(event) => props.setNote(event.target.value)} /><button onClick={props.onParse} disabled={props.loading || !props.note.trim()}>{props.loading ? "正在抽取字段…" : "理解并生成待确认字段"} <span>↗</span></button>{props.error && <p className="parse-error" role="alert">{props.error}</p>}{props.extraction && <div className="parsed-box"><div><span>✓</span><b>已生成，请确认</b><em className={`extract-mode ${props.extraction.mode}`}>{props.extraction.mode === "deepseek" ? `DeepSeek · ${props.extraction.model}` : "规则降级"}</em></div>{signals.length > 0 ? <section>{signals.map((signal) => <button key={signal.id} onClick={() => props.onRemoveSignal(signal.id)} title={`删除：${signal.label}`}>{signal.kind === "hard" ? "底线" : "偏好"} · {signal.label} <i>×</i></button>)}</section> : <p>没有识别到额外字段，你仍可使用左侧显式约束。</p>}{props.extraction.clarificationQuestion && <p>{props.extraction.clarificationQuestion}</p>}{props.extraction.warning && <p className="mode-warning">{props.extraction.warning}</p>}</div>}<p className="ai-privacy-copy">配置 DeepSeek Key 后，这段文字会发送到 DeepSeek API；未配置时只在本地规则中处理。</p></div></div><button className="confirm-preference" onClick={props.onConfirm} disabled={!props.extraction}>确认字段并提交 <span>→</span></button></section>;
}

function RankingScreen({ config, step, candidates, ranked, meta }: { config: RoomConfig; step: number; candidates: Candidate[]; ranked: RankedCandidate[]; meta: CandidateMeta }) {
  const memberCount = ranked[0]?.memberUtilities.length ?? 0;
  const rows = [{ n: candidates.length, title: "地点候选已加载", detail: `${config.city} · ${meta.label}` }, { n: ranked.length, title: "共同底线过滤完成", detail: "任一成员明确拒绝即排除" }, { n: memberCount, title: "真实成员效用已计算", detail: "滑卡、预算和 AI 字段全部进入计算" }, { n: ranked[0]?.groupFit ?? 0, title: "公平排序完成", detail: "满意度门槛 · Pareto · Nash 福利" }];
  return <section className="flow-page ranking-page"><div className="ranking-orbit"><span className="pulse-core">凑</span><i className="orbit-one" /><i className="orbit-two" /></div><div className="ranking-copy"><span>FAIR GROUP DECISION ENGINE</span><h1>正在计算大家的真实交集</h1><p>先保护每个人的底线，再从 Pareto 前沿中寻找 Nash 群体福利最高的方案。</p></div><div className="ranking-funnel">{rows.map((row, index) => <div key={row.title} className={step > index ? "done" : step === index ? "active" : ""}><span>{step > index ? "✓" : index + 1}</span><strong>{step > index || step === index ? row.n : "—"}</strong><section><b>{row.title}</b><small>{row.detail}</small></section><em>{step > index ? "完成" : step === index ? "计算中" : "等待"}</em></div>)}</div><div className="ranking-privacy">⌾ 本轮只包含 {memberCount} 位已提交成员，没有虚拟样本</div></section>;
}

function ResultsScreen({ config, ranked, meta, members, aiExplanation, onVeto, onLock, onAdjust }: { config: RoomConfig; ranked: RankedCandidate[]; meta: CandidateMeta; members: StoredMember[]; aiExplanation: AiExplanation | null; onVeto: () => void; onLock: () => void; onAdjust: () => void }) {
  const main = ranked[0];
  if (!main) return <section className="flow-page results-page no-solution"><span className="no-solution-icon">∅</span><h1>这次没有候选满足全部条件</h1><p>系统没有强行生成 Top 1。请放宽预算、通勤或时间，或者把一张“不想去”改为“还行”。</p><button className="full-dark-button" onClick={onAdjust}>返回调整底线 <span>→</span></button></section>;
  const fair = [...ranked].sort((a, b) => b.minUtility - a.minUtility || b.geoMean - a.geoMean)[0];
  const easy = [...ranked].sort((a, b) => (a.meanTravelMinutes ?? 999) - (b.meanTravelMinutes ?? 999) || (a.priceValue ?? 9999) - (b.priceValue ?? 9999))[0];
  const strategies = [{ label: "最佳平衡", item: main, note: "Nash 群体福利最高" }, { label: "最公平", item: fair, note: "最低成员满意度最高" }, { label: "最省事", item: easy, note: "通勤估算与价格负担更低" }];
  return <section className="flow-page results-page"><div className="result-heading"><div><span>✓ {members.length} 位真实成员参与计算</span><h1>不是一个答案，是三种取舍</h1><p>{ranked.length} 个候选通过共同底线；推荐来自同一组真实输入。</p></div><div className={`verified-badge ${meta.mode}`}><i>{meta.mode === "live" ? "高" : "D"}</i><span>{meta.label}<small>{formatSourceTime(meta.fetchedAt)}</small></span></div></div><div className="strategy-tabs">{strategies.map(({ label, item, note }) => <article key={label} className={item.id === main.id && label === "最佳平衡" ? "selected" : ""}><span>{label}</span><b>{item.name}</b><small>{note}</small><strong>{label === "最公平" ? item.minUtility : item.groupFit}</strong></article>)}</div><div className="result-layout"><article className="winner-card"><div className="winner-art photo-winner"><img src={main.image} alt={main.name} referrerPolicy="no-referrer" /><div className="image-shade" /><div className="rank-ribbon">BEST BALANCE · PARETO</div><span>{config.city} · {main.district}</span></div><div className="winner-body"><div className="winner-title"><div><span>最佳平衡方案</span><h2>{main.name}</h2><small className="source-inline">来源：{main.source.label}</small></div><div className="group-score"><strong>{main.groupFit}</strong><span>GROUP FIT<small>真实成员排序分</small></span></div></div><div className="facts-row"><span><i>◷</i><b>{main.durationLabel}</b><small>{formatDate(config.date)} · {config.startTime}</small></span><span><i>¥</i><b>{main.priceLabel}</b><small>{main.priceValue === null ? "价格未参与硬过滤" : "已进入预算过滤"}</small></span><span><i>⌖</i><b>{main.meanTravelMinutes ? `人均估算 ${main.meanTravelMinutes} 分钟` : "距离未参与"}</b><small>从各成员出发区域计算</small></span></div><div className="score-breakdown"><span>最低满意度 <b>{main.minUtility}</b></span><span>群体均值 <b>{main.meanUtility}</b></span><span>Nash 福利 <b>{main.geoMean}</b></span><span>Pareto <b>{main.onParetoFrontier ? "是" : "否"}</b></span></div><div className="why-box"><span>{aiExplanation ? `DeepSeek：${aiExplanation.headline}` : "为什么是它？"}</span><p>{aiExplanation ? `${aiExplanation.reasoning} ${aiExplanation.tradeoff}` : main.explanation}</p></div></div></article><aside className="response-panel"><div className="response-head"><span>成员满意度</span><b>{members.length} 人</b></div><div className="utility-list">{main.memberUtilities.map((item) => <div key={item.memberId}><span>{item.name.slice(0, 1)}</span><p><b>{item.name}</b><small>{members.find((member) => member.id === item.memberId)?.origin}{item.travelMinutes ? ` · 约 ${item.travelMinutes} 分钟` : ""}</small></p><strong>{item.utility}</strong></div>)}</div><p>最低满意度低于 60 时，系统会优先修复最不满意成员，而不是只追求平均分。</p><button className="accept-button" onClick={onLock}>锁定最佳平衡方案</button><button className="veto-button" onClick={onVeto}>否决并重新计算</button></aside></div></section>;
}

function LockedScreen({ config, result, onCalendar, onReset, onShare }: { config: RoomConfig; result: RankedCandidate; onCalendar: () => void; onReset: () => void; onShare: () => void }) {
  const day = config.date.slice(-2); const month = Number(config.date.slice(5, 7));
  const openMap = () => window.open(result.source.url || `https://uri.amap.com/search?keyword=${encodeURIComponent(config.city + result.name)}`, "_blank", "noopener,noreferrer");
  return <section className="flow-page locked-page"><div className="locked-burst"><span>✓</span></div><div className="locked-title"><span>PLAN LOCKED</span><h1>本轮方案已锁定</h1><p>这张行动卡可以直接发到群里。</p></div><article className="action-card"><div className="action-map action-photo"><img src={result.image} alt={result.name} referrerPolicy="no-referrer" /><div className="image-shade" /><span className="map-pin">✓</span><i>{config.city}</i><i>{result.district}</i></div><div className="action-content"><div className="action-date"><strong>{day}</strong><span>{month} 月<small>{formatDate(config.date).split("日")[1]}</small></span></div><div className="action-name"><span>最佳平衡方案 · {result.source.label}</span><h2>{result.name}</h2><p>{result.source.mode === "live" ? result.address : `${config.city} · 演示候选`}</p></div><div className="locked-score">{result.groupFit}<small>GROUP FIT</small></div><div className="action-facts"><span><i>◷</i><b>{config.startTime} 集合</b><small>{config.endTime} 前结束</small></span><span><i>¥</i><b>{result.priceLabel}</b><small>本轮预算匹配</small></span><span><i>⌖</i><b>{result.meanTravelMinutes ? `人均约 ${result.meanTravelMinutes} 分钟` : "距离未参与"}</b><small>从成员出发区域估算</small></span></div><div className="action-buttons"><button onClick={openMap}>⌖ {result.source.mode === "live" ? "打开地点" : "在高德中搜索"}</button><button onClick={onCalendar}>＋ 加入日历</button><button onClick={onShare}>↗ 分享房间</button></div></div></article><button className="restart-button" onClick={onReset}>创建新房间 ↺</button></section>;
}
