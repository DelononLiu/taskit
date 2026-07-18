# Taskit

多框架模型精度比对与部署管理平台。核心模式：

```
上传模型 → 创建 Task → 后台执行 → 查看结果
```

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| 状态管理 | zustand |
| 字体 | Plus Jakarta Sans + JetBrains Mono |
| 后端 | Express, TypeScript |
| 数据库 | SQLite（drizzle-orm + better-sqlite3） |
| 认证 | JWT（passport.js） |
| 任务执行 | subprocess shell 命令，脚本语言无关 |
| 测试 | Vitest |

## 快速开始

```bash
# 1. 安装依赖
npm install && cd backend && npm install && cd ..

# 2. 初始化数据库
cd backend && npx drizzle-kit push && cd ..

# 3. 启动
npm run dev:all
# 后端 → http://localhost:8000
# 前端 → http://localhost:5173
```

## 架构

```
┌──────────────────────────────────────────────┐
│ Header  76px — TASKIT PLATFORM              │
├──────────┬───────────────────────────────────┤
│ Sidebar  │ Content (TaskTable 主视图)         │
│ 240px    │                                    │
│          │  ┌─ 过滤栏 + 搜索 ──────────────┐  │
│ Model    │  ├──────────────────────────────┤  │
│ Compare  │  │ 任务表格                       │  │
│          │  │ 模型 │ 指标 │ 状态 │ 操作     │  │
│ 部署工坊  │  └──────────────────────────────┘  │
│ (即将上线)│                                    │
│          │  新建/详情 → DetailDrawer (500px)   │
└──────────┴───────────────────────────────────┘
```

## 项目结构

```
src/
├── core/                      # 平台骨架
│   ├── components/            # Header, Sidebar, TaskTable, DetailDrawer, StatusBadge, EmptyState
│   ├── types.ts               # ModuleId, NavModule
│   └── api/                   # auth API
├── pages/
│   └── TaskitPage.tsx         # 主页面（按 activeModule 切换子产品）
├── tasks/
│   ├── registry.ts            # 模块注册
│   ├── _template/             # 新模块模板
│   └── model_compare/         # ModelCompare（模型精度比对）
│       ├── DrawerTaskForm.tsx      # 新建任务（Drawer 内）
│       ├── DrawerTaskDetail.tsx    # 任务详情（Drawer 内）
│       ├── OverviewChart.tsx       # 雷达图
│       ├── LayerTable.tsx          # 层明细表格
│       └── ExecutionTree.tsx       # 执行链路图
├── stores/                    # zustand（appStore, taskStore, authStore, uiStore）
├── api/                       # HTTP + mock
├── components/ui/             # shadcn/ui 组件
├── types/                     # TypeScript 类型
└── lib/                       # utils

backend/
├── src/
│   ├── db/                    # drizzle schema + client
│   │   ├── schema.ts          # users, files, tasks
│   │   └── index.ts           # better-sqlite3 + drizzle
│   ├── routers/               # auth, files, tasks
│   ├── middleware/             # JWT auth, passport
│   ├── lib/                   # task-engine (subprocess 执行器)
│   ├── tasks/
│   │   ├── registry.ts        # MODULES 注册
│   │   └── model_compare/     # runner + router
│   └── __tests__/
├── drizzle.config.ts
└── drizzle/                   # migration 文件
```

## API

```
POST   /auth/register            注册
POST   /auth/login               登录 → JWT
POST   /api/files/upload         上传模型文件
POST   /api/tasks                创建任务 { module, fileIds, params }
GET    /api/tasks                任务列表（分页，可筛 module/status）
GET    /api/tasks/:id            任务详情（含 result）
POST   /api/tasks/:id/cancel     取消运行中任务
POST   /api/tasks/:id/retry      重试失败任务

GET    /api/modules/model_compare/tasks/:id/layers   层差异数据
```

## 添加新子产品

复制模板，改三处：

```bash
cp -r src/tasks/_template src/tasks/my_module
```

1. **`TaskForm.tsx`** — 表单组件（会被嵌入 Drawer）
2. **`ResultViewer.tsx`** — 结果展示组件（会被嵌入 Drawer）
3. **`backend/src/tasks/`** — 新模块的 runner + router

注册：

```ts
// src/tasks/registry.ts + backend/src/tasks/registry.ts
MODULES.my_module = {
  name: '我的模块',
  TaskForm: MyTaskForm,
  ResultViewer: MyTaskResult,
}
```

```ts
// src/core/components/Sidebar.tsx — MODULES 数组中加一条
{ id: 'my-module', label: '我的模块', icon: '🔧', description: '...', status: 'active' }
```

## 开发约定

- **Git commit 消息使用中文**（`feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:`）
- **品牌令牌** — `text-brand-accent`、`bg-brand-accent`，不硬编码颜色
- **TDD** — 修改代码后跑测试，测试不过不提交
- 详见 `AGENTS.md`
