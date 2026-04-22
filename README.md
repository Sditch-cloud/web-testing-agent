# Web Testing Agent

AI 驱动的 Web 测试代理，支持将自然语言测试描述编译成结构化 DSL，并基于 Playwright 执行测试步骤、持久化会话快照、输出 JSON 报告。

核心流程：

自然语言输入 -> TestCaseCompiler -> DslValidator -> testLoop -> 报告与证据落盘

## 项目目标

- NL -> DSL：将自然语言转换为可审计、可重放的 JSON DSL。
- 有界执行：按固定步骤顺序执行，步骤转移限定为 success/retry/skip/fail_fast。
- 可恢复执行：每步写入 session 快照，支持通过 run ID 恢复。
- 语义定位：基于 target.key/type/hints/fallback 解析页面元素，并记录解析记忆。

## 技术栈

- Node.js 20+
- TypeScript 5 (strict)
- Playwright
- OpenAI SDK
- Zod
- Vitest

## 当前目录结构

```text
web-testing-agent/
 src/
    index.ts
    executor/
       BrowserToolExecutor.ts
    orchestrator/
       DslValidator.ts
       NlInputLoader.ts
       TestCaseCompiler.ts
       testLoop.ts
    resolver/
       ElementResolver.ts
       types.ts
    store/
       DslSnapshotStore.ts
       ResolverMemoryStore.ts
       SessionStore.ts
    tools/
       ClickTool.ts
       FillTool.ts
       NavigateTool.ts
       ScreenshotTool.ts
       Tool.ts
    types/
        Message.ts
        Task.ts
        TestDsl.ts
 tests/
    unit/
        BrowserToolExecutor.test.ts
        DslValidator.test.ts
        ElementResolver.test.ts
        indexInput.test.ts
        ResolverMemoryStore.test.ts
        testLoop.test.ts
 nl-case/
 data/
 package.json
 tsconfig.json
 vitest.config.ts
```

## 执行链路

1. 输入处理
- 支持直接传自然语言。
- 支持通过 `--case <markdown路径>` 或直接传入 `.md` 路径读取用例内容。

2. 编译与校验
- `TestCaseCompiler` 调用 OpenAI 生成结构化 DSL。
- `DslValidator` 检查 action、target、assertion、URL 等约束。

3. 执行
- `testLoop` 以有界状态机推进步骤。
- `BrowserToolExecutor` 执行 action，处理超时、重试和失败转移。
- 对 click/input/assert 使用语义解析器候选集逐个尝试。

4. 持久化与报告
- 每步更新 session 文件，支持恢复执行。
- 执行结束写入报告 JSON，包含 artifacts、统计和 Markdown summary。

## DSL 概览

顶层结构（简化）：

```json
{
  "id": "tc_xxx",
  "name": "登录流程",
  "url": "https://example.com/login",
  "steps": [
    {
      "step_id": "s1",
      "action": "navigate",
      "target": { "key": "login_page", "type": "page", "hints": [], "fallback": [] },
      "value": "https://example.com/login"
    }
  ],
  "compile_report": {
    "confidence": 0.95,
    "warnings": [],
    "errors": [],
    "source_nl": "...",
    "compiled_at": "2026-04-09T00:00:00.000Z"
  }
}
```

支持的 action：

- `navigate`
- `input`
- `click`
- `press`
- `assert`
- `screenshot`

支持的 assertion.type：

- `text_contains`
- `url_matches`
- `element_visible`
- `element_not_visible`

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env
```

至少填写：

```env
OPENAI_API_KEY=your_key
```

3. 安装 Playwright 浏览器

```bash
npx playwright install chromium
```

4. 执行测试

```bash
npx tsx src/index.ts "打开 https://example.com，截图"
```

## CLI 用法

直接输入自然语言：

```bash
npx tsx src/index.ts "打开登录页，输入用户名 admin，输入密码 123456，点击登录，断言欢迎文案，截图"
```

从 Markdown 读取：

```bash
npx tsx src/index.ts --case nl-case/login-test.md
```

也可直接传 Markdown 路径：

```bash
npx tsx src/index.ts nl-case/login-test.md
```

恢复执行：

```bash
npx tsx src/index.ts "" --resume run_xxxxxxxx
```

开发时可直接使用脚本：

```bash
npm run dev -- "打开 https://example.com，截图"
```

## 端到端示例（基于现有登录用例）

用例文件：`nl-case/login-test.md`

该用例使用站点 `https://www.qaplayground.com/bank`，并包含登录成功预期。

1. 准备环境

```bash
npm install
npx playwright install chromium
```

2. 设置 API Key

```bash
cp .env.example .env
```

在 `.env` 中填入：

```env
OPENAI_API_KEY=your_key
```

3. 运行端到端用例

```bash
npx tsx src/index.ts --case nl-case/login-test.md
```

4. 校验执行结果

- 控制台会输出每一步的执行状态（例如 `s1`, `s2`）。
- 执行完成后会输出报告路径：`data/reports/<run_id>.json`。
- 如步骤包含截图，可在 `data/screenshots/` 查看证据文件。

5. 中断后恢复（可选）

```bash
npx tsx src/index.ts "" --resume <run_id>
```

`<run_id>` 可从 `data/sessions/` 下的文件名获取。

## 运行产物

默认输出目录为 `./data`（可通过 `STORAGE_DIR` 修改）：

- `data/dsl/<test_id>/nl_input.txt`：原始自然语言
- `data/dsl/<test_id>/dsl_<timestamp>.json`：每次编译产物
- `data/dsl/<test_id>/revision_log.jsonl`：DSL 修订日志
- `data/sessions/<run_id>.json`：执行快照
- `data/resolver-memory/<action>__<target_key>.json`：解析记忆
- `data/screenshots/*.png`：截图证据
- `data/reports/<run_id>.json`：测试报告

## 环境变量

- `OPENAI_API_KEY`：必填。
- `OPENAI_BASE_URL`：可选，兼容代理或自建网关。
- `OPENAI_MODEL`：默认 `gpt-4o`。
- `PROXY_URL`：可选，HTTP(S) 代理。
- `STORAGE_DIR`：默认 `./data`。
- `TEST_EXECUTION_TIMEOUT_MS`：默认 `120000`。
- `MAX_STEP_RETRIES`：默认 `3`。
- `COMPILE_MAX_TOKENS`：默认 `4096`。

## 测试与质量检查

```bash
npm test
npm run test:watch
npm run typecheck
npm run lint
```

当前单测覆盖模块：

- BrowserToolExecutor
- DslValidator
- ElementResolver
- index 输入解析
- ResolverMemoryStore
- testLoop

## 已知边界

- 目前为单 Browser Context 串行执行模型。
- 未提供仓库内 e2e 测试目录，`test:e2e` 仅在存在对应目录时可执行。
- 使用 OpenAI 编译 DSL，运行时需可访问对应 API。
