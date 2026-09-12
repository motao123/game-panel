import http from 'node:http';
import { createApp } from './app.js';
import { CONFIG } from './config.js';
import { ensureStateDir } from './auth/state.js';

function main(): void {
  // 面板自身的状态文件/secret 均显式 chmod 0600/0700；
  // 这里固定 022，避免把保守 umask 传染给安装脚本（脚本会创建 /etc/<game> 等供游戏用户读取的目录）
  process.umask(0o022);
  ensureStateDir();
  const app = createApp();
  const server = http.createServer(app);
  server.headersTimeout = 65_000;
  server.requestTimeout = 300_000;
  server.listen(CONFIG.port, () => {
    console.log(`[panel] game-panel listening on 0.0.0.0:${CONFIG.port}`);
    console.log(`[panel] scripts dir: ${CONFIG.scriptsDir}`);
    console.log(`[panel] state dir:   ${CONFIG.stateDir}`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[panel] listen failed: ${err.message}`);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[panel] unhandled rejection:', reason);
  });
}

main();
