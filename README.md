# Web Testing Agent

> **自然语言 → 测试 DSL → 自动化执行** 的 AI Web 测试 Agent 核心框架

用一句话描述你的测试场景，Agent 将自动编译为结构化测试计划，驱动 Playwright 完成浏览器操作，并生成带有截图证据的测试报告。

```
"打开 https://example.com/login，输入用户名 admin，点击登录，验证出现欢迎页面"
        ↓  TestCaseCompiler (OpenAI)
  [navigate → input → click → assert → screenshot]
        ↓  testLoop (有界状态机)
  ✅ s1 navigate  ✅ s2 input  ✅ s3 click  ✅ s4 assert  ✅ s5 screenshot
        ↓
  📄 JSON 报告 + Markdown 摘要
```

---

## 目录

- [项目简介](#项目简介)
- [架构说明](#架构说明)
- [代码目录结构](#代码目录结构)
- [快速开始](#快速开始)
- [使用方式](#使用方式)
- [DSL 格式](#dsl-格式)
- [测试](#测试)

---

## 项目简介

Web Testing Agent 是一个面向 **可复现、可审计** Web 自动化测试的 AI Agent 框架，核心理念：

- **NL → DSL**：用自然语言描述测试意图，由 OpenAI 编译为结构化 JSON DSL（可保存、可版本化、可审查）
- **有界状态机执行**：每个测试步骤的状态转移严格限定在 `success / retry / skip / fail_fast`，杜绝无限循环
- **中断可恢复**：每步执行后持久化快照，重启后从中断处继续，无需重跑
- **结构化证据**：每个工具调用（导航、点击、填写、截图）都返回绑定了步骤 ID 的证据，便于调试与审计

### 技术选型

| 层次 | 技术 |
|------|------|
| 运行时 | Node.js 20+ + TypeScript 5（strict） |
| 浏览器自动化 | Playwright |
| LLM（编译层） | OpenAI API（gpt-4o，structured output） |
| DSL 校验 | Zod |
| 测试框架 | Vitest |
| DSL 存储 | JSON 文件（本地，按版本追加） |

---

## 架构说明

整体架构分为三个主要阶段：

```
┌─────────────────────────────────────────────────────────────┐
│  阶段一：编译  (src/orchestrator/)                           │
│                                                             │
│  自然语言输入                                                │
│      │                                                      │
│      ▼ TestCaseCompiler                                     │
│  TestCaseDsl (JSON AST)  ──→  DslSnapshotStore (持久化)     │
│      │                                                      │
│      ▼ DslValidator + MacroExpander                         │
│  验证通过的 DSL                                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  阶段二：执行  (src/orchestrator/testLoop.ts)                │
│                                                             │
│  for (step of dsl.steps)  ← 有界，不超过 steps.length       │
│      │                                                      │
│      ▼ BrowserToolExecutor                                  │
│  执行工具 (Navigate / Click / Fill / Screenshot / Assert)   │
│      │                                                      │
│      ▼ StepTransition                                       │
│  success → 下一步  retry → 重试(≤3次)  fail_fast → 终止     │
│      │                                                      │
│      ▼ SessionStore.save()  ← 每步快照（中断恢复基础）       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  阶段三：报告                                                │
│                                                             │
│  TestReport (JSON) + Markdown 摘要                          │
│  包含：步骤结果、证据路径、错误摘要、执行时长                │
└─────────────────────────────────────────────────────────────┘
```

### 核心设计原则

**有界状态机（Bounded State Machine）**

不同于通用 AI Agent 的开放式循环，本项目采用固定步骤数 + 有限转移的执行模型：

```
每个步骤只能产生以下四种转移之一：
  success   → 步进到下一步
  retry     → 停留在当前步（最多 MAX_RETRIES 次）
  skip      → 跳过当前步，继续下一步
  fail_fast → 终止整个测试
```

**工具串行执行**

浏览器是共享状态，所有工具均标记为 `isConcurrencySafe = false`，由 `BrowserToolExecutor` 保证串行执行，避免竞态问题。

**结构化证据**

每个工具调用返回绑定 `step_id` 的证据对象，例如：

```json
{
  "step_id": "s1",
  "tool_name": "navigate",
  "evidence": { "url": "https://example.com", "title": "首页", "load_time_ms": 312 },
  "success": true,
  "transition": "success"
}
```

---

## 代码目录结构

```
web-testing-agent/
│
├── src/
│   ├── types/                        # 核心类型定义（系统契约）
│   │   ├── TestDsl.ts                # TestCaseDsl / StepDsl / AssertionDsl
│   │   ├── Task.ts                   # TestRunState / StepArtifact / TestReport
│   │   └── Message.ts                # LLM 消息类型（编译层内部）
│   │
│   ├── orchestrator/                 # 编排层（编译 + 执行调度）
│   │   ├── TestCaseCompiler.ts       # 自然语言 → DSL（调用 OpenAI gpt-4o）
│   │   ├── DslValidator.ts           # DSL 合法性校验（字段 / 步骤 / 断言）
│   │   ├── MacroExpander.ts          # 高阶步骤展开为原子步骤（如"登录"宏）
│   │   └── testLoop.ts               # 主执行循环：有界状态机 + 快照持久化
│   │
│   ├── tools/                        # 浏览器工具层
│   │   ├── Tool.ts                   # 基础工具接口（name / inputSchema / execute）
│   │   ├── NavigateTool.ts           # page.goto() → 返回 url / title / load_time_ms
│   │   ├── ClickTool.ts              # page.click() → 返回 selector / element_text
│   │   ├── FillTool.ts               # page.fill()  → 返回 selector / filled_value
│   │   └── ScreenshotTool.ts         # page.screenshot() → 返回截图路径 / timestamp
│   │
│   ├── executor/
│   │   └── BrowserToolExecutor.ts    # 串行执行器：retry / timeout / abort / 证据回填
│   │
│   ├── store/
│   │   ├── DslSnapshotStore.ts       # DSL 版本化存储（按 test_id 追加修订记录）
│   │   └── SessionStore.ts           # 任务状态快照（支持中断后恢复继续）
│   │
│   └── index.ts                      # CLI 入口（编译 → 校验 → 执行 → 报告）
│
├── tests/
│   ├── unit/
│   │   ├── DslValidator.test.ts      # 10 个校验规则测试
│   │   ├── MacroExpander.test.ts     # 宏展开测试
│   │   └── testLoop.test.ts          # 状态机执行 / 快照 / 恢复测试
│   └── e2e/                          # 端到端测试（需要真实浏览器 + OPENAI_API_KEY）
│
├── data/                             # 运行时产物（git 忽略）
│   ├── dsl/<test_id>/               # DSL 快照及修订记录
│   ├── sessions/                    # TestRunState 快照（用于中断恢复）
│   ├── screenshots/                 # 执行截图
│   └── reports/                     # 测试报告 JSON
│
├── .env.example                      # 环境变量模板
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 快速开始

### 前置条件

- Node.js 20+
- OpenAI API Key（用于 NL→DSL 编译）

### 安装

```bash
git clone <repo-url>
cd web-testing-agent
npm install
```

### 配置

```bash
cp .env.example .env
```

编辑 `.env`，至少填入：

```env
OPENAI_API_KEY=sk-...
```

### 安装 Playwright 浏览器

```bash
npx playwright install chromium
```

---

## 使用方式

### 基本用法

```bash
npx tsx src/index.ts "<自然语言测试描述>"
```

**示例：**

```bash
# 基础导航测试
npx tsx src/index.ts "打开 https://example.com，截图"

# 表单填写 + 断言
npx tsx src/index.ts "打开 https://example.com/login，在用户名框输入 admin，密码框输入 123456，点击登录按钮，验证页面出现欢迎文字"

# 带 URL 的搜索流程
npx tsx src/index.ts "访问 https://www.baidu.com，在搜索框输入 playwright 自动化，点击搜索，截图结果页"
```

### 中断恢复

如果测试中途被中断（Ctrl+C、进程崩溃等），可以通过 run ID 恢复：

```bash
# 查看保存的 session 文件
ls data/sessions/

# 从中断处继续
npx tsx src/index.ts "" --resume run_abc12345
```

### 无头模式 / 有界面模式

修改 `src/index.ts` 中的 `run()` 调用或设置：

```bash
# 默认无头模式（headless: true）
npx tsx src/index.ts "..."

# 查看浏览器操作（调试用，修改代码中 headless: false）
```

### 输出说明

每次运行会产生以下文件：

| 路径 | 内容 |
|------|------|
| `data/dsl/<id>/nl_input.txt` | 原始自然语言输入 |
| `data/dsl/<id>/dsl_<ts>.json` | 编译后的 DSL JSON |
| `data/dsl/<id>/revision_log.jsonl` | DSL 修订历史 |
| `data/sessions/<run_id>.json` | 执行状态快照（每步更新） |
| `data/screenshots/s<N>_<ts>.png` | 各步骤截图 |
| `data/reports/<run_id>.json` | 完整测试报告 |

---

## DSL 格式

> 迁移声明：当前版本仅支持语义目标 DSL，不再支持旧的 selector-based DSL（不兼容）。

自然语言经 `TestCaseCompiler` 编译后产生以下 JSON 结构：

```json
{
  "id": "tc_login_001",
  "name": "登录流程验证",
  "url": "https://example.com/login",
  "steps": [
    {
      "step_id": "s1",
      "action": "navigate",
      "target": {
        "key": "login_page",
        "type": "page",
        "hints": ["Login Page"],
        "fallback": ["https://example.com/login"]
      },
      "value": "https://example.com/login",
      "description": "打开登录页"
    },
    {
      "step_id": "s2",
      "action": "input",
      "target": {
        "key": "username",
        "type": "input",
        "hints": ["Username", "Email"],
        "fallback": ["#username", "input[name=user]"]
      },
      "value": "admin",
      "description": "输入用户名"
    },
    {
      "step_id": "s3",
      "action": "input",
      "target": {
        "key": "password",
        "type": "input",
        "hints": ["Password"]
      },
      "value": "123456",
      "description": "输入密码"
    },
    {
      "step_id": "s4",
      "action": "click",
      "target": {
        "key": "login_submit",
        "type": "button",
        "hints": ["Login", "Sign In", "登录"]
      },
      "description": "点击登录"
    },
    {
      "step_id": "s5",
      "action": "assert",
      "target": {
        "key": "welcome_area",
        "type": "text",
        "hints": ["欢迎", "Welcome"]
      },
      "assertions": [
        {
          "type": "text_contains",
          "target": {
            "key": "welcome_area",
            "type": "text",
            "hints": ["欢迎", "Welcome"]
          },
          "value": "欢迎"
        }
      ],
      "description": "验证欢迎页"
    },
    {
      "step_id": "s6",
      "action": "screenshot",
      "target": { "key": "post_login", "type": "page" },
      "description": "最终截图"
    }
  ],
  "compile_report": {
    "confidence": 0.95,
    "warnings": [],
    "errors": [],
    "source_nl": "打开登录页...",
    "compiled_at": "2026-04-04T00:00:00.000Z"
  }
}
```

### 支持的 Action 类型

| Action | 说明 | 必填字段 |
|--------|------|---------|
| `navigate` | 导航到目标页面 | `target`（语义对象），`value`（URL） |
| `click` | 点击语义目标元素 | `target`（语义对象） |
| `input` | 向输入框填写文本 | `target`（语义对象）、`value` |
| `press` | 触发键盘按键 | `target`（语义对象）、`value`（如 `Enter`） |
| `screenshot` | 截取当前页面截图 | `target`（语义对象） |
| `assert` | 执行断言检查 | `assertions` 数组 |

### 支持的断言类型

| 类型 | 说明 |
|------|------|
| `text_contains` | 元素文本包含指定字符串 |
| `url_matches` | 当前 URL 包含指定字符串 |
| `element_visible` | 元素在页面上可见 |
| `element_not_visible` | 元素不可见 |

---

## 测试

```bash
# 运行所有单元测试
npm test

# 监听模式（开发时）
npm run test:watch

# 类型检查
npm run typecheck
```

当前测试覆盖：

| 测试文件 | 测试数 | 覆盖内容 |
|----------|--------|---------|
| `DslValidator.test.ts` | 10 | 字段校验、URL 校验、步骤规则、断言规则 |
| `MacroExpander.test.ts` | 2 | 宏识别与展开、步骤 ID 重排 |
| `testLoop.test.ts` | 4 | 完整执行、快照保存、流式 yield、中断恢复 |

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | OpenAI API Key（必填） | — |
| `OPENAI_MODEL` | 编译使用的模型 | `gpt-4o` |
| `STORAGE_DIR` | 数据存储目录 | `./data` |
| `TEST_EXECUTION_TIMEOUT_MS` | 单个测试用例全局超时（ms） | `120000` |
| `MAX_STEP_RETRIES` | 单步最大重试次数 | `3` |
| `COMPILE_MAX_TOKENS` | NL→DSL 编译最大 token 数 | `4096` |
