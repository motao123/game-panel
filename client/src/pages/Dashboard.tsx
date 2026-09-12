import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Button, Card, Col, Empty, Modal, Popconfirm, Row, Space, Statistic, Tag, Tooltip, Typography } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined, RedoOutlined, SettingOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtBytes, fmtTime } from '../api';
import type { GameStatus } from '../types';

function statusTag(g: GameStatus): React.JSX.Element {
  if (!g.installed) return <Tag>未安装</Tag>;
  if (g.active === 'active') return <Tag color="success">运行中</Tag>;
  if (g.active === 'activating') return <Tag color="processing">启动中</Tag>;
  if (g.active === 'failed') return <Tag color="error">失败</Tag>;
  if (g.active === 'inactive') return <Tag color="default">已停止</Tag>;
  return <Tag color="warning">{g.active || '未知'}</Tag>;
}

function LifecycleButtons({ g, onDone }: { g: GameStatus; onDone: () => void }): React.JSX.Element {
  const { message, modal } = App.useApp();
  const [busy, setBusy] = useState(false);

  const run = async (action: string, confirmTitle?: string): Promise<void> => {
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
          modal.info({ title: `${action} 输出`, content: <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', fontSize: 12 }}>{r.output}</pre>, width: 720 });
        }
        onDone();
      } catch (e) {
        message.error(e instanceof Error ? e.message : `${action} 失败`);
      } finally {
        setBusy(false);
      }
    };
    if (confirmTitle) {
      Modal.confirm({ title: confirmTitle, content: `确认对 ${g.label} 执行 ${action}？`, onOk: () => void doIt() });
    } else {
      await doIt();
    }
  };

  return (
    <Space>
      <Button
        size="small"
        icon={<PlayCircleOutlined />}
        disabled={busy || !g.installed}
        onClick={() => void run('start')}
      >
        启动
      </Button>
      <Popconfirm title={`停止 ${g.label}？`} onConfirm={() => void run('stop')} disabled={busy || !g.installed}>
        <Button size="small" icon={<PauseCircleOutlined />} disabled={busy || !g.installed}>
          停止
        </Button>
      </Popconfirm>
      <Button
        size="small"
        icon={<RedoOutlined />}
        disabled={busy || !g.installed}
        onClick={() => void run('restart', '重启会短暂断开玩家连接')}
      >
        重启
      </Button>
    </Space>
  );
}

export default function Dashboard(): React.JSX.Element {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameStatus[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const r = await api<{ games: GameStatus[] }>('/api/games');
      setGames(r.games);
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

  const installed = (games ?? []).filter((g) => g.installed);

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

      {games === null ? (
        <Card loading style={{ minHeight: 200 }} />
      ) : (
        <>
          <Row gutter={[16, 16]}>
            {installed.map((g) => (
              <Col xs={24} md={12} xl={8} key={g.id}>
                <Card
                  title={
                    <Space>
                      {g.label}
                      {statusTag(g)}
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
                  <div style={{ margin: '12px 0 4px', color: '#666', fontSize: 13 }}>
                    <div>
                      unit: <Typography.Text code>{g.unit}</Typography.Text> · PID {g.mainPID || '-'}
                    </div>
                    <div>
                      最近备份：
                      {g.lastBackup.latest
                        ? `${fmtTime(g.lastBackup.latest.mtimeMs)}（${fmtBytes(g.lastBackup.latest.sizeBytes)}，共 ${g.lastBackup.count} 份）`
                        : '暂无'}
                    </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <LifecycleButtons g={g} onDone={() => void refresh()} />
                  </div>
                </Card>
              </Col>
            ))}
          </Row>

          {(games ?? []).filter((g) => !g.installed).length > 0 && (
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
                {(games ?? [])
                  .filter((g) => !g.installed)
                  .map((g) => (
                    <Tag key={g.id}>{g.label}</Tag>
                  ))}
              </Space>
            </Card>
          )}

          {games.length === 0 && <Empty description="未发现任何游戏（检查 PANEL_SCRIPTS_DIR 与 catalog）" />}
        </>
      )}
    </div>
  );
}
