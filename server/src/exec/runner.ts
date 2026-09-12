import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HttpError } from '../errors.js';

const execFileP = promisify(execFile);

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  failed: boolean;
}

interface ExecError extends Error {
  code?: number | string | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
}

/**
 * 唯一的外部命令入口：execFile 固定参数数组，绝不拼 shell 字符串。
 */
export async function runCommand(
  file: string,
  args: readonly string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileP(file, [...args], {
      timeout: opts?.timeoutMs ?? 120_000,
      env: opts?.env,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout, stderr, exitCode: 0, failed: false };
  } catch (e) {
    const err = e as ExecError;
    const code = typeof err.code === 'number' ? err.code : null;
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: code,
      failed: true,
    };
  }
}

export function httpErrorFromRun(r: RunResult, message: string): HttpError {
  const detail = [r.stderr, r.stdout].filter((s) => s.length > 0).join('\n').trim();
  return new HttpError(500, `${message}（exit=${r.exitCode ?? 'signal'}）${detail ? `: ${detail.slice(-800)}` : ''}`);
}
