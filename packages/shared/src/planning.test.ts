import { describe, expect, it } from 'vitest';
import {
  createTemplateSchema,
  customFieldDefSchema,
  describeRecurrence,
  fieldKeyFromLabel,
  nextOccurrence,
  validateCustomValues,
  type CustomFieldDef,
} from './planning';

const rule = { frequency: 'daily' as const, interval: 1, workdaysOnly: false, until: null };

describe('nextOccurrence', () => {
  it('handles daily, working-day, weekly and monthly rules', () => {
    expect(nextOccurrence(rule, '2026-11-06')).toBe('2026-11-07');
    expect(nextOccurrence({ ...rule, workdaysOnly: true }, '2026-11-06')).toBe('2026-11-09');
    expect(nextOccurrence({ ...rule, workdaysOnly: true, interval: 3 }, '2026-11-05')).toBe(
      '2026-11-10',
    );
    expect(nextOccurrence({ ...rule, frequency: 'weekly', interval: 2 }, '2026-12-28')).toBe(
      '2027-01-11',
    );
    expect(nextOccurrence({ ...rule, frequency: 'monthly' }, '2027-01-31')).toBe('2027-02-28');
    expect(nextOccurrence({ ...rule, frequency: 'monthly' }, '2028-01-31')).toBe('2028-02-29');
    expect(nextOccurrence({ ...rule, frequency: 'monthly', interval: 3 }, '2026-11-30')).toBe(
      '2027-02-28',
    );
  });
  it('returns null past the end date (inclusive)', () => {
    expect(nextOccurrence({ ...rule, until: '2026-11-07' }, '2026-11-06')).toBe('2026-11-07');
    expect(nextOccurrence({ ...rule, until: '2026-11-06' }, '2026-11-06')).toBeNull();
  });
  it('describes rules in plain language', () => {
    expect(describeRecurrence({ ...rule, frequency: 'weekly', interval: 2 })).toBe('Every 2 weeks');
    expect(describeRecurrence({ ...rule, workdaysOnly: true, until: '2027-03-31' })).toBe(
      'Every working day until 2027-03-31',
    );
  });
});

describe('custom fields', () => {
  const defs: CustomFieldDef[] = [
    { key: 'ref', label: 'Ref', type: 'text', options: [], required: true },
    { key: 'env', label: 'Env', type: 'select', options: ['UAT', 'PROD'], required: false },
    { key: 'pts', label: 'Points', type: 'number', options: [], required: false },
    { key: 'flag', label: 'Flag', type: 'checkbox', options: [], required: true },
  ];
  it('normalises valid values and reports invalid ones per field', () => {
    const r = validateCustomValues(defs, { ref: '  A1 ', env: 'UAT', pts: '3', flag: false });
    expect(r).toEqual({ values: { ref: 'A1', env: 'UAT', pts: 3, flag: false }, errors: {} });
    const bad = validateCustomValues(defs, { env: 'DEV', pts: 'x', other: 1 });
    expect(bad.errors).toEqual({
      env: 'Choose one of the Env options',
      pts: 'Points must be a number',
      other: 'Unknown field',
      ref: 'Ref is required',
    });
  });
  it('considers existing values for required fields on update', () => {
    expect(validateCustomValues(defs, { pts: 2 }, { ref: 'A1' }).errors).toEqual({});
    expect(validateCustomValues(defs, { ref: null }, { ref: 'A1' }).errors).toEqual({
      ref: 'Ref is required',
    });
  });
  it('validates definitions and derives keys from labels', () => {
    expect(
      customFieldDefSchema.safeParse({ key: 'env', label: 'Env', type: 'select', options: ['A'] })
        .success,
    ).toBe(false);
    expect(customFieldDefSchema.safeParse({ key: 'Env', label: 'Env', type: 'text' }).success).toBe(
      false,
    );
    expect(fieldKeyFromLabel('Client ref #')).toBe('client_ref');
    expect(fieldKeyFromLabel('2nd reviewer')).toBe('nd_reviewer');
  });
});

describe('template schema', () => {
  it('requires consistent internal references', () => {
    const ok = createTemplateSchema.safeParse({
      name: 'T1',
      milestones: [{ ref: 'm1', name: 'M one', dueOffsetDays: 3 }],
      tasks: [
        { ref: 'a', title: 'First', milestoneRef: 'm1' },
        { ref: 'b', title: 'Second', parentRef: 'a', dependencyRefs: ['a'] },
      ],
    });
    expect(ok.success).toBe(true);
    for (const tasks of [
      [
        { ref: 'a', title: 'Dup' },
        { ref: 'a', title: 'Dup' },
      ],
      [{ ref: 'a', title: 'Self', dependencyRefs: ['a'] }],
      [{ ref: 'a', title: 'Ghost', milestoneRef: 'mX' }],
    ]) {
      expect(createTemplateSchema.safeParse({ name: 'T2', tasks }).success).toBe(false);
    }
  });
});
