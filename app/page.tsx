"use client";

import { useEffect, useRef, useState } from "react";

type Stage = "home" | "create" | "room" | "swipe" | "constraints" | "ranking" | "results" | "locked";
type Choice = "no" | "okay" | "like";

const swipeCards = [
  { id: "kart", type: "刺激体验", name: "极速卡丁车", meta: "¥178 · 室内 · 2小时", emoji: "KART", color: "orange" },
  { id: "museum", type: "文化艺术", name: "西岸美术馆", meta: "¥100 · 室内 · 2.5小时", emoji: "ART", color: "blue" },
  { id: "camp", type: "户外放松", name: "滨江轻露营", meta: "¥126 · 户外 · 3小时", emoji: "CAMP", color: "green" },
  { id: "game", type: "轻松社交", name: "META 桌游社", meta: "¥88 · 室内 · 3小时", emoji: "PLAY", color: "pink" },
  { id: "escape", type: "沉浸解谜", name: "谜盒沉浸剧场", meta: "¥168 · 室内 · 2小时", emoji: "MYST", color: "purple" },
  { id: "pottery", type: "手作体验", name: "泥作陶艺工坊", meta: "¥158 · 室内 · 2小时", emoji: "CLAY", color: "sand" },
  { id: "brunch", type: "轻食聚餐", name: "梧桐树下 Brunch", meta: "¥138 · 半室外 · 2小时", emoji: "EAT", color: "yellow" },
  { id: "climb", type: "运动挑战", name: "岩时攀岩馆", meta: "¥198 · 室内 · 2.5小时", emoji: "UP", color: "cyan" },
];

const stageOrder: Stage[] = ["create", "room", "swipe", "constraints", "ranking", "results", "locked"];

export default function Home() {
  const [stage, setStage] = useState<Stage>("home");
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

  const resetDemo = () => {
    setStage("home"); setCompleted(false); setCardIndex(0); setSwipes({});
    setParsed(false); setVetoed(false); setDecision(""); setToast("");
  };

  const copyInvite = async () => {
    try { await navigator.clipboard.writeText("https://couju.demo/join/CJ-0822"); } catch { /* demo fallback */ }
    setToast("邀请链接已复制");
  };

  const chooseCard = (choice: Choice) => {
    const current = swipeCards[cardIndex];
    setSwipes((old) => ({ ...old, [current.id]: choice }));
    if (cardIndex === swipeCards.length - 1) setStage("constraints");
    else setCardIndex((value) => value + 1);
  };

  const confirmConstraints = () => {
    setCompleted(true); setStage("room"); setToast("你的私密偏好已提交");
  };

  const lockPlan = () => {
    setStage("locked");
  };

  const addCalendar = () => {
    const title = vetoed ? "凑局｜谜盒沉浸剧场" : "凑局｜极速卡丁车馆";
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART:20260822T080000Z\nDTEND:20260822T100000Z\nSUMMARY:${title}\nLOCATION:上海市静安区威海路696号\nEND:VEVENT\nEND:VCALENDAR`;
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const link = document.createElement("a"); link.href = url; link.download = "凑局-周六去哪玩.ics"; link.click(); URL.revokeObjectURL(url);
    setToast("日历文件已生成");
  };

  const currentProgress = Math.max(0, stageOrder.indexOf(stage));

  return (
    <main className={`app ${stage === "home" ? "home-mode" : "demo-mode"}`}>
      <header className="app-header">
        <button className="brand" onClick={() => stage === "home" ? null : resetDemo()} aria-label="返回凑局首页">
          <span className="brand-mark">凑</span><span>凑局</span><small>COUJU</small>
        </button>
        {stage === "home" ? (
          <span className="privacy-pill"><i /> 私密偏好 · 公平共识</span>
        ) : (
          <div className="demo-header-right">
            <div className="step-dots" aria-label={`Demo 进度 ${currentProgress + 1}/7`}>
              {stageOrder.map((item, i) => <span key={item} className={i <= currentProgress ? "active" : ""} />)}
            </div>
            <span className="demo-badge">LIVE DEMO</span>
            <button className="quiet-button" onClick={resetDemo}>退出</button>
          </div>
        )}
      </header>

      {stage === "home" && <HomeScreen onStart={() => setStage("create")} />}
      {stage === "create" && <CreateScreen onBack={() => setStage("home")} onCreate={() => setStage("room")} />}
      {stage === "room" && (
        <RoomScreen completed={completed} onCopy={copyInvite} onPreference={() => setStage("swipe")} onRank={() => setStage("ranking")} />
      )}
      {stage === "swipe" && (
        <SwipeScreen index={cardIndex} choices={swipes} onChoose={chooseCard} onBack={() => setStage("room")}
          onPointerDown={(x) => { pointerStart.current = x; }}
          onPointerUp={(x) => { if (pointerStart.current === null) return; const delta = x - pointerStart.current; if (delta > 65) chooseCard("like"); else if (delta < -65) chooseCard("no"); pointerStart.current = null; }} />
      )}
      {stage === "constraints" && (
        <ConstraintsScreen budget={budget} commute={commute} setting={setting} note={note} parsed={parsed}
          setBudget={setBudget} setCommute={setCommute} setSetting={setSetting} setNote={setNote} setParsed={setParsed}
          onBack={() => setStage("swipe")} onConfirm={confirmConstraints} />
      )}
      {stage === "ranking" && <RankingScreen step={rankingStep} />}
      {stage === "results" && (
        <ResultsScreen vetoed={vetoed} decision={decision} onDecision={setDecision} onVeto={() => setVetoOpen(true)} onLock={lockPlan} />
      )}
      {stage === "locked" && <LockedScreen vetoed={vetoed} onCalendar={addCalendar} onReset={resetDemo} onShare={copyInvite} />}

      {vetoOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setVetoOpen(false)}>
          <section className="veto-modal" role="dialog" aria-modal="true" aria-labelledby="veto-title" onMouseDown={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setVetoOpen(false)} aria-label="关闭">×</button>
            <span className="modal-icon">!</span><h2 id="veto-title">什么让你无法接受？</h2>
            <p>原因只用于本次重排，其他成员不会看到是谁提出的。</p>
            <div className="reason-grid">
              {["太吵了", "不想运动", "还是太远", "价格超预期"].map((reason) => (
                <button key={reason} className={vetoReason === reason ? "selected" : ""} onClick={() => setVetoReason(reason)}>{reason}</button>
              ))}
            </div>
            <button className="full-dark-button" onClick={() => { setVetoed(true); setDecision(""); setVetoOpen(false); setToast("已把“太吵”加入本次约束，完成重排"); }}>加入本次约束并重排 <span>→</span></button>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function HomeScreen({ onStart }: { onStart: () => void }) {
  return <>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><i /> AI GROUP DECISION</div>
        <h1>把群聊里的<br /><em>“都行”</em><br />变成现在就出发</h1>
        <p>朋友各自私密表达偏好，凑局负责找到没有人被牺牲、而且真实可执行的共同答案。</p>
        <div className="hero-actions"><button className="primary-button" onClick={onStart}>体验完整决策 <span>→</span></button><span><b>3 分钟</b> · 免下载 · 免登录</span></div>
        <div className="hero-proof"><div className="proof-faces"><i>N</i><i>L</i><i>M</i><i>J</i></div><span><b>4 人的底线都被照顾</b><small>不是多数票，是公平共识</small></span></div>
      </div>
      <div className="decision-card" aria-label="凑局共识房间预览">
        <div className="floating-chat chat-one"><b>都行啊</b><small>但别太远 🙈</small></div>
        <div className="floating-chat chat-two"><b>你们定</b><small>我 8 点前得走</small></div>
        <div className="card-topline"><span><i /> 周六去哪玩</span><b>LIVE · 3/4</b></div>
        <div className="people-row">
          {[["N", "Nina", true], ["L", "Leo", true], ["M", "Mia", true], ["J", "Jay", false]].map(([letter, name, done]) => (
            <div className="person" key={String(name)}><div className={`avatar ${done ? "done" : "wait"}`}>{letter}{done && <span>✓</span>}</div><small>{name}</small></div>
          ))}
        </div>
        <div className="converge"><div className="thread t1" /><div className="thread t2" /><div className="thread t3" /><div className="thread t4" /><span className="ai-node">✦</span></div>
        <div className="place-result"><div className="result-visual"><span>TOP 1</span><b>GO</b></div><div><small>共同可接受方案</small><h3>极速卡丁车馆</h3><p>周六 17:00 · ¥178/人</p></div><strong>88<small>GROUP FIT</small></strong></div>
        <div className="fit-line"><i>✓</i><span><b>全部底线满足</b><small>最低个人匹配仍有 76</small></span></div>
      </div>
    </section>
    <section className="how-strip"><div><b>01</b><span>把链接扔进群</span><small>好友打开就能参与</small></div><div className="arrow">→</div><div><b>02</b><span>每人私密滑 8 张</span><small>不必公开预算和底线</small></div><div className="arrow">→</div><div><b>03</b><span>一起锁定方案</span><small>直接导航、加入日历</small></div></section>
  </>;
}

function ScreenTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <div className="screen-title"><span>{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>;
}

function CreateScreen({ onBack, onCreate }: { onBack: () => void; onCreate: () => void }) {
  const [kind, setKind] = useState("周末活动");
  return <section className="flow-page create-page">
    <button className="back-button" onClick={onBack}>← 返回</button>
    <ScreenTitle eyebrow="CREATE A ROOM" title="发起一个局" detail="先把边界说清，具体去哪交给每个人私密决定。" />
    <div className="create-layout">
      <div className="form-card">
        <label>这次想决定什么？</label>
        <div className="option-pair">{["周末活动", "一起聚餐"].map((item, i) => <button key={item} className={kind === item ? "selected" : ""} onClick={() => setKind(item)}><b>{i === 0 ? "✦" : "♨"}</b><span>{item}<small>{i === 0 ? "玩点有意思的" : "找一家都能吃的"}</small></span></button>)}</div>
        <div className="field-grid">
          <label><span>城市</span><div className="input-look">上海市 <i>⌄</i></div></label>
          <label><span>日期</span><div className="input-look">8月22日 周六 <i>⌄</i></div></label>
          <label><span>开始时间</span><div className="input-look">15:00 <i>⌄</i></div></label>
          <label><span>最晚结束</span><div className="input-look">20:00 <i>⌄</i></div></label>
        </div>
        <label>预计几个人？</label><div className="number-row">{[2,3,4,5,6].map((n) => <button key={n} className={n === 4 ? "selected" : ""}>{n}</button>)}</div>
        <button className="full-dark-button" onClick={onCreate}>创建房间 <span>→</span></button>
      </div>
      <aside className="promise-card"><span className="lock-symbol">⌾</span><h3>默认私密</h3><p>你的预算、忌口和每张选择都不会展示给其他人。</p><div><span>✓</span>好友只看完成进度</div><div><span>✓</span>结果只展示群体结论</div></aside>
    </div>
  </section>;
}

function RoomScreen({ completed, onCopy, onPreference, onRank }: { completed: boolean; onCopy: () => void; onPreference: () => void; onRank: () => void }) {
  const people = [{ name: "Nina", sub: "已提交", letter: "N", done: true }, { name: "Leo", sub: "已提交", letter: "L", done: true }, { name: "Mia", sub: "已提交", letter: "M", done: true }, { name: "你 · Jay", sub: completed ? "已提交" : "待完成", letter: "J", done: completed }];
  return <section className="flow-page room-page">
    <div className="room-kicker"><span>收集中</span><b>房间 CJ-0822</b></div>
    <ScreenTitle eyebrow="SATURDAY IN SHANGHAI" title="周六去哪玩" detail="8月22日 · 15:00–20:00 · 上海" />
    <div className="room-grid">
      <div className="room-main-card">
        <div className="room-card-head"><div><span>成员进度</span><strong>{completed ? "4/4" : "3/4"} 已完成</strong></div><i>{completed ? "已达到求交集条件" : "等待你的偏好"}</i></div>
        <div className="member-list">{people.map((person) => <div key={person.name} className={person.done ? "member done" : "member pending"}><div className="avatar">{person.letter}{person.done && <span>✓</span>}</div><div><b>{person.name}</b><small>{person.sub}</small></div>{person.done ? <em>完成</em> : <em>待完成</em>}</div>)}</div>
        {!completed ? <button className="full-dark-button pulse" onClick={onPreference}>完成我的私密偏好 <span>→</span></button> : <button className="full-dark-button lime-button" onClick={onRank}>开始求交集 <span>✦</span></button>}
        <p className="privacy-note">⌾ 任何人都看不到其他成员的原始选择</p>
      </div>
      <aside className="invite-card"><div className="qr" aria-label="邀请二维码装饰"><span>凑</span></div><h3>邀请朋友加入</h3><p>扫描二维码，或把链接发到群里</p><button onClick={onCopy}>复制邀请链接 <span>↗</span></button><small>链接将在周六 20:00 失效</small></aside>
    </div>
    <div className="public-constraint"><b>公开范围</b><span>周六 15:00–20:00</span><span>上海市内</span><span>4 人</span><i>预算等个人底线按全员交集计算</i></div>
  </section>;
}

function SwipeScreen({ index, choices, onChoose, onBack, onPointerDown, onPointerUp }: { index: number; choices: Record<string, Choice>; onChoose: (choice: Choice) => void; onBack: () => void; onPointerDown: (x: number) => void; onPointerUp: (x: number) => void }) {
  const card = swipeCards[index];
  return <section className="flow-page swipe-page">
    <div className="mobile-frame">
      <div className="mobile-top"><button onClick={onBack}>×</button><span>你的私密偏好</span><b>{index + 1}<small> / {swipeCards.length}</small></b></div>
      <div className="progress-line"><i style={{ width: `${((index + 1) / swipeCards.length) * 100}%` }} /></div>
      <div className="swipe-prompt"><span>凭直觉就好</span><h2>这个周六，你想去吗？</h2><p>你的选择仅用于计算，不会展示给其他人</p></div>
      <div className="card-stack">
        <div className="ghost-card ghost-two" /><div className="ghost-card ghost-one" />
        <article className={`swipe-card ${card.color}`} onPointerDown={(e) => onPointerDown(e.clientX)} onPointerUp={(e) => onPointerUp(e.clientX)}>
          <div className="activity-art"><span className="category-chip">{card.type}</span><b>{card.emoji}</b><i>上海精选</i></div>
          <div className="activity-info"><span>本地真实候选</span><h3>{card.name}</h3><p>{card.meta}</p><div><small>周六可订</small><small>适合 4 人</small><small>信息已核验</small></div></div>
        </article>
      </div>
      <div className="swipe-actions"><button className="no" onClick={() => onChoose("no")} aria-label="不想去">×<small>不想去</small></button><button className="okay" onClick={() => onChoose("okay")} aria-label="还行">−<small>还行</small></button><button className="yes" onClick={() => onChoose("like")} aria-label="喜欢">♥<small>喜欢</small></button></div>
      <p className="gesture-hint">← 左滑不想去 · 右滑喜欢 →</p>
      <div className="choice-history" aria-label={`${Object.keys(choices).length} 张卡已完成`} />
    </div>
  </section>;
}

function ChipGroup({ values, selected, onSelect }: { values: string[]; selected: string; onSelect: (v: string) => void }) {
  return <div className="chip-group">{values.map((v) => <button key={v} className={selected === v ? "selected" : ""} onClick={() => onSelect(v)}>{v}</button>)}</div>;
}

function ConstraintsScreen(props: { budget: string; commute: string; setting: string; note: string; parsed: boolean; setBudget: (v: string) => void; setCommute: (v: string) => void; setSetting: (v: string) => void; setNote: (v: string) => void; setParsed: (v: boolean) => void; onBack: () => void; onConfirm: () => void }) {
  return <section className="flow-page constraints-page">
    <button className="back-button" onClick={props.onBack}>← 返回滑卡</button>
    <ScreenTitle eyebrow="YOUR BOUNDARIES" title="最后，说说你的底线" detail="只需 30 秒。明确底线会让推荐更可靠，也不需要向朋友解释原因。" />
    <div className="constraint-layout">
      <div className="constraint-card">
        <label><span>01</span><div><b>人均预算</b><small>包含场地或门票，不含交通</small></div></label><ChipGroup values={["≤ ¥100", "≤ ¥200", "≤ ¥300", "不限"]} selected={props.budget} onSelect={props.setBudget} />
        <label><span>02</span><div><b>最远单程通勤</b><small>从你出发的位置估算</small></div></label><ChipGroup values={["≤ 30 分钟", "≤ 45 分钟", "≤ 60 分钟", "不限"]} selected={props.commute} onSelect={props.setCommute} />
        <label><span>03</span><div><b>空间偏好</b><small>上海周六有阵雨</small></div></label><ChipGroup values={["室内优先", "户外优先", "都可以"]} selected={props.setting} onSelect={props.setSetting} />
      </div>
      <div className="natural-card"><div className="natural-head"><span>✦</span><div><b>还有什么想说的？</b><small>AI 只负责把人话整理成标签</small></div></div><textarea value={props.note} onChange={(e) => { props.setNote(e.target.value); props.setParsed(false); }} aria-label="自然语言偏好" /><button onClick={() => props.setParsed(true)}>理解这句话 <span>↗</span></button>{props.parsed && <div className="parsed-box"><div><span>✓</span><b>已理解，请确认</b></div><section><button>17:00 后到 <i>×</i></button><button>20:00 前离开 <i>×</i></button><button>不想排队 <em>偏好</em><i>×</i></button></section><p>没有把任何模糊偏好自动升级成底线。</p></div>}</div>
    </div>
    <button className="confirm-preference" onClick={props.onConfirm} disabled={!props.parsed}>确认并私密提交 <span>→</span></button>
  </section>;
}

function RankingScreen({ step }: { step: number }) {
  const rows = [{ n: "40", title: "候选已检索", detail: "上海精选活动与餐厅" }, { n: "25", title: "时间可行", detail: "排除 15 个营业或时长冲突" }, { n: "12", title: "全部底线满足", detail: "排除预算、通勤与室内外冲突" }, { n: "3", title: "共同可接受", detail: "正在计算 FairMix 公平共识分" }];
  return <section className="flow-page ranking-page"><div className="ranking-orbit"><span className="pulse-core">凑</span><i className="orbit-one" /><i className="orbit-two" /></div><div className="ranking-copy"><span>FAIRMIX CONSENSUS ENGINE</span><h1>正在求交集</h1><p>LLM 理解人话，确定性算法负责决定。不会凭空生成答案。</p></div><div className="ranking-funnel">{rows.map((row, i) => <div key={row.n} className={step > i ? "done" : step === i ? "active" : ""}><span>{step > i ? "✓" : i + 1}</span><strong>{step > i || step === i ? row.n : "—"}</strong><section><b>{row.title}</b><small>{row.detail}</small></section><em>{step > i ? "完成" : step === i ? "计算中" : "等待"}</em></div>)}</div><div className="ranking-privacy">⌾ 计算只使用匿名效用分，私人原文不会进入结果解释</div></section>;
}

function ResultsScreen({ vetoed, decision, onDecision, onVeto, onLock }: { vetoed: boolean; decision: "" | "accept" | "okay"; onDecision: (d: "accept" | "okay") => void; onVeto: () => void; onLock: () => void }) {
  const main = vetoed ? { name: "谜盒沉浸剧场", score: 86, emoji: "MYST", price: "¥168/人", travel: "最远 32 分钟", time: "17:15 到店", why: "满足所有人的时间和预算底线；新增“安静环境”约束后仍保持较高兴趣交集。", color: "purple" } : { name: "极速卡丁车馆", score: 88, emoji: "KART", price: "¥178/人", travel: "最远 38 分钟", time: "17:00 到店", why: "满足全部时间和预算底线；四人最低个人匹配仍为 76；室内不受降雨影响。", color: "orange" };
  return <section className="flow-page results-page"><div className="result-heading"><div><span>✦ 找到共同可接受方案</span><h1>{vetoed ? "已根据新底线重排" : "你们的交集，比想象中大"}</h1><p>{vetoed ? "“太吵”已作为本次强约束，其他人的私人输入仍未公开。" : "40 个真实候选经过硬约束过滤和公平共识排序。"}</p></div><div className="verified-badge"><i>✓</i><span>全部硬约束<small>已核验</small></span></div></div>
    <div className="result-layout"><article className="winner-card"><div className={`winner-art ${main.color}`}><div className="rank-ribbon">TOP 1 · 推荐</div><b>{main.emoji}</b><span>上海 · 静安区</span></div><div className="winner-body"><div className="winner-title"><div><span>共同可接受方案</span><h2>{main.name}</h2></div><div className="group-score"><strong>{main.score}</strong><span>GROUP FIT<small>会话内公平分</small></span></div></div><div className="facts-row"><span><i>◷</i><b>{main.time}</b><small>周六 · 约 2 小时</small></span><span><i>¥</i><b>{main.price}</b><small>低于全员预算上限</small></span><span><i>⌖</i><b>{main.travel}</b><small>通勤差异仅 9 分钟</small></span></div><div className="why-box"><span>为什么是它？</span><p>{main.why}</p></div><div className="checks"><span><i>✓</i>时间满足 4/4</span><span><i>✓</i>预算满足 4/4</span><span><i>✓</i>最低匹配 {vetoed ? "74" : "76"}</span><span><i>✓</i>关键事实已更新</span></div></div></article>
      <aside className="response-panel"><div className="response-head"><span>全员确认</span><b>{decision ? "4/4" : "3/4"}</b></div><div className="mini-people">{["N","L","M","J"].map((p,i) => <div key={p} className={i < 3 || decision ? "accepted" : "waiting"}><span>{p}{(i < 3 || decision) && <i>✓</i>}</span><small>{i < 3 ? "已接受" : decision ? (decision === "accept" ? "已接受" : "可接受") : "等待你"}</small></div>)}</div>{!decision ? <><p>你的选择不会展示原因，只有结果状态对小组可见。</p><button className="accept-button" onClick={() => onDecision("accept")}>✓ 接受这个方案</button><button className="okay-button" onClick={() => onDecision("okay")}>可以接受</button><button className="veto-button" onClick={onVeto}>否决并说明原因</button></> : <><div className="all-accepted"><span>✓</span><b>全员已确认</b><small>没有人被落下，可以锁定了</small></div><button className="lock-button" onClick={onLock}>锁定方案 <span>→</span></button></>}</aside>
    </div>
    <div className="alternatives"><div><span>其他可行方案</span><small>比较权衡，不隐藏备选</small></div><article><b>#2</b><span>{vetoed ? "泥作陶艺工坊" : "谜盒沉浸剧场"}<small>{vetoed ? "更安静 · ¥158/人" : "更近 · ¥168/人"}</small></span><strong>{vetoed ? "82" : "86"}</strong></article><article><b>#3</b><span>META 桌游社<small>更便宜 · ¥88/人</small></span><strong>81</strong></article></div>
  </section>;
}

function LockedScreen({ vetoed, onCalendar, onReset, onShare }: { vetoed: boolean; onCalendar: () => void; onReset: () => void; onShare: () => void }) {
  const name = vetoed ? "谜盒沉浸剧场" : "极速卡丁车馆";
  return <section className="flow-page locked-page"><div className="locked-burst"><span>✓</span></div><div className="locked-title"><span>PLAN LOCKED</span><h1>就这么定了！</h1><p>所有人都确认接受，接下来只管出发。</p></div><article className="action-card"><div className="action-map"><div className="map-grid" /><span className="map-pin">凑</span><i>南京西路</i><i>静安寺</i></div><div className="action-content"><div className="action-date"><strong>22</strong><span>八月<small>周六</small></span></div><div className="action-name"><span>本次共同决定</span><h2>{name}</h2><p>上海市静安区威海路 696 号</p></div><div className="locked-score">{vetoed ? "86" : "88"}<small>GROUP FIT</small></div><div className="action-facts"><span><i>◷</i><b>17:00 集合</b><small>活动约 2 小时</small></span><span><i>¥</i><b>{vetoed ? "¥168/人" : "¥178/人"}</b><small>现场各自支付</small></span><span><i>⌖</i><b>距你 28 分钟</b><small>地铁 2 号线</small></span></div><div className="action-buttons"><button onClick={() => window.open("https://uri.amap.com/navigation?to=121.462,31.226,威海路696号&mode=transit", "_blank")}>⌖ 开始导航</button><button onClick={onCalendar}>＋ 加入日历</button><button onClick={onShare}>↗ 分享行动卡</button></div></div></article><div className="locked-people">{["Nina","Leo","Mia","Jay"].map((p) => <span key={p}><i>{p[0]}</i>{p}<b>✓</b></span>)}</div><p className="final-privacy">只保存这次决定？ <button>偏好学习设置</button></p><button className="restart-button" onClick={onReset}>重新体验 Demo ↺</button></section>;
}
