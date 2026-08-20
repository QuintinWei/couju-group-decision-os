"use client";

import { useEffect, useRef, useState } from "react";

type Stage = "home" | "create" | "room" | "swipe" | "constraints" | "ranking" | "results" | "locked";
type Choice = "no" | "okay" | "like";
type DecisionKind = "activity" | "dining";
type RoomConfig = { kind: DecisionKind; city: string; date: string; startTime: string; endTime: string; people: number };
type Candidate = { id: string; type: string; name: string; meta: string; image: string; price: string; duration: string };

const defaultConfig: RoomConfig = { kind: "activity", city: "上海", date: "2026-08-22", startTime: "15:00", endTime: "20:00", people: 4 };
const cityAreas: Record<string, { area: string; address: string }> = {
  上海: { area: "静安区", address: "静安区威海路 696 号" }, 北京: { area: "朝阳区", address: "朝阳区三里屯路 19 号" },
  深圳: { area: "南山区", address: "南山区海德三道 15 号" }, 杭州: { area: "上城区", address: "上城区湖滨路 28 号" },
  成都: { area: "锦江区", address: "锦江区中纱帽街 8 号" }, 广州: { area: "天河区", address: "天河区天河路 218 号" },
};

const activityCards: Candidate[] = [
  { id: "kart", type: "刺激体验", name: "极速卡丁车馆", meta: "室内赛道 · 新手友好", image: "/candidates/activity-kart.jpg", price: "¥178", duration: "2 小时" },
  { id: "museum", type: "文化艺术", name: "当代艺术中心", meta: "新展开放 · 可随时入场", image: "/candidates/activity-museum.jpg", price: "¥100", duration: "2.5 小时" },
  { id: "camp", type: "户外放松", name: "城市滨江轻露营", meta: "提供全套装备 · 含茶点", image: "/candidates/activity-camp.jpg", price: "¥126", duration: "3 小时" },
  { id: "game", type: "轻松社交", name: "META 桌游社", meta: "300+ 游戏 · 含教学", image: "/candidates/activity-boardgame.jpg", price: "¥88", duration: "3 小时" },
  { id: "escape", type: "沉浸解谜", name: "谜盒沉浸剧场", meta: "轻恐主题 · 四人组队", image: "/candidates/activity-escape.jpg", price: "¥168", duration: "2 小时" },
  { id: "pottery", type: "手作体验", name: "泥作陶艺工坊", meta: "拉坯体验 · 作品可烧制", image: "/candidates/activity-pottery.jpg", price: "¥158", duration: "2 小时" },
  { id: "brunch", type: "轻食聚会", name: "梧桐树下 Brunch", meta: "露台座位 · 宠物友好", image: "/candidates/activity-brunch.jpg", price: "¥138", duration: "2 小时" },
  { id: "climb", type: "运动挑战", name: "岩时攀岩馆", meta: "室内抱石 · 含基础教学", image: "/candidates/activity-climb.jpg", price: "¥198", duration: "2.5 小时" },
];

const diningCards: Candidate[] = [
  { id: "yunnan", type: "云南菜", name: "山野云南菜", meta: "菌菇与汽锅鸡 · 可选不辣", image: "/candidates/food-yunnan.jpg", price: "¥148", duration: "2 小时" },
  { id: "hotpot", type: "火锅", name: "巷里重庆火锅", meta: "鸳鸯锅 · 适合多人分享", image: "/candidates/food-hotpot.jpg", price: "¥168", duration: "2 小时" },
  { id: "sushi", type: "日料", name: "鮨间小馆", meta: "寿司拼盘 · 安静吧台", image: "/candidates/food-sushi.jpg", price: "¥218", duration: "1.5 小时" },
  { id: "bbq", type: "炭火烤肉", name: "炭集烤肉", meta: "店员代烤 · 包厢可订", image: "/candidates/food-bbq.jpg", price: "¥188", duration: "2 小时" },
  { id: "bistro", type: "西式简餐", name: "Common Table", meta: "共享餐桌 · 葡萄酒友好", image: "/candidates/food-brunch.jpg", price: "¥176", duration: "2 小时" },
  { id: "veggie", type: "创意素食", name: "青苔蔬食厨房", meta: "植物料理 · 安静好聊", image: "/candidates/food-vegetarian.jpg", price: "¥128", duration: "1.5 小时" },
  { id: "dimsum", type: "粤式点心", name: "喜粤茶楼", meta: "全天点心 · 圆桌聚餐", image: "/candidates/food-dimsum.jpg", price: "¥118", duration: "2 小时" },
  { id: "noodle", type: "面馆", name: "面里江湖", meta: "手工面 · 性价比高", image: "/candidates/food-noodle.jpg", price: "¥68", duration: "1 小时" },
];

const stageOrder: Stage[] = ["create", "room", "swipe", "constraints", "ranking", "results", "locked"];
const getCards = (kind: DecisionKind) => kind === "dining" ? diningCards : activityCards;
const formatDate = (date: string) => new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date(`${date}T00:00:00`));
const roomTitle = (kind: DecisionKind) => kind === "dining" ? "这顿饭吃什么" : "周末去哪玩";

export default function Home() {
  const [stage, setStage] = useState<Stage>("home");
  const [config, setConfig] = useState<RoomConfig>(defaultConfig);
  const [completed, setCompleted] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [swipes, setSwipes] = useState<Record<string, Choice>>({});
  const [budget, setBudget] = useState("≤ ¥200");
  const [commute, setCommute] = useState("≤ 45 分钟");
  const [setting, setSetting] = useState("室内优先");
  const [note, setNote] = useState("我 17:00 后才到，晚上 8 点前得走，不想排队");
  const [parsed, setParsed] = useState(false);
  const [rankingStep, setRankingStep] = useState(0);
  const [vetoOpen, setVetoOpen] = useState(false);
  const [vetoReason, setVetoReason] = useState("太吵了");
  const [vetoed, setVetoed] = useState(false);
  const [decision, setDecision] = useState<"" | "accept" | "okay">("");
  const [toast, setToast] = useState("");
  const pointerStart = useRef<number | null>(null);
  const activeCards = getCards(config.kind);

  useEffect(() => {
    if (stage !== "ranking") return;
    setRankingStep(0);
    const timers = [1, 2, 3, 4].map((value, index) => window.setTimeout(() => setRankingStep(value), 700 + index * 650));
    timers.push(window.setTimeout(() => setStage("results"), 3600));
    return () => timers.forEach(window.clearTimeout);
  }, [stage]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 1900);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const dining = config.kind === "dining";
    setSetting(dining ? "微辣可以" : "室内优先");
    setNote(dining ? "我不太能吃辣，最好安静一点，想坐下来好好聊" : "我 17:00 后才到，晚上 8 点前得走，不想排队");
    setVetoReason(dining ? "太辣了" : "太吵了");
    setParsed(false); setCardIndex(0); setSwipes({});
  }, [config.kind]);

  const resetDemo = () => {
    setStage("home"); setConfig(defaultConfig); setCompleted(false); setCardIndex(0); setSwipes({});
    setParsed(false); setVetoed(false); setDecision(""); setToast("");
  };
  const copyInvite = async () => { try { await navigator.clipboard.writeText("https://couju.demo/join/CJ-0822"); } catch { /* demo fallback */ } setToast("邀请链接已复制"); };
  const chooseCard = (choice: Choice) => {
    const current = activeCards[cardIndex];
    setSwipes((old) => ({ ...old, [current.id]: choice }));
    if (cardIndex === activeCards.length - 1) setStage("constraints"); else setCardIndex((value) => value + 1);
  };
  const confirmConstraints = () => { setCompleted(true); setStage("room"); setToast("你的私密偏好已提交"); };
  const mainResult = resultFor(config, vetoed);
  const addCalendar = () => {
    const compactDate = config.date.replaceAll("-", "");
    const start = config.startTime.replace(":", ""); const end = config.endTime.replace(":", "");
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART:${compactDate}T${start}00\nDTEND:${compactDate}T${end}00\nSUMMARY:凑局｜${mainResult.name}\nLOCATION:${config.city}市${cityAreas[config.city].address}\nEND:VEVENT\nEND:VCALENDAR`;
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const link = document.createElement("a"); link.href = url; link.download = `凑局-${config.date}.ics`; link.click(); URL.revokeObjectURL(url); setToast("日历文件已生成");
  };
  const currentProgress = Math.max(0, stageOrder.indexOf(stage));
  const vetoReasons = config.kind === "dining" ? ["太辣了", "不吃生食", "还是太远", "价格超预期"] : ["太吵了", "不想运动", "还是太远", "价格超预期"];

  return <main className={`app ${stage === "home" ? "home-mode" : "demo-mode"}`}>
    <header className="app-header">
      <button className="brand" onClick={() => stage === "home" ? null : resetDemo()} aria-label="返回凑局首页"><span className="brand-mark">凑</span><span>凑局</span><small>COUJU</small></button>
      {stage === "home" ? <span className="privacy-pill"><i /> 私密偏好 · 公平共识</span> : <div className="demo-header-right"><div className="step-dots" aria-label={`Demo 进度 ${currentProgress + 1}/7`}>{stageOrder.map((item, i) => <span key={item} className={i <= currentProgress ? "active" : ""} />)}</div><span className="demo-badge">LIVE DEMO</span><button className="quiet-button" onClick={resetDemo}>退出</button></div>}
    </header>
    {stage === "home" && <HomeScreen onStart={() => setStage("create")} />}
    {stage === "create" && <CreateScreen config={config} setConfig={setConfig} onBack={() => setStage("home")} onCreate={() => { setCompleted(false); setVetoed(false); setDecision(""); setStage("room"); }} />}
    {stage === "room" && <RoomScreen config={config} completed={completed} onCopy={copyInvite} onPreference={() => setStage("swipe")} onRank={() => setStage("ranking")} />}
    {stage === "swipe" && <SwipeScreen config={config} cards={activeCards} index={cardIndex} choices={swipes} onChoose={chooseCard} onBack={() => setStage("room")} onPointerDown={(x) => { pointerStart.current = x; }} onPointerUp={(x) => { if (pointerStart.current === null) return; const delta = x - pointerStart.current; if (delta > 65) chooseCard("like"); else if (delta < -65) chooseCard("no"); pointerStart.current = null; }} />}
    {stage === "constraints" && <ConstraintsScreen kind={config.kind} budget={budget} commute={commute} setting={setting} note={note} parsed={parsed} setBudget={setBudget} setCommute={setCommute} setSetting={setSetting} setNote={setNote} setParsed={setParsed} onBack={() => setStage("swipe")} onConfirm={confirmConstraints} />}
    {stage === "ranking" && <RankingScreen config={config} step={rankingStep} />}
    {stage === "results" && <ResultsScreen config={config} vetoed={vetoed} decision={decision} onDecision={setDecision} onVeto={() => setVetoOpen(true)} onLock={() => setStage("locked")} />}
    {stage === "locked" && <LockedScreen config={config} vetoed={vetoed} onCalendar={addCalendar} onReset={resetDemo} onShare={copyInvite} />}
    {vetoOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setVetoOpen(false)}><section className="veto-modal" role="dialog" aria-modal="true" aria-labelledby="veto-title" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setVetoOpen(false)} aria-label="关闭">×</button><span className="modal-icon">!</span><h2 id="veto-title">什么让你无法接受？</h2><p>原因只用于本次重排，其他成员不会看到是谁提出的。</p><div className="reason-grid">{vetoReasons.map((reason) => <button key={reason} className={vetoReason === reason ? "selected" : ""} onClick={() => setVetoReason(reason)}>{reason}</button>)}</div><button className="full-dark-button" onClick={() => { setVetoed(true); setDecision(""); setVetoOpen(false); setToast(`已把“${vetoReason}”加入本次约束，完成重排`); }}>加入本次约束并重排 <span>→</span></button></section></div>}
    {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
  </main>;
}

function HomeScreen({ onStart }: { onStart: () => void }) {
  return <><section className="hero"><div className="hero-copy"><div className="eyebrow"><i /> AI GROUP DECISION</div><h1>把群聊里的<br /><em>“都行”</em><br />变成现在就出发</h1><p>朋友各自私密表达偏好，凑局负责找到没有人被牺牲、而且真实可执行的共同答案。</p><div className="hero-actions"><button className="primary-button" onClick={onStart}>体验完整决策 <span>→</span></button><span><b>3 分钟</b> · 免下载 · 免登录</span></div><div className="hero-proof"><div className="proof-faces"><i>N</i><i>L</i><i>M</i><i>J</i></div><span><b>4 人的底线都被照顾</b><small>不是多数票，是公平共识</small></span></div></div><div className="decision-card" aria-label="凑局共识房间预览"><div className="floating-chat chat-one"><b>都行啊</b><small>但别太远</small></div><div className="floating-chat chat-two"><b>你们定</b><small>我 8 点前得走</small></div><div className="card-topline"><span><i /> 周六去哪玩</span><b>LIVE · 3/4</b></div><div className="people-row">{[["N","Nina",true],["L","Leo",true],["M","Mia",true],["J","Jay",false]].map(([letter,name,done]) => <div className="person" key={String(name)}><div className={`avatar ${done ? "done" : "wait"}`}>{letter}{done && <span>✓</span>}</div><small>{name}</small></div>)}</div><div className="converge"><div className="thread t1" /><div className="thread t2" /><div className="thread t3" /><div className="thread t4" /><span className="ai-node">✦</span></div><div className="place-result"><div className="result-visual photo-preview"><img src="/candidates/activity-kart.jpg" alt="卡丁车活动" /><span>TOP 1</span></div><div><small>共同可接受方案</small><h3>极速卡丁车馆</h3><p>周六 17:00 · ¥178/人</p></div><strong>88<small>GROUP FIT</small></strong></div><div className="fit-line"><i>✓</i><span><b>全部底线满足</b><small>最低个人匹配仍有 76</small></span></div></div></section><section className="how-strip"><div><b>01</b><span>把链接扔进群</span><small>好友打开就能参与</small></div><div className="arrow">→</div><div><b>02</b><span>每人私密滑 8 张</span><small>不必公开预算和底线</small></div><div className="arrow">→</div><div><b>03</b><span>一起锁定方案</span><small>直接导航、加入日历</small></div></section></>;
}

function ScreenTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) { return <div className="screen-title"><span>{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>; }

function CreateScreen({ config, setConfig, onBack, onCreate }: { config: RoomConfig; setConfig: (c: RoomConfig) => void; onBack: () => void; onCreate: () => void }) {
  const [error, setError] = useState("");
  const update = <K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => { setConfig({ ...config, [key]: value }); setError(""); };
  const submit = () => { if (config.endTime <= config.startTime) { setError("结束时间需要晚于开始时间"); return; } onCreate(); };
  return <section className="flow-page create-page"><button className="back-button" onClick={onBack}>← 返回</button><ScreenTitle eyebrow="CREATE A ROOM" title="发起一个局" detail="这些设置会直接决定后续出现的卡片和推荐结果。" /><div className="create-layout"><div className="form-card"><label>这次想决定什么？</label><div className="option-pair"><button className={config.kind === "activity" ? "selected" : ""} onClick={() => update("kind", "activity")}><b>✦</b><span>周末活动<small>卡片与结果只出现活动</small></span></button><button className={config.kind === "dining" ? "selected" : ""} onClick={() => update("kind", "dining")}><b>♨</b><span>一起聚餐<small>卡片与结果只出现餐厅</small></span></button></div><div className="field-grid"><label><span>城市</span><select className="form-control" value={config.city} onChange={(e) => update("city", e.target.value)} aria-label="选择城市">{Object.keys(cityAreas).map((city) => <option key={city}>{city}</option>)}</select></label><label><span>日期</span><input className="form-control" type="date" min="2026-08-20" value={config.date} onChange={(e) => update("date", e.target.value)} /></label><label><span>开始时间</span><input className="form-control" type="time" value={config.startTime} onChange={(e) => update("startTime", e.target.value)} /></label><label><span>最晚结束</span><input className="form-control" type="time" value={config.endTime} onChange={(e) => update("endTime", e.target.value)} /></label></div><label>预计几个人？</label><div className="number-row">{[2,3,4,5,6].map((n) => <button key={n} className={n === config.people ? "selected" : ""} onClick={() => update("people", n)} aria-label={`${n}人`}>{n}</button>)}</div>{error && <p className="form-error">{error}</p>}<button className="full-dark-button" onClick={submit}>创建{config.kind === "dining" ? "聚餐" : "活动"}房间 <span>→</span></button></div><aside className="promise-card"><span className="lock-symbol">⌾</span><h3>设置会全程生效</h3><p>城市、日期、时间、人数与决策类型会带入房间、滑卡、推荐和行动卡。</p><div><span>✓</span>选择聚餐不会推荐活动</div><div><span>✓</span>每个场景都有对应图片</div></aside></div></section>;
}

function RoomScreen({ config, completed, onCopy, onPreference, onRank }: { config: RoomConfig; completed: boolean; onCopy: () => void; onPreference: () => void; onRank: () => void }) {
  const others = ["Nina", "Leo", "Mia", "Owen", "Zoe"].slice(0, config.people - 1);
  const people = [...others.map((name) => ({ name, letter: name[0], done: true })), { name: "你 · Jay", letter: "J", done: completed }];
  const doneCount = completed ? config.people : config.people - 1;
  return <section className="flow-page room-page"><div className="room-kicker"><span>收集中</span><b>房间 CJ-{config.date.slice(5).replace("-", "")}</b></div><ScreenTitle eyebrow={`${config.kind === "dining" ? "DINNER" : "WEEKEND"} IN ${config.city.toUpperCase()}`} title={roomTitle(config.kind)} detail={`${formatDate(config.date)} · ${config.startTime}–${config.endTime} · ${config.city}`} /><div className="room-grid"><div className="room-main-card"><div className="room-card-head"><div><span>成员进度</span><strong>{doneCount}/{config.people} 已完成</strong></div><i>{completed ? "已达到求交集条件" : "等待你的偏好"}</i></div><div className="member-list">{people.map((person) => <div key={person.name} className={person.done ? "member done" : "member pending"}><div className="avatar">{person.letter}{person.done && <span>✓</span>}</div><div><b>{person.name}</b><small>{person.done ? "已提交" : "待完成"}</small></div><em>{person.done ? "完成" : "待完成"}</em></div>)}</div>{!completed ? <button className="full-dark-button pulse" onClick={onPreference}>完成我的私密偏好 <span>→</span></button> : <button className="full-dark-button lime-button" onClick={onRank}>开始求交集 <span>✦</span></button>}<p className="privacy-note">⌾ 任何人都看不到其他成员的原始选择</p></div><aside className="invite-card"><div className="qr" aria-label="邀请二维码装饰"><span>凑</span></div><h3>邀请朋友加入</h3><p>扫描二维码，或把链接发到群里</p><button onClick={onCopy}>复制邀请链接 <span>↗</span></button><small>链接将在 {config.endTime} 失效</small></aside></div><div className="public-constraint"><b>公开范围</b><span>{formatDate(config.date)} {config.startTime}–{config.endTime}</span><span>{config.city}市内</span><span>{config.people} 人</span><i>个人预算和忌口仍然私密</i></div></section>;
}

function SwipeScreen({ config, cards, index, choices, onChoose, onBack, onPointerDown, onPointerUp }: { config: RoomConfig; cards: Candidate[]; index: number; choices: Record<string, Choice>; onChoose: (choice: Choice) => void; onBack: () => void; onPointerDown: (x: number) => void; onPointerUp: (x: number) => void }) {
  const card = cards[index];
  return <section className="flow-page swipe-page"><div className="mobile-frame"><div className="mobile-top"><button onClick={onBack}>×</button><span>{config.kind === "dining" ? "你的餐厅偏好" : "你的活动偏好"}</span><b>{index + 1}<small> / {cards.length}</small></b></div><div className="progress-line"><i style={{ width: `${((index + 1) / cards.length) * 100}%` }} /></div><div className="swipe-prompt"><span>凭直觉就好</span><h2>{config.kind === "dining" ? "这家，你想和朋友一起吃吗？" : "这个周末，你想去吗？"}</h2><p>你的选择仅用于计算，不会展示给其他人</p></div><div className="card-stack"><div className="ghost-card ghost-two" /><div className="ghost-card ghost-one" /><article className="swipe-card photo-card" onPointerDown={(e) => onPointerDown(e.clientX)} onPointerUp={(e) => onPointerUp(e.clientX)}><div className="activity-art"><img src={card.image} alt={card.name} draggable={false} /><div className="image-shade" /><span className="category-chip">{card.type}</span><i>{config.city}精选</i></div><div className="activity-info"><span>本地真实候选</span><h3>{card.name}</h3><p>{card.price}/人 · {card.duration} · {card.meta}</p><div><small>{formatDate(config.date)}可订</small><small>适合 {config.people} 人</small><small>信息已核验</small></div></div></article></div><div className="swipe-actions"><button className="no" onClick={() => onChoose("no")} aria-label="不想去">×<small>不想去</small></button><button className="okay" onClick={() => onChoose("okay")} aria-label="还行">−<small>还行</small></button><button className="yes" onClick={() => onChoose("like")} aria-label="喜欢">♥<small>喜欢</small></button></div><p className="gesture-hint">← 左滑不想去 · 右滑喜欢 →</p><div className="choice-history" aria-label={`${Object.keys(choices).length} 张卡已完成`} /></div></section>;
}

function ChipGroup({ values, selected, onSelect }: { values: string[]; selected: string; onSelect: (v: string) => void }) { return <div className="chip-group">{values.map((v) => <button key={v} className={selected === v ? "selected" : ""} onClick={() => onSelect(v)}>{v}</button>)}</div>; }

function ConstraintsScreen(props: { kind: DecisionKind; budget: string; commute: string; setting: string; note: string; parsed: boolean; setBudget: (v: string) => void; setCommute: (v: string) => void; setSetting: (v: string) => void; setNote: (v: string) => void; setParsed: (v: boolean) => void; onBack: () => void; onConfirm: () => void }) {
  const dining = props.kind === "dining";
  return <section className="flow-page constraints-page"><button className="back-button" onClick={props.onBack}>← 返回滑卡</button><ScreenTitle eyebrow="YOUR BOUNDARIES" title="最后，说说你的底线" detail="明确底线会让推荐更可靠，也不需要向朋友解释原因。" /><div className="constraint-layout"><div className="constraint-card"><label><span>01</span><div><b>人均预算</b><small>{dining ? "按人均消费估算" : "包含场地或门票，不含交通"}</small></div></label><ChipGroup values={dining ? ["≤ ¥100","≤ ¥150","≤ ¥200","不限"] : ["≤ ¥100","≤ ¥200","≤ ¥300","不限"]} selected={props.budget} onSelect={props.setBudget} /><label><span>02</span><div><b>最远单程通勤</b><small>从你出发的位置估算</small></div></label><ChipGroup values={["≤ 30 分钟","≤ 45 分钟","≤ 60 分钟","不限"]} selected={props.commute} onSelect={props.setCommute} /><label><span>03</span><div><b>{dining ? "辣度底线" : "空间偏好"}</b><small>{dining ? "饮食底线不会被平均分抵消" : "天气会进入可行性判断"}</small></div></label><ChipGroup values={dining ? ["不吃辣","微辣可以","都可以"] : ["室内优先","户外优先","都可以"]} selected={props.setting} onSelect={props.setSetting} /></div><div className="natural-card"><div className="natural-head"><span>✦</span><div><b>还有什么想说的？</b><small>AI 只负责把人话整理成标签</small></div></div><textarea value={props.note} onChange={(e) => { props.setNote(e.target.value); props.setParsed(false); }} aria-label="自然语言偏好" /><button onClick={() => props.setParsed(true)}>理解这句话 <span>↗</span></button>{props.parsed && <div className="parsed-box"><div><span>✓</span><b>已理解，请确认</b></div><section>{(dining ? ["不吃辣","安静一点","适合聊天"] : ["17:00 后到","20:00 前离开","不想排队"]).map((tag) => <button key={tag}>{tag} <i>×</i></button>)}</section><p>没有把任何模糊偏好自动升级成底线。</p></div>}</div></div><button className="confirm-preference" onClick={props.onConfirm} disabled={!props.parsed}>确认并私密提交 <span>→</span></button></section>;
}

function RankingScreen({ config, step }: { config: RoomConfig; step: number }) {
  const dining = config.kind === "dining"; const rows = [{ n: dining ? "48" : "40", title: dining ? "餐厅候选已检索" : "活动候选已检索", detail: `${config.city}精选真实候选` }, { n: dining ? "31" : "25", title: "时间可行", detail: "排除营业与时长冲突" }, { n: dining ? "14" : "12", title: "全部底线满足", detail: `排除预算、通勤与${dining ? "忌口" : "天气"}冲突` }, { n: "3", title: "共同可接受", detail: "正在计算 FairMix 公平共识分" }];
  return <section className="flow-page ranking-page"><div className="ranking-orbit"><span className="pulse-core">凑</span><i className="orbit-one" /><i className="orbit-two" /></div><div className="ranking-copy"><span>FAIRMIX CONSENSUS ENGINE</span><h1>正在求交集</h1><p>AI 理解人话，确定性算法负责决定。不会凭空生成答案。</p></div><div className="ranking-funnel">{rows.map((row, i) => <div key={row.title} className={step > i ? "done" : step === i ? "active" : ""}><span>{step > i ? "✓" : i + 1}</span><strong>{step > i || step === i ? row.n : "—"}</strong><section><b>{row.title}</b><small>{row.detail}</small></section><em>{step > i ? "完成" : step === i ? "计算中" : "等待"}</em></div>)}</div><div className="ranking-privacy">⌾ 计算只使用匿名效用分，私人原文不会进入结果解释</div></section>;
}

function resultFor(config: RoomConfig, vetoed: boolean) {
  if (config.kind === "dining") return vetoed
    ? { name: "青苔蔬食厨房", score: 87, image: "/candidates/food-vegetarian.jpg", price: "¥128/人", travel: "最远 25 分钟", why: "排除辛辣与生食后，仍满足所有人的预算和距离底线；环境安静，适合聊天。", alt1: "喜粤茶楼", alt2: "Common Table" }
    : { name: "山野云南菜", score: 91, image: "/candidates/food-yunnan.jpg", price: "¥148/人", travel: "最远 28 分钟", why: "可做不辣、预算满足全员底线；圆桌适合多人聊天，最低个人匹配仍有 82。", alt1: "喜粤茶楼", alt2: "炭集烤肉" };
  return vetoed
    ? { name: "谜盒沉浸剧场", score: 86, image: "/candidates/activity-escape.jpg", price: "¥168/人", travel: "最远 32 分钟", why: "满足所有人的时间和预算底线；新增“安静环境”约束后仍保持较高兴趣交集。", alt1: "泥作陶艺工坊", alt2: "META 桌游社" }
    : { name: "极速卡丁车馆", score: 88, image: "/candidates/activity-kart.jpg", price: "¥178/人", travel: "最远 38 分钟", why: "满足全部时间和预算底线；四人最低个人匹配仍为 76；室内不受降雨影响。", alt1: "谜盒沉浸剧场", alt2: "META 桌游社" };
}

function ResultsScreen({ config, vetoed, decision, onDecision, onVeto, onLock }: { config: RoomConfig; vetoed: boolean; decision: "" | "accept" | "okay"; onDecision: (d: "accept" | "okay") => void; onVeto: () => void; onLock: () => void }) {
  const main = resultFor(config, vetoed); const startLabel = config.startTime; const lowest = config.kind === "dining" ? (vetoed ? "78" : "82") : (vetoed ? "74" : "76");
  return <section className="flow-page results-page"><div className="result-heading"><div><span>✓ 找到共同可接受方案</span><h1>{vetoed ? "已根据新底线重排" : "你们的交集，比想象中大"}</h1><p>{vetoed ? "新底线已加入本次计算，其他人的私人输入仍未公开。" : `${config.kind === "dining" ? "48 家餐厅" : "40 个活动"}经过硬约束过滤和公平共识排序。`}</p></div><div className="verified-badge"><i>✓</i><span>全部硬约束<small>已核验</small></span></div></div><div className="result-layout"><article className="winner-card"><div className="winner-art photo-winner"><img src={main.image} alt={main.name} /><div className="image-shade" /><div className="rank-ribbon">TOP 1 · 推荐</div><span>{config.city} · {cityAreas[config.city].area}</span></div><div className="winner-body"><div className="winner-title"><div><span>共同可接受方案</span><h2>{main.name}</h2></div><div className="group-score"><strong>{main.score}</strong><span>GROUP FIT<small>会话内公平分</small></span></div></div><div className="facts-row"><span><i>◷</i><b>{startLabel} {config.kind === "dining" ? "用餐" : "到店"}</b><small>{formatDate(config.date)} · 约 2 小时</small></span><span><i>¥</i><b>{main.price}</b><small>低于全员预算上限</small></span><span><i>⌖</i><b>{main.travel}</b><small>通勤差异较小</small></span></div><div className="why-box"><span>为什么是它？</span><p>{main.why}</p></div><div className="checks"><span><i>✓</i>时间满足 {config.people}/{config.people}</span><span><i>✓</i>预算满足 {config.people}/{config.people}</span><span><i>✓</i>最低匹配 {lowest}</span><span><i>✓</i>关键事实已更新</span></div></div></article><aside className="response-panel"><div className="response-head"><span>全员确认</span><b>{decision ? `${config.people}/${config.people}` : `${config.people - 1}/${config.people}`}</b></div><div className="mini-people">{Array.from({ length: config.people }, (_, i) => String.fromCharCode(78 + i)).map((p,i) => <div key={`${p}${i}`} className={i < config.people - 1 || decision ? "accepted" : "waiting"}><span>{p}{(i < config.people - 1 || decision) && <i>✓</i>}</span><small>{i < config.people - 1 ? "已接受" : decision ? (decision === "accept" ? "已接受" : "可接受") : "等待你"}</small></div>)}</div>{!decision ? <><p>你的选择不会展示原因，只有结果状态对小组可见。</p><button className="accept-button" onClick={() => onDecision("accept")}>✓ 接受这个方案</button><button className="okay-button" onClick={() => onDecision("okay")}>可以接受</button><button className="veto-button" onClick={onVeto}>否决并说明原因</button></> : <><div className="all-accepted"><span>✓</span><b>全员已确认</b><small>没有人被落下，可以锁定了</small></div><button className="lock-button" onClick={onLock}>锁定方案 <span>→</span></button></>}</aside></div><div className="alternatives"><div><span>其他可行方案</span><small>比较权衡，不隐藏备选</small></div><article><b>#2</b><span>{main.alt1}<small>{config.kind === "dining" ? "更安静 · ¥118/人" : "更近 · ¥168/人"}</small></span><strong>85</strong></article><article><b>#3</b><span>{main.alt2}<small>{config.kind === "dining" ? "更有氛围 · ¥176/人" : "更便宜 · ¥88/人"}</small></span><strong>81</strong></article></div></section>;
}

function LockedScreen({ config, vetoed, onCalendar, onReset, onShare }: { config: RoomConfig; vetoed: boolean; onCalendar: () => void; onReset: () => void; onShare: () => void }) {
  const main = resultFor(config, vetoed); const area = cityAreas[config.city]; const day = config.date.slice(-2); const month = Number(config.date.slice(5,7));
  return <section className="flow-page locked-page"><div className="locked-burst"><span>✓</span></div><div className="locked-title"><span>PLAN LOCKED</span><h1>就这么定了！</h1><p>所有人都确认接受，接下来只管出发。</p></div><article className="action-card"><div className="action-map action-photo"><img src={main.image} alt={main.name} /><div className="image-shade" /><span className="map-pin">✓</span><i>{config.city}</i><i>{area.area}</i></div><div className="action-content"><div className="action-date"><strong>{day}</strong><span>{month} 月<small>{formatDate(config.date).split("日")[1]}</small></span></div><div className="action-name"><span>本次共同决定</span><h2>{main.name}</h2><p>{config.city}市{area.address}</p></div><div className="locked-score">{main.score}<small>GROUP FIT</small></div><div className="action-facts"><span><i>◷</i><b>{config.startTime} 集合</b><small>最晚 {config.endTime} 结束</small></span><span><i>¥</i><b>{main.price}</b><small>现场各自支付</small></span><span><i>⌖</i><b>{main.travel}</b><small>{area.area}</small></span></div><div className="action-buttons"><button onClick={() => window.open(`https://uri.amap.com/search?keyword=${encodeURIComponent(config.city + main.name)}`, "_blank")}>⌖ 开始导航</button><button onClick={onCalendar}>＋ 加入日历</button><button onClick={onShare}>↗ 分享行动卡</button></div></div></article><div className="locked-people">{Array.from({ length: config.people }, (_, i) => ["Nina","Leo","Mia","Owen","Zoe","Jay"][i]).map((p) => <span key={p}><i>{p[0]}</i>{p}<b>✓</b></span>)}</div><p className="final-privacy">只保存这次决定？ <button>偏好学习设置</button></p><button className="restart-button" onClick={onReset}>重新体验 Demo ↺</button></section>;
}
