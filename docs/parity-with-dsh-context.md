# 与 dsh-context 的对齐说明

参考实现：[`bowenliang123/dsh-context`](https://github.com/bowenliang123/dsh-context) 0.87（DeepSeek Harness 插件）。

两边的宿主不同：dsh-context 运行在 DeepSeek Harness 的扩展 API 之上，agy-context 运行在 Antigravity 的 sidecar + 语言服务接口之上。下表按能力逐项说明实现方式与差异。

## 已对齐

| 能力 | agy-context 实现方式 |
| --- | --- |
| 洞察 KPI（Token / 成本 / 缓存 / 会话 / 轮次 / 工具 / 时长） | 由 `conversation_summaries.db` + transcript 投影聚合 |
| 7 天用量与成本图 | 按每次请求的时间戳归因，Token 与成本成对柱状 |
| 8 周（56 天）热力图 | 按日聚合，点击日期筛选会话 |
| 技能 / 工具 / 命令排行 | 扫描 `SKILL.md` 加载、工具调用与 `run_command` 程序名 |
| 计费组成环形图 | 投影口径的 9~10 类拆分 |
| 会话卡片与四种排序 | 最近活跃 / Token / 上下文大小 / 成本，点击直达 |
| Context Stats / Token Stats / Timing Stats | 单会话接口 `/api/session` |
| Token Stats 工具定义与工具调用分列 | 官方 `promptSections` 与工具 schema 独立成桶 |
| 官方上下文快照 + 双窗口 | `GetCascadeTrajectoryGeneratorMetadata`：`estimatedTokensUsed` 与 `maxContextTokens` |
| 组合条与浏览器同口径 | `normalizeComposition` / `reconcileComposition` 共用同一分类函数 |
| 时间线 Step/Turn × Total/Delta/Overview | 由步骤序列重建累计与增量 |
| 事件旗标与步骤摘要 | 压缩（`CHECKPOINT`）、技能、切模型、错误、最慢、最大增长 |
| 浏览器分类 / 差异徽标 / Thinking-Tools-Answer / Raw-Markdown | 逐条 content block 渲染，`vs Prev Turn/Step` 比较 |
| DNA 色带 | 按模型读取顺序绘制并附倒序平铺列表 |
| 事件 / 文件活动 / 命令执行 | 从 transcript 提取，均可跳回对应步骤 |
| 编队（Agent 网络 / 泳道 / 任务 / 事件） | `/api/fleet` 基于会话元数据与委派消息还原 |

## 实现方式不同

| 能力 | dsh-context | agy-context |
| --- | --- | --- |
| 面板注册 | Harness 扩展点，可注册入口 | `sidecar.json` 静态注册两个视图（AUX_PANE / SIDEBAR），插件无法动态增减 |
| 子 Agent 谱系 | Host 提供 Teamwork Task API | 从 `conversation_summaries`（`agent_name` / `parent_conversation_id` / `nesting_depth`）与 `transcript.jsonl` 的 `invoke_subagent` / `send_message` 推断 |
| 任务状态 | 宿主任务模型（含依赖链） | 依据子 Agent 完成信号与最后一次回报推断，无 blocked-by |
| 单会话明细位置 | 左右两页均可带会话上下文 | 左侧全宽页 URL 不注入 `conversationId`，只能全局汇总；单会话在右侧面板 |
| 历史数据口径 | 宿主统计 | 跨会话页用投影缓存（`toolDefs` 记 0），单会话页用官方快照，差约 9% |

## 无法实现（宿主限制）

| 能力 | 原因 |
| --- | --- |
| 一键跳回指定对话 | sidecar 只暴露 `ui.toggleAuxPane` / `ui.toggleConversation`，没有“打开指定会话”的稳定接口；已移除该入口 |
| Pin / Lock to Main Agent | 依赖 Harness 的 `pinnedConversationId` / `lockToMainAgent`，Antigravity 无对应 API |
| `/context` 斜杠命令 | 斜杠列表由宿主固定（goal / compact / schedule / browser / plan / teamwork / learn / boost），插件无法注册 |
| 系统提示词前缀 / 后缀 | 插件不能改写宿主系统提示词；等价做法是项目 rules 或 `AGENTS.md` |
| 附件内置预览 | 只暴露 `/api/attachment` 图片接口，PDF / Office 只能显示元数据；需先确认是否存在未公开的文件协议 |

## 取舍

- **不伪造宿主动作**：无法稳定跳转的入口直接移除，避免“点了没反应”。
- **回退要可见**：语言服务不可用时，标题栏不再显示“官方快照”，窗口值标注为估算。
- **两侧口径分开**：全局汇总与单会话明细各自标注数据来源，不混用。
