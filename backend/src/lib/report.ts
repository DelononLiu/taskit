// backend/src/lib/report.ts

interface ReportData {
  modelName: string
  framework: string
  createdAt: string
  overall: {
    totalLayers: number
    passedLayers: number
    failedLayers: number
    avgCosineSimilarity: number
    maxAbsError: number
    worstLayer: string
  }
  layers: Array<{
    layerName: string
    layerType: string
    inputShape: number[]
    outputShape: number[]
    metrics: Array<{
      frameworkId: string
      cosineSimilarity: number
      maxAbsError: number
      meanAbsError: number
      snr: number
      passed: boolean
    }>
  }>
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function generateReportHtml(task: any): string {
  const result = task.result ? JSON.parse(task.result) : {}
  const params = task.params ? JSON.parse(task.params) : {}
  const overall = result.overall || {}
  const layers = result.layers || []
  const modelName = (task.fileNames?.[0] || `任务 #${task.id}`).replace(/\.[^.]+$/, '')
  const framework = result.framework || task.module || 'unknown'
  const createdAt = task.createdAt || ''

  // 构建分布数据
  const bins = { '0.95-1.00': 0, '0.90-0.95': 0, '<0.90': 0 }
  let maxPct = 0
  for (const l of layers) {
    for (const m of (l.metrics || [])) {
      const cos = m.cosineSimilarity || 0
      if (cos >= 0.95) bins['0.95-1.00']++
      else if (cos >= 0.90) bins['0.90-0.95']++
      else bins['<0.90']++
    }
  }
  const total = layers.length || 1
  for (const k of Object.keys(bins)) {
    const pct = Math.round((bins[k as keyof typeof bins] / total) * 100)
    bins[k as keyof typeof bins] = pct
    if (pct > maxPct) maxPct = pct
  }

  // 构建层表格行
  const layerRows = layers.map((l: any) => {
    const m = (l.metrics || [])[0] || {}
    const passed = m.passed !== false
    const rowClass = passed ? '' : ' class="failed"'
    return `<tr${rowClass}>
      <td>${escapeHtml(l.layerName || '')}</td>
      <td>${escapeHtml(l.layerType || '')}</td>
      <td>${m.cosineSimilarity != null ? m.cosineSimilarity.toFixed(6) : '—'}</td>
      <td>${m.maxAbsError != null ? m.maxAbsError.toFixed(6) : '—'}</td>
      <td>${m.meanAbsError != null ? m.meanAbsError.toFixed(6) : '—'}</td>
      <td>${m.snr != null ? m.snr.toFixed(2) : '—'}</td>
      <td>${passed ? '✅' : '❌'}</td>
    </tr>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>精度比对报告 — ${escapeHtml(modelName)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f7fa; color: #1a1a2e; padding: 32px; line-height: 1.6;
}
.container { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin-bottom: 4px; }
.subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
.cards { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.card {
  flex: 1; min-width: 150px; background: #fff; border-radius: 12px;
  padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.06);
  text-align: center;
}
.card .value { font-size: 28px; font-weight: 700; color: #1a1a2e; }
.card .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: .5px; margin-top: 4px; }
.card.good .value { color: #16a34a; }
.card.warn .value { color: #ea580c; }

.bar-section { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.06); margin-bottom: 24px; }
.bar-section h2 { font-size: 15px; margin-bottom: 16px; color: #444; }
.bar { display: flex; align-items: center; margin-bottom: 10px; font-size: 12px; }
.bar .bar-label { width: 80px; color: #666; text-align: right; margin-right: 12px; }
.bar .bar-track { flex: 1; height: 24px; background: #f0f0f0; border-radius: 4px; overflow: hidden; }
.bar .bar-fill { height: 100%; border-radius: 4px; transition: width .3s; }
.bar .bar-pct { width: 48px; margin-left: 8px; color: #444; font-weight: 600; }

.table-section { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table-section h2 { font-size: 15px; margin-bottom: 16px; color: #444; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 10px 12px; border-bottom: 2px solid #e5e7eb; color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; cursor: pointer; user-select: none; }
th:hover { color: #333; }
td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
tr.failed { background: #fef2f2; }
tr.failed td:first-child { color: #dc2626; font-weight: 600; }
tr:hover { background: #f8fafc; }
tr.failed:hover { background: #fee2e2; }
.footer { text-align: center; color: #aaa; font-size: 11px; margin-top: 24px; }
</style>
</head>
<body>
<div class="container">
<h1>🔬 精度比对报告</h1>
<div class="subtitle">
  模型: ${escapeHtml(modelName)} &nbsp;|&nbsp; 框架: ${escapeHtml(framework)} &nbsp;|&nbsp; 时间: ${escapeHtml(createdAt)}
</div>

<div class="cards">
  <div class="card">
    <div class="value">${overall.totalLayers ?? layers.length}</div>
    <div class="label">总层数</div>
  </div>
  <div class="card good">
    <div class="value">${overall.passedLayers ?? 0} ✅</div>
    <div class="label">通过层数</div>
  </div>
  <div class="card">
    <div class="value">${overall.avgCosineSimilarity != null ? overall.avgCosineSimilarity.toFixed(6) : '—'}</div>
    <div class="label">平均余弦相似度</div>
  </div>
  <div class="card warn">
    <div class="value">${escapeHtml(overall.worstLayer || '—')}</div>
    <div class="label">最差层</div>
  </div>
</div>

<div class="bar-section">
  <h2>📈 余弦相似度分布</h2>
  <div class="bar">
    <span class="bar-label">0.95–1.00</span>
    <div class="bar-track"><div class="bar-fill" style="width:${bins['0.95-1.00']}%;background:#16a34a"></div></div>
    <span class="bar-pct">${bins['0.95-1.00']}%</span>
  </div>
  <div class="bar">
    <span class="bar-label">0.90–0.95</span>
    <div class="bar-track"><div class="bar-fill" style="width:${bins['0.90-0.95']}%;background:#f59e0b"></div></div>
    <span class="bar-pct">${bins['0.90-0.95']}%</span>
  </div>
  <div class="bar">
    <span class="bar-label">&lt;0.90</span>
    <div class="bar-track"><div class="bar-fill" style="width:${bins['<0.90']}%;background:#dc2626"></div></div>
    <span class="bar-pct">${bins['<0.90']}%</span>
  </div>
</div>

<div class="table-section">
  <h2>📋 逐层精度表</h2>
  <table id="layerTable">
    <thead>
      <tr>
        <th onclick="sortTable(0)">层名</th>
        <th onclick="sortTable(1)">类型</th>
        <th onclick="sortTable(2)">余弦相似度</th>
        <th onclick="sortTable(3)">最大误差</th>
        <th onclick="sortTable(4)">平均误差</th>
        <th onclick="sortTable(5)">SNR</th>
        <th onclick="sortTable(6)">结果</th>
      </tr>
    </thead>
    <tbody>
${layerRows}
    </tbody>
  </table>
</div>

<div class="footer">Taskit 精度比对报告 · 离线可查看</div>
</div>

<script>
function sortTable(col) {
  var tbody = document.querySelector('#layerTable tbody');
  var rows = Array.from(tbody.querySelectorAll('tr'));
  var asc = tbody.dataset.sortCol == col ? tbody.dataset.sortDir != 'asc' : true;
  rows.sort(function(a, b) {
    var ca = a.cells[col].textContent.trim();
    var cb = b.cells[col].textContent.trim();
    var na = parseFloat(ca), nb = parseFloat(cb);
    if (!isNaN(na) && !isNaN(nb)) return asc ? na - nb : nb - na;
    return asc ? ca.localeCompare(cb) : cb.localeCompare(ca);
  });
  rows.forEach(function(r) { tbody.appendChild(r); });
  tbody.dataset.sortCol = col;
  tbody.dataset.sortDir = asc ? 'asc' : 'desc';
}
</script>
</body>
</html>`
}
