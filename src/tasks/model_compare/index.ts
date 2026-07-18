import { MODULES } from '@/tasks/registry'
import { ModelCompareForm } from './TaskForm'
import { ModelCompareResult } from './ResultViewer'

MODULES.model_compare = {
  name: '模型精度比对',
  icon: 'Layers',
  TaskForm: ModelCompareForm,
  ResultViewer: ModelCompareResult,
}
