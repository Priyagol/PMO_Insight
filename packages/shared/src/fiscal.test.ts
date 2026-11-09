import { describe, expect, it } from 'vitest';
import { describeReportSchedule, fiscalPeriodStart } from './reporting';

describe('fiscalPeriodStart', () => {
  it('uses April to March by default', () => {
    expect(fiscalPeriodStart('2026-11-09', 'quarter')).toBe('2026-10-01');
    expect(fiscalPeriodStart('2026-02-15', 'quarter')).toBe('2026-01-01');
    expect(fiscalPeriodStart('2026-04-01', 'quarter')).toBe('2026-04-01');
    expect(fiscalPeriodStart('2026-02-15', 'year')).toBe('2025-04-01');
    expect(fiscalPeriodStart('2026-11-09', 'year')).toBe('2026-04-01');
  });
  it('follows another financial year start', () => {
    expect(fiscalPeriodStart('2026-01-20', 'quarter', 2)).toBe('2025-11-01');
    expect(fiscalPeriodStart('2026-01-20', 'year', 1)).toBe('2026-01-01');
  });
  it('describes quarterly schedules', () => {
    expect(
      describeReportSchedule({ frequency: 'quarterly', dayOfWeek: 1, dayOfMonth: 2, hour: 9 }),
    ).toBe('Quarterly on day 2 of the new quarter at 09:00');
  });
});
