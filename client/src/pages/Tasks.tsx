import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Progress, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, fmtTime, stripAnsi } from '../api';
import type { TaskSnapshot } from '../types';
import TaskModal from '../components/TaskModal';
import TaskStatusTag from '../components/TaskStatusTag';

const KIND_OPTIONS = [
  { value: 'install', label: '安装' },
  { value: 'uninstall', label: '卸载' },
  { value: 'restore', label: '恢复' },
  { value: 'update', label: '更新' },
  { value: 'backup', label: '备份' },
];

const STATUS_OPTIONS = [
  { value: 'running', label: '运行中' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'interrupted', label: '已中断' },
];

/** 日志尾部（等宽深色底） */
function OutputTail({ output }: { output: string }): React.JSX.Element {
  return (
    <pre
      style={{
        margin: 0,
        background: '#0b1021',
        color: '#d6e2ff',
        padding: 12,
        borderRadius: 6,
        maxHeight: 280,
        overflow: 'auto',
        fontSize: 12,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {stripAnsi(output).slice(-1500) || '（无输出）'}
    </pre>
  );
}

export default function Tasks(): React.JSX.Element {
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<TaskSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string | undefined>(undefined);
  const [gameFilter, setGameFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  const load = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setLoading(true);
      try {
        const r = await api<{ tasks: TaskSnapshot[] }>('/api/tasks');
        setTasks(r.tasks);
      } catch (e) {
        if (!silent) message.error(e instanceof Error ? e.message : '加载任务失败');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // 存在运行中任务时才每 5 秒自动刷新（静默，不触发表格 loading）
  const hasRunning = tasks.some((t) => t.status === 'running');
  useEffect(() => {
    if (!hasRunning) return;
    const t = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(t);
  }, [hasRunning, load]);

  const gameOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) if (t.gameId) ids.add(t.gameId);
    return [...ids].map((id) => ({ value: id, label: id }));
  }, [tasks]);

  const filtered = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (!kindFilter || t.kind === kindFilter) &&
          (!gameFilter || t.gameId === gameFilter) &&
          (!statusFilter || t.status === statusFilter),
      ),
    [tasks, kindFilter, gameFilter, statusFilter],
  );

  const columns: ColumnsType<TaskSnapshot> = [
    { title: '任务', dataIndex: 'title' },
    { title: '类型', dataIndex: 'kindLabel', width: 90, render: (v: string) => <Tag>{v}</Tag> },
    { title: '游戏', dataIndex: 'gameId', width: 110, render: (v: string | null) => (v ? <Tag>{v}</Tag> : '-') },
    {
      title: '状态',
      dataIndex: 'status',
      width: 180,
      render: (v: TaskSnapshot['status'], r: TaskSnapshot) =>
        v === 'running' ? (
          <Space size={6}>
            <Tag color="processing" style={{ marginRight: 0 }}>
              运行中
            </Tag>
            <Progress percent={100} status="active" showInfo={false} size="small" style={{ width: 56, marginBottom: 0 }} />
          </Space>
        ) : (
          <TaskStatusTag task={r} />
        ),
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (v: number) => fmtTime(v) },
    { title: '结束时间', dataIndex: 'endedAt', width: 180, render: (v: number | null) => fmtTime(v) },
  ];

  return (
    <Card
      title="任务中心（安装 / 卸载 / 恢复 / 更新 / 备份）"
      extra={
        <Space wrap>
          <Select placeholder="类型" style={{ width: 110 }} allowClear options={KIND_OPTIONS} value={kindFilter} onChange={(v) => setKindFilter(v)} />
          <Select placeholder="游戏" style={{ width: 130 }} allowClear options={gameOptions} value={gameFilter} onChange={(v) => setGameFilter(v)} />
          <Select placeholder="状态" style={{ width: 110 }} allowClear options={STATUS_OPTIONS} value={statusFilter} onChange={(v) => setStatusFilter(v)} />
          <Button onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        </Space>
      }
    >
      <Table<TaskSnapshot>
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        loading={loading}
        size="small"
        pagination={{ pageSize: 15, showTotal: (t) => `共 ${t} 个任务` }}
        onRow={(r) => ({
          onClick: () => setOpenId(r.id),
          style: { cursor: 'pointer' },
        })}
        expandable={{
          rowExpandable: (r) => r.status === 'failed',
          expandedRowRender: (r) => <OutputTail output={r.output} />,
        }}
      />
      <TaskModal taskId={openId} onClose={() => { setOpenId(null); void load(); }} />
    </Card>
  );
}
