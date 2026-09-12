import { useEffect, useState } from 'react';
import { App as AntApp, Button, ConfigProvider, Dropdown, Layout, Menu, Space, Spin, Typography, theme as antdTheme } from 'antd';
import {
  DashboardOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Routes, Route, useNavigate, useLocation, Navigate, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import GameDetail from './pages/GameDetail';
import Install from './pages/Install';
import Audit from './pages/Audit';
import Tasks from './pages/Tasks';
import Login from './pages/Login';
import ThemeToggle from './components/ThemeToggle';
import { api } from './api';
import { ThemeContext, useThemeState } from './theme';

const { Header, Sider, Content } = Layout;

interface Me {
  username: string;
}

function Shell({ username, onLogout, children }: { username: string; onLogout: () => void; children: React.ReactNode }): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = antdTheme.useToken();
  const selected = location.pathname === '/' ? ['dash'] : location.pathname.startsWith('/install') ? ['install'] : location.pathname.startsWith('/audit') ? ['audit'] : location.pathname.startsWith('/tasks') ? ['tasks'] : [];
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={208}>
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ color: '#fff', padding: '18px 16px', fontWeight: 700, fontSize: 16 }}>
            🎮 Game Panel
          </div>
          <Menu
            theme="dark"
            mode="inline"
            style={{ flex: 1, overflowY: 'auto' }}
            selectedKeys={selected}
            onClick={(e) => navigate(e.key === 'dash' ? '/' : `/${e.key}`)}
            items={[
              { key: 'dash', icon: <DashboardOutlined />, label: '总览' },
              { key: 'install', icon: <DownloadOutlined />, label: '安装向导' },
              { key: 'tasks', icon: <HistoryOutlined />, label: '任务中心' },
              { key: 'audit', icon: <FileSearchOutlined />, label: '审计日志' },
            ]}
          />
          <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.09)' }}>
            <ThemeToggle onDark />
          </div>
        </div>
      </Sider>
      <Layout>
        <Header
          style={{
            background: token.colorBgContainer,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingInline: 24,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Space>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'logout',
                    icon: <LogoutOutlined />,
                    label: '退出登录',
                    onClick: onLogout,
                  },
                ],
              }}
            >
              <Button type="text" icon={<UserOutlined />}>
                {username}
              </Button>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ padding: 20 }}>{children}</Content>
        <Typography.Text type="secondary" style={{ display: 'block', textAlign: 'center', padding: 12 }}>
          一切变更经由 <Link to="/audit">*-manager</Link> 与安装脚本完成 · 面板只做驾驶舱
        </Typography.Text>
      </Layout>
    </Layout>
  );
}

export default function AppRoot(): React.JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();
  const theme = useThemeState();

  useEffect(() => {
    let alive = true;
    api<Me>('/api/auth/me')
      .then((r) => {
        if (alive) setMe(r);
      })
      .catch(() => {
        if (alive) setMe(null);
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const doLogout = async (): Promise<void> => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setMe(null);
    navigate('/login');
  };

  let content: React.JSX.Element;
  if (checking) {
    content = (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 160 }}>
        <Spin size="large" />
      </div>
    );
  } else if (!me) {
    content = (
      <Routes>
        <Route path="/login" element={<Login onLogin={(u) => setMe({ username: u })} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  } else {
    content = (
      <Shell username={me.username} onLogout={() => void doLogout()}>
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/games/:game" element={<GameDetail />} />
            <Route path="/install" element={<Install />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Space>
      </Shell>
    );
  }

  return (
    <ThemeContext.Provider value={theme}>
      <ConfigProvider
        theme={{
          algorithm: theme.isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: { colorPrimary: '#1668dc', borderRadius: 6 },
        }}
      >
        <AntApp>{content}</AntApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
