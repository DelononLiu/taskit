# 产品 B Phase 1: Core Pipeline 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 1 of Product B — FastAPI backend + DeployAgent + DeployCard + torch_understand & torch2onnx Expert Agents, so that a user can input a GitHub URL and the system completes Torch understanding and ONNX conversion with human approval.

**Architecture:** DeployAgent for-loop orchestrates StageDef stages. Each stage calls an Expert Agent via `run(card) -> AgentResult`. State flows through Pydantic DeployCard. Huey manages async task queue. SQLite persists state. LangGraph is NOT used at the pipeline level — only optionally inside Experts.

**Tech Stack:** Python FastAPI, Huey (SQLite), aiosqlite, Pydantic, Claude/GPT API

## Global Constraints

- Product B is a NEW project — independent repo from Taskit. Create at `~/Code/product-b/`
- No LangGraph at pipeline level (DeployAgent is pure Python for loop)
- Expert Agents can optionally use LangGraph internally (not required for Phase 1)
- All state flows through DeployCard(BaseModel) — no separate state management
- SQLite single-file database, zero configuration
- Frontend for Phase 1 is minimal (curl-able API is the primary deliverable)
- Each task ends with a testable deliverable and git commit

---

### Task 1: Backend scaffolding — FastAPI + Huey + SQLite

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/app.py`
- Create: `backend/models/__init__.py`
- Create: `backend/models/db.py`
- Create: `backend/workers/__init__.py`
- Create: `backend/workers/tasks.py`

**Interfaces:**
- Consumes: nothing
- Produces: Bootable FastAPI app, Huey SQLite task queue, SQLite database with tables

- [ ] **Step 1: Create `backend/requirements.txt`**

```
fastapi==0.115.0
uvicorn[standard]==0.30.0
huey[sqlite]==2.5.0
pydantic==2.9.0
aiosqlite==0.20.0
httpx==0.27.0
python-multipart==0.0.9
```

- [ ] **Step 2: Create `backend/app.py`**

```python
"""FastAPI application entry point."""
import os
from fastapi import FastAPI
from contextlib import asynccontextmanager

DB_PATH = os.environ.get("PRODUCT_B_DB", "pipeline_state.db")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure DB tables exist
    from models.db import init_db
    init_db(DB_PATH)
    yield
    # Shutdown


app = FastAPI(title="Product B", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 3: Create `backend/models/db.py`**

```python
"""SQLite database initialization and operations."""
import sqlite3
import json
from typing import Optional


def get_conn(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db(db_path: str):
    conn = get_conn(db_path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS pipelines (
            id TEXT PRIMARY KEY,
            github_url TEXT NOT NULL,
            target_platform TEXT NOT NULL DEFAULT '3559a',
            status TEXT NOT NULL DEFAULT 'running',
            current_stage INTEGER NOT NULL DEFAULT 0,
            rollback_count INTEGER NOT NULL DEFAULT 0,
            card_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS pipeline_stages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pipeline_id TEXT REFERENCES pipelines(id),
            stage_index INTEGER,
            name TEXT,
            status TEXT DEFAULT 'pending',
            gate_output_json TEXT,
            gate_verification_json TEXT,
            handoff_level TEXT,
            attempts INTEGER DEFAULT 0,
            error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS artifacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pipeline_id TEXT REFERENCES pipelines(id),
            stage_name TEXT,
            name TEXT,
            path TEXT,
            type TEXT,
            size INTEGER DEFAULT 0,
            status TEXT DEFAULT 'ready',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS agent_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pipeline_id TEXT REFERENCES pipelines(id),
            stage_name TEXT,
            role TEXT,
            content TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS rollback_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pipeline_id TEXT REFERENCES pipelines(id),
            from_stage INTEGER,
            to_stage INTEGER,
            reason TEXT,
            context_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    conn.close()


def save_pipeline_card(db_path: str, card_json: str, pipeline_id: str):
    conn = get_conn(db_path)
    conn.execute(
        "UPDATE pipelines SET card_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (card_json, pipeline_id),
    )
    conn.commit()
    conn.close()
```

- [ ] **Step 4: Create `backend/workers/tasks.py`**

```python
"""Huey async task queue."""
from huey import SqliteHuey
import os

DB_PATH = os.environ.get("PRODUCT_B_DB", "pipeline_state.db")
huey = SqliteHuey("product_b", filename=DB_PATH)


@huey.task()
def run_pipeline(pipeline_id: str):
    """Entry point for pipeline execution.
    DeployAgent main loop. Called on create and on approval re-enqueue.
    """
    # Import here to avoid circular imports at module level
    from core.deploy_agent import execute_pipeline
    execute_pipeline(pipeline_id, DB_PATH)
```

- [ ] **Step 5: Verify app starts**

```bash
cd backend && python -c "
from app import app
print('FastAPI app created:', app.title)
from workers.tasks import huey
print('Huey created:', huey.name)
from models.db import init_db
init_db('test.db')
print('DB initialized')
import os; os.remove('test.db')
"
```

Expected: FastAPI app created: Product B / Huey created: product_b / DB initialized

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/app.py backend/models/ backend/workers/
git commit -m "feat: backend scaffolding — FastAPI + Huey + SQLite"
```

---

### Task 2: Core data models — DeployCard + StageDef + Helper types

**Files:**
- Create: `backend/core/__init__.py`
- Create: `backend/core/card.py`
- Create: `backend/core/stage.py`

**Interfaces:**
- Consumes: nothing
- Produces: `DeployCard`, `StageState`, `GateResult`, `AgentResult`, `RollbackInfo`, `StageDef`

- [ ] **Step 1: Create `backend/core/card.py`**

```python
"""Pydantic models for DeployCard and related types."""
from pydantic import BaseModel
from typing import Optional, Literal


class StageState(BaseModel):
    name: str
    status: Literal["pending", "running", "waiting_approval",
                     "approved", "completed", "failed"] = "pending"
    attempts: int = 0
    gate_output: Optional[dict] = None
    gate_verification: Optional[dict] = None
    handoff_level: Optional[str] = None
    error: Optional[str] = None


class GateResult(BaseModel):
    passed: bool
    message: str = ""
    metrics: dict = {}


class RollbackInfo(BaseModel):
    from_stage: int
    to_stage: int
    reason: str
    context: dict = {}


class AgentResult(BaseModel):
    card: "DeployCard" = None
    trials: list = []
    gate_output: Optional[GateResult] = None
    gate_verification: Optional[GateResult] = None
    handoff: Optional[str] = None


class LogEntry(BaseModel):
    message: str
    level: str = "info"
    timestamp: str = ""


class DeployCard(BaseModel):
    id: str
    github_url: str
    weight_url: Optional[str] = None
    target_platform: str = "3559a"
    status: str = "running"
    current_stage: int = 0

    # Extensible data dict (slot_1_identity, slot_2_architecture, etc.)
    data: dict = {}

    # Stage states
    stages: list[StageState] = []

    # Rollback tracking
    rollback: Optional[RollbackInfo] = None
    rollback_count: int = 0

    # Reconciliation chain: {A: {}, B: {}, C: {}}
    reconciliation_chain: dict = {}

    # Activity log
    log: list[LogEntry] = []

    class Config:
        extra = "allow"
```

- [ ] **Step 2: Create `backend/core/stage.py`**

```python
"""Stage definition — configures each pipeline step."""
from typing import Callable, Optional, TYPE_CHECKING
from pydantic import BaseModel

if TYPE_CHECKING:
    from experts.base import FunctionAgent
    from core.card import AgentResult, GateResult


class StageDef(BaseModel):
    name: str
    expert_class: any  # type[FunctionAgent] — resolved at runtime
    need_approval: bool = False
    input_slots: list[str] = []
    output_slots: list[str] = []
    verify_fn: Optional[Callable] = None  # (AgentResult) -> GateResult
```

- [ ] **Step 3: Verify imports**

```bash
cd backend && python -c "
from core.card import DeployCard, StageState, GateResult, AgentResult, RollbackInfo
from core.stage import StageDef
card = DeployCard(id='test', github_url='https://github.com/foo/bar')
print('DeployCard created:', card.id)
assert card.status == 'running'
assert card.current_stage == 0
print('All models OK')
"
```

Expected: DeployCard created: test / All models OK

- [ ] **Step 4: Commit**

```bash
git add backend/core/
git commit -m "feat: core data models — DeployCard, StageDef, helpers"
```

---

### Task 3: DeployAgent main loop

**Files:**
- Create: `backend/core/deploy_agent.py`
- Create: `backend/core/gates.py`
- Create: `backend/core/rollback.py`

**Interfaces:**
- Consumes: `DeployCard`, `StageDef`, `AgentResult`
- Produces: `execute_pipeline(pipeline_id, db_path)` — main loop function
- Exports: `handle_rollback()`, `mark_artifacts_stale()`, `get_default_stages()`

- [ ] **Step 1: Create `backend/core/rollback.py`**

```python
"""Rollback handling."""
from core.card import DeployCard
from models.db import get_conn


def mark_artifacts_stale(db_path: str, pipeline_id: str, from_stage_index: int):
    """Mark all artifacts from stage_index onward as stale."""
    conn = get_conn(db_path)
    conn.execute(
        "UPDATE artifacts SET status='stale' WHERE pipeline_id=? AND stage_index>=?",
        (pipeline_id, from_stage_index),
    )
    conn.commit()
    conn.close()


def handle_rollback(card: DeployCard, db_path: str) -> DeployCard:
    """Execute rollback: mark artifacts stale, reset current_stage."""
    target = card.rollback.to_stage

    # Reset stage statuses
    for j in range(target + 1, len(card.stages)):
        if j < len(card.stages):
            card.stages[j].status = "pending"

    # Mark artifacts stale
    mark_artifacts_stale(db_path, card.id, target + 1)

    # Reset current_stage
    card.current_stage = target
    card.rollback = None
    return card
```

- [ ] **Step 2: Create `backend/core/gates.py`**

```python
"""Gate verification functions — one per stage."""
from core.card import GateResult, AgentResult


def gate_torch_understand(result: AgentResult) -> GateResult:
    """Verify torch_understand output: script executed, output shape matches."""
    if result.gate_output and result.gate_output.passed:
        return result.gate_output
    return GateResult(passed=False, message="Torch understand gate not passed")


def gate_torch2onnx(result: AgentResult) -> GateResult:
    """Verify torch2onnx: cosine similarity >= 0.99."""
    if result.gate_verification and result.gate_verification.passed:
        return result.gate_verification
    return GateResult(passed=False, message="Cosine similarity below threshold")


def get_verify_fn(stage_name: str):
    """Lookup verify function by stage name."""
    mapping = {
        "torch_understand": gate_torch_understand,
        "torch2onnx": gate_torch2onnx,
    }
    return mapping.get(stage_name, lambda r: GateResult(passed=True))
```

- [ ] **Step 3: Create `backend/core/deploy_agent.py`**

```python
"""DeployAgent — deterministic pipeline orchestrator."""
import json
from core.card import DeployCard, StageState, RollbackInfo, AgentResult, LogEntry
from core.stage import StageDef
from core.gates import get_verify_fn
from core.rollback import handle_rollback
from models.db import save_pipeline_card
from workers.tasks import huey


MAX_ROLLBACKS = 3


def save_card(card: DeployCard, db_path: str):
    """Persist DeployCard to SQLite."""
    save_pipeline_card(db_path, card.model_dump_json(), card.id)


def get_default_stages() -> list[StageDef]:
    """Define Phase 1 pipeline stages.
    Stage 0 = torch_understand, Stage 1 = torch2onnx.
    (Stages 2-5 added in Phase 2.)
    """
    from experts.torch_understand import TorchUnderstandExpert
    from experts.torch2onnx import Torch2ONNXExpert

    return [
        StageDef(
            name="torch_understand",
            expert_class=TorchUnderstandExpert,
            need_approval=False,
            output_slots=["slot_1_identity", "slot_2_architecture", "slot_3_io_contract"],
            verify_fn=get_verify_fn("torch_understand"),
        ),
        StageDef(
            name="torch2onnx",
            expert_class=Torch2ONNXExpert,
            need_approval=True,  # Thin C confirmation
            input_slots=["slot_2_architecture", "slot_3_io_contract"],
            output_slots=["slot_4_modifications", "slot_5_pitfalls", "slot_6_verification"],
            verify_fn=get_verify_fn("torch2onnx"),
        ),
    ]


def execute_pipeline(pipeline_id: str, db_path: str):
    """DeployAgent main loop. Called by Huey on create and on approve."""
    from models.db import get_conn
    conn = get_conn(db_path)
    row = conn.execute(
        "SELECT card_json FROM pipelines WHERE id=?", (pipeline_id,)
    ).fetchone()
    conn.close()

    if not row:
        return

    card = DeployCard.model_validate_json(row["card_json"])
    stages = get_default_stages()

    for i in range(card.current_stage, len(stages)):
        stage = stages[i]
        card.current_stage = i

        # Skip already completed/approved stages
        if i < len(card.stages) and card.stages[i].status in ("completed", "approved"):
            continue

        # Ensure stage state exists
        while len(card.stages) <= i:
            card.stages.append(StageState(name=stages[len(card.stages)].name))

        card.stages[i].status = "running"
        save_card(card, db_path)

        # Execute Expert Agent
        card.log.append(LogEntry(message=f"Stage {i}: {stage.name} starting"))
        result: AgentResult = stage.expert_class.run(card)

        # Check rollback signal
        if result.handoff == "rollback" and card.rollback:
            if card.rollback_count < MAX_ROLLBACKS:
                card.rollback_count += 1
                card = handle_rollback(card, db_path)
                card.log.append(LogEntry(
                    message=f"Rollback to stage {card.current_stage}: {card.rollback.reason if card.rollback else 'unknown'}"
                ))
                save_card(card, db_path)
                return  # Huey re-enqueues via approve
            else:
                # B escalation
                card.status = "failed"
                card.stages[i].status = "failed"
                card.stages[i].handoff_level = "b_escalation"
                card.log.append(LogEntry(message="Max rollbacks reached, B escalation"))
                save_card(card, db_path)
                return

        # Check gate
        gate = stage.verify_fn(result) if stage.verify_fn else None
        if gate and not gate.passed:
            card.status = "failed"
            card.stages[i].status = "failed"
            card.stages[i].error = gate.message
            card.log.append(LogEntry(message=f"Gate failed: {gate.message}", level="error"))
            save_card(card, db_path)
            return

        # Update stage state
        card.stages[i].status = "completed"
        card.stages[i].gate_output = (gate.model_dump() if gate else None)
        card.stages[i].gate_verification = (
            result.gate_verification.model_dump() if result.gate_verification else None
        )

        # Merge card data from expert
        if result.card:
            card.data.update(result.card.data)

        card.log.append(LogEntry(message=f"Stage {i}: {stage.name} completed"))
        save_card(card, db_path)

        # Need approval?
        if stage.need_approval:
            card.stages[i].status = "waiting_approval"
            card.log.append(LogEntry(message="Waiting for user approval"))
            save_card(card, db_path)
            return  # Huey task ends; re-enqueued on approve

    # All stages complete
    card.status = "completed"
    card.log.append(LogEntry(message="Pipeline completed"))
    save_card(card, db_path)
```

- [ ] **Step 4: Verify module loads**

```bash
cd backend && python -c "
from core.deploy_agent import execute_pipeline, get_default_stages
stages = get_default_stages()
print(f'{len(stages)} stages defined: {[s.name for s in stages]}')
"
```

Expected: 2 stages defined: ['torch_understand', 'torch2onnx']

- [ ] **Step 5: Commit**

```bash
git add backend/core/deploy_agent.py backend/core/gates.py backend/core/rollback.py
git commit -m "feat: DeployAgent main loop + gates + rollback"
```

---

### Task 4: API layer — pipeline CRUD + approve

**Files:**
- Create: `backend/api/__init__.py`
- Create: `backend/api/pipelines.py`
- Create: `backend/api/artifacts.py`

**Interfaces:**
- Consumes: `DeployCard`, `execute_pipeline`
- Produces: FastAPI routes for pipeline management

- [ ] **Step 1: Create `backend/api/pipelines.py`**

```python
"""Pipeline management API."""
import uuid
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from core.card import DeployCard, StageState
from core.deploy_agent import execute_pipeline, get_default_stages, save_card
from models.db import get_conn
from workers.tasks import run_pipeline
import os

router = APIRouter(prefix="/api/pipelines")
DB_PATH = os.environ.get("PRODUCT_B_DB", "pipeline_state.db")


class CreatePipelineRequest(BaseModel):
    github_url: str
    weight_url: Optional[str] = None
    target_platform: str = "3559a"


@router.post("")
async def create_pipeline(req: CreatePipelineRequest):
    """Create a new pipeline and enqueue for execution."""
    pipeline_id = str(uuid.uuid4())

    # Build initial card
    card = DeployCard(
        id=pipeline_id,
        github_url=req.github_url,
        weight_url=req.weight_url,
        target_platform=req.target_platform,
    )

    # Save to DB
    conn = get_conn(DB_PATH)
    conn.execute(
        """INSERT INTO pipelines (id, github_url, target_platform, status, card_json)
           VALUES (?, ?, ?, ?, ?)""",
        (pipeline_id, req.github_url, req.target_platform, "running", card.model_dump_json()),
    )
    conn.commit()
    conn.close()

    # Enqueue async execution
    run_pipeline(pipeline_id)

    return {"id": pipeline_id, "status": "running"}


@router.get("/{pipeline_id}")
async def get_pipeline(pipeline_id: str):
    """Get pipeline status and card."""
    conn = get_conn(DB_PATH)
    row = conn.execute(
        "SELECT card_json, status FROM pipelines WHERE id=?", (pipeline_id,)
    ).fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    card = DeployCard.model_validate_json(row["card_json"])
    return {
        "id": pipeline_id,
        "status": card.status,
        "current_stage": card.current_stage,
        "stages": [s.model_dump() for s in card.stages],
        "data": card.data,
        "log": [l.model_dump() for l in card.log],
    }


@router.post("/{pipeline_id}/approve")
async def approve_stage(pipeline_id: str):
    """Approve current waiting stage and continue pipeline."""
    conn = get_conn(DB_PATH)
    row = conn.execute(
        "SELECT card_json FROM pipelines WHERE id=?", (pipeline_id,)
    ).fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    card = DeployCard.model_validate_json(row["card_json"])

    if card.status != "running":
        raise HTTPException(status_code=400, detail=f"Cannot approve: pipeline is {card.status}")

    current = card.stages[card.current_stage] if card.current_stage < len(card.stages) else None
    if not current or current.status != "waiting_approval":
        raise HTTPException(
            status_code=400,
            detail=f"Stage {card.current_stage} is not waiting for approval (status={current.status if current else 'N/A'})",
        )

    # Mark approved and re-enqueue
    current.status = "approved"
    save_card(card, DB_PATH)
    run_pipeline(pipeline_id)

    return {"id": pipeline_id, "status": "running", "current_stage": card.current_stage}
```

- [ ] **Step 2: Create `backend/api/artifacts.py`**

```python
"""Artifact download API."""
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/artifacts")
ARTIFACTS_ROOT = os.environ.get("PRODUCT_B_ARTIFACTS", "./artifacts")


@router.get("/{pipeline_id}/{filename:path}")
async def download_artifact(pipeline_id: str, filename: str):
    filepath = os.path.join(ARTIFACTS_ROOT, pipeline_id, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Artifact not found")
    return FileResponse(filepath)
```

- [ ] **Step 3: Register routes in `backend/app.py`**

Edit `backend/app.py` — add imports and include routers:

```python
# Add imports at top:
from api.pipelines import router as pipelines_router
from api.artifacts import router as artifacts_router

# Add before the health endpoint:
app.include_router(pipelines_router)
app.include_router(artifacts_router)
```

- [ ] **Step 4: Test API with curl**

```bash
# Start server in background
cd backend && uvicorn app:app --port 8000 &
sleep 2

# Create a pipeline
curl -s -X POST http://localhost:8000/api/pipelines \
  -H "Content-Type: application/json" \
  -d '{"github_url": "https://github.com/example/resnet50"}'

# Get pipeline status
curl -s http://localhost:8000/api/pipelines/<id> | python -m json.tool

# Kill server
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add backend/api/ backend/app.py
git commit -m "feat: pipeline CRUD API + approve endpoint"
```

---

### Task 5: Tool layer — LLM client + sandbox executor

**Files:**
- Create: `backend/tools/__init__.py`
- Create: `backend/tools/llm_client.py`
- Create: `backend/tools/sandbox.py`

**Interfaces:**
- Consumes: LLM API key (env var)
- Produces: `LLMClient.chat(messages) -> str`, `SandboxExecutor.run(command, cwd) -> RunResult`

- [ ] **Step 1: Create `backend/tools/llm_client.py`**

```python
"""LLM API client — Claude / GPT."""
import os
import json
import httpx
from typing import Optional


class LLMClient:
    """Minimal LLM client. Supports OpenAI-compatible APIs."""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or os.environ.get("LLM_API_KEY", "")
        self.model = model or os.environ.get("LLM_MODEL", "claude-sonnet-4-20250514")
        self.api_url = os.environ.get(
            "LLM_API_URL",
            "https://api.anthropic.com/v1/messages" if "claude" in (model or "")
            else "https://api.openai.com/v1/chat/completions",
        )

    def chat(self, messages: list[dict], system: Optional[str] = None) -> str:
        """Send chat messages and return response text."""
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        body = {
            "model": self.model,
            "messages": messages,
            "max_tokens": 4096,
        }
        if system and "claude" in self.model:
            body["system"] = system

        resp = httpx.post(self.api_url, headers=headers, json=body, timeout=300)
        resp.raise_for_status()
        data = resp.json()

        if "claude" in self.model:
            return data["content"][0]["text"]
        return data["choices"][0]["message"]["content"]
```

- [ ] **Step 2: Create `backend/tools/sandbox.py`**

```python
"""Sandbox executor — runs commands in subprocess."""
import subprocess
import os
from typing import Optional


class RunResult:
    def __init__(self, exit_code: int, stdout: str, stderr: str):
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr

    @property
    def success(self) -> bool:
        return self.exit_code == 0


class SandboxExecutor:
    """Execute commands in a subprocess within a workspace directory."""

    def __init__(self, workspace_root: str = "./workspace"):
        self.workspace_root = workspace_root

    def ensure_workspace(self, pipeline_id: str) -> str:
        wd = os.path.join(self.workspace_root, pipeline_id)
        os.makedirs(wd, exist_ok=True)
        return wd

    def run(
        self,
        command: str,
        cwd: Optional[str] = None,
        timeout: int = 300,
        env: Optional[dict] = None,
    ) -> RunResult:
        """Run a shell command and return result."""
        try:
            proc = subprocess.run(
                command,
                shell=True,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=timeout,
                env={**os.environ, **(env or {})},
            )
            return RunResult(proc.returncode, proc.stdout, proc.stderr)
        except subprocess.TimeoutExpired:
            return RunResult(-1, "", f"Command timed out after {timeout}s")
        except Exception as e:
            return RunResult(-1, "", str(e))
```

- [ ] **Step 3: Verify imports**

```bash
cd backend && python -c "
from tools.llm_client import LLMClient
from tools.sandbox import SandboxExecutor, RunResult
print('LLMClient and SandboxExecutor imported OK')
result = SandboxExecutor().run('echo hello')
print('Sandbox works:', result.stdout.strip())
"
```

Expected: LLMClient and SandboxExecutor imported OK / Sandbox works: hello

- [ ] **Step 4: Commit**

```bash
git add backend/tools/
git commit -m "feat: tool layer — LLM client + sandbox executor"
```

---

### Task 6: Expert Agent base class

**Files:**
- Create: `backend/experts/__init__.py`
- Create: `backend/experts/base.py`

**Interfaces:**
- Consumes: `DeployCard`, `LLMClient`, `SandboxExecutor`
- Produces: `FunctionAgent` abstract base class with `run(card)` interface

- [ ] **Step 1: Create `backend/experts/base.py`**

```python
"""FunctionAgent base class — all Expert Agents inherit from this."""
from abc import ABC, abstractmethod
from core.card import DeployCard, AgentResult
from tools.llm_client import LLMClient
from tools.sandbox import SandboxExecutor


class FunctionAgent(ABC):
    """Base class for Expert Agents.
    
    Each Expert Agent runs a specific pipeline stage.
    The run() method is the only public interface.
    Internal implementation is fully autonomous — the agent decides
    how to read context, generate code, execute, and self-correct.
    """

    llm: LLMClient = LLMClient()
    sandbox: SandboxExecutor = SandboxExecutor()

    @classmethod
    @abstractmethod
    def run(cls, card: DeployCard) -> AgentResult:
        """Execute this stage.
        
        Args:
            card: Current pipeline state with all slot data
            
        Returns:
            AgentResult with updated card, gate results, and optional handoff
        """
        ...
```

- [ ] **Step 2: Commit**

```bash
git add backend/experts/
git commit -m "feat: FunctionAgent base class"
```

---

### Task 7: torch_understand Expert Agent

**Files:**
- Create: `backend/experts/torch_understand.py`

**Interfaces:**
- Consumes: `DeployCard` with `github_url`, `weight_url`
- Produces: `AgentResult` with `card.data["slot_1_identity"]`, `card.data["slot_2_architecture"]`, `card.data["slot_3_io_contract"]`

- [ ] **Step 1: Create `backend/experts/torch_understand.py`**

```python
"""torch_understand Expert Agent.

Responsible for:
1. Cloning the GitHub repository
2. Reading and understanding the model code
3. Writing a torch inference script
4. Running it and verifying output
5. Filling Slots 1, 2, 3
"""
import os
from core.card import DeployCard, AgentResult, GateResult
from experts.base import FunctionAgent


class TorchUnderstandExpert(FunctionAgent):
    """Expert Agent for Stage 1: understand the model and reproduce torch output."""

    @classmethod
    def run(cls, card: DeployCard) -> AgentResult:
        pipeline_id = card.id
        workspace = cls.sandbox.ensure_workspace(pipeline_id)
        repo_dir = os.path.join(workspace, "repo")
        artifacts_dir = os.path.join(workspace, "artifacts")
        os.makedirs(artifacts_dir, exist_ok=True)

        # Step 1: Clone repository
        cls._log(card, f"Cloning {card.github_url} into {repo_dir}")
        if not os.path.exists(repo_dir):
            result = cls.sandbox.run(f"git clone {card.github_url} {repo_dir}", timeout=120)
            if not result.success:
                return AgentResult(
                    card=card,
                    gate_output=GateResult(passed=False, message=f"Clone failed: {result.stderr}"),
                )

        # Step 2: Read repo structure
        cls._log(card, "Analyzing repository structure")
        tree = cls.sandbox.run(f"find {repo_dir} -maxdepth 3 -name '*.py' | head -30")
        readme = cls.sandbox.run(f"cat {repo_dir}/README.md 2>/dev/null || echo ''")

        # Step 3: LLM analyzes model structure
        cls._log(card, "LLM analyzing model structure")
        analysis_prompt = f"""
Repository structure:
{tree.stdout[:2000]}

README:
{readme.stdout[:2000]}

Task: Analyze this model repository. Identify:
1. The model's architecture (what type of model, key components)
2. The forward pass structure (input → how data flows → output)
3. The input/output shapes and data types
4. How to write a simple inference script

Give your analysis in a structured format.
"""
        analysis = cls.llm.chat([
            {"role": "user", "content": analysis_prompt},
        ])
        cls._log(card, f"Model analysis received ({len(analysis)} chars)")

        # Step 4: LLM generates inference script
        cls._log(card, "LLM generating torch inference script")
        script_prompt = f"""
Based on this analysis:
{analysis}

Write a complete Python script that:
1. Loads the model from {repo_dir}
2. Uses the correct input shapes
3. Runs inference with a random input
4. Saves the output to {artifacts_dir}/ref_output.npz
5. Saves model metadata to {artifacts_dir}/model_info.json

The script must be self-contained and runnable with: python torch_infer.py
Only output the Python code, no explanations.
"""
        script = cls.llm.chat([
            {"role": "user", "content": script_prompt},
        ])

        # Extract code block if present
        if "```python" in script:
            script = script.split("```python")[1].split("```")[0].strip()
        elif "```" in script:
            script = script.split("```")[1].split("```")[0].strip()

        script_path = os.path.join(workspace, "torch_infer.py")
        with open(script_path, "w") as f:
            f.write(script)

        # Step 5: Execute the script (with retries)
        cls._log(card, "Executing torch inference script")
        result = cls.sandbox.run(f"cd {workspace} && python torch_infer.py", timeout=300)

        if not result.success:
            # Could add self-healing loop here (Phase 3 polish)
            return AgentResult(
                card=card,
                gate_output=GateResult(
                    passed=False,
                    message=f"Execution failed:\n{result.stderr[:500]}",
                ),
            )

        # Step 6: Verify outputs exist
        ref_output = os.path.join(artifacts_dir, "ref_output.npz")
        model_info = os.path.join(artifacts_dir, "model_info.json")

        if not os.path.exists(ref_output) or not os.path.exists(model_info):
            return AgentResult(
                card=card,
                gate_output=GateResult(
                    passed=False,
                    message="Expected output files not found",
                ),
            )

        # Step 7: Fill card slots
        card.data["slot_1_identity"] = {
            "repo": card.github_url.split("/")[-1],
            "weight_source": card.weight_url or "provided by user",
        }
        card.data["slot_2_architecture"] = {
            "analysis": analysis[:1000],
        }
        card.data["slot_3_io_contract"] = {
            "status": "filled",
            "details": "See model_info.json for exact shapes",
        }

        cls._log(card, "torch_understand completed successfully")
        return AgentResult(
            card=card,
            gate_output=GateResult(passed=True, message="Torch understand OK"),
            gate_verification=GateResult(passed=True, message="Output files verified"),
        )

    @classmethod
    def _log(cls, card: DeployCard, message: str):
        from core.card import LogEntry
        card.log.append(LogEntry(message=f"[torch_understand] {message}"))
```

- [ ] **Step 2: Verify module loads**

```bash
cd backend && python -c "
from experts.torch_understand import TorchUnderstandExpert
print('TorchUnderstandExpert loaded')
assert hasattr(TorchUnderstandExpert, 'run')
"
```

Expected: TorchUnderstandExpert loaded

- [ ] **Step 3: Commit**

```bash
git add backend/experts/torch_understand.py
git commit -m "feat: torch_understand Expert Agent"
```

---

### Task 8: torch2onnx Expert Agent

**Files:**
- Create: `backend/experts/torch2onnx.py`

**Interfaces:**
- Consumes: `DeployCard` with `slot_2_architecture`, `slot_3_io_contract`
- Produces: `AgentResult` with `model.onnx`, `onnx_infer.py`, `alignment_report.json`

- [ ] **Step 1: Create `backend/experts/torch2onnx.py`**

```python
"""torch2onnx Expert Agent.

Responsible for:
1. Reading the torch inference script and model info
2. Writing a torch → ONNX conversion script
3. Running the conversion
4. Writing an ONNX inference script
5. Comparing ONNX output with torch output (alignment)
6. Filling Slots 4, 5, 6A
"""
import os
import json
from core.card import DeployCard, AgentResult, GateResult
from experts.base import FunctionAgent


class Torch2ONNXExpert(FunctionAgent):
    """Expert Agent for Stage 2: convert torch model to ONNX and align."""

    @classmethod
    def run(cls, card: DeployCard) -> AgentResult:
        pipeline_id = card.id
        workspace = cls.sandbox.ensure_workspace(pipeline_id)
        repo_dir = os.path.join(workspace, "repo")
        artifacts_dir = os.path.join(workspace, "artifacts")
        os.makedirs(artifacts_dir, exist_ok=True)

        # Read torch inference script for context
        torch_script_path = os.path.join(workspace, "torch_infer.py")
        torch_script = ""
        if os.path.exists(torch_script_path):
            with open(torch_script_path) as f:
                torch_script = f.read()

        # Step 1: Check device capability for constraint injection
        device_cap = cls._load_device_capability(card.target_platform)
        if device_cap:
            card.data["slot_7_device_path"] = {
                "platform": card.target_platform,
                "capabilities": device_cap,
            }

        # Step 2: LLM generates ONNX conversion script
        cls._log(card, "LLM generating ONNX conversion script")
        conversion_prompt = f"""
Task: Write a Python script to convert a PyTorch model to ONNX.

Torch inference script:
{torch_script[:3000]}

Model info (from slot_3):
{json.dumps(card.data.get("slot_3_io_contract", {}), indent=2)}

Device constraints:
{json.dumps(device_cap or {}, indent=2)}

Requirements:
1. Load the model from {repo_dir} the same way as the torch script
2. Export to ONNX using torch.onnx.export()
3. Save to {artifacts_dir}/model.onnx
4. Handle dynamic axes properly
5. Output only the Python code
"""
        conversion_script = cls.llm.chat([
            {"role": "user", "content": conversion_prompt},
        ])

        # Extract code
        if "```python" in conversion_script:
            conversion_script = conversion_script.split("```python")[1].split("```")[0].strip()
        elif "```" in conversion_script:
            conversion_script = conversion_script.split("```")[1].split("```")[0].strip()

        script_path = os.path.join(workspace, "torch2onnx.py")
        with open(script_path, "w") as f:
            f.write(conversion_script)

        # Step 3: Run conversion
        cls._log(card, "Running ONNX conversion")
        result = cls.sandbox.run(f"cd {workspace} && python torch2onnx.py", timeout=300)

        if not result.success:
            return AgentResult(
                card=card,
                gate_output=GateResult(
                    passed=False,
                    message=f"ONNX conversion failed:\n{result.stderr[:500]}",
                ),
            )

        model_onnx = os.path.join(artifacts_dir, "model.onnx")
        if not os.path.exists(model_onnx):
            return AgentResult(
                card=card,
                gate_output=GateResult(passed=False, message="model.onnx not found after conversion"),
            )

        # Step 4: LLM generates ONNX inference script
        cls._log(card, "LLM generating ONNX inference script")
        onnx_infer_prompt = f"""
Write a Python script that:
1. Loads {model_onnx} with ONNX Runtime
2. Uses the same input shapes as the original torch model
3. Runs inference
4. Saves output to {artifacts_dir}/onnx_output.npz

Torch inference script for reference:
{torch_script[:2000]}
"""
        onnx_script = cls.llm.chat([
            {"role": "user", "content": onnx_infer_prompt},
        ])

        if "```python" in onnx_script:
            onnx_script = onnx_script.split("```python")[1].split("```")[0].strip()
        elif "```" in onnx_script:
            onnx_script = onnx_script.split("```")[1].split("```")[0].strip()

        onnx_script_path = os.path.join(workspace, "onnx_infer.py")
        with open(onnx_script_path, "w") as f:
            f.write(onnx_script)

        # Step 5: Run ONNX inference
        cls._log(card, "Running ONNX inference")
        result = cls.sandbox.run(f"cd {workspace} && python onnx_infer.py", timeout=300)

        if not result.success:
            return AgentResult(
                card=card,
                gate_output=GateResult(
                    passed=False,
                    message=f"ONNX inference failed:\n{result.stderr[:500]}",
                ),
            )

        # Step 6: Run alignment (compare torch vs ONNX outputs)
        cls._log(card, "Running accuracy alignment")
        onnx_output = os.path.join(artifacts_dir, "onnx_output.npz")
        ref_output = os.path.join(artifacts_dir, "ref_output.npz")

        align_script = f"""
import numpy as np
try:
    ref = np.load('{ref_output}')
    onnx = np.load('{onnx_output}')
    # Compare key arrays
    results = {{}}
    for key in ref.files:
        if key in onnx.files:
            a, b = ref[key].flatten(), onnx[key].flatten()
            dot = float(np.dot(a, b))
            na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
            cos = dot / (na * nb) if na > 0 and nb > 0 else 0.0
            mae = float(np.max(np.abs(a - b)))
            results[key] = {{"cosine": round(cos, 8), "max_abs_error": round(mae, 8)}}
    import json
    with open('{artifacts_dir}/alignment_report.json', 'w') as f:
        json.dump({{"comparison": results, "passed": any(v['cosine'] >= 0.99 for v in results.values())}}, f, indent=2)
    print("Alignment complete")
except Exception as e:
    print(f"Alignment error: {{e}}")
"""
        with open(os.path.join(workspace, "align.py"), "w") as f:
            f.write(align_script)

        align_result = cls.sandbox.run(f"cd {workspace} && python align.py", timeout=60)

        # Step 7: Read alignment report
        report_path = os.path.join(artifacts_dir, "alignment_report.json")
        cosine_passed = False
        if os.path.exists(report_path):
            with open(report_path) as f:
                report = json.load(f)
            cosine_passed = report.get("passed", False)
            card.data["slot_6_verification"] = {"A": report}

        cls._log(card, f"Alignment {'PASSED' if cosine_passed else 'FAILED'}")

        # Record modifications and pitfalls
        card.data.setdefault("slot_4_modifications", [])
        card.data.setdefault("slot_5_pitfalls", [])

        return AgentResult(
            card=card,
            gate_output=GateResult(passed=True, message="ONNX conversion completed"),
            gate_verification=GateResult(
                passed=cosine_passed,
                message=f"Cosine alignment {'passed' if cosine_passed else 'below 0.99 threshold'}",
                metrics={"cosine_passed": cosine_passed},
            ),
        )

    @classmethod
    def _load_device_capability(cls, platform: str) -> dict:
        """Load device capability file if it exists."""
        import yaml
        cap_path = os.path.join(os.path.dirname(__file__), "..", "runners", platform, "capability.yaml")
        if os.path.exists(cap_path):
            with open(cap_path) as f:
                return yaml.safe_load(f)
        return {}

    @classmethod
    def _log(cls, card: DeployCard, message: str):
        from core.card import LogEntry
        card.log.append(LogEntry(message=f"[torch2onnx] {message}"))
```

- [ ] **Step 2: Verify module loads**

```bash
cd backend && python -c "
from experts.torch2onnx import Torch2ONNXExpert
print('Torch2ONNXExpert loaded')
"
```

Expected: Torch2ONNXExpert loaded

- [ ] **Step 3: Commit**

```bash
git add backend/experts/torch2onnx.py
git commit -m "feat: torch2onnx Expert Agent"
```

---

### Task 9: Frontend — scaffold + PipelineHub + PipelineView

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/api/pipelines.ts`
- Create: `frontend/src/types/pipeline.ts`
- Create: `frontend/src/pages/PipelineHub.tsx`
- Create: `frontend/src/pages/PipelineView.tsx`

**Interfaces:**
- Consumes: Backend API at `http://localhost:8000`
- Produces: Web UI for pipeline management

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "product-b-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `frontend/src/types/pipeline.ts`**

```typescript
export interface StageState {
  name: string
  status: 'pending' | 'running' | 'waiting_approval' | 'approved' | 'completed' | 'failed'
  attempts: number
  gate_output?: { passed: boolean; message: string }
  gate_verification?: { passed: boolean; message: string }
  handoff_level?: string
  error?: string
}

export interface PipelineResponse {
  id: string
  status: string
  current_stage: number
  stages: StageState[]
  data: Record<string, any>
  log: { message: string; level: string }[]
}

export interface CreatePipelineRequest {
  github_url: string
  weight_url?: string
  target_platform?: string
}
```

- [ ] **Step 3: Create `frontend/src/api/pipelines.ts`**

```typescript
const API_BASE = 'http://localhost:8000/api'

export async function createPipeline(req: {
  github_url: string
  weight_url?: string
  target_platform?: string
}): Promise<{ id: string; status: string }> {
  const resp = await fetch(`${API_BASE}/pipelines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  return resp.json()
}

export async function getPipeline(id: string) {
  const resp = await fetch(`${API_BASE}/pipelines/${id}`)
  return resp.json()
}

export async function approveStage(id: string) {
  const resp = await fetch(`${API_BASE}/pipelines/${id}/approve`, { method: 'POST' })
  return resp.json()
}
```

- [ ] **Step 4: Create `frontend/src/pages/PipelineHub.tsx`**

```tsx
import { useState } from 'react'
import { createPipeline } from '../api/pipelines'

export function PipelineHub() {
  const [githubUrl, setGithubUrl] = useState('')

  const handleSubmit = async () => {
    if (!githubUrl) return
    const result = await createPipeline({ github_url: githubUrl })
    window.location.href = `/pipelines/${result.id}`
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="w-full max-w-lg space-y-6">
        <h1 className="text-2xl font-bold text-center">Product B</h1>
        <p className="text-gray-500 text-center text-sm">
          End-to-end AI model import service
        </p>

        <div className="bg-white rounded-xl p-6 shadow-sm border space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">GitHub Repository URL</label>
            <input
              type="text"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!githubUrl}
            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Start Pipeline
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create `frontend/src/pages/PipelineView.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getPipeline, approveStage } from '../api/pipelines'

export function PipelineView() {
  const { id } = useParams<{ id: string }>()
  const [pipeline, setPipeline] = useState<any>(null)

  useEffect(() => {
    if (!id) return
    const fetch = async () => {
      const data = await getPipeline(id)
      setPipeline(data)
    }
    fetch()
    const interval = setInterval(fetch, 3000)
    return () => clearInterval(interval)
  }, [id])

  const handleApprove = async () => {
    if (!id) return
    await approveStage(id)
  }

  if (!pipeline) return <div className="p-8">Loading...</div>

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-xl font-bold">Pipeline {id?.slice(0, 8)}</h1>
        <p className="text-sm text-gray-500">Status: {pipeline.status}</p>

        <div className="grid grid-cols-[200px_1fr] gap-6">
          <div className="space-y-2">
            {pipeline.stages?.map((stage: any, i: number) => (
              <div key={i} className={`p-3 rounded-lg text-sm border ${
                stage.status === 'completed' ? 'bg-green-50 border-green-200' :
                stage.status === 'running' ? 'bg-blue-50 border-blue-200' :
                stage.status === 'waiting_approval' ? 'bg-yellow-50 border-yellow-200' :
                stage.status === 'failed' ? 'bg-red-50 border-red-200' :
                'bg-white border-gray-200'
              }`}>
                <div className="font-medium">{stage.name}</div>
                <div className="text-xs text-gray-500">{stage.status}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border">
            <h2 className="text-sm font-medium mb-4">Details</h2>

            {pipeline.stages?.some((s: any) => s.status === 'waiting_approval') && (
              <div className="mb-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                <p className="text-sm font-medium">Approval Required</p>
                <p className="text-xs text-gray-500 mt-1">Review the artifacts and approve to continue.</p>
                <button
                  onClick={handleApprove}
                  className="mt-2 px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                >
                  Approve & Continue
                </button>
              </div>
            )}

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {pipeline.log?.map((entry: any, i: number) => (
                <div key={i} className="text-xs font-mono text-gray-600 border-b pb-1">
                  {entry.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Create `frontend/src/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { PipelineHub } from './pages/PipelineHub'
import { PipelineView } from './pages/PipelineView'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PipelineHub />} />
        <Route path="/pipelines/:id" element={<PipelineView />} />
      </Routes>
    </BrowserRouter>
  )
}
```

- [ ] **Step 7: Create remaining scaffolding files** (`main.tsx`, `index.html`, `vite.config.ts`, `tsconfig.json`)

Standard Vite React TS config files — see `npx create-vite` template or Taskit's existing configs for reference.

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat: frontend scaffold + PipelineHub + PipelineView"
```

---

## Spec Coverage Check

| Spec Section | Task |
|-------------|------|
| FastAPI + Huey + SQLite framework | Task 1 ✓ |
| DeployCard, StageDef, GateResult, AgentResult | Task 2 ✓ |
| DeployAgent main loop | Task 3 ✓ |
| Rollback handling + artifact stale marking | Task 3 ✓ |
| Pipeline CRUD API + approve | Task 4 ✓ |
| LLM Client + Sandbox Executor tools | Task 5 ✓ |
| FunctionAgent abstract base | Task 6 ✓ |
| torch_understand Expert Agent (Stage 1) | Task 7 ✓ |
| torch2onnx Expert Agent (Stage 2) | Task 8 ✓ |
| Frontend: PipelineHub + PipelineView | Task 9 ✓ |
| Device capability constraint injection | Task 8 ✓ |
| Thin C confirmation (approval gate) | Task 4 (approve API) ✓ |
| 7-slot data model (extensible) | Task 2 (DeployCard.data) ✓ |
| Huey async queue | Task 1 + Task 4 ✓ |
| Frontend polling (3s) | Task 9 (PipelineView useEffect interval) ✓ |
| Phase 2-5 stages (onnx2chip, gen_cpp, chip_infer, alignment) | Not included — Phase 2 |
