# 产品 B: 端到端 AI 辅助模型导入服务

> **轻量调度 + 多 Expert Agent 协作** — 从 GitHub 模型源码到 NPU/GPU 芯片推理部署包的全自动生成。

---

## 1. 背景与目标

### 1.1 产品定义

产品 B 是一个**多 Agent 协作的端到端模型导入 Web 服务**。用户提供一个 GitHub 仓库地址和模型权重，系统自动完成以下全流程：

```
GitHub 仓库 + 权重
    ↓
6 个 Expert Agent 协作: 理解模型 → 转换 → 适配芯片 → 生成代码 → 部署推理 → 三面对齐
    ↓
产出物: C++ demo + CMakeLists + 端侧模型(.wk) + 推理 SO + 部署文档 + 三面对齐报告
```

### 1.2 用户画像

- **部署工程师** — 负责将模型部署到端侧芯片，懂芯片工具链、C++，有一定 Python 基础
- **NPU 算子优化工程师** — 优化芯片推理性能，需要快速拿到芯片模型和基准结果
- **内部小规模使用** — 非 SaaS 产品，定位为团队内部工具，易部署、易调试

### 1.3 核心设计原则

1. **轻量确定性调度 + 多 Expert Agent** — Orchestrator 只管顺序、回退、闸门、审批。每个步骤是独立 Expert Agent 实例，自主理解上下文、生成代码、执行验证
2. **半自动审批** — Handoff 分级：不可逆决策（薄 C 确认）才等人；Agent 真搞不定（B 放弃）才升级
3. **可扩展芯片后端** — 3559a、GPU 是首发，新芯片只需加 capability.yaml + 芯片 Runner
4. **轻量化** — SQLite 存储，单进程可部署，Huey 做异步任务队列

---

## 2. 总体架构

### 2.1 系统分层

```
┌──────────────────────────────────────────────────────────────────┐
│  Frontend (TypeScript · React · Tailwind · shadcn/ui)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ │
│  │Pipeline  │ │Agent     │ │Model Card│ │Gate      │ │Metrics│ │
│  │Designer  │ │Console   │ │Panel(7槽)│ │Panel     │ │Panel  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └───────┘ │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │ Artifact     │  │ AlignmentReport  (三列表格 + 雷达图)      │ │
│  │ Browser      │  │                                          │ │
│  └──────────────┘  └──────────────────────────────────────────┘ │
└─────────────────────────┬────────────────────────────────────────┘
                          │ HTTP REST (前端轮询)
┌─────────────────────────▼────────────────────────────────────────┐
│  FastAPI + Huey Worker                                           │
│                                                                  │
│  ┌───────────────────────────────────────────────────────┐      │
│  │  API: POST /pipelines  ·  GET /pipelines/:id           │      │
│  │       POST /pipelines/:id/approve  ·  GET /artifacts   │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                  │
│  ┌───────────────────────────────────────────────────────┐      │
│  │  Huey Task Queue (SQLite backend)                      │      │
│  │  run_pipeline(id) — 审批时重新入队                      │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                  │
│  ┌───────────────────────────────────────────────────────┐      │
│  │  Orchestrator (确定性调度器)                            │      │
│  │  · 顺序调度 · 回退管理 · 闸门执行 · 审批触发            │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                  │
│  ┌───────────────────────────────────────────────────────┐      │
│  │  Expert Agent Nodes                                     │      │
│  │  ①torch_understand → ②torch2onnx → ③onnx2chip         │      │
│  │  → ④gen_cpp → ⑤chip_infer → ⑥alignment                │      │
│  │  + rollback_handler                                     │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                  │
│  ┌───────────────────────────────────────────────────────┐      │
│  │  Tool Layer: LLM Client · Sandbox · Chip SDK Wrapper   │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                  │
│  ┌───────────────────────────────────────────────────────┐      │
│  │  Storage: SQLite + 文件系统                             │      │
│  │  pipeline/{id}/artifacts/  workspace/  checkpoints/    │      │
│  └───────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层 | 技术 |
|---|------|
| 前端框架 | React 18 + TypeScript |
| 前端 UI | Tailwind CSS + shadcn/ui |
| 图表 | Recharts |
| 后端框架 | Python FastAPI + uvicorn |
| 异步队列 | Huey (SQLite backend) |
| 调度编排 | LangGraph (StateGraph + Checkpointer + Interrupt) |
| 数据库 | SQLite (aiosqlite) |
| LLM | Claude API / GPT API |
| 沙箱执行 | subprocess（可升级 Docker）|
| 前后端通信 | REST（前端每 3 秒轮询）|

---

## 3. 核心设计：轻量 Orchestrator + Expert Agent

### 3.1 职责划分

```
Orchestrator (确定性调度器，不含 AI)
  ✅ 按顺序推进步骤
  ✅ 执行双闸门（产出物 + 验证）
  ✅ 处理回退（下游 → 上游，保留槽数据）
  ✅ 触发审批中断（仅不可逆决策点）
  ✅ 管理 State 持久化
  ✗ 不调用 LLM，不生成代码，不执行脚本

Expert Agent Node (独立 Agent 实例)
  ✅ 理解当前上下文（读 7 槽 + 已有产出物）
  ✅ 自主决策如何完成本步骤
  ✅ 生成执行代码（代码本身即为产出物）
  ✅ 执行 → 观察 → 修正 → 重试
  ✅ 写入槽数据
```

### 3.2 为什么 Orchestrator 不是 Agent

- 流水线顺序是固定的，不需要 AI 决策
- 回退规则是确定的
- Agent 只存在于需要智能的地方（Expert Node 内部）

---

## 4. 模型理解卡（7 槽）

| 槽 | 名称 | 写入阶段 | 内容 |
|---|------|---------|------|
| 1 | 模型身份与来源 | ① torch_understand | repo, commit, weights, target_device |
| 2 | 架构与数据流理解 | ① torch_understand | forward_path, unconvertible_ops |
| 3 | I/O 契约 | ① torch_understand | input_shape, output_shape, dtype, batch_dim |
| 4 | 改造决策日志 | ②③ 累积 | original_op, replacement, cost, rationale |
| 5 | 已遇坑清单 | ②③ 累积 | phenomenon, root_cause, solution, knowledge_ref |
| 6 | 逐阶段验证状态 | ②⑤⑥ 写入 | A(torch-onnx), B(onnx-chip), C(chip-torch) |
| 7 | 设备与转换路径 | ③ onnx2chip | toolchain, converter_args, target_spec |

**槽7 约束前置：** 设备能力档案在②开始前就注入，不等③才发现不兼容。

**槽5 累积传递：** 每个步骤追加新坑，下游读取所有已记录坑防止重踩。

**回退时槽不丢：** 全部槽保留，受影响步骤的 artifact 标记为 stale。

---

## 5. LangGraph 调度设计

### 5.1 Graph 定义

```python
builder = StateGraph(PipelineState)

# 7 个节点
builder.add_node("torch_understand",  torch_understand_node)
builder.add_node("torch2onnx",        torch2onnx_node)
builder.add_node("onnx2chip",         onnx2chip_node)
builder.add_node("gen_cpp",           gen_cpp_node)
builder.add_node("chip_infer",        chip_infer_node)
builder.add_node("alignment",         alignment_node)
builder.add_node("rollback_handler",  rollback_handler_node)

# 正向边
builder.add_edge(START, "torch_understand")
builder.add_edge("torch_understand", "torch2onnx")
builder.add_edge("torch2onnx", "onnx2chip")
builder.add_edge("onnx2chip", "gen_cpp")
builder.add_edge("gen_cpp", "chip_infer")
builder.add_edge("chip_infer", "alignment")
builder.add_edge("alignment", END)

# 回退边: 任意节点 → rollback_handler
for node in ["torch2onnx", "onnx2chip", "gen_cpp", "chip_infer", "alignment"]:
    builder.add_edge(node, "rollback_handler")

# rollback_handler 按回退目标路由
def route_after_rollback(state): return state["rollback_context"]["to_step"]
builder.add_conditional_edges("rollback_handler", route_after_rollback, {...})

graph = builder.compile(
    checkpointer=SqliteSaver.from_conn_string("pipeline_state.db"),
    interrupt_before=[
        "torch2onnx",    # 不可逆: 基准输出确定
        "gen_cpp",       # 不可逆: 芯片模型 + C++ 代码
        "alignment",     # 最终审查
    ]
)
```

### 5.2 审批恢复

```python
@app.post("/api/pipelines/{id}/approve")
async def approve(id: str):
    db.execute("UPDATE pipeline_steps SET status='approved' ...")
    run_pipeline(id)  # Huey 重新入队, LangGraph 从 Checkpoint 恢复
    return {"ok": True}
```

### 5.3 Handoff 分级

| 类型 | 触发 | 行为 |
|------|------|------|
| 薄 C 确认 | `interrupt_before` 3 个决策点 | 中断等审批 |
| B 放弃 | 所有尝试失败 OR 回退超限 | 标记 failed + 结构化现场包 |

---

## 6. 设备能力档案 + 约束前置

```yaml
# runners/3559a/capability.yaml
platform: 3559a
toolchain: dnnc
supported_ops: [Conv, Relu, Gemm, Softmax, BatchNorm, ...]
unsupported_ops:
  - op: NonZero
    replacement: TopK
    cost: "performance ×2"
  - op: dict_mutation
    replacement: null
    requires: "handoff_B"
opset_range: [11, 17]
precision: [fp32, int8]
```

新芯片接入: `capability.yaml` + `runners/{chip}/convert.sh` + `infer.sh` + `build.sh`

---

## 7. 前端 UI

```
/                    → Pipeline Hub（新建 + 历史列表）
/pipelines/:id       → 执行视图
                       ┌──────────┬─────────────────────┐
                       │ Progress │ Agent Console        │
                       │ ① ☑ ② ◉ │ (对话流 + 闸门结果)  │
                       │ ③ ○ ④ ○ │                      │
                       │ ⑤ ○ ⑥ ○ │                      │
                       ├──────────┴─────────────────────┤
                       │ Model Card Panel (7槽实时)      │
                       │ Gate Panel (双闸门 ✓/✗)        │
                       │ Artifact Browser               │
                       └────────────────────────────────┘
/pipelines/:id/report → 三面对齐报告（表格 + 雷达图 + 对账链A/B/C）
/history              → 历史列表
```

---

## 8. 数据模型

```sql
CREATE TABLE pipelines (
    id TEXT PRIMARY KEY,
    github_url TEXT NOT NULL, weight_url TEXT,
    target_platform TEXT NOT NULL DEFAULT '3559a',
    status TEXT NOT NULL DEFAULT 'running',
    current_step INTEGER NOT NULL DEFAULT 0,
    rollback_count INTEGER NOT NULL DEFAULT 0,
    created_at, updated_at
);

CREATE TABLE pipeline_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    step_index INTEGER NOT NULL, name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts, max_attempts,
    gate_output BOOLEAN, gate_verification BOOLEAN,
    error TEXT, handoff_level TEXT, -- NULL | 'thin_c' | 'b_escalation'
    started_at, completed_at
);

CREATE TABLE artifacts (
    id, pipeline_id, step_name, name, path, type, size,
    status TEXT NOT NULL DEFAULT 'ready', -- 'ready' | 'stale'(回退后)
    created_at
);

CREATE TABLE agent_messages (id, pipeline_id, step_name, role, content, timestamp);
CREATE TABLE rollback_logs (id, pipeline_id, from_step, to_step, reason, context_json, created_at);
```

---

## 9. 目录结构

```
product-b/
├── backend/
│   ├── app.py                    # FastAPI 入口
│   ├── api/pipelines.py, artifacts.py
│   ├── orchestrator/
│   │   ├── graph.py              # LangGraph 定义
│   │   ├── state.py              # PipelineState
│   │   ├── gates.py              # 双闸门
│   │   └── rollback.py           # 回退处理
│   ├── experts/                  # Expert Agent 节点
│   │   ├── base.py               # Agent 基类
│   │   ├── torch_understand.py, torch2onnx.py
│   │   ├── onnx2chip.py, gen_cpp.py
│   │   ├── chip_infer.py, alignment.py
│   ├── tools/
│   │   ├── llm_client.py, sandbox.py, chip_sdk.py
│   ├── cards/model_card.py       # 7 槽读写
│   ├── workers/tasks.py          # Huey task: run_pipeline()
│   ├── models/db.py
│   ├── runners/{3559a,gpu}/      # capability.yaml + convert/infer/build.sh
│   │   └── alignment/compare.py
│   ├── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/PipelineHub, PipelineView, History
│   │   ├── components/
│   │   │   PipelineDesigner, PipelineProgress, AgentConsole,
│   │   │   ModelCardPanel, GatePanel, MetricsPanel,
│   │   │   ArtifactBrowser, AlignmentReport, ApprovalDialog
│   │   ├── api/pipelines.ts
│   │   └── types/pipeline.ts
│   ├── package.json, vite.config.ts
└── README.md
```

---

## 10. 阶段规划

### Phase 1: Core Pipeline
FastAPI + SQLite + Huey 框架 · LangGraph + State + Checkpoint · ①② Expert Agent · 7 槽 + 双闸门 + 前端基础 — **产出: torch → ONNX 全流程**

### Phase 2: Chip Integration
③④⑤芯片 Runner · 回退机制 + Handoff · ArtifactBrowser · 芯片设备档案 — **产出: 3559a 全流程跑通**

### Phase 3: Polish
⑥三面对齐 + 报告 · MetricsPanel · 知识闭环 v0 · Docker 容器化 — **产出: 完整产品 B**

---

## 11. 方案要点速查

1. **轻量 Orchestrator + Expert Agent** — 调度确定，智能在 Agent 内部
2. **LangGraph + Huey** — 管状态/审批/Checkpoint + 管异步队列
3. **7 槽模型理解卡** — 显式知识外化，人机共享
4. **回退机制** — 带原因回退上游，保留槽，有上限
5. **双闸门 + 对账链 A/B/C** — 产出闸门 + 验证闸门，三段独立判据
6. **Handoff 分级** — 薄 C (3 个决策点) + B 升级
7. **设备能力档案 + 约束前置** — YAML 档案在 torch2onnx 注入
8. **观测三层** — 卡槽面板 + 闸门面板 + 指标面板
9. **前端轮询** — 删除 SSE
10. **产出物** — C++ demo + CMakeLists + .wk + SO + 文档 + 对齐报告
