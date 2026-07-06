interface Props {
  taskId: number
  onNewTask: () => void
}

export function TemplateResultViewer({ taskId }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">
        任务 #{taskId} — 在此处展示你的任务结果。
      </p>
    </div>
  )
}
