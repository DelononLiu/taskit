# Taskit — AI Agent 开发指南

## 项目定位

Taskit — 多框架模型精度比对与部署管理平台。核心功能：**上传模型 → 配置框架 → 运行比对 → 查看结果 → 部署管理**。

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Node.js, Express, TypeScript, Prisma (SQLite) |
| 前端 | React 18, Vite 5, TypeScript, shadcn/ui, Tailwind CSS 3 |
| 状态 | zustand |
| 测试 | Vitest (前端), Vitest (后端) |
| 字体 | Plus Jakarta Sans + JetBrains Mono |

## 项目结构

```
taskit/
├── backend/                       # Node.js 后端
│   └── src/
│       ├── index.ts               # Express 入口 + 所有路由注册
│       ├── config.ts              # 配置读取
│       ├── lib/                   # prisma / task-engine
│       ├── middleware/            # auth / passport
│       ├── routers/               # auth / files / tasks
│       ├── tasks/                 # 模块注册
│       │   ├── registry.ts        # MODULES 注册表
│       │   └── model_compare/     # ModelCompare 模块 runner + router
│       └── __tests__/
├── src/                           # React SPA 前端
│   ├── App.tsx                    # 根组件 + 路由 + 四区布局骨架
│   ├── pages/
│   │   └── TaskitPage.tsx         # 主页面（根据 activeModule 渲染内容）
│   ├── core/
│   │   ├── components/            # 平台级组件（Header/Sidebar/DetailDrawer/TaskTable/StatusBadge/EmptyState）
│   │   ├── api/                   # auth API 客户端
│   │   └── types.ts               # ModuleId / NavModule
│   ├── tasks/
│   │   ├── registry.ts            # 前端模块注册
│   │   ├── model_compare/         # ModelCompare 子产品（表单/结果/图表/表格）
│   │   └── _template/             # 新模块模板
│   ├── stores/                    # zustand stores（app/task/auth/ui）
│   ├── api/                       # API 客户端（model/task）+ mock
│   ├── components/ui/             # shadcn/ui 组件
│   ├── types/                     # TypeScript 类型定义
│   ├── utils/                     # 工具函数（color/metric）
│   └── lib/                       # env / utils
├── docs/
│   ├── DeployAgent-ui.html        # DeployAgent UI 设计参考
│   └── superpowers/               # spec + plans 归档
├── index.html                     # Vite 入口 HTML
├── tailwind.config.js             # Tailwind 配置（品牌色/字体）
└── AGENTS.md                      # 本文件
```

## 启动 / 重启 / 停止

```bash
# 启动
npm run dev:backend     # 后端 → http://localhost:8000
npm run dev             # 前端 → http://localhost:5173
npm run dev:all         # 同时启动

# 重启
kill $(lsof -ti:8000) 2>/dev/null
kill $(lsof -ti:5173) 2>/dev/null
npm run dev:all

# 停止
kill $(lsof -ti:8000) $(lsof -ti:5173) 2>/dev/null
```

> 开发环境用 `lsof -ti:端口` 定位进程，自己机器基本不撞端口。
> 修改 `run.sh` 不需要重启后端；新增/删除 `~/.taskit/runner/` 目录需要。

## 运行测试

```bash
# 前端 (Vitest)
npm test                # vitest run

# 后端
cd backend && npm test  # vitest run
```

## 开发约定

1. **Git commit 消息使用中文** — 格式 `type: 简短描述`，type 为 `feat/fix/docs/refactor/chore/test/style`
2. **品牌令牌** — 使用 Tailwind class（`text-brand-accent`、`bg-brand-accent`），不硬编码颜色值
3. **组件分层** — `core/components/` 放平台级通用组件，`tasks/<module>/` 放子产品私有组件
4. **状态管理** — zustand，`appStore` 管布局状态，`taskStore` 管任务数据
5. **新增子产品** — 参考 `src/tasks/_template/`，在 `src/tasks/registry.ts` 和 `backend/src/tasks/registry.ts` 注册

## 禁止事项

1. **不要自动 push** — 所有提交后等待用户确认
2. **不要修改 `docs/superpowers/`** — 那是开发过程归档
3. **不要引入新的颜色值** — 已定义 brand-accent / brand-success，新颜色先加到 tailwind.config.js 令牌
4. **不要直接操作 DOM** — 都用 React 方式

## TDD 纪律

> 修改代码后，必须手动运行相关测试确认通过，否则工作视为未完成。

**TDD 日常流程（适用于 AI 和人类开发者）：**

```
1. 写一个失败测试      → Red
2. 写最少代码让测试通过  → Green
3. 运行全量测试确认无回归 → 验证
4. 提交代码
```

**具体执行规则：**

| 改了什么 | 必须运行的测试 |
|---------|---------------|
| `src/core/components/*.tsx` | `npx vitest run src/core/components/ --reporter=verbose` |
| `src/pages/*.tsx` | `npx vitest run src/pages/ --reporter=verbose` |
| `src/stores/*.ts` | `npx vitest run src/stores/ --reporter=verbose` |
| `src/api/*.ts` | `npx vitest run src/api/ --reporter=verbose` |
| `src/utils/*.ts` | `npx vitest run src/utils/ --reporter=verbose` |
| `backend/src/routers/*.ts` | `cd backend && npx vitest run src/__tests__/tasks.test.ts` |
| `backend/src/tasks/*.ts` | `cd backend && npx vitest run src/__tests__/runner.test.ts` |
| 跨模块改动 | **跑全量：** `npm test` + `cd backend && npm test` |

**禁止**：测试失败时提交代码、声称工作完成。

## 测试质量问责

> 写凑数测试（为覆盖而覆盖、不验证业务行为的测试）等同于没写测试。

### 凑数测试判定标准

一个测试被判定为**凑数**，当它满足以下任一条件：

| 凑数类型 | 示例 | 判定规则 |
|----------|------|---------|
| **裸调用** | `render(<Component />)` + 只 `assert 存在` | 没有验证任何业务行为 |
| **存在即正义** | `expect(result).toBeTruthy()` | 没断言具体值，返回空也得过 |
| **宽松断言** | `expect(len).toBeGreaterThanOrEqual(0)` | 断言永不失败，形同虚设 |
| **结构检查** | `expect(typeof result).toBe('object')` + 没查内容 | 没验证字段值 |
| **重复验证** | 多个测试用不同参数走同一路径，断言一模一样 | 只验了一条路径 |
| **边界盲区** | error/异常/空集合/null 等反向路径完全不测 | 只测了快乐路径 |
| **mock 无行为验证** | mock 了 API/Store 但没验证 mock 被正确调用了 | 不知道代码是否真用了 mock |

### 必须遵守的质量清单

写任何一个测试前，逐条自问并通过：

1. **「这个测试能抓到什么 bug？」** — 必须能说出至少一种具体的失败场景
2. **「断言的值是固定的还是推导的？」** — 必须断言具体值，不能断言"存在"或"不为空"
3. **「反向路径测了吗？」** — 如果正向是"有结果"，反向就必须有"无结果"测试
4. **「边界测了吗？」** — null/空字符串/负数/超出范围/列表为空 等
5. **「这个测试我删了，有人会发现吗？」** — 如果删了不影响任何人对代码的信心，那就是凑数测试

### AI 特别约束

AI 生成测试代码后，必须在回复中附上**质量自证声明**，逐条回答：

```
[质量自证]
- 验证的业务行为：______
- 断言了哪些具体值：______
- 反向/异常路径：______
- 边界条件：______
- 无凑数模式（宽松断言/存在即正义/裸调用）：______
```

缺失此声明则 AI 的测试工作视为未完成。

## AI 工作流程

1. **先读 AGENTS.md** 了解项目结构和约定
2. **读相关 spec**（`docs/superpowers/specs/`）了解功能的设计背景
3. **读相关 plan**（`docs/superpowers/plans/`）了解实施计划细节
4. **动手前先列出改动的文件和理由**，等用户确认后再执行
5. **改动后手动运行相关测试**（见上表），确认通过
6. **提交消息使用中文**
