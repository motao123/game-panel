import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, fmtBytes, fmtTime } from '../api';
import type { BackupItem } from '../types';
import TaskModal from './TaskModal';

export default function BackupsTab({ gameId, backupDir }: { gameId: string; backupDir: string }): React.JSX.Element {
  const { message } = App.useApp();
  const [items, setItems] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const r = await api<{ items: BackupItem[] }>(`/api/games/${gameId}/backups`);
      setItems(r.items);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载备份列表失败');
    } finally {
      setLoading(false);
    }
  }, [gameId, message]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startBackup = async (): Promise<void> => {
    try {
      const r = await api<{ task: { id: string } }>(`/api/games/${gameId}/backups`, { method: 'POST', body: {} });
      setTaskId(r.task.id);
      message.info('备份任务已启动');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '备份启动失败');
    }
  };

  const doRestore = async (file: string): Promise<void> => {
    try {
      const r = await api<{ task: { id: string } }>(`/api/games/${gameId}/backups/restore`, {
        method: 'POST',
        body: { file },
      });
      setTaskId(r.task.id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '恢复启动失败');
    }
  };

  const columns: ColumnsType<BackupItem> = [
    { title: '文件名', dataIndex: 'name', render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
    {
      title: '时间',
      dataIndex: 'mtimeMs',
      width: 190,
      render: (v: number) => fmtTime(v),
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.mtimeMs - b.mtimeMs,
    },
    { title: '大小', dataIndex: 'sizeBytes', width: 110, render: (v: number) => fmtBytes(v) },
    {
      title: 'SHA256',
      dataIndex: 'sha256',
      width: 160,
      render: (v: string | null) =>
        v ? (
          <Typography.Text copyable={{ text: v }} style={{ fontSize: 12 }}>
            {v.slice(0, 16)}…
          </Typography.Text>
        ) : (
          <Tag color="warning">无校验文件</Tag>
        ),
    },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, record: BackupItem) => (
        <Popconfirm
          title="恢复该备份？"
          description="恢复前脚本会自动做 pre-restore 备份，恢复失败可回滚。"
          onConfirm={() => void doRestore(record.name)}
        >
          <Button size="small" type="primary" ghost>
            恢复
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Card
      title={`备份管理 · ${backupDir}`}
      extra={
        <Space>
          <Button type="primary" onClick={() => void startBackup()}>
            立即备份
          </Button>
          <Popconfirm title="恢复最新备份 latest？" onConfirm={() => void doRestore('latest')}>
            <Button>恢复 latest</Button>
          </Popconfirm>
          <Button onClick={() => void refresh()} loading={loading}>
            刷新
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="恢复走 <game>-manager restore：自动 sha256 校验 + 目录穿越/空壳包拒绝；恢复前会自动创建 pre-restore 备份，失败自动回滚；只恢复原先处于运行状态的服务。"
      />
      <Table<BackupItem>
        rowKey="name"
        columns={columns}
        dataSource={items}
        loading={loading}
        pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 份` }}
        size="small"
      />
      <TaskModal
        taskId={taskId}
        onClose={(refreshList) => {
          setTaskId(null);
          if (refreshList) void refresh();
        }}
      />
    </Card>
  );
}
