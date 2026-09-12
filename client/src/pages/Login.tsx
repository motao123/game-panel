import { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Typography, Alert, App } from 'antd';
import ThemeToggle from '../components/ThemeToggle';
import { api } from '../api';

interface StatusResp {
  initialized: boolean;
}

export default function Login({ onLogin }: { onLogin: (username: string) => void }): React.JSX.Element {
  const { message } = App.useApp();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<{ username: string; password: string; confirm?: string }>();

  useEffect(() => {
    api<StatusResp>('/api/auth/status')
      .then((r) => setInitialized(r.initialized))
      .catch(() => setInitialized(false));
  }, []);

  const submit = async (): Promise<void> => {
    // 统一 key：成功/初始化时精确关闭本页错误提示，避免跳转后残留
    const LOGIN_MSG_KEY = 'login-feedback';
    try {
      const values = await form.validateFields();
      setLoading(true);
      if (initialized === false) {
        if (values.password !== values.confirm) {
          message.open({ type: 'error', key: LOGIN_MSG_KEY, content: '两次输入的密码不一致' });
          return;
        }
        const r = await api<{ username: string }>('/api/auth/init', {
          method: 'POST',
          body: { username: values.username, password: values.password },
        });
        message.destroy(LOGIN_MSG_KEY);
        onLogin(r.username);
      } else {
        const r = await api<{ username: string }>('/api/auth/login', {
          method: 'POST',
          body: { username: values.username, password: values.password },
        });
        message.destroy(LOGIN_MSG_KEY);
        onLogin(r.username);
      }
    } catch (e) {
      message.open({
        type: 'error',
        key: LOGIN_MSG_KEY,
        content: e instanceof Error ? e.message : '操作失败',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 16, right: 24 }}>
        <ThemeToggle />
      </div>
      <Card style={{ width: 420 }}>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          🎮 Game Panel
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          {initialized === false ? '首次使用：设置管理员账号（仅此一次）' : '单管理员登录'}
        </Typography.Paragraph>
        {initialized === false && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="初始化完成后，注册接口将永久禁用"
          />
        )}
        <Form form={form} layout="vertical" onFinish={() => void submit()}>
          <Form.Item
            name="username"
            label="管理员用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 3, max: 32, message: '3-32 位' },
              { pattern: /^[a-zA-Z0-9_.-]+$/, message: '仅字母/数字/_.-' },
            ]}
            initialValue="admin"
          >
            <Input placeholder="admin" autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, max: 72, message: '8-72 位' },
            ]}
          >
            <Input.Password autoComplete={initialized === false ? 'new-password' : 'current-password'} />
          </Form.Item>
          {initialized === false && (
            <Form.Item
              name="confirm"
              label="确认密码"
              dependencies={['password']}
              rules={[{ required: true, message: '请再次输入密码' }]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}
          <Button type="primary" htmlType="submit" block loading={loading}>
            {initialized === false ? '初始化并登录' : '登录'}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
