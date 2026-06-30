// Force backend server restart to reload latest env variables
import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';

import { authMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import adminRouter from './routes/admin.js';
import aiSummaryRouter from './routes/aiSummary.js';
import authRouter from './routes/auth.js';
import billsRouter from './routes/bills.js';
import billWebhookRouter from './routes/billWebhook.js';
import cafeteriaRouter from './routes/cafeteria.js';
import cronRouter from './routes/cron.js';
import forecastsRouter from './routes/forecasts.js';
import inventoryRouter from './routes/inventory.js';
import manualPurchaseRouter from './routes/manualPurchase.js';
import mealPrintRouter from './routes/mealPrint.js';
import mealsRouter from './routes/meals.js';
import productsRouter from './routes/products.js';
import pushRouter from './routes/push.js';
import reportsRouter from './routes/reports.js';
import requestsRouter from './routes/requests.js';
import telegramWebhookRouter from './routes/telegramWebhook.js';
import transactionsRouter from './routes/transactions.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const configuredOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''));

const allowedOrigins = [...new Set([...configuredOrigins, 'https://snackify.applywizz.ai'])];

if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5175',
    'http://localhost:5176',
    'http://127.0.0.1:5176'
  );
}
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api/bills/webhook', billWebhookRouter);
app.use('/api/telegram/webhook', telegramWebhookRouter);
app.use('/api/auth', authRouter);
app.use('/api/cron', cronRouter);

app.use('/api', authMiddleware);
app.use('/api/products', productsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/reports', aiSummaryRouter);
app.use('/api/admin', adminRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/bills', billsRouter);
app.use('/api/cafeteria', cafeteriaRouter);
app.use('/api/meals', mealsRouter);
app.use('/api/push', pushRouter);
app.use('/api/meal-print', mealPrintRouter);
app.use('/api/manual-purchases', manualPurchaseRouter);
app.use('/api/forecasts', forecastsRouter);

app.use(errorHandler);

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT);
}
export default app;
