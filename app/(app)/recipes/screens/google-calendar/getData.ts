import { unstable_cache } from "next/cache";
import {
	type GoogleEvent,
	getValidAccessToken,
	isCalendarConnected,
	isGoogleOAuthConfigured,
	listCalendars,
	listEvents,
} from "@/lib/integrations/google-calendar";
import { Temporal } from "@/lib/temporal";
import {
	getHolidayDates,
	type HolidayCountry,
} from "../color-calendar/holidays";
import { googleCalendarFixture } from "./fixtures";
import { accentForIndex, display6 } from "./tokens";

// Mark dynamic so the renderer always re-evaluates "now" (caching of the actual
// Google network calls is handled explicitly via unstable_cache below).
export const dynamic = "force-dynamic";

const TZ = "Europe/Copenhagen";
const LOCALE = "da-DK";

// Calendars whose name matches this are always drawn red (and skip the colour
// cycle), e.g. "Holidays in Denmark", "Danske helligdage", "Svenska helgdagar".
const HOLIDAY_CALENDAR_RE = /holidays|helgdag|helligdag/i;

const NAMED_COLORS: Record<string, string> = {
	black: display6.black,
	white: display6.white,
	red: display6.red,
	green: display6.green,
	blue: display6.blue,
	yellow: display6.yellow,
};

type ColorRule = { match: string; color: string };

/** Parse the calendarColors JSON param into name-substring → colour rules. */
function parseCalendarColors(json: string): ColorRule[] {
	try {
		const obj = JSON.parse(json) as Record<string, string>;
		return Object.entries(obj)
			.map(([match, value]) => {
				const v = String(value).trim();
				const color = v.startsWith("#") ? v : NAMED_COLORS[v.toLowerCase()];
				return color ? { match: match.toLowerCase(), color } : null;
			})
			.filter((x): x is ColorRule => x !== null);
	} catch {
		return [];
	}
}

// Legend grouping order: red (holidays) first, then the accent cycle order.
// Custom hex colours fall after these, ranked by first appearance.
const LEGEND_COLOR_ORDER = [
	display6.red,
	display6.black,
	display6.blue,
	display6.yellow,
	display6.green,
] as const;

/**
 * Group legend entries by colour so all calendars sharing a colour sit together
 * (all red after each other, etc.). Stable within each colour group.
 */
function groupLegendByColor(
	legend: CalendarLegendEntry[],
): CalendarLegendEntry[] {
	const rank = new Map<string, number>();
	LEGEND_COLOR_ORDER.forEach((c, i) => {
		rank.set(c, i);
	});
	let next = LEGEND_COLOR_ORDER.length;
	for (const e of legend) {
		if (!rank.has(e.color)) rank.set(e.color, next++);
	}
	return legend
		.map((e, i) => ({ e, i }))
		.sort((a, b) => {
			const byColor = (rank.get(a.e.color) ?? 0) - (rank.get(b.e.color) ?? 0);
			return byColor !== 0 ? byColor : a.i - b.i;
		})
		.map(({ e }) => e);
}

/** Holiday → always red; else a configured colour; else the next cycle colour. */
function resolveCalendarColor(
	name: string,
	rules: ColorRule[],
	nextCycle: () => string,
): string {
	if (HOLIDAY_CALENDAR_RE.test(name)) return display6.red;
	const lower = name.toLowerCase();
	for (const rule of rules) {
		if (rule.match && lower.includes(rule.match)) return rule.color;
	}
	return nextCycle();
}

/**
 * Per-day event processing:
 *  1. Merge overlapping events (same title + start across calendars) into a
 *     single entry whose `colors` carry up to two of the calendars' colours
 *     (rendered as a striped pattern; a 3rd overlapping colour is dropped).
 *  2. Collapse holiday (solid-red) all-day events into one merged entry.
 *  3. Sort all-day-first, then by start time.
 */
function processDayEvents(events: CalendarEvent[]): CalendarEvent[] {
	const groups = new Map<string, CalendarEvent[]>();
	for (const e of events) {
		const key = `${e.allDay ? "d" : "t"}|${e.startEpoch}|${e.title.trim().toLowerCase()}`;
		const g = groups.get(key);
		if (g) g.push(e);
		else groups.set(key, [e]);
	}

	let merged: CalendarEvent[] = [];
	for (const group of groups.values()) {
		if (group.length === 1) {
			merged.push(group[0]);
			continue;
		}
		const colors = [...new Set(group.flatMap((g) => g.colors))].slice(0, 2);
		merged.push({ ...group[0], colors });
	}

	const isHoliday = (e: CalendarEvent) =>
		e.allDay && e.colors.length === 1 && e.colors[0] === display6.red;
	const holidays = merged.filter(isHoliday);
	if (holidays.length > 1) {
		const seen = new Set<string>();
		const titles: string[] = [];
		for (const h of holidays) {
			const norm = h.title.trim().toLowerCase();
			if (!seen.has(norm)) {
				seen.add(norm);
				titles.push(h.title.trim());
			}
		}
		merged = [
			{
				title: titles.join(" · "),
				allDay: true,
				startLabel: "",
				startEpoch: 0,
				colors: [display6.red],
			},
			...merged.filter((e) => !isHoliday(e)),
		];
	}

	return merged.sort((a, b) =>
		a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.startEpoch - b.startEpoch,
	);
}

// ---- Serializable props (no Temporal/Date objects cross the render boundary) ----

export type CalendarEvent = {
	title: string;
	allDay: boolean;
	startLabel: string; // "" for all-day events
	startEpoch: number; // sort key (0 for all-day so they lead the day)
	/** Marker colours: 1 = solid; 2 = striped pattern (overlapping calendars). */
	colors: string[];
};

export type MonthCell = {
	day: number;
	inMonth: boolean;
	isToday: boolean;
	isHoliday: boolean;
	isWeekend: boolean;
	isVacation: boolean;
};

export type WeekDay = {
	dateStr: string;
	weekdayLabel: string;
	dayNum: number;
	isToday: boolean;
	isHoliday: boolean;
	isWeekend: boolean;
	isVacation: boolean;
	events: CalendarEvent[];
};

/**
 * A multi-day all-day event, positioned within the visible week as a block that
 * spans day columns (Google Calendar's "all-day" band above the timed events).
 */
export type SpanEvent = {
	title: string;
	/** Marker/background colours: 1 = solid; 2 = striped (overlapping calendars). */
	colors: string[];
	/** 0-based column (weekday) where the block starts in this week. */
	startIndex: number;
	/** Number of day columns the block covers in this week (1–7). */
	span: number;
	/** The event began before this week (flatten the left edge). */
	continuesBefore: boolean;
	/** The event continues after this week (flatten the right edge). */
	continuesAfter: boolean;
};

export type GoogleCalendarData = {
	connected: boolean;
	configured: boolean;
	monthTitle: string;
	weekdayLabels: string[];
	/** Single-letter weekday initials, Monday-first (M T O T F L S). */
	weekdayInitials: string[];
	monthCells: MonthCell[];
	/** ISO week number for each of the 6 month-grid rows. */
	monthWeeks: number[];
	/** Next month, rendered in full with a dotted (outline-only) style. */
	nextMonthTitle: string;
	nextMonthCells: MonthCell[];
	nextMonthWeeks: number[];
	weekDays: WeekDay[];
	/** Multi-day all-day events drawn as spanning blocks above the week columns. */
	spanningEvents: SpanEvent[];
	weekNumber: number;
	showWeekNumbers: boolean;
	/** Calendars (with events) and their accent colour, for the legend. */
	calendars: CalendarLegendEntry[];
};

type GoogleCalendarParams = {
	vacationCalendar?: string;
	country?: string;
	showWeekNumbers?: boolean | string;
	/** JSON mapping a calendar name-substring to a colour. */
	calendarColors?: string;
};

// ---- Intl formatters (Danish). Intl needs a Date, so build a UTC-neutral one. ----

const monthYearFormat = new Intl.DateTimeFormat(LOCALE, {
	month: "long",
	year: "numeric",
});
const weekdayShortFormat = new Intl.DateTimeFormat(LOCALE, {
	weekday: "short",
});

function labelDate(d: Temporal.PlainDate): Date {
	return new Date(Date.UTC(d.year, d.month - 1, d.day));
}

/** Monday 2024-01-01 — anchors the Monday-first weekday header order. */
const MONDAY_REF = Temporal.PlainDate.from({ year: 2024, month: 1, day: 1 });
const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, i) =>
	weekdayShortFormat.format(labelDate(MONDAY_REF.add({ days: i }))),
);
const WEEKDAY_INITIALS = WEEKDAY_LABELS.map((label) =>
	label.charAt(0).toUpperCase(),
);

function timeLabel(zdt: Temporal.ZonedDateTime): string {
	// Danish convention uses a dot separator (e.g. 09.30).
	const t = zdt.toPlainTime();
	return `${String(t.hour).padStart(2, "0")}.${String(t.minute).padStart(2, "0")}`;
}

// ---- Pure date helpers (Temporal) ----

const isWeekend = (d: Temporal.PlainDate) => d.dayOfWeek >= 6; // 6=Sat, 7=Sun

function mondayOf(d: Temporal.PlainDate): Temporal.PlainDate {
	return d.subtract({ days: d.dayOfWeek - 1 });
}

function plainEq(a: Temporal.PlainDate, b: Temporal.PlainDate): boolean {
	return Temporal.PlainDate.compare(a, b) === 0;
}

function dayStartInstantISO(d: Temporal.PlainDate): string {
	return d.toZonedDateTime(TZ).toInstant().toString();
}

// ---- Normalized event shape produced by the (cached) network fetch ----

// `endDateStr` (exclusive, clipped to the fetch range) is set only for all-day
// events, so the week view can tell single-day all-day events apart from
// multi-day spans without re-fetching.
type NormalizedEvent = CalendarEvent & {
	dateStr: string;
	endDateStr?: string;
};

/** Whole days from `a` to `b` (b exclusive). Negative if b precedes a. */
function daysBetween(a: Temporal.PlainDate, b: Temporal.PlainDate): number {
	return a.until(b, { largestUnit: "day" }).days;
}

export type CalendarLegendEntry = { name: string; color: string };

type CalendarPayload = {
	events: NormalizedEvent[];
	vacationDates: string[];
	calendars: CalendarLegendEntry[];
};

/**
 * Expand a Google all-day event (start.date inclusive .. end.date exclusive)
 * into the ISO date strings it covers, clipped to [rangeStart, rangeEndExcl).
 */
function expandAllDay(
	startDate: string,
	endDate: string,
	rangeStart: Temporal.PlainDate,
	rangeEndExcl: Temporal.PlainDate,
): string[] {
	const out: string[] = [];
	let cur = Temporal.PlainDate.from(startDate);
	const end = Temporal.PlainDate.from(endDate);
	// Clip the lower bound forward to the range start.
	if (Temporal.PlainDate.compare(cur, rangeStart) < 0) cur = rangeStart;
	while (
		Temporal.PlainDate.compare(cur, end) < 0 &&
		Temporal.PlainDate.compare(cur, rangeEndExcl) < 0
	) {
		out.push(cur.toString());
		cur = cur.add({ days: 1 });
	}
	return out;
}

/** One calendar's raw events plus the flags assembly needs (pre-colour). */
export type CalendarGroup = {
	events: GoogleEvent[];
	name: string;
	isVacation: boolean;
};

/**
 * Pure assembly of per-calendar Google events into the render payload: assigns
 * accent colours, normalizes/expands events, collects vacation dates, and builds
 * the colour-grouped legend. Shared by the live fetch and the test fixture so
 * both paths run identical logic; importable directly for unit tests.
 */
export function assembleCalendarPayload(
	groups: CalendarGroup[],
	args: {
		calendarColorsJson: string;
		rangeStartStr: string;
		rangeEndExclStr: string;
	},
): CalendarPayload {
	const rangeStart = Temporal.PlainDate.from(args.rangeStartStr);
	const rangeEndExcl = Temporal.PlainDate.from(args.rangeEndExclStr);

	// Only calendars with events get an accent. Holiday calendars are always
	// red; JSON-configured calendars get their colour; neither consumes a cycle
	// slot. The rest cycle (black → blue → yellow → green).
	const colorRules = parseCalendarColors(args.calendarColorsJson);
	let cycleIdx = 0;
	const active = groups
		.filter((g) => g.events.length > 0)
		.map((g) => ({
			...g,
			color: resolveCalendarColor(g.name, colorRules, () =>
				accentForIndex(cycleIdx++),
			),
		}));

	const out: NormalizedEvent[] = [];
	const vacationDates = new Set<string>();

	for (const group of active) {
		for (const ev of group.events) {
			const title = ev.summary?.trim() || "(uden titel)";
			if (ev.start.date) {
				// All-day event. Google's end.date is exclusive; default a missing
				// one to a single day. Keep one entry carrying the (clipped) range so
				// the week view can render multi-day events as a single spanning block.
				const endExclusive =
					ev.end.date ??
					Temporal.PlainDate.from(ev.start.date).add({ days: 1 }).toString();
				const dates = expandAllDay(
					ev.start.date,
					endExclusive,
					rangeStart,
					rangeEndExcl,
				);
				if (dates.length === 0) continue; // entirely outside the fetch range
				if (group.isVacation) {
					for (const dateStr of dates) vacationDates.add(dateStr);
				}
				out.push({
					dateStr: dates[0],
					endDateStr: Temporal.PlainDate.from(dates[dates.length - 1])
						.add({ days: 1 })
						.toString(),
					title,
					allDay: true,
					startLabel: "",
					startEpoch: 0,
					colors: [group.color],
				});
			} else if (ev.start.dateTime) {
				// Timed event.
				const inst = Temporal.Instant.from(ev.start.dateTime);
				const zdt = inst.toZonedDateTimeISO(TZ);
				out.push({
					dateStr: zdt.toPlainDate().toString(),
					title,
					allDay: false,
					startLabel: timeLabel(zdt),
					startEpoch: inst.epochMilliseconds,
					colors: [group.color],
				});
			}
		}
	}

	const legend: CalendarLegendEntry[] = groupLegendByColor(
		active.filter((g) => g.name).map((g) => ({ name: g.name, color: g.color })),
	);

	return {
		events: out,
		vacationDates: [...vacationDates],
		calendars: legend,
	};
}

function buildCalendarPayloadFetcher() {
	return unstable_cache(
		async (args: {
			userId: string;
			vacationCalendar: string;
			calendarColorsJson: string;
			timeMinISO: string;
			timeMaxISO: string;
			rangeStartStr: string;
			rangeEndExclStr: string;
		}): Promise<CalendarPayload> => {
			const accessToken = await getValidAccessToken(args.userId);
			if (!accessToken) {
				// Throwing prevents unstable_cache from caching a transient miss.
				throw new Error("No Google access token");
			}

			const vacationMatch = args.vacationCalendar.trim().toLowerCase();

			const calendars = await listCalendars(accessToken);
			const perCalendar: CalendarGroup[] = await Promise.all(
				calendars.map((cal) =>
					listEvents(
						accessToken,
						cal.id,
						args.timeMinISO,
						args.timeMaxISO,
					).then((events) => ({
						events,
						name: cal.summary ?? "",
						isVacation:
							vacationMatch.length > 0 &&
							(cal.summary ?? "").toLowerCase().includes(vacationMatch),
					})),
				),
			);

			return assembleCalendarPayload(perCalendar, {
				calendarColorsJson: args.calendarColorsJson,
				rangeStartStr: args.rangeStartStr,
				rangeEndExclStr: args.rangeEndExclStr,
			});
		},
		["google-calendar-payload"],
		{ revalidate: 300, tags: ["google-calendar"] },
	);
}

const getCachedCalendarPayload = buildCalendarPayloadFetcher();

// ---- Main entry ----

export default async function getData(
	params?: GoogleCalendarParams,
	userId?: string,
): Promise<GoogleCalendarData> {
	const vacationCalendar = params?.vacationCalendar ?? "ferie";
	const showWeekNumbers =
		params?.showWeekNumbers === undefined
			? true
			: params.showWeekNumbers === true || params.showWeekNumbers === "true";

	const today = Temporal.Now.plainDateISO(TZ);
	const displayYear = today.year;
	const displayMonth = today.month;

	// Month overview grid: 6 Monday-first weeks covering the current month.
	const firstOfMonth = Temporal.PlainDate.from({
		year: displayYear,
		month: displayMonth,
		day: 1,
	});
	const monthGridStart = mondayOf(firstOfMonth);
	const monthGridEndExcl = monthGridStart.add({ days: 42 });

	// Next month, rendered in full below the current month (dotted style).
	const nextMonthFirst = firstOfMonth.add({ months: 1 });
	const nextMonthGridStart = mondayOf(nextMonthFirst);

	// Detail week: current Monday..Sunday.
	const weekStart = mondayOf(today);
	const weekEndExcl = weekStart.add({ days: 7 });

	// Combined fetch window (month grid always contains the current week, but
	// take the union defensively).
	const rangeStart =
		Temporal.PlainDate.compare(monthGridStart, weekStart) <= 0
			? monthGridStart
			: weekStart;
	const rangeEndExcl =
		Temporal.PlainDate.compare(monthGridEndExcl, weekEndExcl) >= 0
			? monthGridEndExcl
			: weekEndExcl;

	// Holidays for every year the window touches (handles Dec/Jan spillover).
	// Only DK is supported today; the `country` param is reserved for future use.
	const holidayDates = new Set<string>();
	const supportedCountry: HolidayCountry = "DK";
	const holidayEndYear = nextMonthGridStart.add({ days: 41 }).year;
	for (let y = rangeStart.year; y <= holidayEndYear; y++) {
		for (const d of getHolidayDates(supportedCountry, y)) holidayDates.add(d);
	}

	const monthTitle = monthYearFormat.format(labelDate(firstOfMonth));
	const configured = isGoogleOAuthConfigured();

	// Test/preview mode: render deterministic fixture data with no Google account.
	// Used by unit tests, Playwright e2e, and local preview.
	const useFixture = process.env.GOOGLE_CALENDAR_FIXTURE === "true";

	const calendarColorsJson =
		typeof params?.calendarColors === "string" ? params.calendarColors : "{}";

	// Fresh connection check (never cached) so the screen flips to "connected"
	// immediately after the OAuth handshake.
	const connected =
		useFixture ||
		(configured && userId ? await isCalendarConnected(userId) : false);

	let payload: CalendarPayload = {
		events: [],
		vacationDates: [],
		calendars: [],
	};
	if (useFixture) {
		payload = assembleCalendarPayload(
			googleCalendarFixture(weekStart.toString()),
			{
				calendarColorsJson,
				rangeStartStr: rangeStart.toString(),
				rangeEndExclStr: rangeEndExcl.toString(),
			},
		);
	} else if (connected && userId) {
		try {
			payload = await getCachedCalendarPayload({
				userId,
				vacationCalendar,
				calendarColorsJson,
				timeMinISO: dayStartInstantISO(rangeStart),
				timeMaxISO: dayStartInstantISO(rangeEndExcl),
				rangeStartStr: rangeStart.toString(),
				rangeEndExclStr: rangeEndExcl.toString(),
			});
		} catch {
			// Leave events empty; the week view simply shows no entries.
			payload = { events: [], vacationDates: [], calendars: [] };
		}
	}

	const vacationSet = new Set(payload.vacationDates);

	const flagsFor = (d: Temporal.PlainDate) => {
		const dateStr = d.toString();
		return {
			isToday: plainEq(d, today),
			isHoliday: holidayDates.has(dateStr),
			isWeekend: isWeekend(d),
			isVacation: vacationSet.has(dateStr),
		};
	};

	// Month overview cells.
	const monthCells: MonthCell[] = [];
	for (let i = 0; i < 42; i++) {
		const d = monthGridStart.add({ days: i });
		monthCells.push({
			day: d.day,
			inMonth: d.year === displayYear && d.month === displayMonth,
			...flagsFor(d),
		});
	}

	// ISO week number for each of the 6 grid rows (the row's Monday).
	const monthWeeks = Array.from(
		{ length: 6 },
		(_, row) => monthGridStart.add({ days: row * 7 }).weekOfYear ?? 0,
	);

	// Next month cells/weeks (holiday + weekend flags only; no events/vacation).
	const nextMonthCells: MonthCell[] = [];
	for (let i = 0; i < 42; i++) {
		const d = nextMonthGridStart.add({ days: i });
		nextMonthCells.push({
			day: d.day,
			inMonth:
				d.year === nextMonthFirst.year && d.month === nextMonthFirst.month,
			...flagsFor(d),
		});
	}
	const nextMonthWeeks = Array.from(
		{ length: 6 },
		(_, row) => nextMonthGridStart.add({ days: row * 7 }).weekOfYear ?? 0,
	);
	const nextMonthTitle = monthYearFormat.format(labelDate(nextMonthFirst));

	// A multi-day all-day event spans ≥2 calendar days.
	const isMultiDay = (ev: NormalizedEvent): boolean =>
		ev.allDay &&
		ev.endDateStr !== undefined &&
		daysBetween(
			Temporal.PlainDate.from(ev.dateStr),
			Temporal.PlainDate.from(ev.endDateStr),
		) >= 2;

	// Spanning band: multi-day all-day events clipped to the visible week, drawn
	// as blocks above the day columns. Identical events from several calendars
	// (same title + range) merge into one block with up to two striped colours.
	const spanAccum = new Map<string, SpanEvent>();
	for (const ev of payload.events) {
		if (!isMultiDay(ev) || !ev.endDateStr) continue;
		const evStart = Temporal.PlainDate.from(ev.dateStr);
		const evEndExcl = Temporal.PlainDate.from(ev.endDateStr);
		// Intersect [evStart, evEndExcl) with [weekStart, weekEndExcl).
		const clipStart =
			Temporal.PlainDate.compare(evStart, weekStart) >= 0 ? evStart : weekStart;
		const clipEndExcl =
			Temporal.PlainDate.compare(evEndExcl, weekEndExcl) <= 0
				? evEndExcl
				: weekEndExcl;
		if (Temporal.PlainDate.compare(clipStart, clipEndExcl) >= 0) continue;

		const key = `${ev.title}|${ev.dateStr}|${ev.endDateStr}`;
		const existing = spanAccum.get(key);
		if (existing) {
			existing.colors = [...new Set([...existing.colors, ...ev.colors])].slice(
				0,
				2,
			);
			continue;
		}
		spanAccum.set(key, {
			title: ev.title,
			colors: ev.colors.slice(0, 2),
			startIndex: daysBetween(weekStart, clipStart),
			span: daysBetween(clipStart, clipEndExcl),
			continuesBefore: Temporal.PlainDate.compare(evStart, weekStart) < 0,
			continuesAfter: Temporal.PlainDate.compare(evEndExcl, weekEndExcl) > 0,
		});
	}
	const spanningEvents = [...spanAccum.values()].sort(
		(a, b) => a.startIndex - b.startIndex || b.span - a.span,
	);

	// Group the remaining (single-day all-day + timed) events onto week days.
	// Multi-day events live in the spanning band, not the per-day columns.
	const eventsByDate = new Map<string, CalendarEvent[]>();
	for (const ev of payload.events) {
		if (isMultiDay(ev)) continue;
		const list = eventsByDate.get(ev.dateStr) ?? [];
		list.push({
			title: ev.title,
			allDay: ev.allDay,
			startLabel: ev.startLabel,
			startEpoch: ev.startEpoch,
			colors: ev.colors,
		});
		eventsByDate.set(ev.dateStr, list);
	}

	const weekDays: WeekDay[] = [];
	for (let i = 0; i < 7; i++) {
		const d = weekStart.add({ days: i });
		const dateStr = d.toString();
		const events = processDayEvents(eventsByDate.get(dateStr) ?? []);
		weekDays.push({
			dateStr,
			weekdayLabel: WEEKDAY_LABELS[i],
			dayNum: d.day,
			...flagsFor(d),
			events,
		});
	}

	return {
		connected,
		configured,
		monthTitle,
		weekdayLabels: WEEKDAY_LABELS,
		weekdayInitials: WEEKDAY_INITIALS,
		monthCells,
		monthWeeks,
		nextMonthTitle,
		nextMonthCells,
		nextMonthWeeks,
		weekDays,
		spanningEvents,
		weekNumber: today.weekOfYear ?? 0,
		showWeekNumbers,
		calendars: payload.calendars,
	};
}
