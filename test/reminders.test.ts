import { describe, expect, it } from 'vitest';
import { dueReminders, type ReminderInput, type ReminderKind } from '../src/domain/reminders';
import type { Weekday } from '../src/domain/time';

function input(overrides: Partial<ReminderInput> = {}): ReminderInput {
  return {
    moment: { date: '2026-08-12', time: '07:30', weekday: 3 as Weekday },
    remindAt: '07:30',
    eveningPingAt: '20:00',
    miniReminders: false,
    pausedUntil: null,
    snoozeUntil: null,
    alreadySent: new Set<ReminderKind>(),
    mainStatus: 'none',
    now: new Date('2026-08-12T05:30:00Z'),
    ...overrides,
  };
}

describe('dueReminders', () => {
  it('шлёт утреннее напоминание в назначенное время', () => {
    expect(dueReminders(input())).toEqual(['morning']);
  });

  it('молчит до назначенного времени', () => {
    expect(
      dueReminders(input({ moment: { date: '2026-08-12', time: '07:25', weekday: 3 } })),
    ).toEqual([]);
  });

  it('не догоняет напоминанием через полдня', () => {
    // Cron мог не сработать, но «доброе утро» в четыре часа дня хуже, чем молчание.
    expect(
      dueReminders(input({ moment: { date: '2026-08-12', time: '16:00', weekday: 3 } })),
    ).toEqual([]);
  });

  it('не шлёт дубль, если сегодня уже отправляли', () => {
    expect(dueReminders(input({ alreadySent: new Set(['morning']) }))).toEqual([]);
  });

  it('молчит на паузе', () => {
    // Болезнь или поездка: /pause выключает бота, а не откладывает его (docs/04).
    expect(dueReminders(input({ pausedUntil: '2026-08-20' }))).toEqual([]);
  });

  it('снова напоминает после паузы', () => {
    expect(dueReminders(input({ pausedUntil: '2026-08-11' }))).toEqual(['morning']);
  });

  it('не будит утром, если тренировка уже сделана', () => {
    expect(dueReminders(input({ mainStatus: 'done' }))).toEqual([]);
  });

  it('переносит напоминание кнопкой «Через час»', () => {
    const snoozed = input({
      snoozeUntil: '2026-08-12T06:30:00Z',
      now: new Date('2026-08-12T05:35:00Z'),
      moment: { date: '2026-08-12', time: '07:35', weekday: 3 },
    });
    expect(dueReminders(snoozed)).toEqual([]);

    const later = { ...snoozed, now: new Date('2026-08-12T06:30:00Z') };
    expect(dueReminders(later)).toEqual(['morning']);
  });

  it('шлёт вечерний пинг, если тренировка не закрыта', () => {
    const evening = input({
      moment: { date: '2026-08-12', time: '20:00', weekday: 3 },
      alreadySent: new Set(['morning']),
    });
    expect(dueReminders(evening)).toEqual(['evening']);
  });

  it('не шлёт вечерний пинг после выполненной или пропущенной тренировки', () => {
    const base = {
      moment: { date: '2026-08-12', time: '20:00', weekday: 3 as Weekday },
      alreadySent: new Set<ReminderKind>(['morning']),
    };
    expect(dueReminders(input({ ...base, mainStatus: 'done' }))).toEqual([]);
    expect(dueReminders(input({ ...base, mainStatus: 'skipped' }))).toEqual([]);
  });

  it('шлёт недельный отчёт воскресным вечером', () => {
    const sunday = input({
      moment: { date: '2026-08-16', time: '20:00', weekday: 7 },
      alreadySent: new Set(['morning', 'evening']),
    });
    expect(dueReminders(sunday)).toEqual(['weekly_report']);
  });

  it('не шлёт отчёт в другие дни недели', () => {
    const wednesday = input({
      moment: { date: '2026-08-12', time: '20:00', weekday: 3 },
      alreadySent: new Set(['morning', 'evening']),
    });
    expect(dueReminders(wednesday)).toEqual([]);
  });

  it('напоминает про микро-блоки только в рабочие дни и только если включено', () => {
    const midday = { date: '2026-08-12', time: '12:00', weekday: 3 as Weekday };
    const saturday = { date: '2026-08-15', time: '12:00', weekday: 6 as Weekday };
    const sent = new Set<ReminderKind>(['morning']);

    expect(dueReminders(input({ moment: midday, miniReminders: true, alreadySent: sent }))).toEqual(
      ['mini_midday'],
    );
    expect(
      dueReminders(input({ moment: midday, miniReminders: false, alreadySent: sent })),
    ).toEqual([]);
    expect(
      dueReminders(input({ moment: saturday, miniReminders: true, alreadySent: sent })),
    ).toEqual([]);
  });

  it('различает дневной и послеобеденный микро-блок', () => {
    const afternoon = { date: '2026-08-12', time: '16:05', weekday: 3 as Weekday };
    const sent = new Set<ReminderKind>(['morning', 'mini_midday']);

    expect(
      dueReminders(input({ moment: afternoon, miniReminders: true, alreadySent: sent })),
    ).toEqual(['mini_afternoon']);
  });
});
