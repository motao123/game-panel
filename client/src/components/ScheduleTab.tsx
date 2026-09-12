import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../api';
import type { ScheduleItem } from '../types';

const TEMPLATES: { label: string; value: string }[] = [
  { label: '每天 04:00', value: '*-*-* 04:00:00' },
  { label: '每天 00:00', value: '*-*-* 00:00:00' },
  { label: '每 6 小时', value: '*-*-* 00/6:00:00' },
  { label: '每小时', value: '*-*-* *:00:00' },
  { label: '每周一 05:00', value: 'Mon *-*-* 05:00:00' },
  { label: '每周日 03:30', value: 'Sun *-*-* 03:30:00' },
  { label: '每月 1 日 05:00', value: '*-*-01 05:00:00' },
];

export default function ScheduleTab({ gameId, unit }: { gameId: string; unit: string }): React.JSX.Element {
  const { message } = App.useApp();
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<{ calendar: string; command: string }>();

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const r = await api<{ items: ScheduleItem[] }>(`/api/games/${gameId}/schedule`);
      setItems(r.items);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载计划任务失败');
    } finally {
      setLoading(false);
    }
  }, [gameId, message]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async (): Promise<void> => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const r = await api<{ id: string | null }>(`/api/games/${gameId}/schedule`, {
        method: 'POST',
        body: values,
      });
      message.success(`计划任务已创建${r.id ? `：ID ${r.id}` : ''}`);
      setModalOpen(false);
      form.resetFields();
      void refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await api(`/api/games/${gameId}/schedule/${id}`, { method: 'DELETE' });
      message.success(`任务 ${id} 已删除`);
      void refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const columns: ColumnsType<ScheduleItem> = [
    { title: 'ID', dataIndex: 'id', width: 150, render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
    { title: 'OnCalendar', dataIndex: 'calendar', width: 200 },
    {
      title: '下次触发',
      dataIndex: 'nextElapse',
      width: 200,
      render: (v: string | null) => {
        if (!v || v === 'n/a') return '-';
        const us = Number.parseInt(v, 10);
        return Number.isFinite(us) ? new Date(us / 1000).toLocaleString() : v;
      },
    },
    {
      title: '命令',
      dataIndex: 'command',
      render: (v: string) => (
        <Typography.Paragraph style={{ margin: 0 }} code ellipsis={{ rows: 2, expandable: true }}>
          {v}
        </Typography.Paragraph>
      ),
    },
    {
      title: '操作',
      width: 100,
      render: (_: unknown, record: ScheduleItem) =>
        record.stale ? (
          <Tag color="warning">timer 缺失</Tag>
        ) : (
          <Button size="small" danger onClick={() => void remove(record.id)}>
            删除
          </Button>
        ),
    },
  ];

  return (
    <Card
      title={`计划任务（systemd timer）· ${unit}`}
      extra={
        <Space>
          <Button type="primary" onClick={() => setModalOpen(true)}>
            新建任务
          </Button>
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
        message="经由 <game>-manager schedule add|remove 完成，任务落盘 /etc/<game>/tasks/<ID>.cmd，失败自动审计+告警。"
      />
      <Table<ScheduleItem> rowKey="id" columns={columns} dataSource={items} loading={loading} pagination={false} size="small" />

      <Modal
        open={modalOpen}
        title="新建计划任务"
        onCancel={() => setModalOpen(false)}
        onOk={() => void add()}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="calendar"
            label="OnCalendar 表达式"
            rules={[
              { required: true, message: '请输入或选择模板' },
              { max: 100, message: '最长 100 字符' },
              { pattern: /^[A-Za-z0-9*,:/_. -]+$/, message: '仅允许 A-Za-z0-9*,:/_. 空格-' },
            ]}
          >
            <Select
              showSearch
              allowClear
              options={TEMPLATES}
              placeholder="选择常用模板或输入表达式"
              onChange={(v) => {
                if (typeof v === 'string') form.setFieldValue('calendar', v);
              }}
            />
          </Form.Item>
          <Form.Item
            name="command"
            label="要执行的命令（传给 manager schedule add，将按计划由 systemd 触发）"
            rules={[
              { required: true, message: '请输入命令' },
              { max: 500, message: '最长 500 字符' },
            ]}
          >
            <Input.TextArea rows={3} placeholder={`例如 say 重启，或 /usr/local/bin/${gameId === 'minecraft' ? 'mc' : gameId}-manager restart`} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
