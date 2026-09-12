import { useState } from 'react';
import { App, Button, Card, Col, Popconfirm, Row, Space, Spin, Statistic, Tag, Tooltip, Typography, theme } from 'antd';
import { PauseCircleOutlined, PlayCircleOutlined, RedoOutlined, SettingOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { api, fmtBytes, fmtTime } from '../api';
import type { GameStatus, TaskSnapshot } from '../types';
import TaskStatusTag from './TaskStatusTag';

/** 游戏状态徽标（色系对齐 GPX：emerald/red/amber/sky → success/error/warning/processing） */
export function gameStatusTag(g: GameStatus): React.JSX.Element {
  if (!g.installed) return <Tag>未安装</Tag>;
  if (g.active === 'active') return <Tag color="success">运行中</Tag>;
  if (g.active === 'activating') return <Tag color="processing">启动中</Tag>;
  if (g.active === 'deactivating') return <Tag color="processing">停止中</Tag>;
  if (g.active === 'failed') return <Tag color="error">失败</Tag>;
  if (g.active === 'inactive') return <Tag color="default">已停止</Tag>;
  return <Tag color="warning">{g.active || '未知'}</Tag>;
}

type LifecycleAction = 'start' | 'stop' | 'restart';

/** 生命周期快捷操作（按状态机）：运行中→[停止/重启]；已停止/失败→[启动]；过渡态/执行中→禁用转圈 */
function LifecycleButtons({ g, onDone }: { g: GameStatus; onDone: () => void }): React.JSX.Element | null {
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const [busy, setBusy] = useState(false);

  const run = async (action: LifecycleAction, confirmTitle?: string): Promise<void> => {
    const doIt = async (): Promise<void> => {
      setBusy(true);
      try {
        const r = await api<{ ok: boolean; output: string; exitCode: number | null }>(
          `/api/games/${g.id}/lifecycle`,
          { method: 'POST', body: { action } },
        );
        if (r.ok) message.success(`${action} 完成`);
        else message.warning(`${action} 返回非零（exit=${r.exitCode ?? '?'}），见输出`);
        if (r.output.trim().length > 0) {
          modal.info({
            title: `${action} 输出`,
            content: <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', fontSize: 12 }}>{r.output}</pre>,
            width: 720,
          });
        }
        onDone();
      } catch (e) {
        message.error(e instanceof Error ? e.message : `${action} 失败`);
      } finally {
        setBusy(false);
      }
    };
    if (confirmTitle) {
      modal.confirm({ title: confirmTitle, content: `确认对 ${g.label} 执行 ${action}？`, onOk: () => void doIt() });
    } else {
      await doIt();
    }
  };

  if (!g.installed) return null;

  if (busy || g.active === 'activating' || g.active === 'deactivating') {
    return (
      <Space size={8}>
        <Spin size="small" />
        <Typography.Text type="secondary">
          {busy ? '命令执行中…' : g.active === 'activating' ? '启动中…' : '停止中…'}
        </Typography.Text>
      </Space>
    );
  }
  if (g.active === 'active') {
    return (
      <Space>
        <Popconfirm title={`停止 ${g.label}？`} onConfirm={() => void run('stop')}>
          <Button size="small" danger icon={<PauseCircleOutlined />}>
            停止
          </Button>
        </Popconfirm>
        <Button size="small" type="primary" icon={<RedoOutlined />} onClick={() => void run('restart', '重启会短暂断开玩家连接')}>
          重启
        </Button>
      </Space>
    );
  }
  return (
    <Button
      size="small"
      type="primary"
      icon={<PlayCircleOutlined />}
      style={{ backgroundColor: token.colorSuccess }}
      onClick={() => void run('start')}
    >
      启动
    </Button>
  );
}

/** Dashboard 游戏卡片：状态徽标 + CPU/内存/端口 + 最近备份/最近任务 + 状态机快捷操作 */
export default function GameStatusCard({
  g,
  latestTask,
  onDone,
}: {
  g: GameStatus;
  latestTask: TaskSnapshot | null;
  onDone: () => void;
}): React.JSX.Element {
  return (
    <Card
      size="small"
      title={
        <Space wrap size={8}>
          {g.label}
          {gameStatusTag(g)}
        </Space>
      }
      extra={
        <Link to={`/games/${g.id}`}>
          <Button size="small" icon={<SettingOutlined />}>
            管理
          </Button>
        </Link>
      }
    >
      <Row gutter={8}>
        <Col span={8}>
          <Statistic title="CPU" value={g.cpuPercent === null ? '-' : `${g.cpuPercent}%`} />
        </Col>
        <Col span={8}>
          <Statistic
            title="内存"
            value={g.memoryCurrent === null ? '-' : fmtBytes(g.memoryCurrent)}
            suffix={g.memoryMax ? `/ ${fmtBytes(g.memoryMax)}` : ''}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="端口"
            valueRender={() => (
              <div style={{ paddingTop: 4 }}>
                {g.ports.map((p) => (
                  <Tooltip key={`${p.port}/${p.proto}`} title={`${p.label} (${p.proto})`}>
                    <Tag style={{ marginBottom: 4 }}>
                      {p.port}/{p.proto}
                    </Tag>
                  </Tooltip>
                ))}
              </div>
            )}
          />
        </Col>
      </Row>
      <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.9 }}>
        <div>
          unit: <Typography.Text code>{g.unit}</Typography.Text> · PID {g.mainPID || '-'}
        </div>
        <div>
          最近备份：
          {g.lastBackup.latest
            ? `${fmtTime(g.lastBackup.latest.mtimeMs)}（${fmtBytes(g.lastBackup.latest.sizeBytes)}，共 ${g.lastBackup.count} 份）`
            : '暂无'}
        </div>
        <div>
          最近任务：
          {latestTask ? (
            <Space size={6} wrap>
              <TaskStatusTag task={latestTask} />
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {latestTask.title} · {fmtTime(latestTask.createdAt)}
              </Typography.Text>
            </Space>
          ) : (
            '暂无'
          )}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <LifecycleButtons g={g} onDone={onDone} />
      </div>
    </Card>
  );
}
