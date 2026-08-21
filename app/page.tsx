/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SUPPORTED_CITIES,
  getDemoCandidates,
  rankCandidates,
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

type CandidateMeta = { mode: DataMode; label: string; fetchedAt: string; disclaimer: string };
const stageOrder: Stage[] = ["create", "room", "swipe", "constraints", "ranking", "results", "locked"];
const demoMembers = ["Nina", "Leo", "Mia", "Owen", "Zoe"];

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
  const [completed, setCompleted] = useState(false);
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
  const [decision, setDecision] = useState<"" | "accept" | "okay">("");
  const [toast, setToast] = useState("");
  const pointerStart = useRef<number | null>(null);

  const ranked = useMemo(() => rankCandidates(candidates, {
    config,
    choices: swipes,
    budgetLabel: budget,
    commuteLabel: commute,
    setting,
    extraction,
    excludedIds,
    vetoReason: appliedVetoReason,
  }), [candidates, config, swipes, budget, commute, setting, extraction, excludedIds, appliedVetoReason]);
  const mainResult = ranked[0] ?? null;

  useEffect(() => {
    if (stage !== "ranking") return;
    const timers = [1, 2, 3, 4].map((value, index) => window.setTimeout(() => setRankingStep(value), 500 + index * 450));
    timers.push(window.setTimeout(() => setStage("results"), 2500));
    return () => timers.forEach(window.clearTimeout);
  }, [stage]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const resetSession = () => {
    const next = createDefaultConfig();
    setStage("home"); setConfig(next); setCandidates(getDemoCandidates(next.city, next.kind));
    setCandidateMeta({ mode: "demo", label: "凑局演示候选库", fetchedAt: "2026-08-21T00:00:00.000Z", disclaimer: "当前为演示候选，不代表实时商户、价格或可订状态。" });
    setCompleted(false); setCardIndex(0); setSwipes({}); setBudget("≤ ¥150"); setCommute("≤ 45 分钟"); setSetting("微辣可以");
    setNote("我不太能吃辣，最好安静一点，想坐下来好好聊"); setExtraction(null); setExcludedIds([]); setAppliedVetoReason(""); setDecision("");
  };

  const updateConfig = (next: RoomConfig) => {
    const kindChanged = next.kind !== config.kind;
    setConfig(next);
    if (!kindChanged) return;
    setBudget(next.kind === "dining" ? "≤ ¥150" : "≤ ¥200");
    setSetting(next.kind === "dining" ? "微辣可以" : "室内优先");
    setNote(next.kind === "dining" ? "我不太能吃辣，最好安静一点，想坐下来好好聊" : "我 17:00 后才到，晚上 8 点前得走，不想排队");
    setVetoReason(next.kind === "dining" ? "太辣了" : "太吵了");
    setExtraction(null); setSwipes({}); setCardIndex(0);
  };

  const createRoom = async () => {
    setCandidateLoading(true); setCompleted(false); setDecision(""); setExcludedIds([]); setAppliedVetoReason(""); setSwipes({}); setCardIndex(0);
    try {
      const response = await fetch(`/api/candidates?city=${encodeURIComponent(config.city)}&kind=${config.kind}`);
      if (!response.ok) throw new Error("candidate request failed");
      const payload = await response.json() as { candidates?: Candidate[]; meta?: CandidateMeta };
      if (!Array.isArray(payload.candidates) || payload.candidates.length < 1 || !payload.meta) throw new Error("candidate payload invalid");
      setCandidates(payload.candidates); setCandidateMeta(payload.meta);
    } catch {
      setCandidates(getDemoCandidates(config.city, config.kind));
      setCandidateMeta({ mode: "demo", label: "凑局演示候选库", fetchedAt: new Date().toISOString(), disclaimer: "地点服务不可用，已切换为演示候选。" });
    } finally {
      setCandidateLoading(false); setStage("room");
    }
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
  const startRanking = () => { setRankingStep(0); setStage("ranking"); };
  const confirmConstraints = () => { setCompleted(true); setStage("room"); setToast(`偏好已提交 · ${extraction?.mode === "deepseek" ? "DeepSeek 抽取" : "规则抽取"}`); };
  const applyVeto = () => {
    if (mainResult) setExcludedIds((old) => [...new Set([...old, mainResult.id])]);
    setAppliedVetoReason(vetoReason); setDecision(""); setVetoOpen(false); setToast(`“${vetoReason}”已加入本轮重排`); startRanking();
  };

  const copyShare = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setToast("当前 Demo 链接已复制"); }
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
    {stage === "create" && <CreateScreen config={config} onChange={updateConfig} onBack={() => setStage("home")} onCreate={createRoom} loading={candidateLoading} />}
    {stage === "room" && <RoomScreen config={config} completed={completed} meta={candidateMeta} candidateCount={candidates.length} onShare={copyShare} onPreference={() => setStage("swipe")} onRank={startRanking} />}
    {stage === "swipe" && <SwipeScreen config={config} cards={candidates} index={cardIndex} choices={swipes} onChoose={chooseCard} onBack={() => setStage("room")} onPointerDown={(x) => { pointerStart.current = x; }} onPointerUp={(x) => { if (pointerStart.current === null) return; const delta = x - pointerStart.current; if (delta > 65) chooseCard("like"); else if (delta < -65) chooseCard("no"); pointerStart.current = null; }} />}
    {stage === "constraints" && <ConstraintsScreen config={config} budget={budget} commute={commute} setting={setting} note={note} extraction={extraction} loading={parseLoading} error={parseError} setBudget={setBudget} setCommute={setCommute} setSetting={setSetting} setNote={(value) => { setNote(value); setExtraction(null); }} onParse={parsePreference} onRemoveSignal={removeSignal} onBack={() => setStage("swipe")} onConfirm={confirmConstraints} />}
    {stage === "ranking" && <RankingScreen config={config} step={rankingStep} candidates={candidates} ranked={ranked} meta={candidateMeta} />}
    {stage === "results" && <ResultsScreen config={config} ranked={ranked} meta={candidateMeta} decision={decision} onDecision={setDecision} onVeto={() => setVetoOpen(true)} onLock={() => setStage("locked")} onAdjust={() => setStage("constraints")} />}
    {stage === "locked" && mainResult && <LockedScreen config={config} result={mainResult} onCalendar={addCalendar} onReset={resetSession} onShare={copyShare} />}
    {vetoOpen && <div className="modal-backdrop"><button className="modal-dismiss-layer" onClick={() => setVetoOpen(false)} aria-label="关闭否决弹窗" /><section className="veto-modal" role="dialog" aria-modal="true" aria-labelledby="veto-title"><button className="modal-close" onClick={() => setVetoOpen(false)} aria-label="关闭">×</button><span className="modal-icon">!</span><h2 id="veto-title">什么让你无法接受？</h2><p>当前方案会被排除，所选原因会进入下一轮确定性重排。</p><div className="reason-grid">{vetoReasons.map((reason) => <button key={reason} className={vetoReason === reason ? "selected" : ""} onClick={() => setVetoReason(reason)}>{reason}</button>)}</div><button className="full-dark-button" onClick={applyVeto}>加入本轮约束并重排 <span>→</span></button></section></div>}
    {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
  </main>;
}

function HomeScreen({ onStart }: { onStart: () => void }) {
  return <><section className="hero"><div className="hero-copy"><div className="eyebrow"><i /> AI GROUP DECISION</div><h1>不是猜一个答案，<br /><em>是算出交集。</em></h1><p>说出每个人的预算、时间和偏好，凑局会从真实地点中找到大家都能接受的方案。</p><div className="hero-actions"><button className="primary-button" onClick={onStart}>开始创建 <span>→</span></button><span><b>上海 · 北京 · 深圳</b><br />杭州 · 成都 · 广州</span></div><div className="hero-proof"><div className="proof-faces"><i>懂</i><i>算</i><i>选</i></div><span><b>理解每个人，再匹配共同选择</b><small>预算、距离和底线都会改变结果</small></span></div></div><div className="decision-card" aria-label="凑局推荐预览"><div className="floating-chat chat-one"><b>人均 150</b><small>进入预算筛选</small></div><div className="floating-chat chat-two"><b>别太辣</b><small>AI 理解偏好</small></div><div className="card-topline"><span><i /> 周末聚餐</span><b>GROUP FIT</b></div><div className="trust-stack"><div><span>01</span><p><b>选城市</b><small>六座城市均可使用</small></p><em>地点</em></div><div><span>02</span><p><b>说偏好</b><small>AI 理解自然语言</small></p><em>理解</em></div><div><span>03</span><p><b>一起选</b><small>兼顾每个人的底线</small></p><em>公平</em></div></div><div className="place-result"><div className="result-visual photo-preview"><img src="/candidates/food-yunnan.jpg" alt="聚餐候选示例" /><span>PREVIEW</span></div><div><small>结果随输入变化</small><h3>Group Fit 动态计算</h3><p>预算 · 距离 · 偏好 · 底线</p></div><strong>ƒ(x)<small>FAIRMIX</small></strong></div><div className="fit-line"><i>✓</i><span><b>不是少数服从多数</b><small>先保证每个人都能接受，再寻找整体最优</small></span></div></div></section><section className="how-strip"><div><b>01</b><span>选择城市与场景</span><small>六城餐厅与活动均可选择</small></div><div className="arrow">→</div><div><b>02</b><span>告诉 AI 你的底线</span><small>自然语言会变成可确认条件</small></div><div className="arrow">→</div><div><b>03</b><span>一起找到交集</span><small>每条推荐都有清楚理由</small></div></section></>;
}

function ScreenTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) { return <div className="screen-title"><span>{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>; }

function CreateScreen({ config, onChange, onBack, onCreate, loading }: { config: RoomConfig; onChange: (config: RoomConfig) => void; onBack: () => void; onCreate: () => void; loading: boolean }) {
  const [error, setError] = useState("");
  const update = <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => { onChange({ ...config, [key]: value }); setError(""); };
  const submit = () => { if (!config.date || !config.startTime || !config.endTime) return setError("请完整填写日期和时间"); if (config.date < shanghaiDate()) return setError("日期不能早于今天"); if (config.endTime <= config.startTime) return setError("结束时间需要晚于开始时间"); onCreate(); };
  return <section className="flow-page create-page"><button className="back-button" onClick={onBack}>← 返回</button><ScreenTitle eyebrow="CREATE A ROOM" title="先把问题说清楚" detail="选择城市、日期、时间和人数，凑局会为这次聚会准备合适的候选。" /><div className="create-layout"><div className="form-card"><fieldset><legend>这次想决定什么？</legend><div className="option-pair"><button className={config.kind === "activity" ? "selected" : ""} onClick={() => update("kind", "activity")}><b>✦</b><span>周末活动<small>只加载活动类候选</small></span></button><button className={config.kind === "dining" ? "selected" : ""} onClick={() => update("kind", "dining")}><b>♨</b><span>一起聚餐<small>只加载餐饮类候选</small></span></button></div></fieldset><div className="field-grid"><label htmlFor="city"><span>城市</span><select id="city" className="form-control" value={config.city} onChange={(event) => update("city", event.target.value as CityName)}>{SUPPORTED_CITIES.map((city) => <option key={city} value={city}>{city}</option>)}</select></label><label htmlFor="date"><span>日期</span><input id="date" className="form-control" type="date" min={shanghaiDate()} value={config.date} onChange={(event) => update("date", event.target.value)} /></label><label htmlFor="start-time"><span>开始时间</span><input id="start-time" className="form-control" type="time" value={config.startTime} onChange={(event) => update("startTime", event.target.value)} /></label><label htmlFor="end-time"><span>最晚结束</span><input id="end-time" className="form-control" type="time" value={config.endTime} onChange={(event) => update("endTime", event.target.value)} /></label></div><fieldset><legend>预计几个人？</legend><div className="number-row">{[2, 3, 4, 5, 6].map((number) => <button key={number} className={number === config.people ? "selected" : ""} onClick={() => update("people", number)} aria-label={`${number}人`}>{number}</button>)}</div></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<button className="full-dark-button" onClick={submit} disabled={loading}>{loading ? "正在加载候选…" : `创建${config.kind === "dining" ? "聚餐" : "活动"}房间`} <span>→</span></button></div><aside className="promise-card"><span className="lock-symbol">6</span><h3>六座城市，全部可用</h3><p>每座城市都可以选择聚餐或周末活动，使用同一套 AI 理解与群体决策流程。</p><div><span>✓</span>上海 · 北京 · 深圳</div><div><span>✓</span>杭州 · 成都 · 广州</div><div><span>✓</span>城市切换后自动更新候选</div></aside></div></section>;
}

function RoomScreen({ config, completed, meta, candidateCount, onShare, onPreference, onRank }: { config: RoomConfig; completed: boolean; meta: CandidateMeta; candidateCount: number; onShare: () => void; onPreference: () => void; onRank: () => void }) {
  const others = demoMembers.slice(0, config.people - 1);
  const people = [...others.map((name) => ({ name, letter: name[0], done: true, virtual: true })), { name: "你 · Jay", letter: "J", done: completed, virtual: false }];
  const doneCount = completed ? config.people : config.people - 1;
  return <section className="flow-page room-page"><div className="room-kicker"><span>{config.city} · {config.kind === "dining" ? "聚餐" : "活动"}</span><b>房间 CJ-{config.date.slice(5).replace("-", "")}</b></div><ScreenTitle eyebrow={`${config.kind === "dining" ? "DINNER" : "WEEKEND"} IN ${config.city.toUpperCase()}`} title={roomTitle(config.kind)} detail={`${formatDate(config.date)} · ${config.startTime}–${config.endTime} · ${config.city}`} /><div className="data-audit-strip"><span className={`source-dot ${meta.mode}`} /><b>{candidateCount} 个候选已准备</b><span>{config.city}</span><span>{config.kind === "dining" ? "餐厅" : "活动"}</span></div><div className="room-grid"><div className="room-main-card"><div className="room-card-head"><div><span>本轮参与信号</span><strong>{doneCount}/{config.people} 已准备</strong></div><i>{completed ? "可以运行 FairMix" : "等待你的真实输入"}</i></div><div className="member-list">{people.map((person) => <div key={person.name} className={person.done ? "member done" : "member pending"}><div className="avatar">{person.letter}{person.done && <span>✓</span>}</div><div><b>{person.name}</b><small>{person.virtual ? "演示成员样本" : person.done ? "你的偏好已提交" : "待完成"}</small></div><em>{person.virtual ? "虚拟" : person.done ? "完成" : "待完成"}</em></div>)}</div>{!completed ? <button className="full-dark-button pulse" onClick={onPreference}>完成我的偏好 <span>→</span></button> : <button className="full-dark-button lime-button" onClick={onRank}>开始确定性求交集 <span>✦</span></button>}<p className="privacy-note">⌾ 当前版本仅在本次浏览器会话中处理你的输入；实时多人房间尚未启用</p></div><aside className="invite-card"><span className="big-source-mark live">↗</span><h3>邀请朋友一起选</h3><p>把房间链接发给朋友，让每个人都能表达自己的预算、距离和偏好。</p><button onClick={onShare}>复制房间链接 <span>↗</span></button><small>当前 Demo 使用虚拟成员模拟群体决策</small></aside></div><div className="public-constraint"><b>本轮配置</b><span>{formatDate(config.date)} {config.startTime}–{config.endTime}</span><span>{config.city}市</span><span>{config.people} 人</span><i>{config.people - 1} 位虚拟成员会参与演示计算</i></div></section>;
}

function SwipeScreen({ config, cards, index, choices, onChoose, onBack, onPointerDown, onPointerUp }: { config: RoomConfig; cards: Candidate[]; index: number; choices: Record<string, Choice>; onChoose: (choice: Choice) => void; onBack: () => void; onPointerDown: (x: number) => void; onPointerUp: (x: number) => void }) {
  const card = cards[index]; if (!card) return null;
  return <section className="flow-page swipe-page"><div className="mobile-frame"><div className="mobile-top"><button onClick={onBack} aria-label="返回房间">×</button><span>{config.kind === "dining" ? "你的餐厅偏好" : "你的活动偏好"}</span><b>{index + 1}<small> / {cards.length}</small></b></div><div className="progress-line"><i style={{ width: `${((index + 1) / cards.length) * 100}%` }} /></div><div className="swipe-prompt"><span>你的选择会真正进入效用计算</span><h2>{config.kind === "dining" ? "这家，你想和朋友一起吃吗？" : "这个周末，你想去吗？"}</h2><p>“不想去”会直接排除该候选</p></div><div className="card-stack"><div className="ghost-card ghost-two" /><div className="ghost-card ghost-one" /><button className="swipe-card photo-card" onPointerDown={(event) => onPointerDown(event.clientX)} onPointerUp={(event) => onPointerUp(event.clientX)} onKeyDown={(event) => { if (event.key === "ArrowRight") onChoose("like"); if (event.key === "ArrowLeft") onChoose("no"); }} aria-label={`${card.name}，左方向键不想去，右方向键喜欢`}><div className="activity-art"><img src={card.image} alt={card.name} draggable={false} referrerPolicy="no-referrer" /><div className="image-shade" /><span className="category-chip">{card.type}</span><i>{card.source.mode === "live" ? "高德地点" : "演示候选"}</i></div><div className="activity-info"><span>{card.source.label}</span><h3>{card.name}</h3><p>{card.priceLabel} · {card.durationLabel} · {card.meta}</p><div><small>{card.rating ? `评分 ${card.rating.toFixed(1)}` : "评分待确认"}</small><small>{card.estimatedTravelMinutes ? `中心点估算 ${card.estimatedTravelMinutes} 分钟` : "通勤待确认"}</small><small>{card.openToday ? `今日 ${card.openToday}` : "营业/可订需确认"}</small></div></div></button></div><div className="swipe-actions"><button className="no" onClick={() => onChoose("no")} aria-label="不想去">×<small>不想去</small></button><button className="okay" onClick={() => onChoose("okay")} aria-label="还行">−<small>还行</small></button><button className="yes" onClick={() => onChoose("like")} aria-label="喜欢">♥<small>喜欢</small></button></div><p className="gesture-hint">← 左滑排除 · 右滑提高个人效用 →</p><div className="choice-history" aria-label={`${Object.keys(choices).length} 张卡已完成`} /></div></section>;
}

function ChipGroup({ label, values, selected, onSelect }: { label: string; values: string[]; selected: string; onSelect: (value: string) => void }) { return <div className="chip-group" role="group" aria-label={label}>{values.map((value) => <button key={value} className={selected === value ? "selected" : ""} onClick={() => onSelect(value)}>{value}</button>)}</div>; }

function ConstraintsScreen(props: { config: RoomConfig; budget: string; commute: string; setting: string; note: string; extraction: PreferenceExtraction | null; loading: boolean; error: string; setBudget: (value: string) => void; setCommute: (value: string) => void; setSetting: (value: string) => void; setNote: (value: string) => void; onParse: () => void; onRemoveSignal: (id: string) => void; onBack: () => void; onConfirm: () => void }) {
  const dining = props.config.kind === "dining";
  const signals = [...(props.extraction?.hardConstraints ?? []).map((item) => ({ ...item, kind: "hard" as const })), ...(props.extraction?.softPreferences ?? []).map((item) => ({ ...item, kind: "soft" as const }))];
  return <section className="flow-page constraints-page"><button className="back-button" onClick={props.onBack}>← 返回滑卡</button><ScreenTitle eyebrow="YOUR BOUNDARIES" title="把底线变成可计算字段" detail="显式选项直接进入过滤；自由文本由 DeepSeek 或规则抽取，确认后才参与排名。" /><div className="constraint-layout"><div className="constraint-card"><div className="constraint-label"><span>01</span><div><b>人均预算</b><small>候选价格超过上限会被排除</small></div></div><ChipGroup label="人均预算" values={dining ? ["≤ ¥100", "≤ ¥150", "≤ ¥200", "不限"] : ["≤ ¥100", "≤ ¥200", "≤ ¥300", "不限"]} selected={props.budget} onSelect={props.setBudget} /><div className="constraint-label"><span>02</span><div><b>最远单程通勤</b><small>当前为城市中心点估算，不冒充路线规划</small></div></div><ChipGroup label="最远单程通勤" values={["≤ 30 分钟", "≤ 45 分钟", "≤ 60 分钟", "不限"]} selected={props.commute} onSelect={props.setCommute} /><div className="constraint-label"><span>03</span><div><b>{dining ? "辣度底线" : "空间偏好"}</b><small>{dining ? "未知是否可做不辣时会标记待确认" : "作为软偏好进入个人效用"}</small></div></div><ChipGroup label={dining ? "辣度底线" : "空间偏好"} values={dining ? ["不吃辣", "微辣可以", "都可以"] : ["室内优先", "户外优先", "都可以"]} selected={props.setting} onSelect={props.setSetting} /></div><div className="natural-card"><div className="natural-head"><span>AI</span><div><b>还有什么想说的？</b><small>DeepSeek V4 Flash · 只做字段抽取</small></div></div><label className="sr-only" htmlFor="preference-note">自然语言偏好</label><textarea id="preference-note" value={props.note} maxLength={500} onChange={(event) => props.setNote(event.target.value)} /><button onClick={props.onParse} disabled={props.loading || !props.note.trim()}>{props.loading ? "正在抽取字段…" : "理解并生成待确认字段"} <span>↗</span></button>{props.error && <p className="parse-error" role="alert">{props.error}</p>}{props.extraction && <div className="parsed-box"><div><span>✓</span><b>已生成，请确认</b><em className={`extract-mode ${props.extraction.mode}`}>{props.extraction.mode === "deepseek" ? `DeepSeek · ${props.extraction.model}` : "规则降级"}</em></div>{signals.length > 0 ? <section>{signals.map((signal) => <button key={signal.id} onClick={() => props.onRemoveSignal(signal.id)} title={`删除：${signal.label}`}>{signal.kind === "hard" ? "底线" : "偏好"} · {signal.label} <i>×</i></button>)}</section> : <p>没有识别到额外字段，你仍可使用左侧显式约束。</p>}{props.extraction.clarificationQuestion && <p>{props.extraction.clarificationQuestion}</p>}{props.extraction.warning && <p className="mode-warning">{props.extraction.warning}</p>}</div>}<p className="ai-privacy-copy">配置 DeepSeek Key 后，这段文字会发送到 DeepSeek API；未配置时只在本地规则中处理。</p></div></div><button className="confirm-preference" onClick={props.onConfirm} disabled={!props.extraction}>确认字段并提交 <span>→</span></button></section>;
}

function RankingScreen({ config, step, candidates, ranked, meta }: { config: RoomConfig; step: number; candidates: Candidate[]; ranked: RankedCandidate[]; meta: CandidateMeta }) {
  const rows = [{ n: candidates.length, title: "候选已加载", detail: `${config.city} · ${meta.label}` }, { n: ranked.length, title: "硬约束过滤完成", detail: "预算、通勤、时间与明确底线" }, { n: ranked.length, title: "个人效用已计算", detail: "滑卡和软偏好已经进入计算" }, { n: ranked[0]?.groupFit ?? 0, title: "FairMix 排序完成", detail: "保护最低效用并扣除不确定性" }];
  return <section className="flow-page ranking-page"><div className="ranking-orbit"><span className="pulse-core">凑</span><i className="orbit-one" /><i className="orbit-two" /></div><div className="ranking-copy"><span>DETERMINISTIC FAIRMIX ENGINE</span><h1>正在按真实输入求交集</h1><p>DeepSeek 不决定去哪；确定性代码使用已经确认的字段排序。</p></div><div className="ranking-funnel">{rows.map((row, index) => <div key={row.title} className={step > index ? "done" : step === index ? "active" : ""}><span>{step > index ? "✓" : index + 1}</span><strong>{step > index || step === index ? row.n : "—"}</strong><section><b>{row.title}</b><small>{row.detail}</small></section><em>{step > index ? "完成" : step === index ? "计算中" : "等待"}</em></div>)}</div><div className="ranking-privacy">⌾ 本轮包含你的真实输入与 {config.people - 1} 位明确标注的演示成员样本</div></section>;
}

function ResultsScreen({ config, ranked, meta, decision, onDecision, onVeto, onLock, onAdjust }: { config: RoomConfig; ranked: RankedCandidate[]; meta: CandidateMeta; decision: "" | "accept" | "okay"; onDecision: (decision: "accept" | "okay") => void; onVeto: () => void; onLock: () => void; onAdjust: () => void }) {
  const main = ranked[0];
  if (!main) return <section className="flow-page results-page no-solution"><span className="no-solution-icon">∅</span><h1>这次没有候选满足全部条件</h1><p>系统没有强行生成 Top 1。请放宽预算、通勤或时间，或者把一张“不想去”改为“还行”。</p><button className="full-dark-button" onClick={onAdjust}>返回调整底线 <span>→</span></button></section>;
  return <section className="flow-page results-page"><div className="result-heading"><div><span>✓ 按当前输入完成排序</span><h1>推荐依据，现在说得清</h1><p>{ranked.length} 个候选通过硬约束，Top 3 来自同一次 FairMix 计算。</p></div><div className={`verified-badge ${meta.mode}`}><i>{meta.mode === "live" ? "高" : "D"}</i><span>{meta.label}<small>{formatSourceTime(meta.fetchedAt)}</small></span></div></div><div className="result-layout"><article className="winner-card"><div className="winner-art photo-winner"><img src={main.image} alt={main.name} referrerPolicy="no-referrer" /><div className="image-shade" /><div className="rank-ribbon">TOP 1 · 计算结果</div><span>{config.city} · {main.district}</span></div><div className="winner-body"><div className="winner-title"><div><span>共同可接受方案</span><h2>{main.name}</h2><small className="source-inline">来源：{main.source.label}</small></div><div className="group-score"><strong>{main.groupFit}</strong><span>GROUP FIT<small>会话内排序分</small></span></div></div><div className="facts-row"><span><i>◷</i><b>{main.durationLabel}</b><small>{formatDate(config.date)} · {config.startTime} 开始</small></span><span><i>¥</i><b>{main.priceLabel}</b><small>{main.priceValue === null ? "事实待确认" : "已进入预算过滤"}</small></span><span><i>⌖</i><b>{main.estimatedTravelMinutes ? `估算 ${main.estimatedTravelMinutes} 分钟` : "通勤待确认"}</b><small>基于城市中心点，不是实时路线</small></span></div><div className="score-breakdown"><span>最低效用 <b>{main.minUtility}</b></span><span>群体均值 <b>{main.meanUtility}</b></span><span>几何均值 <b>{main.geoMean}</b></span><span>不确定性 <b>{main.uncertainty}</b></span></div><div className="why-box"><span>为什么是它？</span><p>{main.explanation}</p></div><div className="checks">{main.evidence.slice(0, 3).map((item) => <span key={item}><i>✓</i>{item}</span>)}{main.unknownFacts.length > 0 ? <span className="pending"><i>!</i>{main.unknownFacts.join("、")}待确认</span> : <span><i>✓</i>当前所需事实完整</span>}</div></div></article><aside className="response-panel"><div className="response-head"><span>演示确认</span><b>{decision ? `${config.people}/${config.people}` : `${config.people - 1}/${config.people}`}</b></div><div className="mini-people">{Array.from({ length: config.people }, (_, index) => index).map((index) => <div key={index} className={index < config.people - 1 || decision ? "accepted" : "waiting"}><span>{index < config.people - 1 ? demoMembers[index][0] : "J"}{(index < config.people - 1 || decision) && <i>✓</i>}</span><small>{index < config.people - 1 ? "虚拟样本" : decision ? (decision === "accept" ? "已接受" : "可接受") : "等待你"}</small></div>)}</div>{!decision ? <><p>这里只演示确认闭环；当前尚未启用实时多人同步。</p><button className="accept-button" onClick={() => onDecision("accept")}>✓ 接受这个方案</button><button className="okay-button" onClick={() => onDecision("okay")}>可以接受</button><button className="veto-button" onClick={onVeto}>否决并重新计算</button></> : <><div className="all-accepted"><span>✓</span><b>本轮演示已确认</b><small>可以生成行动卡</small></div><button className="lock-button" onClick={onLock}>锁定方案 <span>→</span></button></>}</aside></div><div className="alternatives"><div><span>同次计算的备选</span><small>不是写死的固定结果</small></div>{ranked.slice(1, 3).map((candidate, index) => <article key={candidate.id}><b>#{index + 2}</b><span>{candidate.name}<small>{candidate.priceLabel} · {candidate.estimatedTravelMinutes ? `估算 ${candidate.estimatedTravelMinutes} 分钟` : "通勤待确认"}</small></span><strong>{candidate.groupFit}</strong></article>)}</div></section>;
}

function LockedScreen({ config, result, onCalendar, onReset, onShare }: { config: RoomConfig; result: RankedCandidate; onCalendar: () => void; onReset: () => void; onShare: () => void }) {
  const day = config.date.slice(-2); const month = Number(config.date.slice(5, 7));
  const openMap = () => window.open(result.source.url || `https://uri.amap.com/search?keyword=${encodeURIComponent(config.city + result.name)}`, "_blank", "noopener,noreferrer");
  return <section className="flow-page locked-page"><div className="locked-burst"><span>✓</span></div><div className="locked-title"><span>PLAN LOCKED</span><h1>本轮方案已锁定</h1><p>行动前仍请确认价格、营业时间和可订状态。</p></div><article className="action-card"><div className="action-map action-photo"><img src={result.image} alt={result.name} referrerPolicy="no-referrer" /><div className="image-shade" /><span className="map-pin">✓</span><i>{config.city}</i><i>{result.district}</i></div><div className="action-content"><div className="action-date"><strong>{day}</strong><span>{month} 月<small>{formatDate(config.date).split("日")[1]}</small></span></div><div className="action-name"><span>本次计算结果 · {result.source.label}</span><h2>{result.name}</h2><p>{result.source.mode === "live" ? result.address : `${config.city} · 演示地址不用于到店`}</p></div><div className="locked-score">{result.groupFit}<small>GROUP FIT</small></div><div className="action-facts"><span><i>◷</i><b>{config.startTime} 集合</b><small>最晚 {config.endTime} 结束</small></span><span><i>¥</i><b>{result.priceLabel}</b><small>到店前再次确认</small></span><span><i>⌖</i><b>{result.estimatedTravelMinutes ? `估算 ${result.estimatedTravelMinutes} 分钟` : "待确认"}</b><small>非实时路线</small></span></div><div className="action-buttons"><button onClick={openMap}>⌖ {result.source.mode === "live" ? "打开地点" : "在高德中搜索"}</button><button onClick={onCalendar}>＋ 加入日历</button><button onClick={onShare}>↗ 分享 Demo</button></div></div></article><div className="source-footnote"><b>数据说明</b><span>{result.source.label} · {formatSourceTime(result.source.fetchedAt)}</span><p>{result.source.mode === "live" ? "地点基础事实来自高德 API；推荐分由本次输入计算。" : "当前候选为演示数据；推荐分由本次输入计算。"}</p></div><button className="restart-button" onClick={onReset}>重新体验 Demo ↺</button></section>;
}
