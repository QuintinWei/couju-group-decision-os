# 凑局 Couju — Group Decision OS

> 把群聊里的“都行”，变成马上能执行的共同决定。

[在线体验 Interactive Demo](https://couju-demo.quintinwei1314.chatgpt.site/) · 2–6 人本地聚餐 / 活动决策 · 移动端与桌面端均可体验

> [!IMPORTANT]
> 当前项目用于作品集与 Demo 展示。代码已接入 DeepSeek JSON 字段抽取与高德 POI 检索接口，但公开环境只有在配置服务端 Key 后才启用；没有 Key 或接口失败时会明确显示“规则降级 / 演示候选”，不会伪装成实时数据。

## 演示视频

https://github.com/user-attachments/assets/009544ca-8dd0-47e0-9569-3797646de0a3

> 点击播放器即可在线观看 45 秒完整产品演示。

## 作品简介

凑局是一款 AI 群体决策产品。它不是再给一个人生成一份推荐清单，而是帮助 2–6 个人在预算、时间、距离、忌口和兴趣不同的情况下，快速找到一个“所有硬约束都满足、没有人明显被牺牲”的共同方案。

核心闭环：

```text
创建房间 → 私密滑卡 → AI 理解自然语言底线 → 硬约束过滤
→ FairMix 公平共识排序 → 全员接受 / 否决重排 → 锁定行动卡
```

## 可交互 Demo

打开：[https://couju-demo.quintinwei1314.chatgpt.site/](https://couju-demo.quintinwei1314.chatgpt.site/)

推荐演示路径：

1. 点击「体验完整决策」。
2. 选择「一起聚餐」或「周末活动」。
3. 修改城市、日期、开始 / 结束时间和 2–6 人规模。
4. 进入房间，查看候选来源并完成私密滑卡。
5. 设置预算、通勤和饮食 / 空间底线，并输入一句自然语言偏好。
6. 查看结构化标签回显，确认后启动 FairMix 求交集。
7. 查看 Top 3、Group Fit 与推荐依据。
8. 可直接接受，也可否决并选择原因，观察系统重排。
9. 全员确认后锁定方案，体验导航、日历与分享动作。

当前 Demo 包含：

- 上海首发、北京 / 深圳 / 杭州 / 成都 / 广州保留的六城地点接口；
- 城市、日期、时间窗与人数的真实表单交互；
- 聚餐与活动两套完全独立的候选和结果链路；
- 16 个带场景图片的本地候选；
- 鼠标 / 触摸滑卡与按钮双交互；
- DeepSeek V4 Flash JSON 字段抽取，以及无 Key 时的动态规则降级；
- 滑卡、预算、通勤、时间和确认字段真正参与候选过滤与 FairMix 排序；
- 推荐结果的数据来源、更新时间、分数拆解和待确认事实；
- 接受、可接受、否决、动态重排；
- 最终行动卡、地图导航和 `.ics` 日历文件生成。

## 为什么这是 AI 产品，而不只是投票工具

AI 负责理解低成本、非结构化的人类表达，并把它整理成可确认的结构化约束；最终决定不交给语言模型“凭感觉”生成，而由可测试、可复现的确定性算法完成。

| 模块 | 方法 | 作用 |
|---|---|---|
| Preference Extractor | DeepSeek JSON Output + 校验 | 把“我 17 点后才到，不想排队”抽取为时间硬约束和排队软偏好 |
| Candidate Retriever | 高德 POI / 明示演示回退 | 返回地点 ID、地址、坐标、来源与更新时间；失败时不伪装实时数据 |
| Feasibility Checker | 规则 | 校验时间、预算、距离、忌口等硬约束 |
| FairMix Engine | 确定性代码 | 保护最低个人效用，兼顾群体均值和最大后悔值 |
| Evidence Writer | 确定性证据模板 | 把得分分解与候选事实转成简短、不泄露个人输入的解释 |
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
Score = 0.40 × 最低个人效用
      + 0.30 × 几何平均效用
      + 0.20 × 平均效用
      + 0.10 × (1 - 最大后悔值)
      - 0.10 × 数据不确定性
```

`Group Fit` 只用于同一会话内排序，不包装成“成功概率”。

## 隐私与可信度

- 偏好、预算和忌口默认私密；小组只看到完成进度和群体结论。
- 结果解释只使用匿名群体汇总，不显示“谁导致了哪个限制”。
- 过敏、无障碍、明确时间等硬约束不会被平均分抵消。
- 无可行候选时不伪造答案，而是明确进入“调整底线”状态。
- Prompt 和 Schema 需要版本化；算法结果可回放、可测试。

## 数据模式与实现边界

为了保证作品展示无需 API Key、网络波动时仍可完整体验，系统有两层明确模式：

- 配置 `DEEPSEEK_API_KEY`：服务端通过可配置的 OpenAI-compatible 地址调用 `deepseek-reasoner`，返回 JSON 字段并经代码白名单校验；失败时使用本地规则抽取。
- 配置 `AMAP_WEB_SERVICE_KEY`：六城通过高德地点搜索 2.0 获取 POI；失败时使用明确标注的演示候选。
- FairMix 始终由本地确定性函数执行，不由语言模型决定推荐结果。

当前实时多人房间仍未接入，界面中的其他成员明确标注为演示样本。价格、营业时间、通勤估算和可订状态若证据不足，会显示“待确认”。

## 技术栈

- Next.js / React 19 / TypeScript
- Vinext + Cloudflare Runtime
- 原生 CSS 响应式界面
- 本地结构化候选数据与图片资源
- DeepSeek Chat Completions JSON Output
- 高德地点搜索 2.0
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
DEEPSEEK_API_BASE=https://api.openai-proxy.org/v1
DEEPSEEK_MODEL=deepseek-reasoner
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
lib/couju.ts              候选模型、规则抽取与 FairMix 纯函数
app/globals.css           Apple-inspired 响应式视觉系统
public/candidates/        聚餐与活动场景图片
docs/AI_WORKFLOW.md       AI 架构、Prompt、输入 / 输出、降级策略
tests/                    构建与页面渲染测试
```

## 项目状态

当前版本为可路演的可验证 MVP：真实服务接口已预留并可启用，核心推荐不再是固定结果。下一阶段重点是实时多人房间、真实路线时间与订座 / 可订状态。
