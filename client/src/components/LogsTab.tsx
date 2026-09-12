import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Space, Switch, Tag, Typography, App } from 'antd';

/**
 * journalctl SSE 实时日志：
 * - 服务端 --show-cursor 下发游标；断线重连自动带 --after-cursor 续传
 * - 心跳由服务端 15s 注释帧维持
 */
export default function LogsTab({ gameId, unit }: { gameId: string; unit: string }): React.JSX.Element {
  const { message } = App.useApp();
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const esRef = useRef<EventSource | null>(null);
  const cursorRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const preRef = useRef<HTMLPreElement | null>(null);
  const reconnectTimer = useRef<number | null>(null);

  pausedRef.current = paused;

  const connect = (): void => {
    esRef.current?.close();
    const q = cursorRef.current ? `?cursor=${encodeURIComponent(cursorRef.current)}` : '?lines=300';
    const es = new EventSource(`/api/games/${gameId}/logs/stream${q}`);
    esRef.current = es;
    es.addEventListener('hello', () => {
      setConnected(true);
    });
    es.addEventListener('cursor', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { cursor: string };
      cursorRef.current = d.cursor;
    });
    es.addEventListener('line', (ev) => {
      if (pausedRef.current) return;
      const d = JSON.parse((ev as MessageEvent).data) as { line: string };
      setLines((prev) => {
        const next = [...prev, d.line];
        return next.length > 3000 ? next.slice(next.length - 3000) : next;
      });
    });
    es.addEventListener('stderr', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { line: string };
      setLines((prev) => [...prev.slice(-2999), `[stderr] ${d.line}`]);
    });
    es.addEventListener('expired', () => {
      setConnected(false);
      message.warning('会话已失效，日志流已断开');
      es.close();
    });
    es.addEventListener('end', () => {
      setConnected(false);
      es.close();
      // 断线自动续传
      reconnectTimer.current = window.setTimeout(() => connect(), 1500);
    });
    es.onerror = () => {
      setConnected(false);
      es.close();
      reconnectTimer.current = window.setTimeout(() => connect(), 1500);
    };
  };

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [lines]);

  const shown = filter ? lines.filter((l) => l.includes(filter)) : lines;

  return (
    <Card
      title={`journalctl · ${unit}`}
      extra={
        <Space>
          <Tag color={connected ? 'success' : 'error'}>{connected ? '已连接' : '未连接'}</Tag>
          <span>暂停</span>
          <Switch size="small" checked={paused} onChange={setPaused} />
          <Button
            size="small"
            onClick={() => {
              setLines([]);
              cursorRef.current = null;
              connect();
            }}
          >
            重新连接
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="断线自动以 --after-cursor 续传，不丢行不重复；输出仅为 journal 内容展示。"
      />
      <Input.Search
        placeholder="过滤关键字（客户端本地过滤）"
        allowClear
        style={{ marginBottom: 12, maxWidth: 360 }}
        onSearch={setFilter}
        onChange={(e) => {
          if (e.target.value === '') setFilter('');
        }}
      />
      <pre
        ref={preRef}
        style={{
          background: '#0b1021',
          color: '#d6e2ff',
          padding: 12,
          borderRadius: 6,
          maxHeight: 520,
          overflow: 'auto',
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {shown.join('\n') || '（等待日志…）'}
      </pre>
      <Typography.Text type="secondary">缓冲区保留最近 3000 行，渲染已转义。</Typography.Text>
    </Card>
  );
}
