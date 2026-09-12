import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Descriptions, Space, Tabs, Tag } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtBytes } from '../api';
import type { GameStatus } from '../types';
import LogsTab from '../components/LogsTab';
import BackupsTab from '../components/BackupsTab';
import ScheduleTab from '../components/ScheduleTab';
import ConfigTab from '../components/ConfigTab';
import UninstallTab from '../components/UninstallTab';

export default function GameDetail(): React.JSX.Element {
  const params = useParams<{ game: string }>();
  const gameId = params.game ?? '';
  const navigate = useNavigate();
  const [game, setGame] = useState<GameStatus | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const r = await api<{ game: GameStatus }>(`/api/games/${gameId}`);
      setGame(r.game);
    } catch {
      navigate('/');
    }
  }, [gameId, navigate]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(t);
  }, [refresh]);

  if (!game) return <Card loading style={{ minHeight: 300 }} />;

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Link to="/">
          <Button icon={<ArrowLeftOutlined />}>返回总览</Button>
        </Link>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{game.label}</span>
        <Tag color={game.active === 'active' ? 'success' : 'default'}>{game.active}</Tag>
      </Space>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, md: 2, xl: 4 }} size="small">
          <Descriptions.Item label="unit">{game.unit}</Descriptions.Item>
          <Descriptions.Item label="manager">{game.manager}</Descriptions.Item>
          <Descriptions.Item label="PID">{game.mainPID || '-'}</Descriptions.Item>
          <Descriptions.Item label="CPU">{game.cpuPercent === null ? '-' : `${game.cpuPercent}%`}</Descriptions.Item>
          <Descriptions.Item label="内存">
            {game.memoryCurrent === null ? '-' : fmtBytes(game.memoryCurrent)}
            {game.memoryMax ? ` / ${fmtBytes(game.memoryMax)}` : ''}
          </Descriptions.Item>
          <Descriptions.Item label="内存峰值">{game.memoryPeak === null ? '-' : fmtBytes(game.memoryPeak)}</Descriptions.Item>
          <Descriptions.Item label="端口">
            {game.ports.map((p) => `${p.port}/${p.proto}`).join('， ')}
          </Descriptions.Item>
          <Descriptions.Item label="最近备份">
            {game.lastBackup.latest ? `${game.lastBackup.count} 份 · 最近 ${fmtBytes(game.lastBackup.latest.sizeBytes)}` : '暂无'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Tabs
        items={[
          { key: 'logs', label: '日志', children: <LogsTab gameId={gameId} unit={game.unit} /> },
          { key: 'backups', label: '备份/恢复', children: <BackupsTab gameId={gameId} backupDir={game.backupDir} /> },
          { key: 'schedule', label: '计划任务', children: <ScheduleTab gameId={gameId} unit={game.unit} /> },
          ...(game.configEditable && game.configPath
            ? [{ key: 'config', label: '配置', children: <ConfigTab gameId={gameId} configPath={game.configPath} /> }]
            : []),
          { key: 'uninstall', label: '卸载', children: <UninstallTab gameId={gameId} onUninstalled={() => void refresh()} /> },
        ]}
      />
    </div>
  );
}
