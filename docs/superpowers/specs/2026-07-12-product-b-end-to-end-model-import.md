# 产品 B: 端到端 AI 辅助模型导入服务

> **AI Agent 驱动的模型导入流水线** — 从 GitHub 模型源码到 NPU/GPU 芯片推理的全自动部署。

---

## 1. 背景与目标

### 1.1 产品定义

产品 B 是一个**AI Agent 驱动的端到端模型导入 Web 服务**。用户提供一个 GitHub 仓库地址和模型权重，系统自动完成以下全流程：

```
GitHub 仓库 + 权重
    ↓
Agent 流水线: 理解模型 → 转换 → 适配芯片 → 生成代码 → 部署推理 → 精度对齐
    ↓
产出物: C++ demo + 端侧模型(.wk) + 推理 SO + 部署文档
```

### 1.2 用户画像

- **部署工程师** — 负责将模型部署到端侧芯片，懂芯片工具链、懂 C++，有一定 Python 基础
- **NPU 算子优化工程师** — 优化芯片上的推理性能，需要快速拿到芯片模型和基准结果
- **内部小规模使用** — 非 SaaS 产品，定位为团队内部工具，易部署、易调试

### 1.3 核心设计原则

1. **AI Agent 自主驱动** — 每个步骤由 Agent 自主理解代码、生成脚本、运行、自我修正
2. **半自动审批** — 每个 Agent 步骤完成后等待用户审查产出物，确认后继续
3. **可扩展芯片后端** — 3559a、GPU 是首发，架构支持任意芯片平台
4. **轻量化** — 内部小规模使用，SQLite 存储，单机可部署

---

## 2. 总体架构

### 2.1 系统分层

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend (TypeScript · React · Tailwind · shadcn/ui)        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ Pipeline     │ │ Agent        │ │ Artifact Browser     │ │
│  │ Designer     │ │ Console      │ │ (产出物浏览/下载)    │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
└─────────────────────────┬────────────────────────────────────┘
                          │ HTTP REST + SSE (Server-Sent Events)
┌─────────────────────────▼────────────────────────────────────┐
│  Backend (Python · FastAPI)                                  │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  API 层                                               │    │
│  │  POST   /api/pipelines          创建流水线             │    │
│  │  GET    /api/pipelines/:id      查询状态               │    │
│  │  POST   /api/pipelines/:id/approve  审批节点          │    │
│  │  GET    /api/pipelines/:id/stream  SSE 流(Future)     │    │
│  │  GET    /api/artifacts/*path    下载产出物             │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  LangGraph Agent                                      │    │
│  │  ┌──────────────────┐ ┌──────────┐ ┌──────────────┐ │    │
│  │  │ State Schema     │ │ Graph    │ │ Human-in-loop│ │    │
│  │  │ (TypedDict)      │ │ (Nodes)  │ │ (Interrupt)  │ │    │
│  │  └──────────────────┘ └──────────┘ └──────────────┘ │    │
│  │  ┌──────────────────────────────────────────────┐   │    │
│  │  │ Checkpointer (SQLite) — 自动断点续跑 + 恢复   │   │    │
│  │  └──────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Tool Layer (Agent 可调用的能力)                      │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │    │
│  │  │ LLM      │ │ Sandbox  │ │ Chip SDK Wrapper     │ │    │
│  │  │ Client   │ │ Executor │ │ (Python 封装的 CLI)  │ │    │
│  │  │(Claude   │ │(跑脚本)  │ │ runners/             │ │    │
│  │  │ /GPT)    │ │         │ │  ├── onnx2chip       │ │    │
│  │  └──────────┘ └──────────┘ │  ├── chip_infer      │ │    │
│  │                            │  └── alignment       │ │    │
│  └────────────────────────────┴────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Storage Layer                                        │    │
│  │  ┌──────────┐ ┌────────────────────────────────┐    │    │
│  │  │ SQLite   │ │ File Store                     │    │    │
│  │  │(流水线/  │ │ pipeline/{id}/                 │    │    │
│  │  │ 步骤/    │ │ ├── artifacts/  (产出物)        │    │    │
│  │  │ 产物meta)│ │ ├── workspace/ (Agent工作目录)   │    │    │
│  │  └──────────┘ │ └── state/     (checkpoints)    │    │    │
│  └──────────────────┴────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 前端框架 | React 18 + TypeScript | 参考 Taskit 技术栈 |
| 前端 UI | Tailwind CSS + shadcn/ui | 组件可复用 |
| 图表 | Recharts | 精度雷达图复用 |
| 后端框架 | Python FastAPI + uvicorn | 异步、高性能 |
| Agent 编排 | LangGraph | StateGraph + Checkpointer |
| 数据库 | SQLite (aiosqlite) | 轻量、零配置 |
| LLM | Claude API / GPT API | 外部 LLM |
| 沙箱执行 | subprocess / 可选 Docker | 运行生成的脚本 |
| 通信 | REST + SSE | 前端轮询 + 流式推送 |

---

## 3. LangGraph 流水线设计

### 3.1 State Schema

```python
from typing import TypedDict, Optional, Literal
from langgraph.graph import StateGraph

class Artifact(TypedDict):
    name: str                       # 文件名，如 "torch_infer.py"
    path: str                       # 相对 artifact 目录的路径
    type: Literal["script", "model", "data", "doc", "lib"]
    size: int                       # 字节
    description: str                # 用途说明

class AgentMessage(TypedDict):
    role: Literal["agent", "tool", "system", "user"]
    content: str                    # 消息内容
    timestamp: str                  # ISO 时间

class StepState(TypedDict):
    name: str                       # 步骤名，如 "torch_understand"
    status: Literal["pending", "running", "waiting_approval", "approved", "failed"]
    attempts: int                   # 当前重试次数
    max_attempts: int               # 最大重试次数
    artifacts: list[Artifact]       # 本步骤的产出物
    messages: list[AgentMessage]    # Agent 在本步骤的思考过程
    error: Optional[str]            # 最后一次失败的错误信息

class PipelineState(TypedDict):
    id: str                         # 流水线 UUID
    status: Literal["running", "waiting_approval", "completed", "failed"]
    github_url: str                 # GitHub 仓库地址
    weight_url: Optional[str]       # 权重下载链接（可选）
    weight_file: Optional[str]      # 已上传的权重文件路径（可选）
    target_platform: str            # 目标芯片平台，如 "3559a"
    current_step: int               # 当前执行到第几步 (index)
    steps: list[StepState]          # 所有步骤的状态
    artifacts: list[Artifact]       # 流水线整体产出物
    created_at: str
    updated_at: str
```

### 3.2 Graph 定义

流水线是线性 DAG，每个 Step 对应一个 Graph Node：

```python
from langgraph.graph import StateGraph, START
from langgraph.checkpoint.sqlite import SqliteSaver

builder = StateGraph(PipelineState)

# 注册所有节点（每个步骤一个 Agent 循环）
builder.add_node("torch_understand", torch_understand_node)
builder.add_node("torch2onnx",        torch2onnx_node)
builder.add_node("onnx2chip",         onnx2chip_node)
builder.add_node("gen_cpp",           gen_cpp_node)
builder.add_node("chip_infer",        chip_infer_node)
builder.add_node("alignment",         alignment_node)

# 线性连接
builder.add_edge(START, "torch_understand")
builder.add_edge("torch_understand", "torch2onnx")
builder.add_edge("torch2onnx", "onnx2chip")
builder.add_edge("onnx2chip", "gen_cpp")
builder.add_edge("gen_cpp", "chip_infer")
builder.add_edge("chip_infer", "alignment")

# 审批门控：每个节点执行完后 interrupt，等用户审批
graph = builder.compile(
    checkpointer=SqliteSaver.from_conn_string("pipeline_state.db"),
    interrupt_before=[
        "torch2onnx",     # 看完 torch 推理脚本后审批
        "onnx2chip",      # 看完 ONNX 对齐报告后审批
        "gen_cpp",        # 芯片模型生成后审批
        "chip_infer",     # C++ 代码审查后审批
        "alignment",      # 芯片结果回来后审批
    ]
)
```

**关键设计：** `interrupt_before` 在每个步骤**之前**中断，用户审批后自动进入下一个节点。每个节点内部是 Agent 循环（多次 LLM 调用 + 执行）。最后一个节点（alignment）不需要在它之后中断——完成后直接结束。

### 3.3 每个 Node 内部的 Agent 循环

Node 不是"调一次 LLM"，而是**一个内部循环**：

```python
def agent_loop_step(
    state: PipelineState,
    step_index: int,
    system_prompt: str,
    tools: list,
    max_attempts: int = 5,
) -> PipelineState:
    """
    通用 Agent 循环模板。
    每个步骤: LLM 生成代码 → 执行 → 检查 → 成功则通过，失败则循环
    """
    step = state["steps"][step_index]
    step["status"] = "running"
    step["attempts"] = 0

    while step["attempts"] < max_attempts:
        step["attempts"] += 1

        # 1. LLM 根据当前状态生成代码/方案
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=build_context(state, step_index)),
        ])
        step["messages"].append({
            "role": "agent", "content": response.content, "timestamp": now()
        })

        # 2. 执行生成的代码
        result = sandbox_executor.run(response.content)

        if result.success:
            # 3. 验证产出物
            validation = validate_output(result, step["name"])
            if validation.passed:
                step["status"] = "completed"
                step["artifacts"] = extract_artifacts(result)
                return state
            else:
                step["messages"].append({
                    "role": "tool", "content": f"验证失败: {validation.error}",
                    "timestamp": now()
                })
        else:
            step["messages"].append({
                "role": "tool", "content": f"执行失败:\n{result.stderr}",
                "timestamp": now()
            })

    # 超过最大尝试次数
    step["status"] = "failed"
    step["error"] = f"超过最大重试次数 ({max_attempts})"
    return state
```

### 3.4 Human-in-the-loop 审批流程

```python
# 用户通过 API 审批
@app.post("/api/pipelines/{id}/approve")
async def approve_step(id: str):
    # 1. 从 checkpointer 恢复 pipeline state
    thread = {"configurable": {"thread_id": id}}
    state = graph.get_state(thread)

    # 2. 更新当前步骤状态为 approved
    step_idx = state.values["current_step"]
    state.values["steps"][step_idx]["status"] = "approved"

    # 3. 继续执行下一个节点
    result = graph.invoke(
        None,  # 不传新输入，继续之前的流
        thread,
        interrupt_before=[...]  # 下一个中断点
    )

    return {"status": "running", "current_step": result["current_step"]}
```

---

## 4. 前端 UI 设计

### 4.1 页面结构

```
┌──────────────────────────────────────────────────────────────┐
│  TopNav                                                      │
│  [● Pipeline Hub]  [History]  [☀ 主题]  [用户]              │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  主内容区: 根据当前视图切换                                    │
│                                                               │
│  ┌──────────────┬────────────────────────────────────────┐   │
│  │  Pipeline    │  Agent Console                           │   │
│  │  进度列表    │  ┌─────────────────────────────────┐    │   │
│  │              │  │ [Agent] 已克隆仓库，发现模型为     │    │   │
│  │  ☑ ① Torch  │  │ ResNet50，输入 3x224x224        │    │   │
│  │     理解     │  │                                  │    │   │
│  │  ◉ ② ONNX   │  │ [Agent]正在编写 torch 推理脚本...│    │   │
│  │     转换     │  │ ```python                       │    │   │
│  │  ○ ③ 芯片    │  │ model.eval()                    │    │   │
│  │     转换     │  │ ...                             │    │   │
│  │  ○ ④ C++    │  │ ```                              │    │   │
│  │     生成     │  │                                  │    │   │
│  │  ○ ⑤ 芯片   │  │ [系统] 执行完成，cosine=0.9992   │    │   │
│  │     推理     │  │                                  │    │   │
│  │  ○ ⑥ 三面   │  └─────────────────────────────────┘    │   │
│  │     对齐     │                                        │   │
│  └──────────────┴────────────────────────────────────────┘   │
│                                                               │
│  底部: Artifact Browser                                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 📁 pipeline_42/artifacts/                         对比  │  │
│  │ ├── torch_infer.py  ● 已验证  1.2 KB     ┌──────┐      │  │
│  │ ├── model.onnx      ● 已验证  2.3 MB     │ 对比  │      │  │
│  │ └── model_3559a.wk  ○ 待验证  1.8 MB     │ 查看  │      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 核心 UI 组件

| 组件 | 功能 | 参考 Taskit |
|------|------|------------|
| `PipelineDesigner` | 输入 GitHub 地址 + 选择芯片平台 | 参考 TaskForm 改造 |
| `PipelineProgress` | 左侧步骤列表 + 状态指示器 | 新增 |
| `AgentConsole` | 右侧 Agent 对话流，类似 Claude Code 的聊天界面 | 新增 |
| `ArtifactBrowser` | 底部产出物列表，可下载/预览/对比 | 新增 |
| `AlignmentReport` | 精度对齐报告（三列表格 + 雷达图） | 复用 LayerTable + OverviewChart |
| `ApprovalDialog` | 审批弹窗，展示产出物 + [确认] [驳回] [修改] | 新增 |

### 4.3 页面路由

```
/                    → Pipeline Hub（首页，新建 + 历史列表）
/pipelines/:id       → 流水线执行视图（进度 + Agent Console + Artifacts）
/pipelines/:id/report → 最终对齐报告（流水线完成后）
/history             → 历史流水线列表
```

---

## 5. 数据模型

### 5.1 SQLite 表结构

```sql
-- 流水线
CREATE TABLE pipelines (
    id TEXT PRIMARY KEY,
    github_url TEXT NOT NULL,
    weight_url TEXT,
    weight_file TEXT,
    target_platform TEXT NOT NULL DEFAULT '3559a',
    status TEXT NOT NULL DEFAULT 'running',
    current_step INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 流水线步骤
CREATE TABLE pipeline_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    step_index INTEGER NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    error TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);

-- 产出物
CREATE TABLE artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    step_name TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agent 消息（用于 SSE 推送 / 前端展示）
CREATE TABLE agent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    step_name TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- LangGraph Checkpointer（由 LangGraph 自动管理）
-- 表名: checkpoint_blobs, checkpoints, writes, checkpoint_migrations
```

### 5.2 LangGraph Checkpointer

LangGraph 内置的 `SqliteSaver` 自动管理 checkpoints 表，无需手写。每次 `interrupt_before` 触发时，graph 的完整 state 自动保存到 SQLite。

---

## 6. Runner / Tool Layer

### 6.1 工具清单

Agent 可调用的工具分为两类：

**LLM 驱动工具（Agent 通过 LLM 写代码 + 执行）：**

| 工具 | 说明 | 输入 | 输出 |
|------|------|------|------|
| `llm_write_code` | LLM 根据需求写代码 | prompt + 上下文 | 代码文件 |
| `sandbox_execute` | 沙箱中执行 Python/C++ | 脚本路径 | stdout + stderr + 产出物 |
| `git_clone` | 克隆 GitHub 仓库 | 仓库 URL | 仓库目录 |
| `read_file` | 读取分析已有代码 | 文件路径 | 文件内容 |

**确定性工具（封装 CLI / SDK）：**

| 工具 | 说明 | 对应的 Runner |
|------|------|-------------|
| `onnx2chip_convert` | ONNX → 芯片模型 | runners/{chip}/convert.sh |
| `chip_infer_run` | 部署 + 芯片推理 | runners/{chip}/infer.sh |
| `compute_alignment` | 精度比对（三路） | runners/alignment/compare.py |
| `compile_cpp` | 交叉编译 C++ 代码 | runners/{chip}/build.sh |

### 6.2 目录结构

```
product-b/
├── backend/
│   ├── app.py                 # FastAPI 入口
│   ├── api/
│   │   ├── pipelines.py       # 流水线 REST API
│   │   └── artifacts.py       # 产出物下载 API
│   ├── agent/
│   │   ├── graph.py           # LangGraph 定义
│   │   ├── state.py           # State Schema
│   │   ├── nodes/
│   │   │   ├── torch_understand.py
│   │   │   ├── torch2onnx.py
│   │   │   ├── onnx2chip.py
│   │   │   ├── gen_cpp.py
│   │   │   ├── chip_infer.py
│   │   │   └── alignment.py
│   │   ├── tools/
│   │   │   ├── llm_client.py
│   │   │   ├── sandbox.py
│   │   │   └── chip_sdk.py
│   │   └── prompts/
│   │       ├── torch_understand.txt
│   │       ├── torch2onnx.txt
│   │       └── gen_cpp.txt
│   ├── models/
│   │   └── db.py              # SQLite 表操作
│   ├── runners/               # 确定性脚本（按芯片平台分）
│   │   ├── 3559a/
│   │   │   ├── convert.sh
│   │   │   ├── infer.sh
│   │   │   └── build.sh
│   │   ├── gpu/
│   │   │   └── ...
│   │   └── alignment/
│   │       └── compare.py     # 精度比对（参考 Taskit 算法）
│   ├── requirements.txt
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── PipelineHub.tsx
│   │   │   ├── PipelineView.tsx
│   │   │   └── History.tsx
│   │   ├── components/
│   │   │   ├── PipelineDesigner.tsx
│   │   │   ├── PipelineProgress.tsx
│   │   │   ├── AgentConsole.tsx
│   │   │   ├── ArtifactBrowser.tsx
│   │   │   ├── AlignmentReport.tsx
│   │   │   └── ApprovalDialog.tsx
│   │   ├── api/
│   │   │   └── pipelines.ts
│   │   └── types/
│   │       └── pipeline.ts
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

---

## 7. 流水线各步骤详细设计

### 7.1 torch_understand

| 项目 | 内容 |
|------|------|
| 类型 | Agent 循环 |
| 输入 | GitHub URL, 权重文件/链接 |
| 产出物 | `torch_infer.py`, `ref_output.npz`, `model_info.json` |
| 最大尝试 | 5 次 |
| 审批 | ✅ 需要（审查生成的推理脚本是否正确） |

**Agent 循环逻辑：**
1. `git_clone` 克隆仓库
2. `read_file` 分析模型定义文件（读取 `model.py`、`README.md` 等）
3. LLM 理解模型结构（输入/输出形状、预处理流程、类别数）
4. LLM 生成 `torch_infer.py`（加载权重 → 预处理 → 推理 → 后处理）
5. `sandbox_execute` 运行 `torch_infer.py`
6. 成功 → 验证输出合理性（shape 正确、数值非空）
7. 失败 → LLM 分析错误 → 修复 → 重试

### 7.2 torch2onnx

| 项目 | 内容 |
|------|------|
| 类型 | Agent 循环 |
| 输入 | torch_infer.py, ref_output.npz |
| 产出物 | `model.onnx`, `onnx_infer.py`, `alignment_report.json` |
| 审批 | ✅ 需要（审查 ONNX 转换和对齐结果） |

**Agent 循环逻辑：**
1. LLM 生成 `torch2onnx.py`（torch.onnx.export + 动态轴配置）
2. `sandbox_execute` 运行转换脚本 → 产出 `model.onnx`
3. LLM 生成 `onnx_infer.py`（ONNX Runtime 推理脚本）
4. `sandbox_execute` 运行 ONNX 推理 → 产出 `onnx_output.npz`
5. 调用 `compute_alignment(ref_output.npz, onnx_output.npz)` 比对
6. 余弦相似度 ≥ 0.99 → 通过；否则 LLM 分析差异原因并修复

### 7.3 onnx2chip

| 项目 | 内容 |
|------|------|
| 类型 | 确定性 Runner |
| 输入 | model.onnx |
| 产出物 | `model_{chip}.wk` / `model_{chip}.param`（芯片模型文件） |
| 审批 | ✅ 需要（审查芯片模型是否生成成功） |

**执行逻辑：**
1. 调用 `runners/{target_platform}/convert.sh --input model.onnx --output model_{chip}.wk`
2. 芯片工具链（如 Hisilicon nnie_mapper）执行转换
3. 转换成功 → 输出芯片模型文件
4. 失败 → 返回芯片工具链的错误信息，由上游 Agent 分析处理

### 7.4 gen_cpp

| 项目 | 内容 |
|------|------|
| 类型 | Agent 循环 |
| 输入 | model_info.json, model_{chip}.wk, chip SDK 文档 |
| 产出物 | `infer.cpp`, `CMakeLists.txt`, `build.sh`, `README.md` |
| 审批 | ✅ 需要（审查 C++ 代码质量） |

**Agent 循环逻辑：**
1. LLM 读取芯片 SDK 文档（内部知识库或仓库内文档）
2. LLM 生成 `infer.cpp`（模型加载 → 预处理 → 推理 → 后处理 → 输出结果）
3. LLM 生成 `CMakeLists.txt`（链接芯片 SDK 库）
4. LLM 生成 `build.sh`（交叉编译脚本）
5. 调用 `compile_cpp`（交叉编译验证）
6. 编译失败 → LLM 分析编译错误 → 修复 → 重试

### 7.5 chip_infer

| 项目 | 内容 |
|------|------|
| 类型 | 确定性 Runner |
| 输入 | model_{chip}.wk, infer, chip 设备信息 |
| 产出物 | `chip_output.npz`, `performance.json` |
| 审批 | ✅ 需要（审查芯片推理结果） |

**执行逻辑：**
1. 调用 `runners/{target_platform}/infer.sh --model model_{chip}.wk --bin infer --output chip_output.npz`
2. 工具链自动执行：交叉编译 → SCP 部署 → SSH 执行 → SCP 拉回结果
3. 输出芯片推理的 tensor 值 + 性能数据

### 7.6 alignment

| 项目 | 内容 |
|------|------|
| 类型 | 确定性 Runner |
| 输入 | ref_output.npz, onnx_output.npz, chip_output.npz |
| 产出物 | `final_report.json` |
| 审批 | 不需要（最后一步，完成后直接展示） |

**执行逻辑：**
1. 三路对比：torch vs onnx, onnx vs chip, torch vs chip
2. 逐层计算 cosine similarity、max abs error、SNR
3. 生成 `final_report.json`（三面对齐报告）
4. 汇总所有产出物到最终目录

---

## 8. 阶段规划

### Phase 1: Core Pipeline（MVP）

| 模块 | 工作量估计 |
|------|-----------|
| 后端框架搭建 (FastAPI + SQLite) | ~1d |
| LangGraph Graph 定义 + State Schema | ~1d |
| torch_understand 节点 (Agent 循环) | ~2d |
| torch2onnx 节点 (Agent 循环) | ~2d |
| 前端 Pipeline Hub + Pipeline View 基本框架 | ~2d |
| REST API (创建、查询、审批) | ~1d |

**Phase 1 产出：** 可以输入 GitHub 地址，走完 torch → ONNX 流程，看到 Agent 对话和产出物。

### Phase 2: Chip Integration

| 模块 | 工作量估计 |
|------|-----------|
| onnx2chip runner (3559a) | ~3d |
| gen_cpp 节点 (Agent 循环) | ~3d |
| chip_infer runner (SSH 部署) | ~2d |
| Artifact Browser 前端 | ~1d |
| Chip SDK 文档索引 | ~1d |

**Phase 2 产出：** 完整端到端流程可用，3559a 全流程跑通。

### Phase 3: Polish

| 模块 | 工作量估计 |
|------|-----------|
| alignment 节点 + 三面对齐报告 | ~1d |
| SSE 流式推送 (Agent Console 实时更新) | ~2d |
| 精度雷达图 + 对比表格前端 | ~1d |
| 错误处理 + 重试优化 | ~1d |
| 部署脚本 + 文档 | ~1d |

**Phase 3 产出：** 完整产品 B，可内部使用。

---

## 9. 复用关系总览

| 来自 Taskit 的复用 | 用途 |
|-------------------|------|
| `cosine_similarity()` `compare_layers()` | alignment 节点核心算法 |
| React + Tailwind + shadcn/ui 技术栈 | 前端脚手架 |
| TopNav / LayerTable / OverviewChart 组件 | 参考复用到产品 B 前端 |
| `runners/{name}/run.sh --input --output` 模式 | 确定性 Runner 的设计模式 |
| `_init/setup.sh` venv 管理 | Runner Python 环境管理 |
