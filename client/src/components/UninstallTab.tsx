import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Input, List, Space, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { UninstallPreview } from '../types';
import TaskModal from './TaskModal';

export default function UninstallTab({
  gameId,
  onUninstalled,
}: {
  gameId: string;
  onUninstalled: () => void;
}): React.JSX.Element {
  const { message } = App.useApp();
  const [preview, setPreview] = useState<UninstallPreview | null>(null);
  const [confirm, setConfirm] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const r = await api<{ preview: UninstallPreview }>(`/api/games/${gameId}/uninstall/preview`);
      setPreview(r.preview);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载卸载清单失败');
    }
  }, [gameId, message]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (): Promise<void> => {
    try {
      const r = await api<{ task: { id: string } }>(`/api/games/${gameId}/uninstall`, {
        method: 'POST',
        body: { confirm },
      });
      setTaskId(r.task.id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '卸载启动失败');
    }
  };

  if (!preview) return <Card loading />;

  return (
    <Card
      title={
        <span>
          <WarningOutlined style={{ color: '#cf1322' }} /> 一键卸载 · {preview.label}
        </span>
      }
    >
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message="卸载执行 NONINTERACTIVE=1 FORCE_UNINSTALL=1 bash <script> --uninstall，将删除下列全部内容（含世界/存档/备份），删除后不可恢复！建议先手动备份。"
      />
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="systemd 单元">
          <List
            size="small"
            dataSource={preview.units}
            renderItem={(u) => <List.Item style={{ padding: '2px 0' }}><Typography.Text code>{u}</Typography.Text></List.Item>}
          />
        </Descriptions.Item>
        <Descriptions.Item label="程序文件">
          <List
            size="small"
            dataSource={preview.files}
            renderItem={(f) => <List.Item style={{ padding: '2px 0' }}><Typography.Text code>{f}</Typography.Text></List.Item>}
          />
        </Descriptions.Item>
        <Descriptions.Item label="数据目录（不可恢复）">
          <List
            size="small"
            dataSource={preview.dirs}
            renderItem={(d) => (
              <List.Item style={{ padding: '2px 0' }}>
                <Typography.Text code>{d}</Typography.Text>（含世界/存档/备份）
              </List.Item>
            )}
          />
        </Descriptions.Item>
        <Descriptions.Item label="系统用户">
          {preview.users.length > 0 ? preview.users.map((u) => <Typography.Text key={u} code>{u} </Typography.Text>) : '（无，steam 用户可能被共用）'}
        </Descriptions.Item>
        <Descriptions.Item label="执行脚本">
          <Typography.Text code>
            {`NONINTERACTIVE=1 FORCE_UNINSTALL=1 bash ${preview.script} ${preview.script === 'steam-server-install.sh' ? `${preview.gameId} ` : ''}--uninstall`}
          </Typography.Text>
        </Descriptions.Item>
      </Descriptions>

      <div style={{ marginTop: 16 }}>
        <Typography.Paragraph>
          请输入服务名 <Typography.Text strong code>{preview.confirmName}</Typography.Text> 以确认：
        </Typography.Paragraph>
        <Space>
          <Input
            style={{ width: 320 }}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={preview.confirmName}
          />
          <Button danger type="primary" disabled={confirm !== preview.confirmName} onClick={() => void run()}>
            确认卸载
          </Button>
        </Space>
      </div>

      <TaskModal
        taskId={taskId}
        onClose={(refreshList) => {
          setTaskId(null);
          if (refreshList) {
            onUninstalled();
            void refresh();
          }
        }}
      />
    </Card>
  );
}
