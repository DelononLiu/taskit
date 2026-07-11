# 推理框架支持设计

> 为 Taskit 建立标准化的多推理框架支持体系。每个框架以独立目录形式存在，通过统一的 CLI 接口被后端调用。环境由系统统一管理。

---

## 背景

当前 Taskit 只支持 ONNX Runtime 推理比对，且没有 Python 环境管理。需要扩展支持多个推理框架，包括小模型框架（OpenVINO、ONNX Runtime）和大模型框架（vLLM CPU、Transformers、PyTorch CPU）。

TensorRT 因没有硬件暂不考虑。

## CLI 接口

所有框架的入口脚本必须遵守以下 CLI 接口：

```bash
# 必传参数
--input <path>[,<path>]     # 逗号分隔的模型/输入路径
--output <path>[,<path>]    # 逗号分隔的比对结果输出路径（JSON）

# 可选参数
--node-output <path>        # 节点级详细数据的二进制输出路径（.npz）
```

- 入口脚本可以是 shell 脚本、Python 脚本或编译好的二进制文件
- 入口脚本必须是 chmod +x 可执行文件
- 框架身份由所在目录名标识（`onnx` / `openvino` / `vllm-cpu` / ...）

## 目录结构

```
runners/
  _init/
    setup.sh              # 遍历各框架目录，初始化 venv + pip install
  onnx/
    run.sh                # 入口脚本
    run.py                # 实际推理实现
    requirements.txt
    venv/                 # python3 -m venv，setup 时创建
  openvino/
    run.sh
    run.py
    requirements.txt
    venv/
  vllm-cpu/
    run.sh
    run.py
    requirements.txt
    venv/
  transformers/
    run.sh
    run.py
    requirements.txt
    venv/
  torch-cpu/
    run.sh
    run.py
    requirements.txt
    venv/
```

## 每个框架的可选参数

所有可选参数都有合理的默认值，调用方只需传需要覆盖的。

### ONNX Runtime

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--precision` | `fp32` | `fp32` / `fp16` / `int8` |
| `--batch-size` | `1` | Batch 大小 |

### OpenVINO

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--precision` | `fp32` | `fp32` / `fp16` / `int8` |
| `--batch-size` | `1` | |
| `--device` | `CPU` | `CPU` / `AUTO` |

### vLLM (CPU)

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--max-model-len` | `4096` | 最大上下文长度 |
| `--dtype` | `float32` | `float32` / `float16` / `bfloat16` |
| `--max-batch-size` | `1` | |

### Transformers

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--task` | `text-generation` | 任务类型 |
| `--max-new-tokens` | `256` | 最大生成 tokens |
| `--dtype` | `float32` | |
| `--batch-size` | `1` | |
| `--device` | `cpu` | |

### PyTorch (CPU)

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--precision` | `fp32` | |
| `--batch-size` | `1` | |

## 输出格式

`--output` 输出比对结果 JSON，沿用现有 `tensor-compare.py` 的结构：

```json
{
  "status": "ok",
  "framework": "onnx",
  "model": "model.onnx",
  "layers": [
    {
      "layerName": "conv_1",
      "layerType": "Conv",
      "inputShape": [1, 3, 224, 224],
      "outputShape": [1, 64, 112, 112],
      "metrics": [
        {
          "frameworkId": "onnxruntime",
          "cosineSimilarity": 0.999999,
          "maxAbsError": 0.000012,
          "meanAbsError": 0.000008
        }
      ]
    }
  ]
}
```

可选 `--node-output` 输出二进制 `.npz` 文件，存储节点级的 tensor 数据。

## venv 生命周期

**初始化：**
- `_init/setup.sh` 遍历 `runners/` 下每个目录
- 有 `requirements.txt` 且 `venv/` 不存在 → `python3 -m venv venv && venv/bin/pip install -r requirements.txt`
- 有 `requirements.txt` 且 `venv/` 已存在 → 跳过
- 无 `requirements.txt` → 跳过（纯 shell 或二进制框架）

**重建：**
- `_init/setup.sh --force` 强制重建所有 venv

**系统启动：**
- 后端启动时自动执行 `setup.sh`（仅 venv 不存在时执行）
- 异步执行，不阻塞启动

## 后端集成

后端 task engine 根据 `params.framework` 找到对应的 runner 目录，拼接命令：

```typescript
const runnerPath = `runners/${params.framework}/run.sh`
const cmd = `${runnerPath} --input ${modelPath} --output ${outputPath}`
// 将 params 中剩余的字段转为 --key value 形式追加
```

> **注意**：后端当前 `src/tasks/model_diff/` 是单模块结构，需要扩展为通过 `MODULES` 注册多框架支持。

## 排除的范围（第二阶段）

- 量化参数（`--quantize`、校准数据集等）
- 性能压测相关参数（`--warmup`、`--iterations`）
- TensorRT 支持
- Docker 容器化

## 已确认的设计原则

1. 文件名即框架身份（目录名标识框架）
2. `--input` + `--output` 是所有框架的公共 CLI 接口
3. 可选参数各框架独立定义，互不影响
4. 入口脚本不限定语言（shell / Python / 二进制均可）
5. 保持一层 shell wrapper（`run.sh`）作为统一入口
6. 量化留到第二阶段
