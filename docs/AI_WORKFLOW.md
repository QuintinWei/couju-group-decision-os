# 凑局 AI 工作流与 Prompt 说明

本文用于作品评审、技术沟通和无法稳定访问外部模型时的效果展示。它描述生产目标架构；公开 Demo 使用相同输入 / 输出契约的本地回退，确保无需 API Key 也能完整体验。

## 1. 系统目标

AI 不直接决定“去哪”。AI 只承担两类适合语言模型的任务：

1. 把成员的自然语言整理为可确认的硬约束和软偏好；
2. 把确定性算法的证据转为简洁、不泄露隐私的结果解释。

最终候选过滤、个人效用计算、公平排序、重排和锁定条件均由代码控制。

## 2. 端到端工作流

```text
房间配置（城市 / 日期 / 时间 / 人数 / 类型）
                    +
成员输入（滑卡 / 标签 / 一句话）
                    ↓
       Preference Extractor（LLM）
                    ↓
      JSON Schema 校验 + 用户回显确认
                    ↓
          候选检索与事实校验
                    ↓
        硬约束过滤 + Pareto 过滤
                    ↓
          FairMix 确定性公平排序
                    ↓
       Explanation Writer（LLM，只读证据）
                    ↓
     接受 / 可接受 / 否决重排 / Plan Locked
                    ↓
             导航 / 日历 / 分享
```

## 3. Prompt A：Preference Extractor

### System Prompt

```text
你是凑局的 Preference Extractor。你的唯一任务是把用户关于本次聚餐或活动的自然语言，转换为结构化候选约束。

规则：
1. 不推荐地点，不做最终决策。
2. 只有用户明确表达不可违反的条件，才能标记为 hard_constraint。
3. “最好、希望、不想、尽量”等默认属于 soft_preference，除非上下文明示是底线。
4. 时间、货币和距离统一格式；不要补全用户没有说过的值。
5. 过敏、无障碍和明确离场时间属于高风险字段，必须请求用户确认。
6. 遇到歧义时设置 needs_confirmation=true，并生成最多一个 clarification_question。
7. 不推断政治、宗教、收入、健康诊断等敏感属性。
8. 只输出符合给定 JSON Schema 的 JSON，不输出解释性段落。
```

### 输入

```json
{
  "decision_type": "local_activity",
  "city": "上海",
  "date": "2026-08-22",
  "room_time_window": { "start": "15:00", "end": "22:00" },
  "utterance": "我 17:00 后才到，晚上 8 点前得走，不想排队。"
}
```

### 输出

```json
{
  "hard_constraints": [
    {
      "type": "arrival_after",
      "value": "17:00",
      "confidence": 0.99,
      "evidence": "我 17:00 后才到"
    },
    {
      "type": "leave_before",
      "value": "20:00",
      "confidence": 0.99,
      "evidence": "晚上 8 点前得走"
    }
  ],
  "soft_preferences": [
    {
      "feature": "queue_time",
      "direction": "minimize",
      "weight": 0.7,
      "confidence": 0.82,
      "evidence": "不想排队"
    }
  ],
  "needs_confirmation": true,
  "clarification_question": null
}
```

### 用户回显

模型输出不会直接进入排名，界面先展示可编辑标签：

```text
17:00 后到   20:00 前离开   不想排队（偏好）
```

只有用户点击「确认并私密提交」后，本次会话才使用这些信号。

## 4. Prompt B：聚餐场景输入 / 输出

### 输入

```text
我不太能吃辣，最好安静一点，想坐下来好好聊。人均 150 左右。
```

### 结构化输出示意

```json
{
  "hard_constraints": [
    {
      "type": "spice_level",
      "operator": "lte",
      "value": "mild",
      "confidence": 0.91
    }
  ],
  "soft_preferences": [
    {
      "feature": "noise_level",
      "direction": "minimize",
      "weight": 0.75,
      "confidence": 0.88
    },
    {
      "feature": "conversation_friendly",
      "direction": "maximize",
      "weight": 0.65,
      "confidence": 0.84
    },
    {
      "feature": "price_per_person",
      "target": 150,
      "currency": "CNY",
      "weight": 0.55,
      "confidence": 0.78
    }
  ],
  "needs_confirmation": true,
  "clarification_question": "“不太能吃辣”是完全不吃辣，还是微辣可以？"
}
```

## 5. FairMix Engine

### 5.1 硬约束过滤

对参与者 `i` 和候选 `c` 定义：

```text
H_i(c) ∈ {0, 1}
Feasible(c) = ∏ H_i(c)
```

只有 `Feasible(c) = 1` 的候选进入排序。过敏、无障碍、明确时间窗等条件不能被高平均分抵消。

### 5.2 个人效用

```text
u_i(c) = 0.55 × SessionSignal
       + 0.30 × SoftPreferenceMatch
       + 0.15 × LongTermProfile
```

对证据不足的新用户做中性回缩：

```text
adjusted_u = confidence × u + (1 - confidence) × 0.5
```

### 5.3 公平排序

```text
Score(c) = 0.40 × MinUtility
         + 0.30 × GeoMean
         + 0.20 × MeanUtility
         + 0.10 × (1 - MaxRegret)
         - 0.10 × Uncertainty
```

权重设计优先保护最不满意的人，同时避免一个极端低分被整体均值掩盖。

## 6. Prompt C：Explanation Writer

### System Prompt

```text
你是凑局的结果解释器。你只能根据输入的候选事实、群体聚合指标和算法得分分解解释结果。

规则：
1. 不改变排名，不创造价格、营业时间、通勤或排队事实。
2. 不提及成员姓名，不复述任何成员的原始私人文本。
3. 只使用“满足全部底线”“群体兴趣较高”等群体级表达。
4. Group Fit 是会话内排序分，不写成成功概率。
5. 若关键事实不确定，必须明确标注“需确认”。
6. 输出一条不超过 70 个汉字的主解释和最多 4 个证据标签。
```

### 输入

```json
{
  "candidate": {
    "name": "山野云南菜",
    "price_per_person": 148,
    "supports_non_spicy": true,
    "conversation_friendly": true
  },
  "group_aggregate": {
    "time_feasible": "4/4",
    "budget_feasible": "4/4",
    "min_utility": 0.82,
    "max_travel_minutes": 28
  },
  "ranking": {
    "rank": 1,
    "group_fit": 91
  }
}
```

### 输出

```json
{
  "summary": "可做不辣、预算满足全员底线；环境适合多人聊天，最低个人匹配仍有 82。",
  "evidence_labels": [
    "时间满足 4/4",
    "预算满足 4/4",
    "最低匹配 82",
    "最远通勤 28 分钟"
  ]
}
```

## 7. 否决与重排

成员否决时必须提交结构化原因。原因只影响本次会话：

```text
否决“太辣”
→ 将 spice_level ≤ mild 加入本次约束
→ 移除当前候选
→ 重新执行硬约束过滤、Pareto 过滤与 FairMix
→ 生成新的 Top 3
```

最多自动重排两轮，之后展示两个明确权衡，避免无限循环。

## 8. 无解时的澄清

若没有候选满足全部硬约束，系统不强行给出答案：

1. 找出造成空集的最小约束组合；
2. 排除过敏、无障碍等不可妥协项；
3. 计算一次最小成本放宽可新增多少候选；
4. 只向约束拥有者私密询问一个问题；
5. 得到明确同意后再重算。

示例：

```text
如果单程通勤从 30 分钟放宽到 38 分钟，会新增 5 个满足其他底线的选项。仅本次放宽吗？
```

## 9. 可靠性与回退

| 故障 | 回退策略 |
|---|---|
| LLM 不可用 | 使用显式标签和关键词规则，不解析自由文本 |
| 输出不符合 Schema | 丢弃输出并要求用户手动确认，不静默猜测 |
| 地点 API 不可用 | 使用带更新时间的本地候选，不声称实时可订 |
| 解释模型不可用 | 用算法证据模板生成解释 |
| 实时同步失败 | 轮询房间状态 |
| 无可行候选 | 进入最小冲突澄清，不生成虚假 Top 1 |

## 10. 当前公开 Demo 与生产版本的边界

公开 Demo 已实现完整前端状态机、场景分流、滑卡、结构化约束确认、候选过滤动画、结果解释、否决重排、锁定、导航和日历动作。

为保证任何评委无需登录或 API Key 都能稳定体验：

- 候选为本地精选演示数据；
- Preference Extractor 使用预置输出模拟 Schema 合约；
- FairMix 过程与结果使用可复现的确定性演示数据；
- 地图通过深链打开，日历由浏览器生成 `.ics` 文件。

生产版本会把本文件中的 Prompt 和 Schema 接入服务端 LLM Gateway，并将 FairMix 独立为带版本号和测试的纯函数模块。
