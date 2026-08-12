import { describe, expect, it } from 'vitest';
import {
  neckTrend,
  painAfterTraining,
  summarizeRange,
  summarizeWeeks,
  weeksOfHistory,
  type SessionSummary,
} from '../src/domain/stats';
import { isoWeek, startOfWeek } from '../src/domain/time';

function main(date: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { date, kind: 'main', status: 'done', minutes: 14, neckScore: null, ...overrides };
}

function mini(date: string): SessionSummary {
  return { date, kind: 'mini', status: 'done', minutes: 3, neckScore: null };
}

describe('isoWeek и startOfWeek', () => {
  it('неделя начинается с понедельника', () => {
    // 12 августа 2026 — среда, её понедельник — 10-е.
    expect(startOfWeek('2026-08-12')).toBe('2026-08-10');
    expect(startOfWeek('2026-08-10')).toBe('2026-08-10');
    expect(startOfWeek('2026-08-16')).toBe('2026-08-10');
  });

  it('нумерует недели по ISO', () => {
    expect(isoWeek('2026-01-01')).toBe(1);
    expect(isoWeek('2026-08-12')).toBe(33);
  });
});

describe('summarizeRange', () => {
  const sessions = [
    main('2026-08-10'),
    main('2026-08-11', { neckScore: 1 }),
    main('2026-08-12', { status: 'skipped', minutes: null }),
    main('2026-08-13', { neckScore: 0, minutes: 16 }),
    mini('2026-08-11'),
    mini('2026-08-11'),
    main('2026-08-03'),
  ];

  it('считает выполненные тренировки и минуты за неделю', () => {
    const week = summarizeRange(sessions, '2026-08-10', '2026-08-16');

    expect(week.done).toBe(3);
    expect(week.minutes).toBe(44);
  });

  it('не пускает пропущенную тренировку в минуты', () => {
    expect(summarizeRange(sessions, '2026-08-12', '2026-08-12').minutes).toBe(0);
  });

  it('считает микро-блоки отдельным счётчиком', () => {
    // ADR-013: они не входят в объём тренировок, но их частота — самостоятельная метрика.
    const week = summarizeRange(sessions, '2026-08-10', '2026-08-16');
    expect(week.miniCount).toBe(2);
    expect(week.done).toBe(3);
  });

  it('усредняет оценку шеи только по дням, когда спрашивали', () => {
    expect(summarizeRange(sessions, '2026-08-10', '2026-08-16').neckAverage).toBe(0.5);
  });

  it('отдаёт null, если про шею не спрашивали ни разу', () => {
    expect(summarizeRange(sessions, '2026-08-03', '2026-08-09').neckAverage).toBeNull();
  });
});

describe('summarizeWeeks', () => {
  it('отдаёт недели от свежей к старой', () => {
    const weeks = summarizeWeeks([main('2026-08-11'), main('2026-08-04')], '2026-08-12', 3);

    expect(weeks).toHaveLength(3);
    expect(weeks[0]?.from).toBe('2026-08-10');
    expect(weeks[1]?.from).toBe('2026-08-03');
    expect(weeks[0]?.done).toBe(1);
    expect(weeks[2]?.done).toBe(0);
  });
});

describe('neckTrend', () => {
  it('различает падение, рост и плато', () => {
    expect(neckTrend(0.8, 1.4)).toBe('down');
    expect(neckTrend(1.4, 0.8)).toBe('up');
    expect(neckTrend(1.0, 1.1)).toBe('flat');
  });

  it('не выдумывает тренд без данных', () => {
    expect(neckTrend(null, 1.2)).toBe('unknown');
    expect(neckTrend(1.2, null)).toBe('unknown');
  });
});

describe('painAfterTraining', () => {
  it('считает, сколько дней с болью пришли после тренировки', () => {
    // docs/07: иногда обнаруживается, что болит после конкретного дня.
    const sessions = [
      main('2026-08-10'),
      main('2026-08-11', { neckScore: 2 }),
      main('2026-08-12', { status: 'skipped', minutes: null }),
      main('2026-08-13', { neckScore: 3 }),
    ];
    const result = painAfterTraining(sessions);

    expect(result.painfulDays).toBe(2);
    expect(result.afterTraining).toBe(1);
  });

  it('нет боли — нечего считать', () => {
    expect(painAfterTraining([main('2026-08-10', { neckScore: 0 })])).toEqual({
      painfulDays: 0,
      afterTraining: 0,
    });
  });
});

describe('weeksOfHistory', () => {
  it('считает, сколько недель уже идут тренировки', () => {
    expect(weeksOfHistory([main('2026-07-01'), main('2026-08-12')], '2026-08-12')).toBe(7);
    expect(weeksOfHistory([], '2026-08-12')).toBe(0);
  });
});
