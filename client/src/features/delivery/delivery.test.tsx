import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeRequestDto, DocumentDto, ProjectDto, ReleaseDto } from '@arihant/shared';
import { routes } from '@/routes/routes';
import type * as WorkApi from '@/services/api/work';
import { renderRoutes } from '@/test/render';

vi.mock('@/services/api/delivery', () => ({
  fetchDocuments: vi.fn(),
  fetchDocument: vi.fn(),
  createDocument: vi.fn(),
  uploadDocumentVersion: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  publishDocument: vi.fn(),
  documentDownloadUrl: vi.fn(),
  fetchReleases: vi.fn(),
  fetchRelease: vi.fn(),
  createRelease: vi.fn(),
  updateRelease: vi.fn(),
  deployRelease: vi.fn(),
  rollbackRelease: vi.fn(),
  requestGoLive: vi.fn(),
  fetchStakeholders: vi.fn(),
  createStakeholder: vi.fn(),
  updateStakeholder: vi.fn(),
  deleteStakeholder: vi.fn(),
  fetchChangeRequests: vi.fn(),
  fetchChangeRequest: vi.fn(),
  createChangeRequest: vi.fn(),
  updateChangeRequest: vi.fn(),
  submitChangeRequest: vi.fn(),
  withdrawChangeRequest: vi.fn(),
  changeRequestTask: vi.fn(),
  changeRequestImplemented: vi.fn(),
  fetchFeedback: vi.fn(),
  recordFeedback: vi.fn(),
}));
vi.mock('@/services/api/work', async (orig) => {
  const actual = await orig<typeof WorkApi>();
  return { toParams: actual.toParams, fetchProjects: vi.fn(), fetchProject: vi.fn() };
});
vi.mock('@/services/api/collaboration', () => ({
  fetchUnreadCount: vi.fn().mockResolvedValue({ unread: 0 }),
  fetchNotifications: vi.fn(),
}));
const api = await import('@/services/api/delivery');
const work = await import('@/services/api/work');

const FIRST = { timeout: 15_000 };
const proj = { id: '64b000000000000000000001', key: 'TST', name: 'Test Project' };
const pm = { id: '64b0000000000000000000a1', name: 'Pat Manager' };
const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, limit: 50, total: items.length, totalPages: 1 },
});

const release = (over: Partial<ReleaseDto> = {}): ReleaseDto => ({
  id: '64b0000000000000000000f1',
  project: proj,
  version: '1.4.0',
  status: 'in_progress',
  tasks: [],
  openTasks: 0,
  environments: (['dev', 'qa', 'uat', 'prod'] as const).map((environment) => ({
    environment,
    status: 'not_deployed',
    by: null,
  })),
  history: [],
  approval: null,
  can: { edit: true, deployProd: false },
  createdAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

const doc = (over: Partial<DocumentDto> = {}): DocumentDto => ({
  id: '64b0000000000000000000d1',
  project: proj,
  title: 'Test Requirements',
  category: 'brd',
  tags: [],
  status: 'draft',
  sharedWithStakeholders: false,
  currentVersion: 2,
  versions: [1, 2].map((version) => ({
    version,
    fileName: `req-v${version}.pdf`,
    mime: 'application/pdf',
    size: 2048,
    uploadedBy: pm as DocumentDto['createdBy'],
    uploadedAt: '2026-11-01T00:00:00.000Z',
  })),
  publishedVersion: null,
  approval: null,
  createdBy: null,
  can: { edit: true, publish: true },
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

const cr = (over: Partial<ChangeRequestDto>): ChangeRequestDto =>
  ({
    id: '64b0000000000000000000c1',
    key: 'CR-1',
    project: proj,
    title: 'Add export to CSV',
    status: 'draft',
    impacts: ['scope'],
    priority: 'medium',
    stakeholder: null,
    approval: null,
    implementationTask: null,
    can: { edit: true, submit: true },
    createdAt: '2026-11-01T00:00:00.000Z',
    ...over,
  }) as ChangeRequestDto;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(work.fetchProjects).mockResolvedValue({
    items: [proj as ProjectDto],
    meta: page([]).meta,
  });
  vi.mocked(api.fetchStakeholders).mockResolvedValue(page([]));
  vi.mocked(api.fetchFeedback).mockResolvedValue(page([]));
});

describe('Releases', () => {
  it('locks production until go-live is approved and records a UAT deployment', async () => {
    const r = release();
    vi.mocked(api.fetchReleases).mockResolvedValue(page([r]));
    vi.mocked(api.fetchRelease).mockResolvedValue(r);
    vi.mocked(api.deployRelease).mockResolvedValue(r);
    vi.mocked(api.requestGoLive).mockResolvedValue(r);
    const user = userEvent.setup();
    renderRoutes(routes, {
      path: `/releases?release=${r.id}`,
      permissions: {
        'release:read': 'project',
        'release:write': 'project',
        'project:read': 'project',
      },
    });
    const envs = await screen.findByRole('region', { name: 'Environments' }, FIRST);
    const cards = within(envs).getAllByRole('button', { name: /Deploy/ });
    expect(cards).toHaveLength(4);
    // Production is the last card and stays disabled without an approved go-live request.
    expect(cards[3]).toBeDisabled();
    expect(cards[2]).toBeEnabled();

    await user.click(cards[2]!);
    const dialog = await screen.findByRole('dialog', { name: /Record deployment: 1\.4\.0/ });
    await user.type(within(dialog).getByLabelText('Build / artefact'), 'build-77');
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    await waitFor(() =>
      expect(api.deployRelease).toHaveBeenCalledWith(r.id, {
        environment: 'uat',
        outcome: 'deployed',
        build: 'build-77',
        notes: undefined,
      }),
    );

    await user.click(screen.getByRole('button', { name: /Request go-live approval/ }));
    await waitFor(() => expect(api.requestGoLive).toHaveBeenCalledWith(r.id));
  });

  it('enables the production deploy once go-live is approved', async () => {
    const r = release({
      approval: { id: 'a1', key: 'APR-3', status: 'approved' },
      can: { edit: true, deployProd: true },
    });
    vi.mocked(api.fetchReleases).mockResolvedValue(page([r]));
    vi.mocked(api.fetchRelease).mockResolvedValue(r);
    renderRoutes(routes, {
      path: `/releases?release=${r.id}`,
      permissions: {
        'release:read': 'project',
        'release:write': 'project',
        'project:read': 'project',
      },
    });
    const envs = await screen.findByRole('region', { name: 'Environments' }, FIRST);
    expect(within(envs).getAllByRole('button', { name: /Deploy/ })[3]).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: /Request go-live approval/ }),
    ).not.toBeInTheDocument();
  });
});

describe('Documents', () => {
  it('lists versions and requests publication of the current version', async () => {
    const d = doc();
    vi.mocked(api.fetchDocuments).mockResolvedValue(page([d]));
    vi.mocked(api.fetchDocument).mockResolvedValue(d);
    vi.mocked(api.publishDocument).mockResolvedValue({ ...d, status: 'pending_approval' });
    const user = userEvent.setup();
    renderRoutes(routes, {
      path: `/documents?doc=${d.id}`,
      permissions: {
        'document:read': 'project',
        'document:write': 'project',
        'project:read': 'project',
      },
    });
    const versions = await screen.findByRole('region', { name: 'Versions' }, FIRST);
    expect(
      within(versions).getByRole('button', { name: 'Download version 1' }),
    ).toBeInTheDocument();
    expect(
      within(versions).getByRole('button', { name: 'Download version 2' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Request publication of v2/ }));
    await waitFor(() => expect(api.publishDocument).toHaveBeenCalledWith(d.id));
  });
});

describe('Change requests', () => {
  it('submits a draft and offers a task once approved', async () => {
    vi.mocked(api.fetchChangeRequests).mockResolvedValue(
      page([
        cr({}),
        cr({
          id: '64b0000000000000000000c2',
          key: 'CR-2',
          title: 'Approved change',
          status: 'approved',
          can: { edit: false, submit: false },
        }),
      ]),
    );
    vi.mocked(api.submitChangeRequest).mockResolvedValue(cr({ status: 'submitted' }));
    vi.mocked(api.changeRequestTask).mockResolvedValue(
      cr({
        status: 'approved',
        implementationTask: { id: 't1', key: 'TST-9' } as ChangeRequestDto['implementationTask'],
      }),
    );
    const user = userEvent.setup();
    renderRoutes(routes, {
      path: '/stakeholders',
      permissions: {
        'stakeholder:read': 'project',
        'project:read': 'project',
        'task:create': 'project',
      },
    });
    await user.click(await screen.findByRole('tab', { name: 'Change requests' }, FIRST));
    await user.click(await screen.findByRole('button', { name: /Submit/ }));
    await waitFor(() =>
      expect(api.submitChangeRequest).toHaveBeenCalledWith('64b0000000000000000000c1'),
    );
    await user.click(screen.getByRole('button', { name: /Create task/ }));
    await waitFor(() =>
      expect(api.changeRequestTask).toHaveBeenCalledWith('64b0000000000000000000c2'),
    );
  });
});
