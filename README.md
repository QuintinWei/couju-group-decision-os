# 凑局 Couju — Group Decision OS

> 把群聊里的“都行”，变成马上能执行的共同决定。

[在线体验 Interactive Demo](https://couju-demo.quintinwei1314.chatgpt.site/) · 2–6 人本地聚餐 / 活动决策 · 移动端与桌面端均可体验

## 演示视频

https://github.com/user-attachments/assets/009544ca-8dd0-47e0-9569-3797646de0a3

> 点击播放器即可在线观看 45 秒完整产品演示。

## 作品简介

凑局是一款 AI 群体决策产品。它不是再给一个人生成一份推荐清单，而是帮助 2–6 个人在预算、时间、距离、忌口和兴趣不同的情况下，快速找到一个“所有硬约束都满足、没有人明显被牺牲”的共同方案。

核心闭环：

```text
创建房间 → 分享链接 → 真实成员加入 → 各自滑卡与表达偏好
→ AI 理解字段 → 共同底线过滤 → Pareto + Nash 公平排序 → 锁定行动卡
```

## 可交互 Demo

打开：[https://couju-demo.quintinwei1314.chatgpt.site/](https://couju-demo.quintinwei1314.chatgpt.site/)

推荐演示路径：

1. 点击「体验完整决策」。
2. 选择「一起聚餐」或「周末活动」。
3. 修改城市、日期、开始 / 结束时间和 2–6 人规模。
4. 复制房间链接，用另一个浏览器或设备以朋友身份加入。
5. 每位成员独立滑卡，设置预算、通勤和饮食 / 空间底线，并输入一句自然语言偏好。
6. 查看 DeepSeek 结构化字段，确认后提交到同一个房间。
7. 至少两位真实成员完成后，启动公平求交集。
8. 对比「最佳平衡 / 最公平 / 最省事」三类方案和每位成员满意度。
9. 锁定方案，体验地图、日历与房间分享。

当前 Demo 包含：

- 上海、北京、深圳、杭州、成都、广州六城地点接口；
- 城市、日期、时间窗与人数的真实表单交互；
- 聚餐与活动两套完全独立的候选和结果链路；
- 16 个带场景图片的本地候选；
- 鼠标 / 触摸滑卡与按钮双交互；
- 可分享的持久化多人房间、独立成员身份与 4 秒同步；
- DeepSeek V4 Flash 字段抽取与结果解释，以及失败时的规则降级；
- 成员出发区域通过高德地理编码参与通勤估算；
- 滑卡、预算、通勤、时间和确认字段真正参与过滤与公平排序；
- 否决、动态重排和三类可解释结果；
- 最终行动卡、地图导航和 `.ics` 日历文件生成。

## 为什么这是 AI 产品，而不只是投票工具

AI 负责理解低成本、非结构化的人类表达，并把它整理成可确认的结构化约束；最终决定不交给语言模型“凭感觉”生成，而由可测试、可复现的确定性算法完成。

| 模块 | 方法 | 作用 |
|---|---|---|
| Preference Extractor | DeepSeek JSON Output + 校验 | 把“我 17 点后才到，不想排队”抽取为时间硬约束和排队软偏好 |
| Candidate Retriever | 高德 POI / 明示演示回退 | 返回地点 ID、地址、坐标、来源与更新时间；失败时不伪装实时数据 |
| Room Coordinator | D1 持久化房间 | 保存真实成员、独立提交与候选快照，让分享链接跨设备可用 |
| Feasibility Checker | 确定性规则 | 任一成员明确拒绝或触发预算、时间、距离底线时排除候选 |
| FairMix Engine | Pareto + Nash + 最低满意度 | 先保护最不满意成员，再最大化群体乘积福利 |
| Evidence Writer | DeepSeek + 确定性回退 | 只解释算法已经产生的名次，无权改写名次或补造地点事实 |
| Action Connector | 地图 / 日历深链 | 把推荐变成现实行动 |

详细 Prompt、输入 / 输出和降级策略见 [AI 工作流说明](docs/AI_WORKFLOW.md)。

## AI 工作流示例

用户输入：

```text
我 17:00 后才到，晚上 8 点前得走，不想排队。
```

结构化输出：

```json
{
  "hard_constraints": [
    { "type": "arrival_after", "value": "17:00", "confidence": 0.99 },
    { "type": "leave_before", "value": "20:00", "confidence": 0.99 }
  ],
  "soft_preferences": [
    { "feature": "queue_time", "direction": "minimize", "weight": 0.7, "confidence": 0.82 }
  ],
  "needs_confirmation": true
}
```

用户确认标签后，硬约束进入候选过滤，软偏好进入个人效用计算；模型无权自行把软偏好升级为硬约束。

## FairMix 公平共识

普通投票容易让多数人的最爱变成少数人的雷区。凑局先淘汰违反任意成员硬约束的候选，再综合：

```text
若存在最低满意度 ≥ 60 的候选：
Score = 0.35 × 最低个人效用 + 0.55 × Nash 几何均值 + 0.10 × 平均效用

否则：
Score = 0.65 × 最低个人效用 + 0.25 × Nash 几何均值 + 0.10 × 平均效用

最后扣除数据不确定性，并优先保留 Pareto 前沿候选。
```

`Group Fit` 只用于同一会话内排序，不包装成“成功概率”。

## 隐私与可信度

- 房间通过随机房间号和设备成员令牌工作，不要求注册。
- 成员令牌只保存在各自设备，服务端仅保存哈希；出发地只要求地铁站或商圈，不要求精确住址。
- 过敏、无障碍、明确时间等硬约束不会被平均分抵消。
- 无可行候选时不伪造答案，而是明确进入“调整底线”状态。
- Prompt 和 Schema 需要版本化；算法结果可回放、可测试。

## 数据模式与实现边界

为了保证作品展示无需 API Key、网络波动时仍可完整体验，系统有两层明确模式：

- 配置 `DEEPSEEK_API_KEY`：服务端默认直连 DeepSeek 官方并调用 `deepseek-v4-flash`，返回 JSON 字段后经代码白名单校验；失败时使用本地规则抽取。
- 配置 `AMAP_WEB_SERVICE_KEY`：六城通过高德地点搜索 2.0 获取 POI；失败时使用明确标注的演示候选。
- DeepSeek 负责字段理解和结果解释；FairMix 始终由确定性函数执行，不由语言模型决定名次。
- 高德地理编码把成员填写的地铁站 / 商圈转换为大致坐标，当前通勤分使用距离估算，不冒充实时公交或驾车路线。

## 技术栈

- Next.js / React 19 / TypeScript
- Vinext + Cloudflare Runtime
- 原生 CSS 响应式界面
- 本地结构化候选数据与图片资源
- DeepSeek Chat Completions JSON Output
- 高德地点搜索 2.0
- Cloudflare D1 持久化多人房间
- Node Test + production build verification

## 本地运行

要求 Node.js `>= 22.13.0`。

```bash
npm install
npm run dev
```

可选服务端配置见 `.env.example`：

```text
DEEPSEEK_API_KEY=
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_TIMEOUT_MS=45000
AMAP_WEB_SERVICE_KEY=
```

构建与验证：

```bash
npm run build
npm test
```

## 项目结构

```text
app/page.tsx              完整交互状态机与数据透明度界面
app/api/preferences/      DeepSeek 字段抽取与规则降级
app/api/candidates/       高德 POI 检索与演示候选回退
app/api/rooms/            持久化房间创建与同步
app/api/members/          真实成员加入与独立偏好提交
app/api/explain/          DeepSeek 对确定性结果做受约束解释
db/                       D1 房间与成员 Schema
lib/couju.ts              候选模型、规则抽取与 FairMix 纯函数
app/globals.css           Apple-inspired 响应式视觉系统
public/candidates/        聚餐与活动场景图片
docs/AI_WORKFLOW.md       AI 架构、Prompt、输入 / 输出、降级策略
tests/                    构建与页面渲染测试
```

## 项目状态

当前版本已经是可跨设备体验的真实多人 MVP：房间、成员、AI 字段理解、高德候选与公平排序形成完整闭环。下一阶段重点是接入高德实时路线矩阵，以及商户营业 / 订座能力。
