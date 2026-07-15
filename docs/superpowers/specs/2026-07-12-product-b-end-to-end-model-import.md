# 产品 B: 端到端 AI 辅助模型导入服务

> **确定的外壳 + 动态的内核** — 流水线的步骤是固定的，每个节点的功能是 AI Agent 自主的。

---

## 1. 产品定义

用户提供一个 GitHub 仓库 + 模型权重，系统自动完成以下全流程并交付部署包：

```
GitHub 仓库 + 权重
    ↓
6 个阶段: torch_understand → torch2onnx → onnx2chip → gen_cpp → chip_infer → alignment
    ↓
产出物: C++ demo + CMakeLists + 端侧模型(.wk) + 推理 SO + 部署文档 + 三面对齐报告
```

**用户画像：** 部署工程师 / NPU 算子优化工程师，懂芯片工具链和 C++，有一定 Python。
**内部小规模使用，单机可部署。**

---

## 2. 核心架构：确定外壳 + 动态内核

```
┌──────────────────────────────────────────────────────────────────┐
│  确定的外壳 (DeployAgent)                                        │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  for stage in stages:                                      │  │
│  │    result = stage.expert.run(card)                         │  │
│  │    gate = stage.verify_fn(result)                          │  │
│  │    if not gate.passed: handle(gate, result)                │  │
│  │    if stage.need_approval: save_card(); return              │  │
│  │    save_card()                                             │  │
│  └────────────────────────────────────────────────────────────┘  │
│  职责: 顺序调度 / 回退 / 闸门 / 审批触发 / 持久化                │
│  不做: 不调用 LLM / 不写代码 / 不执行脚本                         │
├──────────────────────────────────────────────────────────────────┤
│  动态的内核 (Expert Agent)                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  class ONNXExportExpert(FunctionAgent):                    │  │
│  │    def run(card) -> AgentResult:                           │  │
│  │      # 自主决策、LLM 写代码、执行、修正                     │  │
│  │      # 可选内部用 LangGraph                                │  │
│  │      return AgentResult(card, trials, gate, handoff)       │  │
│  └────────────────────────────────────────────────────────────┘  │
│  职责: 自主完成任务 / 理解上下文 / 生成代码 / 自我修正            │
│  方式: 怎么做不预写，Agent 自己决定                               │
└──────────────────────────────────────────────────────────────────┘
```

### 核心原则

**流水线是确定的，节点功能是 AI Agent 动态的：**
- 步骤顺序固定（不靠 AI 决定下一步做什么）
- 回退规则固定（不靠 AI 判断该不该回退）
- 闸门标准固定（验收条件预注册）
- Agent 内部怎么做不确定——生成什么代码、怎么修错、试几次，Agent 自己决定

---

## 3. 总体架构

### 3.1 系统分层

```
┌──────────────────────────────────────────────────────────────────┐
│  Frontend (React + Tailwind + shadcn/ui)                         │
│  PipelineHub / PipelineView / Agent Console /                    │
│  ModelCardPanel / GatePanel / ArtifactBrowser / AlignmentReport  │
└─────────────────────────┬────────────────────────────────────────┘
                          │ HTTP REST (前端轮询)
┌─────────────────────────▼────────────────────────────────────────┐
│  FastAPI + Huey Worker (同进程组, multiprocessing 拉起)           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  API                                                    │       │
│  │  POST  /api/pipelines           创建流水线, Huey 入队  │       │
│  │  GET   /api/pipelines/:id       查询状态 + 消息 + 卡   │       │
│  │  POST  /api/pipelines/:id/approve  审批, Huey 重新入队 │       │
│  │  GET   /api/artifacts/*path     下载产出物             │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  DeployAgent (确定性调度器)                             │       │
│  │  for 循环 + StageDef + DeployCard                      │       │
│  │  + gates.py + rollback.py + save_card()               │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  Expert Agents (FunctionAgent 基类)                    │       │
│  │  ① torch_understand  →  ② torch2onnx                  │       │
│  │  ③ onnx2chip(Runner) →  ④ gen_cpp                   │       │
│  │  ⑤ chip_infer(Runner)→  ⑥ alignment(Runner)          │       │
│  │  + rollback_handler                                   │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  Tool Layer                                             │       │
│  │  LLM Client / Sandbox Executor / Chip SDK Wrapper       │       │
│  │  runners/{chip}/convert.sh, infer.sh, build.sh          │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  Storage                                                │       │
│  │  SQLite + 文件系统                                      │       │
│  │  pipeline/{id}/artifacts/  workspace/  checkpoints/     │       │
│  └──────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18 + TypeScript + Tailwind CSS + shadcn/ui + Recharts |
| 后端 | Python FastAPI + uvicorn |
| 异步队列 | Huey (SQLite backend) |
| 数据库 | SQLite + 文件系统 |
| LLM | Claude API / GPT API |
| 沙箱执行 | subprocess (可升级 Docker) |
| 通信 | REST (前端每 3s 轮询) |
| Agent 编排 | 外层纯 Python; Expert 内部可选用 LangGraph |

---

## 4. 核心数据结构

### 4.1 DeployCard (Pydantic)

```python
class DeployCard(BaseModel):
    id: str
    github_url: str
    weight_url: Optional[str] = None
    target_platform: str = "3559a"
    status: str = "running"
    current_stage: int = 0

    # 核心数据 — 自由扩展，各阶段按需写入
    # 约定的槽 key: slot_1_identity, slot_2_architecture, slot_3_io_contract
    #               slot_4_modifications, slot_5_pitfalls, slot_6_verification
    #               slot_7_device_path
    # 但不在 Schema 层固定，想加槽 8、9 直接写，不改代码
    data: dict = {}

    # 阶段状态
    stages: list[StageState] = []

    # 回退
    rollback: Optional[RollbackInfo] = None
    rollback_count: int = 0

    # 对账链: {A: {...}, B: {...}, C: {...}}
    reconciliation_chain: dict = {}

    # 日志
    log: list[LogEntry] = []
```

### 4.2 辅助类型

```python
class StageState(BaseModel):
    name: str
    status: Literal["pending", "running", "waiting_approval",
                     "approved", "completed", "failed"]
    attempts: int = 0
    gate_output: Optional[GateResult] = None
    gate_verification: Optional[GateResult] = None
    handoff_level: Optional[str] = None  # "thin_c" | "b_escalation"
    error: Optional[str] = None

class GateResult(BaseModel):
    passed: bool
    message: str
    metrics: dict = {}

class AgentResult(BaseModel):
    card: DeployCard
    trials: list[Trial] = []
    gate_output: Optional[GateResult] = None
    gate_verification: Optional[GateResult] = None
    handoff: Optional[HandoffLevel] = None

class RollbackInfo(BaseModel):
    from_stage: int
    to_stage: int
    reason: str
    context: dict = {}
```

### 4.3 StageDef

```python
class StageDef(BaseModel):
    name: str
    expert_class: type[FunctionAgent]
    need_approval: bool = False       # 是否在完成后等待审批
    input_slots: list[str] = []       # 需要的槽 key
    output_slots: list[str] = []      # 写入的槽 key
    verify_fn: Callable               # 验收函数 (AgentResult) -> GateResult
```

---

## 5. DeployAgent 调度器

### 5.1 主循环

```python
def run_pipeline(pipeline_id: str):
    card = load_card(pipeline_id)

    for i in range(card.current_stage, len(stages)):
        stage = stages[i]
        card.current_stage = i

        # 跳过已完成的阶段
        if card.stages[i].status in ("completed", "approved"):
            continue

        card.stages[i].status = "running"
        save_card(card)

        # 执行 Expert Agent
        result = stage.expert_class.run(card)

        # 检查回退
        if result.card.rollback:
            handle_rollback(result.card)
            save_card(result.card)
            return  # 下次从回退目标阶段重新开始

        # 检查闸门
        gate = stage.verify_fn(result)
        if not gate.passed:
            if result.card.rollback_count < card.max_rollbacks:
                # 自动回退
                card.rollback_count += 1
                card.rollback = RollbackInfo(...)
                save_card(card)
                return
            else:
                # B 放弃升级
                card.status = "failed"
                card.stages[i].status = "failed"
                card.stages[i].handoff_level = "b_escalation"
                save_card(card)
                return

        # 更新阶段状态
        card.stages[i].status = "completed"
        card.data.update(result.card.data)
        save_card(card)

        # 需要审批?
        if stage.need_approval:
            card.stages[i].status = "waiting_approval"
            save_card(card)
            return  # Huey task 结束, 等待重新入队

    card.status = "completed"
    save_card(card)
```

### 5.2 恢复机制

```python
# 审批后重新入队
@app.post("/api/pipelines/{id}/approve")
async def approve(id: str):
    card = load_card(id)
    card.stages[card.current_stage].status = "approved"
    save_card(card)
    run_pipeline(id)         # Huey 重新入队
    return {"ok": True}

# 恢复时: 入口统一从 card.current_stage 开始
# 已 completed/approved 的阶段在循环开头自动跳过
# 不区分首次运行还是恢复运行
```

### 5.3 回退机制

```python
def handle_rollback(card: DeployCard):
    target = card.rollback.to_stage

    # 标记受影响阶段的 artifact 为 stale
    for j in range(target + 1, card.current_stage + 1):
        card.stages[j].status = "pending"
        mark_artifacts_stale(card.id, stages[j].name)

    # 重置 current_stage
    card.current_stage = target

# 回退超限 → B handoff: card.status = "failed" + 结构化现场包
# 现场包内容: 当前 card / 回退历史 / Agent 最后一次尝试的 context
```

---

## 6. Expert Agent

### 6.1 接口

```python
class FunctionAgent(ABC):
    @staticmethod
    @abstractmethod
    def run(card: DeployCard) -> AgentResult:
        """Expert Agent 入口。
        内部自主决策：读上下文、LLM 写代码、sandbox 执行、自我修正。
        内部可选用 LangGraph（建议 Code Agent 风格的 Graph）。
        返回结构化结果：更新后的 card + 闸门结果 + handoff 信号。
        """
        pass
```

### 6.2 各阶段定义

| 阶段 | 类型 | 需要审批 | 输入槽 | 输出槽 | 闸门标准 |
|------|------|---------|--------|--------|---------|
| ① torch_understand | Agent | 否 (薄 C) | github_url | slot_1,2,3 | torch_infer.py 执行成功 + output shape 匹配 |
| ② torch2onnx | Agent | 是 | slot_2,3,7 | slot_4,5,6A | cosine >= 0.99 |
| ③ onnx2chip | Runner | 否 | slot_4,5 | slot_4(追加),5(追加),7 | 芯片模型文件存在 |
| ④ gen_cpp | Agent | 是 | slot_3,4,7 | — | 编译通过 |
| ⑤ chip_infer | Runner | 否 | slot_3 | slot_6B | 芯片输出数值非零 |
| ⑥ alignment | Runner | 是 | slot_6A,6B | slot_6C | 三段对账链全部过阈值 |

### 6.3 Expert 内部使用 LangGraph 的原则

- LangGraph **不控制整条流水线**，只在 Expert 节点内部用于管理 Agent 的尝试循环
- Expert 内部使用 LangGraph，或纯手写 while 循环，由 Expert 实现者自行决定
- 外层 DeployAgent 不关心 Expert 内部的实现细节

---

## 7. Handoff 分级

| 类型 | 触发条件 | 行为 |
|------|---------|------|
| **薄 C 确认** | `stage.need_approval == True` | `status = "waiting_approval"`, 等用户审批 |
| **B 放弃升级** | Agent 所有尝试失败 OR `rollback_count >= max_rollbacks` | `status = "failed"` + 结构化现场包 |

---

## 8. 前端 UI

```
/                    → Pipeline Hub（新建 + 历史列表）
/pipelines/:id       → 执行视图（Progress + Console + Card + Gates + Artifacts）
/pipelines/:id/report → 最终对齐报告
/history             → 历史列表
```

布局：

```
┌──────────────┬────────────────────────────────────┐
│ Pipeline     │ Agent Console / Approval UI        │
│ Progress     │ (对话流 + 闸门结果)                 │
│ ① ☑ ② ◉     │                                     │
│ ③ ○ ④ ○     │                                     │
│ ⑤ ○ ⑥ ○     │                                     │
├──────────────┴────────────────────────────────────┤
│ Model Card Panel                                  │
│ slot_1: LoFTR / d2294fb    slot_2: coarse→fine    │
│ slot_3: [1,3,480,640]      slot_4: NonZero→TopK   │
│ slot_5: dict mutation..    slot_6: A✓ B✗          │
│ slot_7: dnnc / WK                                  │
├───────────────────────────────────────────────────┤
│ Gate Panel (双闸门 ✓/✗ + 指标)                     │
│ Artifact Browser (ready / stale 标记)             │
└───────────────────────────────────────────────────┘
```

---

## 9. 数据模型

```sql
CREATE TABLE pipelines (
    id TEXT PRIMARY KEY,
    github_url TEXT NOT NULL,
    target_platform TEXT NOT NULL DEFAULT '3559a',
    status TEXT NOT NULL DEFAULT 'running',
    current_stage INTEGER NOT NULL DEFAULT 0,
    rollback_count INTEGER NOT NULL DEFAULT 0,
    card_json TEXT,                -- DeployCard 完整序列化
    created_at, updated_at
);

CREATE TABLE pipeline_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id TEXT REFERENCES pipelines(id),
    stage_index INTEGER, name TEXT, status TEXT,
    gate_output_json TEXT,
    gate_verification_json TEXT,
    handoff_level TEXT,
    attempts INTEGER DEFAULT 0,
    error TEXT
);

CREATE TABLE artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id TEXT REFERENCES pipelines(id),
    stage_name TEXT, name TEXT, path TEXT, type TEXT, size INTEGER,
    status TEXT DEFAULT 'ready',  -- 'ready' | 'stale'
    created_at
);

CREATE TABLE agent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id TEXT REFERENCES pipelines(id),
    stage_name TEXT, role TEXT, content TEXT, timestamp
);

CREATE TABLE rollback_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id TEXT REFERENCES pipelines(id),
    from_stage INTEGER, to_stage INTEGER, reason TEXT,
    context_json TEXT, created_at
);
```

---

## 10. 目录结构

```
product-b/
├── backend/
│   ├── app.py                      # FastAPI 入口
│   ├── api/
│   │   ├── pipelines.py            # POST/GET pipelines, approve
│   │   └── artifacts.py            # 产出物下载
│   ├── core/
│   │   ├── deploy_agent.py         # DeployAgent 主循环
│   │   ├── card.py                 # DeployCard + StageState
│   │   ├── stage.py                # StageDef
│   │   ├── gates.py                # 双闸门逻辑
│   │   └── rollback.py             # 回退处理
│   ├── experts/
│   │   ├── base.py                 # FunctionAgent 基类
│   │   ├── torch_understand.py     # ①
│   │   ├── torch2onnx.py           # ②
│   │   ├── onnx2chip.py            # ③ Runner 封装
│   │   ├── gen_cpp.py              # ④
│   │   ├── chip_infer.py           # ⑤ Runner 封装
│   │   └── alignment.py            # ⑥ Runner 封装
│   ├── tools/
│   │   ├── llm_client.py           # Claude/GPT API
│   │   ├── sandbox.py              # subprocess 沙箱
│   │   └── chip_sdk.py             # 芯片工具链封装
│   ├── runners/
│   │   ├── 3559a/capability.yaml, convert.sh, infer.sh, build.sh
│   │   ├── gpu/
│   │   └── alignment/compare.py
│   ├── workers/
│   │   └── tasks.py                # Huey: run_pipeline()
│   ├── models/
│   │   └── db.py                   # SQLite 操作
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── api/pipelines.ts
│   │   └── types/pipeline.ts
│   └── package.json
└── README.md
```

---

## 11. 阶段规划

### Phase 1: Core Pipeline

FastAPI + SQLite + Huey · DeployAgent + DeployCard + StageDef · ①② Expert Agent · 审批/回退/闸门 · 前端基础

→ 产出: 输入 GitHub → torch → ONNX 全流程可跑

### Phase 2: Chip Integration

③ onnx2chip Runner · ④ gen_cpp Agent · ⑤ chip_infer Runner · 设备能力档案 · 回退+handoff 完善 · ArtifactBrowser

→ 产出: 3559a 全流程跑通

### Phase 3: Polish

⑥ alignment + 三面对齐报告 · 对账链 A/B/C 面板 · 知识闭环 v0 · Docker 容器化 · 部署文档

→ 产出: 完整产品 B 内部可用

---

## 12. Grilling 确认清单

| 问题 | 决策 |
|------|------|
| 审批时 Huey 怎么处理 | task return + 重新入队 |
| 恢复时从哪开始 | 始终从 current_stage，不区分首次/恢复 |
| 回退配合 | current_stage 直接设回目标阶段 |
| 持久化语义 | save_card() 成功即完成 |
| Expert 用 LangGraph | 外层纯 Python，内部可选 LangGraph |
| Expert checkpoint vs 外层 | 分离，外层只关心 gate.passed |
| Agent.run() 同步/异步 | 同步，Huey 多线程 |
| 审批看到什么 | 产出物 + 关键信息摘要 |
| 审批后 current_stage | 不自增，靠 status=='approved' 跳过 |
| 回退后 artifact | 标记 stale |
| 回退超限 | failed + 结构化现场包 |
