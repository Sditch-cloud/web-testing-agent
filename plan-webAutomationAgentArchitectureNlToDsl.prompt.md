## Plan: Web测试Agent精简落地（含NL->DSL）

以该仓库的已验证编排模式为蓝本，新增“自然语言测试用例 -> 测试DSL -> 执行计划”的中间层，形成五个核心能力：主循环、DSL转换、工具编排、任务状态、可恢复会话。执行层采用有界状态机（固定步骤 + 有限转移）而非开放式无限循环。目标是在 2 周内交付可运行的 AI Web 自动化测试 Agent 核心框架，并确保测试语义可复现、可审计。

**Steps**
1. 阶段一（核心抽象，D1-D2）: 建立最小领域模型与会话状态快照。定义 Message、Tool、Task、Session，并新增 TestCaseDsl、StepDsl、AssertionDsl 类型；定义主循环输入输出契约。*与步骤2并行*
2. 阶段一（持久化基础，D1-D2）: 建立 transcript 与会话恢复存储，新增 DSL 版本化存储（原始自然语言、解析后DSL、修订记录）。*与步骤1并行*
3. 阶段二（NL->DSL 转换层，D3-D5）: 实现 TestCaseCompiler：将自然语言测试用例规范化为 DSL AST；包含术语归一化、步骤拆分、前置条件提取、断言提取、歧义标注与置信度。输出 compile report（warnings/errors）。*依赖步骤1-2*
4. 阶段二（DSL校验与扩展，D5-D6）: 实现 DSL Validator 与 Macro Expander。校验字段完整性、步骤可执行性、断言合法性；将高阶语句（如“登录并下单”）展开为原子步骤。*依赖步骤3*
5. 阶段三（任务生命周期，D6-D7）: 实现任务注册、状态迁移与终止控制（pending/running/completed/failed/killed），并关联 DSL 执行游标（当前步骤索引、重试计数、失败片段）。*依赖步骤3-4*
6. 阶段四（浏览器工具 MVP，D7-D9）: 落地 Navigate/Click/Fill/Screenshot 四个工具，约束返回结构化证据（URL、选择器、截图路径、断言结果片段），并支持 DSL step 到工具调用参数映射。*依赖步骤4*
7. 阶段五（工具运行时，D9-D11）: 实现工具分区执行器（并发安全工具批并行，非并发安全串行），并将工具结果按 DSL step_id 回填主循环与 artifact。*依赖步骤5-6*
8. 阶段六（主循环最小化，D11-D12）: 实现 queryLoop 最小闭环：NL输入 -> DSL编译/校验 -> 生成 tool_use -> 执行工具 -> 生成 tool_result -> DSL断言判定。采用 step_cursor 从 1..N 推进，并约束每步仅允许 success/retry(k上限)/skip/fail-fast 的有限转移；等待类动作使用局部小循环（timeout + max attempts）。*依赖步骤7*
9. 阶段七（策略与守护，D13-D14）: 加入 token/cost 预算硬阈值、超时与中断处理、错误归因与可重试标记；对 DSL 编译失败提供可解释错误与建议修订。*依赖步骤8*
10. 阶段八（端到端验收，D14-D15）: 跑通“自然语言测试用例 -> DSL -> 执行 -> 验证 -> 报告”链路，验证中断恢复与重复执行稳定性。*依赖步骤8-9*

**Relevant files**
- ~/claude-code-main/src/QueryEngine.ts — 参考会话生命周期与 submitMessage 编排入口
- ~/claude-code-main/src/query.ts — 参考 queryLoop 状态机与轮次推进
- ~/claude-code-main/src/services/tools/toolOrchestration.ts — 参考并发/串行工具分区与执行策略
- ~/claude-code-main/src/tools/AgentTool/AgentTool.tsx — 参考 Agent 启动与异步任务分支
- ~/claude-code-main/src/tools/AgentTool/runAgent.ts — 参考“子Agent复用同一query内核”的实现方式
- ~/claude-code-main/src/tasks/LocalAgentTask/LocalAgentTask.tsx — 参考任务进度、通知与终态管理
- ~/claude-code-main/src/tools/SendMessageTool/SendMessageTool.ts — 参考运行中队列投递与停止后恢复继续
- ~/claude-code-main/src/utils/swarm/backends/InProcessBackend.ts — 参考单进程 teammate 执行模型（可后续扩展）
- 新增模块（目标项目）: orchestrator/TestCaseCompiler.ts、orchestrator/DslValidator.ts、types/TestDsl.ts、artifact-store/DslSnapshotStore.ts

**Verification**
1. 类型层: tsc --noEmit 全绿，核心类型在 orchestrator/tool-runtime/task-store 之间无循环依赖。
2. DSL转换层: 给定自然语言用例，编译结果产出稳定 DSL（含 step_id、action、target、assertions）且可重复。
3. DSL校验层: 非法 DSL（缺 target、断言语法错误、未知 action）能被准确拦截并返回可解释错误。
4. 工具层: 对 Navigate/Click/Fill/Screenshot 进行真实浏览器集成测试，要求每个工具返回结构化证据并绑定 step_id。
5. 循环层: 单轮与多轮 queryLoop 测试，检查 tool_use 与 tool_result 成对出现，DSL 执行游标正确推进，且状态转移严格受限在 success/retry/skip/fail-fast。
6. 稳定性: 注入超时、网络错误、手动中断，验证任务状态与 DSL 游标都可恢复继续。
7. 端到端: 跑通最小场景并生成测试报告（原始自然语言、编译后DSL、执行轨迹、证据路径、错误摘要）。

**Decisions**
- 包含范围: 单进程编排、NL->DSL 编译与校验、浏览器工具 MVP、任务与会话恢复、预算守护。
- 排除范围: swarm 团队协作、remote worker、worktree 隔离、复杂 feature gate 与 MCP 全量接入。
- 关键取舍: 优先保证测试语义可复现（DSL可审计）与执行闭环可恢复，而非能力面最全。
- DSL策略: 首版采用“受限指令集 DSL”（声明式步骤 + 有限动作词表），避免一开始做过度复杂的通用语言。
- 执行策略: 固定步骤场景下采用“有界状态机”替代开放式循环，保留必要的重试与恢复能力，同时避免无限迭代风险。

**Further Considerations**
1. DSL形态选择: 先用 JSON AST（机器友好）+ Markdown 视图（人工审阅），后续再考虑纯文本DSL。
2. 编译策略: 先 rule-based 归一化 + LLM 辅助补全，后续再引入语义检索增强。
3. 报告格式: 先出 JSON + 简版 Markdown，后续再接入可视化报告。
4. 失败重试策略: 首版固定次数重试，后续升级为按错误类型自适应重试。