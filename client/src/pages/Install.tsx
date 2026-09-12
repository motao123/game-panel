import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Form, Input, Select, Space, Typography } from 'antd';
import { api } from '../api';
import type { InstallEntry, InstallField } from '../types';
import TaskModal from '../components/TaskModal';

function renderField(field: InstallField): React.JSX.Element {
  if (field.type === 'select' && field.options) {
    return (
      <Select
        options={field.options.map((o) => ({ value: o.value, label: o.label }))}
        placeholder={field.defaultValue || '请选择'}
      />
    );
  }
  if (field.type === 'password') {
    return <Input.Password placeholder={field.defaultValue ? '默认自动生成' : ''} autoComplete="new-password" maxLength={field.maxLength} />;
  }
  return <Input maxLength={field.maxLength} placeholder={field.defaultValue || ''} />;
}

export default function Install(): React.JSX.Element {
  const { message } = App.useApp();
  const [entries, setEntries] = useState<InstallEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<Record<string, string>>();

  useEffect(() => {
    api<{ entries: InstallEntry[] }>('/api/install/catalog')
      .then((r) => setEntries(r.entries))
      .catch((e) => message.error(e instanceof Error ? e.message : '加载安装目录失败'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entry = useMemo(() => entries.find((e) => e.gameId === selected) ?? null, [entries, selected]);

  useEffect(() => {
    form.resetFields();
    if (entry) {
      const init: Record<string, string> = {};
      for (const f of entry.fields) init[f.name] = f.defaultValue;
      form.setFieldsValue(init);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const refreshCatalog = useCallback((): void => {
    api<{ entries: InstallEntry[] }>('/api/install/catalog')
      .then((r) => setEntries(r.entries))
      .catch(() => undefined);
  }, []);

  const submit = async (): Promise<void> => {
    if (!entry) return;
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const r = await api<{ task: { id: string } }>('/api/install', {
        method: 'POST',
        body: { gameId: entry.gameId, values },
      });
      setTaskId(r.task.id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Typography.Title level={4}>安装向导</Typography.Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="面板只把表单映射为白名单环境变量后执行 NONINTERACTIVE=1 bash <安装脚本>；密码类值仅在环境变量中传递且输出自动打码，不进命令行/日志。"
      />
      <Card title="1. 选择要安装的游戏">
        <Select
          style={{ width: '100%', maxWidth: 520 }}
          placeholder="选择游戏（4 个专用脚本 + steam catalog 数据驱动）"
          value={selected}
          onChange={(v) => setSelected(v as string)}
          options={entries.map((e) => ({ value: e.gameId, label: `${e.label} — ${e.description}` }))}
        />
        <Button style={{ marginLeft: 12 }} onClick={refreshCatalog}>
          刷新目录
        </Button>
      </Card>

      {entry && (
        <Card title={`2. 参数（${entry.label}）`} style={{ marginTop: 16 }}>
          <Form form={form} layout="vertical" style={{ maxWidth: 640 }} preserve={false}>
            {entry.fields.map((f) => (
              <Form.Item
                key={f.name}
                name={f.name}
                label={`${f.label}（${f.name}）`}
                required={f.required}
                extra={f.help || undefined}
                rules={[
                  ...(f.required ? [{ required: true, message: `${f.label} 为必填` }] : []),
                  { max: f.maxLength, message: `最长 ${f.maxLength} 字符` },
                  ...(f.pattern !== '^.{0,200}$' ? [{ pattern: new RegExp(f.pattern), message: '格式不合法' }] : []),
                ]}
              >
                {renderField(f)}
              </Form.Item>
            ))}
            <Space>
              <Button type="primary" loading={submitting} onClick={() => void submit()}>
                开始安装（后台任务 + 流式回显）
              </Button>
            </Space>
          </Form>
        </Card>
      )}

      <TaskModal
        taskId={taskId}
        title={entry ? `安装 ${entry.label}` : '安装'}
        onClose={() => {
          setTaskId(null);
        }}
      />
    </div>
  );
}
