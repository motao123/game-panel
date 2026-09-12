import { useCallback, useEffect, useState } from 'react';
import { App, Button, Card, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, fmtTime } from '../api';
import type { TaskSnapshot } from '../types';
import TaskModal from '../components/TaskModal';

export default function Tasks(): React.JSX.Element {
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<TaskSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const r = await api<{ tasks: TaskSnapshot[] }>('/api/tasks');
      setTasks(r.tasks);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载任务失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(t);
  }, [load]);

  const columns: ColumnsType<TaskSnapshot> = [
    { title: '任务', dataIndex: 'title' },
    { title: '类型', dataIndex: 'kindLabel', width: 90, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (v: TaskSnapshot['status'], r: TaskSnapshot) =>
        v === 'running' ? (
          <Tag color="processing">运行中</Tag>
        ) : v === 'success' ? (
          <Tag color="success">成功</Tag>
        ) : v === 'interrupted' ? (
          <Tag color="warning">已中断</Tag>
        ) : (
          <Tag color="error">失败 (exit={r.exitCode ?? '?'})</Tag>
        ),
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (v: number) => fmtTime(v) },
    { title: '结束时间', dataIndex: 'endedAt', width: 180, render: (v: number | null) => fmtTime(v) },
  ];

  return (
    <Card
      title="任务中心（安装 / 更新 / 备份 / 恢复 / 卸载）"
      extra={
        <Button onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      }
    >
      <Table<TaskSnapshot>
        rowKey="id"
        columns={columns}
        dataSource={tasks}
        loading={loading}
        size="small"
        pagination={{ pageSize: 15, showTotal: (t) => `共 ${t} 个任务` }}
        onRow={(r) => ({
          onClick: () => setOpenId(r.id),
          style: { cursor: 'pointer' },
        })}
      />
      <TaskModal taskId={openId} onClose={() => { setOpenId(null); void load(); }} />
    </Card>
  );
}
