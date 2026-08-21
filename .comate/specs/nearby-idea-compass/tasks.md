# 附近灵感罗盘：推荐、定位与城市联动改造任务清单

- [x] Task 1: 更新候选兴趣模型与演示候选
    - 1.1: 在 `/Users/weiqingshuai/Documents/couju-group-decision-os/lib/couju.ts` 中将“云南菜”替换为“云贵菜”。
    - 1.2: 增加“东北菜”“川湘菜”“江西菜”和“东南亚菜”聚餐兴趣，并为全部新/改名兴趣补充演示候选模板。
    - 1.3: 增加展示名称为“景点”的周末活动兴趣和演示候选模板。
    - 1.4: 保持活动兴趣池的跨类别采样，不再把景点从普通活动候选中强制排除或设为只能主动选择的类别。
    - 1.5: 保持 `Candidate` 类型、候选来源标识、图片回退和既有 FairMix 排序接口兼容。

- [x] Task 2: 调整实时与演示候选召回边界
    - 2.1: 在 `/Users/weiqingshuai/Documents/couju-group-decision-os/app/api/candidates/route.ts` 中移除按 POI 名称过滤景点的特殊分支。
    - 2.2: 让普通活动与景点使用同一套兴趣分桶轮询和候选数量控制，确保默认推荐有类别多样性而不是全部推荐景点。
    - 2.3: 修正演示回退的 focused 过滤，保证选择东北菜、川湘菜、云贵菜、江西菜、东南亚菜或景点时优先返回匹配类型。
    - 2.4: 保留跨兴趣分桶轮询、`avoid`、`exclude`、分页、随机种子和 `learn` 反馈召回行为。
    - 2.5: 验证默认活动的多类别结果、景点倾向和全部新聚餐倾向的 API 返回结果。

- [x] Task 3: 改进定位服务与支持城市识别
    - 3.1: 在 `/Users/weiqingshuai/Documents/couju-group-decision-os/lib/amap.ts` 中从逆地理编码的城市、省份和区县字段识别六个支持城市。
    - 3.2: 扩展 `locateFromBrowser` 返回 `city: CityName | null`，规范化“北京市”等行政名称，并处理数组字段。
    - 3.3: 在高德 Key 缺失、请求失败、超时或逆地理响应无效时，返回经纬度范围有效且降低精度的当前位置兜底，不伪造城市。
    - 3.4: 在 `/Users/weiqingshuai/Documents/couju-group-decision-os/app/api/location/route.ts` 中透传定位城市并保持现有输入坐标校验、手动地点解析和错误状态码。
    - 3.5: 确保无效坐标不覆盖有效定位，所有定位分支都能结束且不会遗留加载状态。

- [x] Task 4: 在前端接入定位城市自动切换与错误提示
    - 4.1: 在 `/Users/weiqingshuai/Documents/couju-group-decision-os/app/page.tsx` 的创建者定位流程中接收服务端返回的 `city`。
    - 4.2: 定位识别到支持城市时自动更新 `config.city`，同步城市下拉框且不清空刚取得的坐标。
    - 4.3: 定位城市不在支持范围时保留当前城市、继续使用有效坐标，并明确提示用户。
    - 4.4: 按权限拒绝、系统不可用、超时和未知错误显示可操作的中文提示，保留手动输入入口。
    - 4.5: 更新加入房间页定位失败提示，但不改变已有房间城市配置。
    - 4.6: 删除创建页说明卡中“划卡后，换一批会参考你的真实反馈。”，保留其他说明和实际反馈逻辑。

- [x] Task 5: 更新测试与产品说明
    - 5.1: 在 `/Users/weiqingshuai/Documents/couju-group-decision-os/tests/couju-core.test.mjs` 增加全部新聚餐兴趣、景点兴趣和演示候选的核心断言。
    - 5.2: 在 `/Users/weiqingshuai/Documents/couju-group-decision-os/tests/rendered-html.test.mjs` 调整不应固定候选数量的断言，并验证文案、兴趣和定位城市联动代码。
    - 5.3: 增加默认活动保持多类别、不会全部变成景点，以及主动选择景点可返回景点的接口测试。
    - 5.4: 更新 `/Users/weiqingshuai/Documents/couju-group-decision-os/README.md` 和 `/Users/weiqingshuai/Documents/couju-group-decision-os/docs/AI_WORKFLOW.md` 的聚餐类别、活动类别、景点采样和定位自动切城说明。
    - 5.5: 执行 `npm run lint` 和不读取本地真实密钥的生产构建测试，修复类型、渲染或行为回归。

- [x] Task 6: 完成变更复核
    - 6.1: 检查 diff，确认 API Key 未进入源代码、测试、README 或 Git 跟踪文件。
    - 6.2: 手动验证创建页、定位、城市自动切换、聚餐兴趣和周末景点选择的完整流程。
    - 6.3: 确认既有房间、成员加入、滑卡反馈、换一批和公平排序流程未被破坏。
    - 6.4: 确认测试通过、工作区只包含本次需求文件，并更新顶层复选框状态。
