# Runner Pipeline 统一 & 平台交互重构

> 统一模型输入格式与精度比对流程，增强任务产出物能力，支持外部 runner 生态，精简 UI 交互。

---

## 1. 功能总览

| # | 功能 | 复杂度 | 核心思路 |
|---|------|--------|---------|
| 📦 | zip2npz.py | 中 | 公共 Python 模块，zip → npz 自适应解析，ONNX/OpenVINO/torch-cpu 统一调用 |
| 🔬 | compare.py | 中 | 从三个 runner 提取重复的比对逻辑为 `runners/compare.py` 公共模块 |
| 📊 | Report | 中 | `GET /api/tasks/:id/report`，生成自包含静态 HTML，任务列表下载按钮 |
| 📂 | 目录隔离 | 低 | 上传目录按 `userId` 分子目录，支持多用户并发 |
| 🔌 | 外部 runner | 低 | 启动时从 `~/.taskit/runner/` 加载并注册到 MODULES，task-engine 执行时解析 |
| 🎨 | UI 重构 | 中 | 去掉 DrawerTaskDetail，新建任务改 Modal，任务列表增加精度摘要列 |

---

## 2. 📦 zip2npz.py — Zip 统一解析

### 2.1 位置

```
runners/zip2npz.py
```

### 2.2 职责

接受 zip 文件路径，自适应检测内部结构（不同 bin 文件名约定、目录布局），提取 tensor 数据，统一输出 `.npz`。

### 2.3 接口

```python
# runners/zip2npz.py

def extract_to_npz(zip_path: str, output_dir: str) -> str:
    """解包 zip，自适应目录/文件结构，返回 npz 文件路径。

    内部按优先级依次尝试多种格式匹配规则（"三级"适配），
    命中即返回，所有规则失败则抛 RuntimeError。

    Returns:
        生成的 .npz 文件的绝对路径
    """
```

### 2.4 格式适配规则

三种典型 zip 内部结构（"三级"）：

1. **直接模型文件**：zip 内为 `model.onnx` / `model.pth` 等，直接提取
2. **命名目录结构**：`<model_name>/model.bin` + `<model_name>/config.json`，以目录名匹配
3. **扁平多文件**：多个 `.bin` 无目录层级，按文件名模式匹配

具体匹配规则从实际数据中归纳，通过策略链依次尝试。

### 2.5 各 runner 调用方式

```python
# onnx/run.py, openvino/run.py, torch-cpu/run.py

from ..zip2npz import extract_to_npz

# --input 现在接受 zip 文件
if input_path.endswith('.zip'):
    npz_path = extract_to_npz(input_path, temp_dir)
    # 后续从 npz 加载数据
```

### 2.6 测试

- `runners/__tests__/test_zip2npz.py`：三种 zip 结构的解析测试

---

## 3. 🔬 compare.py — 公共精度比对

### 3.1 位置

```
runners/compare.py
```

### 3.2 职责

从 onnx/openvino/torch-cpu 三个 runner 中提取重复的比对函数，消除 copy-paste。

### 3.3 接口

```python
# runners/compare.py

# ── 底层指标（公共） ──
def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float
def max_abs_error(a: np.ndarray, b: np.ndarray) -> float
def mean_abs_error(a: np.ndarray, b: np.ndarray) -> float
def relative_error(a: np.ndarray, b: np.ndarray) -> float
def compute_snr(a: np.ndarray, b: np.ndarray) -> float

# ── 高层比对 ──
def compare_npz(
    baseline_npz: str,
    target_npz: str,
    framework_id: str,
    threshold: float = 0.95,
) -> dict:
    """加载两个 npz，逐层比对，返回 {overall, layers}。

    overall: {
        totalLayers, passedLayers, failedLayers,
        avgCosineSimilarity, maxAbsError, worstLayer
    }
    layers: [{layerName, layerType, inputShape, outputShape, metrics: [...]}]
    """
```

### 3.4 各 runner 改动

每个 runner 删除本地的 `cosine_similarity / max_abs_error / mean_abs_error / compute_snr / compare_layers`（约 50-70 行），改为：

```python
from ..compare import compare_npz
```

### 3.5 测试

- 现有 `test_onnx_runner.py` / `test_openvino_runner.py` / `test_torch_cpu_runner.py` 保持通过
- 新增 `runners/__tests__/test_compare.py`：compare_npz 单元测试（构造两个 npz，验证指标计算正确性）

---

## 4. 📊 Report — 自包含精度报告

### 4.1 后端路由

```
GET /api/tasks/:id/report
```

### 4.2 生成流程

```
taskId → db 查 task.result (JSON)
       → 注入 HTML 模板（纯字符串拼接，不依赖模板引擎）
       → Content-Type: text/html
       → 响应
```

报告是**自包含单文件**——所有 CSS/JS 内联，数据通过 `<script>` 标签嵌入，下载后离线可打开。

### 4.3 报告内容

```
┌──────────────────────────────────────────────────┐
│  🔬 精度比对报告                                  │
│  模型: resnet18  |  框架: onnx vs openvino        │
│  创建时间: 2026-07-20 14:30                       │
├──────────┬──────────┬──────────┬─────────────────┤
│  总层数   │  通过层数   │  平均余弦  │  最差层          │
│   48     │   43 ✅   │  0.9876  │  Conv_23        │
├──────────┴──────────┴──────────┴─────────────────┤
│                                                   │
│  📈 余弦相似度分布（纯 CSS bar chart）              │
│  ████████████████████████████░░ 0.95-1.00  85%    │
│  ██████░░░░░░░░░░░░░░░░░░░░░░ 0.90-0.95  10%    │
│  ██░░░░░░░░░░░░░░░░░░░░░░░░░░ <0.90       5%     │
│                                                   │
│  📋 逐层精度表（可按列排序）                        │
│  ┌──────────┬────────┬────────┬────────┬────────┐ │
│  │ 层名      │ 余弦    │ 最大误差 │ 平均误差 │  SNR   │ │
│  │ Conv_0   │ 0.9998 │ 0.0012 │ 0.0003 │ 45.0  │ │
│  │ Conv_23  │ 0.8921 │ 0.0531 │ 0.0126 │ 18.2  │ │ ← 失败层红色高亮
│  └──────────┴────────┴────────┴────────┴────────┘ │
└──────────────────────────────────────────────────┘
```

### 4.4 技术约束

- 零外部依赖（不引图表库、CDN）
- CSS bar chart 实现分布图
- 表格排序用内联 JS（`<script>` 中写简单的 sort 函数）
- 失败层（`passed: false`）红色高亮

### 4.5 前端下载按钮

任务列表操作列增加「下载报告」按钮：

```
任务列表行
├── 序号
├── 模型名
├── 框架
├── 精度 (通过/总计)  ← 新增
├── 平均余弦           ← 新增
├── 状态
├── 创建时间
└── 操作: [下载报告] [取消]
```

点击下载按钮 → 直接请求 `/api/tasks/:id/report` → 浏览器触发文件下载。

### 4.6 后端测试

- 新增测试用例：完成态任务调用 `/api/tasks/:id/report` → 返回 `Content-Type: text/html` 且包含关键数据
- running/failed 任务返回适当提示

---

## 5. 📂 目录隔离

### 5.1 改动点

`backend/src/routers/files.ts` — multer storage 的 `destination` 回调：

```typescript
// 之前
cb(null, config.uploadDir)

// 之后
const userDir = path.join(config.uploadDir, String(userId))
await fs.mkdir(userDir, { recursive: true })
cb(null, userDir)
```

### 5.2 兼容性

- 数据库 `files.storedPath` 存绝对路径，历史数据不受影响
- `config.uploadDir` 配置项不变，只是其下多了 `<userId>/` 子目录

---

## 6. 🔌 外部 Runner 加载

### 6.1 现状

| 能力 | 状态 |
|------|------|
| `~/.taskit/runner/` 扫描 | ✅ `user-runners.ts` 已实现，仅用于展示框架列表 |
| 任务执行调用外部 runner | ❌ `task-engine.ts` 只查项目 `runners/` |

### 6.2 改动

**启动时注册**（`backend/src/index.ts`）：

```
扫描 ~/.taskit/runner/<name>/
  ├── run.sh              ← 必需
  └── config.json          ← 可选 {name, description, color}

对每个合法目录 → MODULES[`user_<name>`] = {
    name: config.name || <name>,
    runner: <name>,           // runner 目录名
    source: 'user',
    ...
}
```

约定：外部 runner 的 `run.sh` 接受与内置 runner 相同的 CLI 接口（`--input --output --node-output --precision --batch-size`）。

**执行时解析**（`backend/src/lib/task-engine.ts`）：

```
解析 runner 路径：
  1. 先查项目 runners/<name>/run.sh
  2. 未找到则查 ~/.taskit/runner/<name>/run.sh
  3. 都未找到 → error
```

### 6.3 对外部 Runner 的要求

最小实现：

```
~/.taskit/runner/vllm/
├── run.sh          # 接受 --input --output CLI，输出 JSON 到 --output
├── config.json     # { "name": "vLLM", "color": "#10b981" }
└── run.py          # 实际逻辑（可选，run.sh 调用即可）
```

输出 JSON 需遵循 `{status, framework, model, overall, layers}` 结构。

---

## 7. 🎨 UI 重构

### 7.1 去掉 DrawerTaskDetail

- 删除 `DrawerTaskDetail.tsx` 组件
- 精度详情通过下载 Report HTML 查看
- 表格列本身提供摘要信息

### 7.2 新建任务改 Modal

- `DrawerTaskForm.tsx` 重构为 `TaskFormModal.tsx`，用 `<Dialog>` 居中弹出
- Modal 尺寸：`max-w-2xl`
- 提交成功后关闭 Modal，刷新任务列表

### 7.3 任务列表增加精度列

```typescript
// 任务列表新增字段映射
{
  ...现有字段,
  passedLayers: task.result?.overall?.passedLayers,
  totalLayers: task.result?.overall?.totalLayers,
  avgCosine: task.result?.overall?.avgCosineSimilarity,
}
```

新增列：

| 列 | 数据来源 | 显示格式 |
|----|---------|---------|
| 精度 (通过/总计) | `result.overall` | `43/48` 或 `-` (未完成) |
| 平均余弦 | `result.overall` | `0.9876` 或 `-` |

### 7.4 操作列

```
[ 下载报告 ]  [ 取消 ]       ← 运行中任务
[ 下载报告 ]                  ← 已完成任务
             [ 重试 ]        ← 失败任务
```

---

## 8. 改动文件清单

| 文件 | 变更类型 | 功能 |
|------|---------|------|
| `runners/zip2npz.py` | **新增** | Zip→NPZ 公共模块 |
| `runners/compare.py` | **新增** | 公共精度比对模块 |
| `runners/onnx/run.py` | 修改 | 删除重复比对代码，import compare |
| `runners/openvino/run.py` | 修改 | 同上 |
| `runners/torch-cpu/run.py` | 修改 | 同上 |
| `backend/src/routers/tasks.ts` | 修改 | 新增 `/api/tasks/:id/report` |
| `backend/src/lib/report.ts` | **新增** | HTML 报告生成器 |
| `backend/src/routers/files.ts` | 修改 | 上传目录按 userId 隔离 |
| `backend/src/lib/task-engine.ts` | 修改 | 支持 `~/.taskit/runner/` 解析 |
| `backend/src/index.ts` | 修改 | 启动时注册外部 runner |
| `src/tasks/model_compare/DrawerTaskDetail.tsx` | **删除** | 去掉详情抽屉 |
| `src/tasks/model_compare/TaskFormModal.tsx` | **新增** | Modal 新建任务（重构自 DrawerTaskForm） |
| `src/core/components/TaskTable.tsx` | 修改 | 新增精度列 + 下载按钮 |
| `runners/__tests__/test_zip2npz.py` | **新增** | zip2npz 测试 |
| `runners/__tests__/test_compare.py` | **新增** | compare.py 测试 |
| `backend/src/__tests__/tasks.test.ts` | 修改 | 增加 report 路由测试 |

---

## 9. 不属于本轮范围

- KNN runner 实现（外部 runner 机制支持后自行添加）
- 多框架同时比对（依然是一个任务比两个框架）
- 报告图表库化（保持纯 CSS/JS，不引入 chart 库）
- deploy-agent 产品 B 功能

---

## 10. Grilling 确认

| 问题 | 决策 |
|------|------|
| zip2npz 三级回退具体含义 | 三种 zip 内部目录/文件结构适配 |
| compare.py 放哪 | `runners/compare.py` |
| Report 形式 | 自包含静态 HTML，新标签页打开 |
| Drawer 去留 | 去掉，表格列 + 下载 Report 替代 |
| 新建任务形式 | Modal 居中弹窗 |
| 目录隔离维度 | 按 userId 分子目录 |
| 外部 runner 如何注册 | 启动时扫描 `~/.taskit/runner/`，动态注册到 MODULES |
| 外部 runner CLI 约定 | 与内置 runner 一致：`--input --output --node-output --precision --batch-size` |
