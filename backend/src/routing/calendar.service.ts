import { Injectable, Inject } from '@nestjs/common';
import postgres from 'postgres';
import { PG_CLIENT } from '../db/connection';
import { OrgCalendarDto } from './routing.types';

@Injectable()
export class CalendarService {
  constructor(@Inject(PG_CLIENT) private readonly sql: postgres.Sql) {}

  private jsonb(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  async getCalendar(orgId: string): Promise<any> {
    const [existing] = await this.sql<any[]>`
      SELECT *
      FROM org_calendars
      WHERE org_id = ${orgId}
        AND is_default = true
      LIMIT 1
    `;

    if (existing) {
      return existing;
    }

    const [created] = await this.sql<any[]>`
      INSERT INTO org_calendars (
        org_id,
        name,
        timezone,
        working_days,
        start_time,
        end_time,
        holidays,
        is_default
      ) VALUES (
        ${orgId},
        'Default Working Hours',
        'Asia/Kolkata',
        '[1, 2, 3, 4, 5]'::jsonb,
        '09:30',
        '18:30',
        '[]'::jsonb,
        true
      )
      RETURNING *
    `;

    return created;
  }

  async updateCalendar(orgId: string, dto: OrgCalendarDto): Promise<any> {
    const calendar = await this.getCalendar(orgId);

    const [updated] = await this.sql<any[]>`
      UPDATE org_calendars
      SET
        name = COALESCE(${dto.name ?? null}, name),
        timezone = COALESCE(${dto.timezone ?? null}, timezone),
        working_days = COALESCE(${dto.workingDays ? this.jsonb(dto.workingDays) : null}::text::jsonb, working_days),
        start_time = COALESCE(${dto.startTime ?? null}, start_time),
        end_time = COALESCE(${dto.endTime ?? null}, end_time),
        holidays = COALESCE(${dto.holidays ? this.jsonb(dto.holidays) : null}::text::jsonb, holidays),
        updated_at = now()
      WHERE id = ${calendar.id}
        AND org_id = ${orgId}
      RETURNING *
    `;

    return updated;
  }

  private parseTimeMinutes(timeStr: string): number {
    const [h, m] = timeStr.split(':').map((x) => parseInt(x, 10));
    return (h || 0) * 60 + (m || 0);
  }

  async isWithinWorkingHours(orgId: string, date: Date = new Date()): Promise<boolean> {
    const cal = await this.getCalendar(orgId);
    const tz = cal.timezone || 'Asia/Kolkata';

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'narrow',
    });

    const parts = formatter.formatToParts(date);
    const partMap: Record<string, string> = {};
    for (const p of parts) {
      partMap[p.type] = p.value;
    }

    const year = partMap['year'];
    const month = partMap['month'];
    const day = partMap['day'];
    const dateStr = `${year}-${month}-${day}`;

    const holidays: string[] = Array.isArray(cal.holidays) ? cal.holidays : [];
    if (holidays.includes(dateStr)) {
      return false;
    }

    const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();
    const workingDays: number[] = Array.isArray(cal.working_days) ? cal.working_days : [1, 2, 3, 4, 5];
    if (!workingDays.includes(dayOfWeek)) {
      return false;
    }

    const currentMinutes = parseInt(partMap['hour'] || '0', 10) * 60 + parseInt(partMap['minute'] || '0', 10);
    const startMinutes = this.parseTimeMinutes(cal.start_time || '09:30');
    const endMinutes = this.parseTimeMinutes(cal.end_time || '18:30');

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  async calculateTargetTime(
    orgId: string,
    startDate: Date,
    durationMinutes: number,
    businessHoursOnly = true,
  ): Promise<Date> {
    if (!businessHoursOnly || durationMinutes <= 0) {
      return new Date(startDate.getTime() + durationMinutes * 60000);
    }

    const cal = await this.getCalendar(orgId);
    const startMinutes = this.parseTimeMinutes(cal.start_time || '09:30');
    const endMinutes = this.parseTimeMinutes(cal.end_time || '18:30');
    const dailyWorkingMinutes = Math.max(1, endMinutes - startMinutes);
    const workingDays: number[] = Array.isArray(cal.working_days) ? cal.working_days : [1, 2, 3, 4, 5];
    const holidays: string[] = Array.isArray(cal.holidays) ? cal.holidays : [];

    let current = new Date(startDate.getTime());
    let remainingMinutes = durationMinutes;

    while (remainingMinutes > 0) {
      const dayOfWeek = current.getDay() === 0 ? 7 : current.getDay();
      const dateStr = current.toISOString().slice(0, 10);
      const isWorkingDay = workingDays.includes(dayOfWeek) && !holidays.includes(dateStr);

      if (!isWorkingDay) {
        current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1, Math.floor(startMinutes / 60), startMinutes % 60, 0);
        continue;
      }

      const currentDayMinutes = current.getHours() * 60 + current.getMinutes();

      if (currentDayMinutes < startMinutes) {
        current.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
        continue;
      }

      if (currentDayMinutes >= endMinutes) {
        current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1, Math.floor(startMinutes / 60), startMinutes % 60, 0);
        continue;
      }

      const availableToday = endMinutes - currentDayMinutes;
      if (remainingMinutes <= availableToday) {
        current = new Date(current.getTime() + remainingMinutes * 60000);
        remainingMinutes = 0;
      } else {
        remainingMinutes -= availableToday;
        current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1, Math.floor(startMinutes / 60), startMinutes % 60, 0);
      }
    }

    return current;
  }
}
