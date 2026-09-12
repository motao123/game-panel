import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api } from '../api';
import type { ScheduleItem } from '../types';

interface Template {
  group: string;
  label: string;
  calendar: string;
  /** 非空时选中模板自动填充命令输入框 */
  command: string;
}

/** 仅时间表达式模板（不自动填充命令） */
const TIME_ONLY: { label: string; calendar: string }[] = [
  { label: '每天 00:00', calendar: '*-*-* 00:00:00' },
  { label: '每小时', calendar: '*-*-* *:00:00' },
  { label: '每周一 05:00', calendar: 'Mon *-*-* 05:00:00' },
  { label: '每周日 03:30', calendar: 'Sun *-*-* 03:30:00' },
  { label: '每月 1 日 05:00', calendar: '*-*-01 05:00:00' },
];

export default function ScheduleTab({ gameId, unit, manager }: { gameId: string; unit: string; manager: string }): React.JSX.Element {
  const { message } = App.useApp();
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<{ template?: string; calendar: string; command: string }>();

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

  // 模板库（重启/备份/命令类；命令类按游戏过滤），command 依赖当前游戏 manager 路径
  const templates = useMemo<Template[]>(() => {
    const list: Template[] = [
      { group: '重启类', label: '每天凌晨 4 点重启', calendar: '*-*-* 04:00:00', command: `${manager} restart` },
      { group: '备份类', label: '每 6 小时备份', calendar: '*-*-* 00,06,12,18:00:00', command: `${manager} backup` },
      { group: '备份类', label: '每天凌晨 2 点备份', calendar: '*-*-* 02:00:00', command: `${manager} backup` },
    ];
    if (gameId === 'palworld') {
      list.push({ group: '命令类', label: '每小时保存', calendar: '*:00:00', command: `${manager} save` });
    }
    for (const t of TIME_ONLY) {
      list.push({ group: '仅时间表达式（命令不自动填充）', label: t.label, calendar: t.calendar, command: '' });
    }
    return list;
  }, [manager, gameId]);

  const templateOptions = useMemo(() => {
    const groups: { label: string; options: { label: string; value: string }[] }[] = [];
    for (const t of templates) {
      let g = groups.find((x) => x.label === t.group);
      if (!g) {
        g = { label: t.group, options: [] };
        groups.push(g);
      }
      g.options.push({ label: t.label, value: t.label });
    }
    return groups;
  }, [templates]);

  const add = async (): Promise<void> => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      // 后端 schema 为 strict：只提交 calendar/command，剥离 UI 用的 template 字段
      const r = await api<{ id: string | null }>(`/api/games/${gameId}/schedule`, {
        method: 'POST',
        body: { calendar: values.calendar, command: values.command },
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
          <Form.Item name="template" label="从模板选择（自动填充下方表达式与命令，仍可修改）">
            <Select
              allowClear
              placeholder="选择计划任务模板"
              options={templateOptions}
              onChange={(v) => {
                const t = templates.find((x) => x.label === v);
                if (!t) return;
                form.setFieldsValue({ calendar: t.calendar, ...(t.command ? { command: t.command } : {}) });
              }}
            />
          </Form.Item>
          <Form.Item
            name="calendar"
            label="OnCalendar 表达式"
            rules={[
              { required: true, message: '请输入或选择模板' },
              { max: 100, message: '最长 100 字符' },
              { pattern: /^[A-Za-z0-9*,:/_. -]+$/, message: '仅允许 A-Za-z0-9*,:/_. 空格-' },
            ]}
          >
            <Input placeholder="例如 *-*-* 04:00:00" />
          </Form.Item>
          <Form.Item
            name="command"
            label="要执行的命令（传给 manager schedule add，将按计划由 systemd 触发）"
            rules={[
              { required: true, message: '请输入命令' },
              { max: 500, message: '最长 500 字符' },
            ]}
          >
            <Input.TextArea rows={3} placeholder={`例如 ${manager} restart，或 say 重启`} />
          </Form.Item>
        </Form>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          创建成功后，列表“下次触发”列将展示由 systemd 计算的下次执行时间。
        </Typography.Text>
      </Modal>
    </Card>
  );
}
