import { useEffect, useState } from 'react';
import { Button, Card, Space, Steps, Typography } from 'antd';
import type { StepsProps } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { GameStatus } from '../types';

const DONE_KEY = 'gp-onboarding-done';
const STEPS_KEY = 'gp-onboarding-steps';

interface StepState {
  /** 步骤②安装第一个游戏：检测到已安装游戏自动置位，或手动跳过 */
  install: boolean;
  /** 步骤③查看日志与备份：人工点“我知道了”置位 */
  logs: boolean;
  /** 步骤④设置自动备份计划：人工确认置位 */
  schedule: boolean;
}

function readSteps(): StepState {
  try {
    const raw = localStorage.getItem(STEPS_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<StepState>;
      return { install: v.install === true, logs: v.logs === true, schedule: v.schedule === true };
    }
  } catch {
    /* ignore */
  }
  return { install: false, logs: false, schedule: false };
}

function writeSteps(s: StepState): void {
  try {
    localStorage.setItem(STEPS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function markDoneForever(): void {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* ignore */
  }
}

/**
 * 新手引导卡（Dashboard 顶部，非全屏遮罩）：
 * - 显示条件：未点过“不再显示” 且 四步未全部完成
 * - 步骤②由已安装游戏自动检测完成；③④人工确认；各步均可跳过
 */
export default function Onboarding({ games }: { games: GameStatus[] }): React.JSX.Element | null {
  const navigate = useNavigate();
  const [done, setDone] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DONE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [steps, setSteps] = useState<StepState>(readSteps);

  const first = games.find((g) => g.installed) ?? null;

  useEffect(() => {
    if (first && !steps.install) {
      const next = { ...steps, install: true };
      setSteps(next);
      writeSteps(next);
    }
  }, [first, steps]);

  if (done || (steps.install && steps.logs && steps.schedule)) return null;

  const resolveStep = (k: keyof StepState): void => {
    const next = { ...steps, [k]: true };
    setSteps(next);
    writeSteps(next);
    if (next.install && next.logs && next.schedule) {
      markDoneForever();
      setDone(true);
    }
  };

  const stepDone = [true, steps.install, steps.logs, steps.schedule];
  const current = stepDone.findIndex((d) => !d);
  const stat = (i: number): 'finish' | 'process' | 'wait' => (i < current ? 'finish' : i === current ? 'process' : 'wait');

  const items: StepsProps['items'] = [
    {
      title: '初始化管理员',
      status: stat(0),
      description: <Typography.Text type="secondary">已使用管理员账号登录，面板初始化完成。</Typography.Text>,
    },
    {
      title: '安装第一个游戏',
      status: stat(1),
      description: steps.install ? (
        <Typography.Text type="secondary">检测到已安装游戏{first ? `：${first.label}` : ''}。</Typography.Text>
      ) : (
        <Space size={8} wrap>
          <Button size="small" type="primary" onClick={() => navigate('/install')}>
            前往安装向导
          </Button>
          <Button size="small" type="text" onClick={() => resolveStep('install')}>
            跳过
          </Button>
        </Space>
      ),
    },
    {
      title: '查看日志与备份',
      status: stat(2),
      description: steps.logs ? (
        <Typography.Text type="secondary">已完成。</Typography.Text>
      ) : first ? (
        <Space size={8} wrap>
          <Button size="small" onClick={() => navigate(`/games/${first.id}`)}>
            打开游戏详情（日志 / 备份）
          </Button>
          <Button size="small" type="text" onClick={() => resolveStep('logs')}>
            我知道了
          </Button>
        </Space>
      ) : (
        <Space size={8} wrap>
          <Typography.Text type="secondary">安装第一个游戏后可用。</Typography.Text>
          <Button size="small" type="text" onClick={() => resolveStep('logs')}>
            跳过
          </Button>
        </Space>
      ),
    },
    {
      title: '设置自动备份计划',
      status: stat(3),
      description: steps.schedule ? (
        <Typography.Text type="secondary">已完成。</Typography.Text>
      ) : first ? (
        <Space size={8} wrap>
          <Button size="small" onClick={() => navigate(`/games/${first.id}`)}>
            打开「计划任务」标签页
          </Button>
          <Button size="small" type="text" onClick={() => resolveStep('schedule')}>
            设置好了
          </Button>
        </Space>
      ) : (
        <Space size={8} wrap>
          <Typography.Text type="secondary">安装第一个游戏后可用。</Typography.Text>
          <Button size="small" type="text" onClick={() => resolveStep('schedule')}>
            跳过
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title="新手引导"
      style={{ marginBottom: 16 }}
      extra={
        <Button
          size="small"
          type="text"
          onClick={() => {
            markDoneForever();
            setDone(true);
          }}
        >
          不再显示
        </Button>
      }
    >
      <Steps direction="vertical" size="small" current={current} items={items} />
    </Card>
  );
}
