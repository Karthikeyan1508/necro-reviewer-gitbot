import { bridgePort, loadEnv } from '@necroreview/core';
import { createApp } from './app.js';

loadEnv();

const port = bridgePort();
const { httpServer } = createApp({ port });

httpServer.listen(port, () => {
  console.log(`[bridge] NecroReview bridge listening on http://localhost:${port}`);
  console.log(`[bridge] Socket.IO ready for control room connections.`);
});
