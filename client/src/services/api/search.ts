import type {
  ExportColumn,
  GadgetDto,
  GadgetInput,
  GlobalSearchDto,
  SavedFilterDto,
  SavedFilterInput,
  SearchHistoryDto,
  SearchStatDto,
  StatGroup,
  TaskDto,
} from '@arihant/shared';
import { api, apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from './client';
import { downloadFile } from './insights';

export const searchTasks = (aql: string, page = 1, record = false, limit = 25) =>
  apiGetPage<TaskDto>('/search/tasks', {
    params: { aql, page, limit, ...(record ? { record: 'true' } : {}) },
  });
export const fetchSearchStats = (aql: string, by: StatGroup) =>
  apiGet<SearchStatDto[]>('/search/tasks/stats', { params: { aql, by } });
export const exportSearch = (aql: string, format: 'csv' | 'xlsx', columns: ExportColumn[]) =>
  downloadFile(
    '/search/tasks/export',
    { aql, format, ...(columns.length ? { columns: columns.join(',') } : {}) },
    `search.${format}`,
  );
export const fetchSearchHistory = () => apiGet<SearchHistoryDto[]>('/search/history');
export const clearSearchHistory = () => apiDelete('/search/history');
export const globalSearch = (q: string) => apiGet<GlobalSearchDto>('/search', { params: { q } });

export const fetchFilters = () => apiGet<SavedFilterDto[]>('/filters');
export const createFilter = (input: SavedFilterInput) => apiPost<SavedFilterDto>('/filters', input);
export const updateFilter = (id: string, input: Partial<SavedFilterInput>) =>
  apiPatch<SavedFilterDto>(`/filters/${id}`, input);
export const deleteFilter = (id: string) => apiDelete(`/filters/${id}`);
export async function setFilterFavourite(id: string, favourite: boolean): Promise<SavedFilterDto> {
  const res = await api.put<{ data: SavedFilterDto }>(`/filters/${id}/favourite`, { favourite });
  return res.data.data;
}

export const fetchGadgets = () => apiGet<GadgetDto[]>('/filters/gadgets');
export const addGadget = (input: GadgetInput) => apiPost<GadgetDto[]>('/filters/gadgets', input);
export const removeGadget = (id: string) => apiDelete(`/filters/gadgets/${id}`);
