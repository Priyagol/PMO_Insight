import { describe, expect, it } from 'vitest';
import { ALL_NAV_ITEMS, filterNav, NAV_SECTIONS } from './nav-config';

describe('filterNav', () => {
  it('shows only items the user has permission for and drops empty sections', () => {
    const sections = filterNav(NAV_SECTIONS, { 'task:read': 'own', 'worklog:write': 'own' });
    expect(sections.map((s) => s.id)).toEqual(['workspace']);
    expect(sections[0]!.items.map((i) => i.id)).toEqual([
      'my-workspace',
      'my-tasks',
      'task-board',
      'help-center',
      'search',
      'work-logs',
      'timesheets',
    ]);
  });

  it('shows nothing without permissions', () => {
    expect(filterNav(NAV_SECTIONS, {})).toEqual([]);
  });

  it('administration is only visible with admin permissions', () => {
    const sections = filterNav(NAV_SECTIONS, { 'user:read': 'org', 'audit:read': 'org' });
    expect(sections.map((s) => s.id)).toEqual(['administration']);
    expect(sections[0]!.items.map((i) => i.id)).toEqual(['employees', 'audit-logs']);
  });
});

describe('navigation catalogue', () => {
  it('has unique ids and paths', () => {
    expect(new Set(ALL_NAV_ITEMS.map((i) => i.id)).size).toBe(ALL_NAV_ITEMS.length);
    expect(new Set(ALL_NAV_ITEMS.map((i) => i.path)).size).toBe(ALL_NAV_ITEMS.length);
  });

  it('covers every module in the navigation structure of the brief', () => {
    // The brief's 26 modules plus Project Templates (Phase 5B) and Help Center, Search & Filters and Task Workflows (Phase 9), Project Timeline, and Dependencies & Blockers.
    expect(ALL_NAV_ITEMS).toHaveLength(32);
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual([
      'Workspace',
      'Management',
      'Automation',
      'Administration',
    ]);
  });
});
