# TASKIT — 模型工坊

**通用任务平台，支持模型精度比对与部署管理。**

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![React](https://img.shields.io/badge/React-18-61dafb)
![Express](https://img.shields.io/badge/Express-4-000000)
![SQLite](https://img.shields.io/badge/SQLite-drizzle-003B57)
![License](https://img.shields.io/badge/license-MIT-green)

---

## TL;DR

上传 ONNX 模型 → 选择对比框架 → 后台执行推理 → 查看精度差异报告。支持 ONNX Runtime / TensorRT / OpenVINO 多框架层级别精度比对，通过 Drawer 面板完成所有操作，无需页面跳转。

## 核心特性

```
上传模型 → 配置框架 → 执行比对 → 精度报告
```

四区布局：Header + Sidebar + TaskTable 主视图 + DetailDrawer。所有操作（新建任务、查看详情）均通过右侧滑出面板完成，主视图始终展示任务大盘。支持子产品扩展（部署工坊即将上线）。

## 快速启动

```bash
# 安装依赖
npm install && cd backend && npm install && cd ..

# 初始化数据库
cd backend && npx drizzle-kit push && cd ..

# 一键启动
npm run dev:all

# 或分别启动
npm run dev              # 前端 → http://localhost:5173
npm run dev:backend      # 后端 → http://localhost:8000
```

首次访问自动跳转登录页，注册后即可使用。

## 环境要求

- Node.js 18+
- npm 网络（纯 npm 安装，无需 GitHub 直连）

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| 状态管理 | zustand |
| 字体 | Plus Jakarta Sans + JetBrains Mono |
| 后端 | Express, TypeScript |
| 数据库 | SQLite（drizzle-orm + better-sqlite3） |
| 认证 | JWT（passport.js） |
| 任务执行 | subprocess shell 命令，语言无关 |
| 测试 | Vitest |

## 架构

```
┌──────────────────────────────────────────────────┐
│ Header  76px — TASKIT PLATFORM v2.0             │
├──────────┬───────────────────────────────────────┤
│ Sidebar  │ Content (TaskTable 主视图)             │
│ 240px    │                                        │
│          │  ┌─ 过滤栏 + 搜索 ──────────────────┐ │
│ Model    │  ├──────────────────────────────────┤ │
│ Compare  │  │ 任务表格                           │ │
│          │  │ 模型 │ 精度 │ 状态 │ 完成时间    │ │
│ 部署工坊  │  └──────────────────────────────────┘ │
│ (即将上线)│                                        │
│          │  新建/详情 → DetailDrawer 500px        │
└──────────┴───────────────────────────────────────┘
```

详细架构设计见 [`docs/superpowers/specs/2026-07-17-taskit-platform-layout-design.md`](docs/superpowers/specs/2026-07-17-taskit-platform-layout-design.md)。

## 项目结构

```
├── src/                          # 前端
│   ├── core/                     # 平台骨架（Header, Sidebar, TaskTable, DetailDrawer）
│   ├── pages/
│   │   └── TaskitPage.tsx        # 主页面（按 activeModule 切换子产品）
│   ├── tasks/
│   │   ├── registry.ts           # 模块注册
│   │   ├── _template/            # 新模块模板
│   │   └── model_compare/        # ModelCompare（表单, 图表, 表格, 执行树）
│   ├── stores/                   # zustand（appStore, taskStore, authStore, uiStore）
│   ├── api/                      # HTTP 客户端 + mock
│   ├── components/ui/            # shadcn/ui 组件
│   ├── types/                    # TypeScript 类型
│   └── lib/                      # utils
├── backend/                      # Express 后端
│   └── src/
│       ├── db/                   # drizzle schema + better-sqlite3 client
│       ├── routers/              # auth, files, tasks
│       ├── middleware/            # JWT + passport
│       ├── lib/                  # task-engine（subprocess 执行器）
│       ├── tasks/                # 模块注册 + model_compare runner
│       └── __tests__/
├── runners/                      # 外部推理脚本（语言无关）
├── docs/
│   ├── DeployAgent-ui.html       # DeployAgent UI 设计参考
│   └── superpowers/              # 开发过程归档 (specs + plans)
└── AGENTS.md                     # AI Agent 开发指南
```

## 开发命令

```bash
# 运行测试
npm test                    # 前端（Vitest）
cd backend && npm test      # 后端（Vitest）

# 类型检查
npx tsc --noEmit            # 前端
cd backend && npx tsc --noEmit  # 后端

# 数据库
cd backend && npx drizzle-kit push   # 同步 schema
cd backend && npx drizzle-kit studio # 可视化管理
```

## 配置

通过环境变量配置：

```bash
# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# LDAP（可选，默认关闭）
LDAP_ENABLED=true
LDAP_URL=ldap://ldap.corp.com:389
LDAP_BIND_DN=cn=admin,dc=corp,dc=com
LDAP_BIND_PASSWORD=admin-password
LDAP_SEARCH_BASE=ou=users,dc=corp,dc=com
LDAP_SEARCH_FILTER=(uid={{username}})
LDAP_EMAIL_DOMAIN=corp.com
```

LDAP 启用后登录优先走 LDAP，首次登录自动创建本地用户。不配置则使用本地邮箱+密码登录。

## 自定义 Runner

在 `~/.taskit/runner/` 下放任意目录，包含 `run.sh` 即可注册为任务模块，后端启动时自动扫描加载。

```bash
~/.taskit/runner/
└── vllm/
    ├── config.json    # {"name": "vLLM 推理", "icon": "🚀"}
    └── run.sh         # 入口脚本
```

`run.sh` 接收标准参数：`--task-dir <目录> --task-id <ID>`，输出 JSON 到 `$TASK_DIR/output.json`。

```bash
#!/usr/bin/env bash
set -euo pipefail
# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --task-dir) TASK_DIR="$2"; shift 2 ;;
    --task-id)  TASK_ID="$2"; shift 2 ;;
    *) shift ;;
  esac
done
# 产出结果
cat > "$TASK_DIR/output.json" << 'EOF'
{"status": "ok", "data": {}}
EOF
```

**重启后端**后新模块出现在侧边栏和模块列表。**修改脚本内容不需要重启**——每次执行时从磁盘重新读取。

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

```bash
cp -r src/tasks/_template src/tasks/my_module
```

三步注册：

```ts
// 1. 前端：src/tasks/registry.ts
MODULES.my_module = { name: '我的模块', TaskForm: MyForm, ResultViewer: MyResult }

// 2. 后端：backend/src/tasks/registry.ts（含 runner + router）

// 3. 侧边栏：src/core/components/Sidebar.tsx → MODULES 数组追加入口
```

## 如何贡献

1. 先读 [`AGENTS.md`](AGENTS.md) 了解开发规范和 TDD 纪律
2. 理解核心流程：上传 → 配置 → 执行 → 结果
3. 提交前通过所有测试
4. Commit 消息使用中文

## License

MIT
