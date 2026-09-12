import { Button, Tooltip } from 'antd';
import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { MODE_LABEL, useTheme } from '../theme';

/**
 * 主题切换按钮：循环 light → dark → system，Tooltip 显示当前模式。
 * onDark=true 用于深色侧栏内（浅色文字）。
 */
export default function ThemeToggle({ onDark = false }: { onDark?: boolean }): React.JSX.Element {
  const { mode, cycleMode } = useTheme();
  const icon = mode === 'light' ? <SunOutlined /> : mode === 'dark' ? <MoonOutlined /> : <DesktopOutlined />;
  return (
    <Tooltip title={`主题：${MODE_LABEL[mode]}（点击切换 浅色 → 深色 → 跟随系统）`}>
      <Button
        type="text"
        icon={icon}
        onClick={cycleMode}
        aria-label="切换主题"
        style={onDark ? { color: 'rgba(255,255,255,0.85)' } : undefined}
      />
    </Tooltip>
  );
}
