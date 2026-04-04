import { Router } from 'express';
import authRouter from './auth';
import { accountsRouter } from './accounts';
import { periodsRouter } from './periods';
import { reportsRouter } from './reports';
import { stagingRouter } from './staging';
import { transactionsRouter } from './transactions';
import { usersRouter } from './users';
import { webhooksRouter } from './webhooks';
import { exchangeRatesRouter } from './exchange-rates';
import { bankRouter } from './bank';
import { authenticate } from './middleware/auth';

// ---------------------------------------------------------------------------
// routes.ts — assembles all API sub-routers under /api
// ---------------------------------------------------------------------------

export const apiRouter = Router();

// ── Public routes (no authentication required) ────────────────────────────
apiRouter.use('/auth', authRouter);

// ── All routes below require authentication ───────────────────────────────
apiRouter.use(authenticate);

apiRouter.use('/accounts', accountsRouter);
apiRouter.use('/transactions', transactionsRouter);
apiRouter.use('/staging', stagingRouter);
apiRouter.use('/periods', periodsRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/webhooks', webhooksRouter);
apiRouter.use('/exchange-rates', exchangeRatesRouter);
apiRouter.use('/bank-accounts', bankRouter);
