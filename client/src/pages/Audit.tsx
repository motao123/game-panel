import { useCallback, useEffect, useState } from 'react';
import { App, Button, Card, Input, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../api';
import type { AuditRow } from '../types';

const actionColors: Record<string, string> = {
  schedule_add: 'blue',
  schedule_remove: 'blue',
  config_apply: 'cyan',
  config_apply_ok: 'green',
  config_rollback: 'red',
  uninstall_start: 'red',
  uninstall_done: 'red',
  task_failed: 'volcano',
  task_ok: 'green',
};

export default function Audit(): React.JSX.Element {
  const { message } = App.useApp();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [game, setGame] = useState<string>('');
  const [action, setAction] = useState<string>('');
  const [q, setQ] = useState('');
  const pageSize = 50;

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      params.set('offset', String((page - 1) * pageSize));
      if (game) params.set('game', game);
      if (action) params.set('action', action);
      if (q) params.set('q', q);
      const r = await api<{ exists: boolean; total: number; rows: AuditRow[] }>(`/api/audit?${params.toString()}`);
      setRows(r.rows);
      setTotal(r.total);
      setExists(r.exists);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载审计日志失败');
    } finally {
      setLoading(false);
    }
  }, [page, game, action, q, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<AuditRow> = [
    { title: '时间', dataIndex: 'time', width: 200 },
    { title: '游戏', dataIndex: 'game', width: 110, render: (v: string) => <Tag>{v || '-'}</Tag> },
    { title: '用户', dataIndex: 'user', width: 110 },
    {
      title: '动作',
      dataIndex: 'action',
      width: 170,
      render: (v: string) => <Tag color={actionColors[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: '详情',
      dataIndex: 'detail',
      render: (v: string) => (
        <Typography.Paragraph style={{ margin: 0 }} code ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}>
          {v}
        </Typography.Paragraph>
      ),
    },
  ];

  return (
    <Card
      title="审计日志（/var/log/game-server-scripts/audit.log · JSONL）"
      extra={
        <Space wrap>
          <Input
            allowClear
            placeholder="搜索详情关键字"
            style={{ width: 200 }}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <Input
            allowClear
            placeholder="game 过滤，如 terraria"
            style={{ width: 170 }}
            value={game}
            onChange={(e) => {
              setGame(e.target.value);
              setPage(1);
            }}
          />
          <Input
            allowClear
            placeholder="action 过滤，如 schedule"
            style={{ width: 190 }}
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          />
          <Button onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        </Space>
      }
    >
      {!exists && (
        <Typography.Paragraph type="warning">
          审计文件尚不存在（执行任意 manager 操作后自动生成）。
        </Typography.Paragraph>
      )}
      <Table<AuditRow>
        rowKey={(r, i) => `${i}-${r.time}-${r.action}`}
        columns={columns}
        dataSource={rows}
        loading={loading}
        size="small"
        pagination={{
          current: page,
          pageSize,
          total,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p) => setPage(p),
        }}
      />
    </Card>
  );
}
