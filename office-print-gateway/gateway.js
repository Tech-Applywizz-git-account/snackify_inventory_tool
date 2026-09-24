import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gatewayDir = path.dirname(fileURLToPath(import.meta.url));
process.env.DOTENV_CONFIG_PATH ||= path.join(gatewayDir, '.env');

// Reuse the production print agent without changing its behavior.
await import('../print-agent/index.js');