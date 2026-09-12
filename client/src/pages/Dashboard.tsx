import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Col, Empty, Row, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { GameStatus, TaskSnapshot } from '../types';
import GameStatusCard from '../components/GameStatusCard';
import TaskStatusTag from '../components/TaskStatusTag';
import Onboarding from '../components/Onboarding';

function SummaryStat({ label, value, color }: { label: string; value: React.ReactNode; color?: 'success' }): React.JSX.Element {
  return (
    <span style={{ fontSize: 14 }}>
      {label}{' '}
      <Typography.Text strong style={{ fontSize: 16 }} type={color}>
        {value}
      </Typography.Text>
    </span>
  );
}

export default function Dashboard(): React.JSX.Element {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameStatus[] | null>(null);
  const [tasks, setTasks] = useState<TaskSnapshot[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [g, t] = await Promise.all([
        api<{ games: GameStatus[] }>('/api/games'),
        api<{ tasks: TaskSnapshot[] }>('/api/tasks').catch(() => ({ tasks: [] as TaskSnapshot[] })),
      ]);
      setGames(g.games);
      setTasks([...t.tasks].sort((a, b) => b.createdAt - a.createdAt));
      setUpdatedAt(Date.now());
    } catch {
      /* 轮询失败静默，下一轮重试 */
    }
  }, []);

  useEffect(() => {
    void refresh();
    timerRef.current = window.setInterval(() => void refresh(), 5000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [refresh]);

  const list = games ?? [];
  const installed = list.filter((g) => g.installed);
  const installable = list.filter((g) => !g.installed);
  const running = installed.filter((g) => g.active === 'active').length;
  const stopped = installed.filter((g) => g.active === 'inactive').length;
  const latestTask = tasks[0] ?? null;
  const latestByGame = new Map<string, TaskSnapshot>();
  for (const t of tasks) {
    if (t.gameId && !latestByGame.has(t.gameId)) latestByGame.set(t.gameId, t);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          服务器总览
        </Typography.Title>
        <Typography.Text type="secondary">
          每 5 秒自动刷新{updatedAt ? ` · 更新于 ${new Date(updatedAt).toLocaleTimeString()}` : ''}
        </Typography.Text>
      </div>

      <Onboarding games={list} />

      {games === null ? (
        <Card loading style={{ minHeight: 200 }} />
      ) : (
        <>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space wrap size={16} split={<Typography.Text type="secondary">·</Typography.Text>}>
              <SummaryStat label="运行中" value={running} color="success" />
              <SummaryStat label="已停止" value={stopped} />
              <SummaryStat label="已安装 / 可安装" value={`${installed.length} / ${installable.length}`} />
              <span style={{ fontSize: 14 }}>
                最近任务{' '}
                {latestTask ? (
                  <Space size={6} wrap>
                    <TaskStatusTag task={latestTask} />
                    <Typography.Text type="secondary">{latestTask.title}</Typography.Text>
                  </Space>
                ) : (
                  <Typography.Text type="secondary">暂无</Typography.Text>
                )}
              </span>
            </Space>
          </Card>

          <Row gutter={[16, 16]}>
            {installed.map((g) => (
              <Col xs={24} sm={12} lg={8} key={g.id}>
                <GameStatusCard g={g} latestTask={latestByGame.get(g.id) ?? null} onDone={() => void refresh()} />
              </Col>
            ))}
          </Row>

          {installable.length > 0 && (
            <Card
              style={{ marginTop: 16 }}
              title="可安装（未发现已安装）"
              extra={
                <Button type="primary" size="small" onClick={() => navigate('/install')}>
                  打开安装向导
                </Button>
              }
            >
              <Space wrap>
                {installable.map((g) => (
                  <Tag key={g.id}>{g.label}</Tag>
                ))}
              </Space>
            </Card>
          )}

          {list.length === 0 && <Empty description="未发现任何游戏（检查 PANEL_SCRIPTS_DIR 与 catalog）" />}
        </>
      )}
    </div>
  );
}
