import { useEffect, useRef, useState } from 'react';
import { Modal, Tag, Typography, App } from 'antd';
import { fmtTime } from '../api';
import type { TaskSnapshot } from '../types';

interface Props {
  taskId: string | null;
  onClose: (refresh: boolean) => void;
  title?: string;
}

/** 剥离 ANSI 转义序列（脚本输出的颜色/控制码在终端渲染，Web 端仅展示纯文本） */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/** 任务输出订阅（SSE）：实时回显 + 终态提示 */
export default function TaskModal({ taskId, onClose, title }: Props): React.JSX.Element | null {
  const { message } = App.useApp();
  const [task, setTask] = useState<TaskSnapshot | null>(null);
  const [output, setOutput] = useState('');
  const preRef = useRef<HTMLPreElement | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setTask(null);
    setOutput('');
    setDone(false);
    if (!taskId) return;
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    es.addEventListener('snapshot', (ev) => {
      const snap = JSON.parse((ev as MessageEvent).data) as TaskSnapshot;
      setTask(snap);
      setOutput(stripAnsi(snap.output));
    });
    es.addEventListener('output', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { appended: string };
      setOutput((prev) => (prev + stripAnsi(d.appended)).slice(-1024 * 1024));
    });
    es.addEventListener('end', (ev) => {
      // 兜底：若终态 snapshot 因任何原因未先到达，用 end 载荷修正状态
      try {
        const d = JSON.parse((ev as MessageEvent).data) as { status: string; exitCode: number | null };
        setTask((prev) => (prev && prev.status === 'running' ? { ...prev, status: d.status as TaskSnapshot['status'], exitCode: d.exitCode } : prev));
      } catch {
        /* end 载荷解析失败不阻断关闭 */
      }
      setDone(true);
      es.close();
    });
    es.onerror = () => {
      // EventSource 会自动重连；终态后由 end 事件关闭
    };
    return () => {
      es.close();
    };
  }, [taskId]);

  useEffect(() => {
    if (done && task) {
      if (task.status === 'success') message.success(`${task.kindLabel}完成`);
      else if (task.status === 'interrupted') message.warning(`${task.kindLabel}因面板重启而中断`);
      else message.error(`${task.kindLabel}失败（exit=${task.exitCode ?? '?'}）`);
    }
  }, [done, task, message]);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [output]);

  if (!taskId) return null;

  const statusTag =
    task === null ? (
      <Tag>连接中…</Tag>
    ) : task.status === 'running' ? (
      <Tag color="processing">运行中</Tag>
    ) : task.status === 'success' ? (
      <Tag color="success">成功</Tag>
    ) : task.status === 'interrupted' ? (
      <Tag color="warning">已中断</Tag>
    ) : (
      <Tag color="error">失败 (exit={task.exitCode ?? '?'})</Tag>
    );

  return (
    <Modal
      open
      title={
        <span>
          {title ?? task?.title ?? '任务'} {statusTag}
        </span>
      }
      width={860}
      onCancel={() => onClose(true)}
      footer={null}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        任务 ID: {taskId} · {task ? fmtTime(task.createdAt) : ''} · 密码类输出已由服务端打码
      </Typography.Paragraph>
      <pre
        ref={preRef}
        style={{
          background: '#0b1021',
          color: '#d6e2ff',
          padding: 12,
          borderRadius: 6,
          maxHeight: 420,
          overflow: 'auto',
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {output || '（等待输出…）'}
      </pre>
    </Modal>
  );
}
