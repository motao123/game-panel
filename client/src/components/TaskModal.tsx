import { useEffect, useRef, useState } from 'react';
import { Modal, Tag, Typography, App } from 'antd';
import { fmtTime } from '../api';
import type { TaskSnapshot } from '../types';

interface Props {
  taskId: string | null;
  onClose: (refresh: boolean) => void;
  title?: string;
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
      setOutput(snap.output);
    });
    es.addEventListener('output', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { appended: string };
      setOutput((prev) => (prev + d.appended).slice(-1024 * 1024));
    });
    es.addEventListener('end', () => {
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
    ) : (
      <Tag color="error">失败 (exit={task.exitCode ?? '?'})</Tag>
    );

  return (
    <Modal
      open
      title={`${title ?? task?.title ?? '任务'} ${statusTag}`}
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
