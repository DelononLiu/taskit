interface Props {
  onTaskCreated: (taskId: number) => void
}

export function TemplateTaskForm({ onTaskCreated }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">
        创建一个新任务类型时，复制此目录并根据需要修改 TaskForm 和 ResultViewer。
      </p>
    </div>
  )
}
