export interface ModuleDef {
  name: string
  /** Shell command template with {task_dir} and {task_id} placeholders (legacy) */
  shell?: string
  /** Runner directory name under runners/ (e.g. 'onnx', 'openvino') */
  runner?: string
  parser: (stdout: any, params: any) => any
}

export const MODULES: Record<string, ModuleDef> = {}

export function getModule(name: string): ModuleDef | undefined {
  return MODULES[name]
}
