// 新任务模板 — 复制此目录并重命名，然后修改以下三处：
//
// 1. TaskForm.tsx    — 上传什么文件、填什么参数
// 2. ResultViewer.tsx — 结果怎么展示
// 3. index.ts        — 注册名称和图标（见下方）
//
// 然后在 src/tasks/registry.ts 中导入注册：
//
//   import '@/tasks/my_task'
//   MODULES.my_task = { name, icon, TaskForm, ResultViewer }

import { MODULES } from '@/tasks/registry'
import { TemplateTaskForm } from './TaskForm'
import { TemplateResultViewer } from './ResultViewer'

// 取消下方注释并修改为新任务名称即可注册
// MODULES.my_task = {
//   name: '我的任务',
//   icon: 'FileText',
//   TaskForm: TemplateTaskForm,
//   ResultViewer: TemplateResultViewer,
// }
