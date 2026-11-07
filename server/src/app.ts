import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { filterRoutes, searchRoutes } from './modules/search/search.routes';
import { workflowRoutes } from './modules/workflows/workflow.routes';
import { securityRoutes } from './modules/security/security.routes';
import { outboundRoutes } from './modules/outbound/outbound.routes';
import { reportingRoutes } from './modules/reporting/reporting.routes';
import { serviceDeskRoutes } from './modules/servicedesk/servicedesk.routes';
import express, { type Express } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { API_PREFIX } from './config/app';
import { env, isProduction } from './config/env';
import { openApiDocument } from './docs/openapi';
import { errorHandler, notFound } from './middleware/error-handler';
import { apiLimiter } from './middleware/rate-limit';
import { httpLogger, requestId } from './middleware/request-context';
import { sanitizeBody } from './middleware/sanitize';
import { auditRoutes, settingsRoutes, skillRoutes } from './modules/admin/admin.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { departmentRoutes } from './modules/departments/department.routes';
import { permissionRoutes, roleRoutes } from './modules/roles/role.routes';
import { systemRoutes } from './modules/system/system.routes';
import { userRoutes } from './modules/users/user.routes';
import {
  attachmentRoutes,
  commentRoutes,
  projectRoutes,
  savedViewRoutes,
  taskRoutes,
} from './modules/work.routes';
import { milestoneRoutes, templateRoutes } from './modules/planning/planning.routes';
import { approvalRoutes, meetingRoutes, notificationRoutes } from './modules/collaboration.routes';
import { aiRoutes, automationRoutes } from './modules/intelligence.routes';
import {
  changeRequestRoutes,
  documentRoutes,
  feedbackRoutes,
  releaseRoutes,
  stakeholderRoutes,
} from './modules/delivery/delivery.routes';
import { agileReportRoutes, sprintRoutes } from './modules/agile/agile.routes';
import {
  integrationRoutes,
  mountGitProviderWebhooks,
  mountGithubWebhook,
} from './modules/integrations/git.routes';
import {
  assignmentRoutes,
  availabilityRoutes,
  journalRoutes,
  passportRoutes,
  teamRoutes,
  timerRoutes,
  timesheetRoutes,
  worklogRoutes,
} from './modules/tracking/tracking.routes';
import { analyticsRoutes, reportRoutes, riskRoutes } from './modules/insights/insights.routes';
import type { ReadinessChecks } from './modules/system/system.service';

export interface AppDependencies {
  readinessChecks: ReadinessChecks;
}

/** Builds the Express application. Kept free of I/O so tests can create it cheaply. */
export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  // Trust exactly the configured number of proxy hops so req.ip is the real client IP
  // (rate limits, audit). Too few = all users share a proxy IP; too many = spoofable.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(requestId);
  app.use(httpLogger);
  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: env.APP_ORIGIN,
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(compression());
  // Signed GitHub webhook: needs the raw body, so it is registered before the JSON parser.
  mountGithubWebhook(app);
  mountGitProviderWebhooks(app);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(sanitizeBody);

  if (!isProduction) {
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
    app.get('/api/openapi.json', (_req, res) => {
      res.json(openApiDocument);
    });
  }

  const api = express.Router();
  api.use(apiLimiter);
  api.use(systemRoutes(deps.readinessChecks));
  api.use('/auth', authRoutes);
  api.use('/users', userRoutes);
  api.use('/departments', departmentRoutes);
  api.use('/roles', roleRoutes);
  api.use('/permissions', permissionRoutes);
  api.use('/skills', skillRoutes);
  api.use('/audit-logs', auditRoutes);
  api.use('/settings', settingsRoutes);
  api.use('/projects', projectRoutes);
  api.use('/tasks', taskRoutes);
  api.use('/comments', commentRoutes);
  api.use('/attachments', attachmentRoutes);
  api.use('/saved-views', savedViewRoutes);
  api.use('/worklogs', worklogRoutes);
  api.use('/timer', timerRoutes);
  api.use('/timesheets', timesheetRoutes);
  api.use('/journals', journalRoutes);
  api.use('/availability', availabilityRoutes);
  api.use('/teams', teamRoutes);
  api.use('/users', passportRoutes);
  api.use('/assignment', assignmentRoutes);
  api.use('/risks', riskRoutes);
  api.use('/analytics', analyticsRoutes);
  api.use('/reports', reportRoutes);
  api.use('/milestones', milestoneRoutes);
  api.use('/project-templates', templateRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/approvals', approvalRoutes);
  api.use('/meetings', meetingRoutes);
  api.use('/automations', automationRoutes);
  api.use('/ai', aiRoutes);
  api.use('/sprints', sprintRoutes);
  api.use('/integrations', integrationRoutes);
  api.use('/agile', agileReportRoutes);
  api.use('/documents', documentRoutes);
  api.use('/releases', releaseRoutes);
  api.use('/stakeholders', stakeholderRoutes);
  api.use('/change-requests', changeRequestRoutes);
  api.use('/feedback', feedbackRoutes);
  api.use('/search', searchRoutes);
  api.use('/filters', filterRoutes);
  api.use('/workflows', workflowRoutes);
  api.use('/security', securityRoutes);
  api.use('/integrations/outgoing', outboundRoutes);
  api.use('/reporting', reportingRoutes);
  api.use('/service-desk', serviceDeskRoutes);
  // Further feature modules are mounted here phase by phase.

  app.use(API_PREFIX, api);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
