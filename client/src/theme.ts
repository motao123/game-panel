import { createContext, useContext, useEffect, useState } from 'react';

/** 主题模式：'system' 跟随 prefers-color-scheme；手动设置后持久化到 localStorage */
export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'gp-theme';

export const MODE_LABEL: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

/** 切换循环：light → dark → system → light */
export function nextMode(m: ThemeMode): ThemeMode {
  return m === 'light' ? 'dark' : m === 'dark' ? 'system' : 'light';
}

function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* localStorage 不可用时回退默认 */
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export interface ThemeState {
  mode: ThemeMode;
  /** 当前实际是否深色（mode === 'system' 时由媒体查询决定） */
  isDark: boolean;
  setMode: (m: ThemeMode) => void;
  cycleMode: () => void;
}

export const ThemeContext = createContext<ThemeState | null>(null);

/** 在 ThemeContext.Provider 内获取主题状态（切换按钮等组件用） */
export function useTheme(): ThemeState {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme 必须在 ThemeContext.Provider 内使用');
  return v;
}

/**
 * 主题状态（AppRoot 持有）：
 * - mode 持久化 localStorage（gp-theme），默认跟随系统
 * - 'system' 模式监听 prefers-color-scheme 变化
 * - 同步 body 背景色，避免主题切换闪白/闪黑
 */
export function useThemeState(): ThemeState {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && systemDark);

  useEffect(() => {
    document.body.style.background = isDark ? '#141414' : '#f5f6fa';
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  }, [isDark]);

  const setMode = (m: ThemeMode): void => {
    setModeState(m);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  const cycleMode = (): void => setMode(nextMode(mode));

  return { mode, isDark, setMode, cycleMode };
}
