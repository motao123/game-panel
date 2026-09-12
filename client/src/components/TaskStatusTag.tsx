import { Tag } from 'antd';
import type { TaskSnapshot } from '../types';

/** 任务状态徽标（色系对齐 GPX：emerald/red/amber/sky → success/error/warning/processing） */
export default function TaskStatusTag({ task }: { task: TaskSnapshot }): React.JSX.Element {
  if (task.status === 'running') return <Tag color="processing">运行中</Tag>;
  if (task.status === 'success') return <Tag color="success">成功</Tag>;
  if (task.status === 'interrupted') return <Tag color="warning">已中断</Tag>;
  return <Tag color="error">失败 (exit={task.exitCode ?? '?'})</Tag>;
}
