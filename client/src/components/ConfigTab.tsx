import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Space, Tag, Typography } from 'antd';
import { api } from '../api';
import type { ConfigApplyResult } from '../types';

/**
 * 配置编辑（textarea 轻量实现）：保存即执行 config-apply 语义
 * （备份 → 写入 → restart → 15 秒 is-active 轮询 → 失败自动回滚，全部由 *-manager 完成）。
 */
export default function ConfigTab({ gameId, configPath }: { gameId: string; configPath: string }): React.JSX.Element {
  const { message } = App.useApp();
  const [content, setContent] = useState<string>('');
  const [origin, setOrigin] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ConfigApplyResult | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const r = await api<{ path: string; content: string }>(`/api/games/${gameId}/config`);
      setContent(r.content);
      setOrigin(r.content);
      setResult(null);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '读取配置失败');
    } finally {
      setLoading(false);
    }
  }, [gameId, message]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setResult(null);
    try {
      const r = await api<{ result: ConfigApplyResult }>(`/api/games/${gameId}/config`, {
        method: 'PUT',
        body: { content },
      });
      setResult(r.result);
      if (r.result.status === 'applied') message.success('配置已应用，服务健康检查通过');
      else if (r.result.status === 'unchanged') message.info('配置未变更');
      else message.error('服务重启验证失败，配置已自动回滚');
      await refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const dirty = content !== origin;

  return (
    <Card
      loading={loading}
      title={
        <Space>
          配置编辑
          <Typography.Text code>{configPath}</Typography.Text>
        </Space>
      }
      extra={
        <Space>
          <Button onClick={() => void refresh()}>重置</Button>
          <Button type="primary" disabled={!dirty} loading={saving} onClick={() => void save()}>
            保存并应用（config-apply）
          </Button>
        </Space>
      }
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          <>
            保存即执行 <b>config-apply</b>：自动备份原配置 → 写入 → 重启服务 → 15 秒健康检查 → <b>失败自动回滚</b>。
          </>
        }
      />

      {result && (
        <Alert
          style={{ marginBottom: 12 }}
          type={result.status === 'applied' ? 'success' : result.status === 'unchanged' ? 'info' : result.status === 'rolled_back' ? 'error' : 'warning'}
          showIcon
          message={
            <Space wrap>
              <Tag color={result.status === 'applied' ? 'success' : result.status === 'unchanged' ? 'blue' : result.status === 'rolled_back' ? 'red' : 'orange'}>
                {result.status === 'applied'
                  ? 'applied · 已生效'
                  : result.status === 'unchanged'
                    ? 'unchanged · 配置未变更'
                    : result.status === 'rolled_back'
                      ? 'rolled_back · 已回滚'
                      : 'no_change_detected'}
              </Tag>
              {result.status === 'rolled_back' && result.problemConfigPath && (
                <span>
                  问题配置保留于 <Typography.Text code>{result.problemConfigPath}</Typography.Text>
                </span>
              )}
              {result.preChangeBackupPath && (
                <span>
                  变更前配置 <Typography.Text code>{result.preChangeBackupPath}</Typography.Text>
                </span>
              )}
            </Space>
          }
          description={<pre style={{ maxHeight: 200, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap' }}>{result.output}</pre>}
        />
      )}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        style={{
          width: '100%',
          minHeight: 440,
          fontFamily: 'SFMono-Regular, Consolas, monospace',
          fontSize: 13,
          lineHeight: 1.5,
          padding: 12,
          borderRadius: 6,
          border: '1px solid #d9d9d9',
          resize: 'vertical',
        }}
      />
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
        {dirty ? '有未保存的修改' : '与服务器内容一致'} · 文件大小 {content.length.toLocaleString()} 字符
      </Typography.Text>
    </Card>
  );
}
