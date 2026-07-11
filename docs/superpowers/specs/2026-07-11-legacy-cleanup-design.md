# Taskit 遗留代码清理设计

> 清理旧架构残留的死代码、重复配置和 import 路径，为后续开发扫清障碍。

---

## 背景

项目从 MVP 单页阶段（`Tool/index.tsx` + `pages/TaskDetail/`）重构为模块化架构（`core/` + `tasks/`）后，旧目录结构和组件未被清理，导致：

- 957 行死代码驻留在仓库中
- 框架配置（`FW_OPTIONS`）在 4 个文件中重复定义
- `ResultViewer` 仍从旧目录 import 组件
- 测试覆盖仅限 2 个纯函数 utils 文件

## 范围

四项独立任务，可分批执行但须按给定顺序（前三个相互依赖）。

### 1. 删除 `src/pages/Tool/index.tsx`

**操作**：
- `git rm src/pages/Tool/index.tsx`
- 确认 `App.tsx` 和 `main.tsx` 无引用（已核实无引用）
- 确认 `src/tasks/model_diff/` 中的新组件已完全覆盖其功能（已核实）

**验证**：`npx tsc --noEmit` 不报错

### 2. 迁移 + 删除 `src/pages/TaskDetail/`

**当前引用**：`ResultViewer.tsx` 从 `@/pages/TaskDetail/OverviewChart` 和 `@/pages/TaskDetail/LayerTable` import

**操作**：
1. 将 `src/pages/TaskDetail/OverviewChart/` → 移到 `src/tasks/model_diff/OverviewChart.tsx`（展平为单文件，因其内部只有一个组件）
2. 将 `src/pages/TaskDetail/LayerTable/` → 移到 `src/tasks/model_diff/LayerTable/`（保持目录结构，其内部有多个子组件）
3. 更新 `ResultViewer.tsx` 的 import 路径
4. 删除 `src/pages/TaskDetail/` 整个目录

**验证**：`npx tsc --noEmit` 通过，`npm run build` 通过

### 3. 提取 `FW_OPTIONS` 共享常量

**当前散落位置**：
- `src/tasks/model_diff/TaskForm.tsx` (L19-23)
- `src/tasks/model_diff/ResultViewer.tsx` (L24-28)
- `src/pages/Tool/index.tsx` (L324-328，随 Task 1 删除)
- `src/tasks/model_diff/mockData.ts` (硬编码框架名)
- `src/types/framework.ts` (`FRAMEWORKS` 数组)

**操作**：
1. 新建 `src/tasks/model_diff/constants.ts`，定义：
   ```typescript
   export const FW_OPTIONS = [
     { value: 'onnxruntime', label: 'ONNX Runtime', color: '#1677ff' },
     { value: 'tensorrt', label: 'TensorRT', color: '#9333ea' },
     { value: 'openvino', label: 'OpenVINO', color: '#f97316' },
   ]
   ```
2. `TaskForm.tsx` 删除行内定义后 import
3. `ResultViewer.tsx` 删除行内定义后 import
4. `mockData.ts` 中硬编码的框架名不影响正确性，可暂不改动
5. `src/types/framework.ts` 的 `FRAMEWORKS` 类型定义保持独立（用于 API 类型，不同于 UI 配置）

**验证**：`npx tsc --noEmit` 通过

### 4. 扩展测试覆盖

**当前测试**：`src/utils/__tests__/color.test.ts` + `metric.test.ts`（共 2 个文件）

**操作**：
1. 安装 `@testing-library/react` + `@testing-library/jest-dom`
2. 增加 `ErrorBoundary.test.tsx` — 验证渲染子元素、捕获错误、展示 fallback
3. 增加 `TaskHistoryDrawer.test.tsx` — 验证过滤和搜索逻辑
4. 增加 `api/task.test.ts` — 验证 mock handler 的业务逻辑（创建任务、轮询状态、失败处理）

**验证**：`npx vitest run` 所有测试通过

## 依赖关系

```
Task 1 (删除 Tool) ──→ Task 2 (迁移 TaskDetail + 删除) ──→ Task 3 (共享常量)
                                                              │
Task 4 (测试扩展) ────────────────────────────────────────────┘ (无依赖，可并行)
```

| 任务 | 依赖 | 可并行 |
|------|------|--------|
| 1. 删除 Tool | 无 | 是 (与 4) |
| 2. 迁移 TaskDetail | 1 | 否 |
| 3. 常量提取 | 2 | 否 |
| 4. 测试扩展 | 无 | 是 (与 1-3) |

## 风险与回滚

- 每一步都独立 commit，任何一步出问题可 `git revert` 单步回滚
- 迁移组件后先 commit，再删除旧目录 —— 确保迁移后代码可运行
- Task 4 若 `@testing-library/react` 安装失败不影响前三个任务
