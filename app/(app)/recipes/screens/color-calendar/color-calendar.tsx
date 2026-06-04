import { Temporal } from "@/lib/temporal";
import { PreSatori } from "@/utils/pre-satori";
import { display6 } from "./tokens";

const COPENHAGEN = "Europe/Copenhagen";
const EMPTY_HOLIDAYS = new Set<string>();
const LOCALE = "da-DK";

const monthYearFormat = new Intl.DateTimeFormat(LOCALE, {
	month: "long",
	year: "numeric",
});
const weekdayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: "short" });

/** Monday 2024-01-01 — header order matches the Mon-first grid. */
const WEEKDAY_REF_MONDAY = Temporal.PlainDate.from({
	year: 2024,
	month: 1,
	day: 1,
});

function plainDateToDate(d: Temporal.PlainDate): Date {
	return new Date(d.year, d.month - 1, d.day);
}

const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, i) =>
	weekdayFormat.format(plainDateToDate(WEEKDAY_REF_MONDAY.add({ days: i }))),
);

function formatMonthYear(year: number, month: number): string {
	return monthYearFormat.format(new Date(year, month - 1, 1));
}

type CalendarCell = {
	day: number;
	month: number;
	year: number;
	inMonth: boolean;
	isToday: boolean;
	isHoliday: boolean;
};

function holidaySetsByYear(
	byYear: Record<number, string[]> | undefined,
): Map<number, ReadonlySet<string>> {
	const map = new Map<number, ReadonlySet<string>>();
	if (!byYear) return map;
	for (const [year, dates] of Object.entries(byYear)) {
		map.set(Number(year), new Set(dates));
	}
	return map;
}

function buildMonthGrid(
	displayYear: number,
	displayMonth: number,
	today: Temporal.PlainDate,
	holidayYears: Map<number, ReadonlySet<string>>,
): CalendarCell[] {
	const firstOfMonth = Temporal.PlainDate.from({
		year: displayYear,
		month: displayMonth,
		day: 1,
	});
	// Monday-first week (man … søn): Temporal dayOfWeek is 1=Mon … 7=Sun
	const gridStart = firstOfMonth.subtract({ days: firstOfMonth.dayOfWeek - 1 });

	const cells: CalendarCell[] = [];

	for (let i = 0; i < 42; i++) {
		const date = gridStart.add({ days: i });
		const inMonth = date.year === displayYear && date.month === displayMonth;

		const dates = holidayYears.get(date.year) ?? EMPTY_HOLIDAYS;

		cells.push({
			day: date.day,
			month: date.month,
			year: date.year,
			inMonth,
			isToday: Temporal.PlainDate.compare(date, today) === 0,
			isHoliday: dates.has(date.toString()),
		});
	}

	return cells;
}

export default function ColorCalendar({
	width = 1872,
	height = 1404,
	holidayDatesByYear,
}: {
	width?: number;
	height?: number;
	holidayDatesByYear?: Record<number, string[]>;
}) {
	const today = Temporal.Now.plainDateISO(COPENHAGEN);
	const displayYear = today.year;
	const displayMonth = today.month;

	const holidayYears = holidaySetsByYear(holidayDatesByYear);
	const cells = buildMonthGrid(displayYear, displayMonth, today, holidayYears);

	// Layout designed against a 1600×1200 reference; scales uniformly to the
	// actual canvas (default 1872×1404 / TRMNL X → ×1.17, smaller previews → down)
	const refW = 1600;
	const refH = 1200;
	const scale = Math.min(width / refW, height / refH);
	const pad = Math.round(40 * scale);
	const headerH = Math.round(140 * scale);
	const weekdayH = Math.round(56 * scale);
	const gridH = height - pad * 2 - headerH - weekdayH;
	const rowH = Math.floor(gridH / 6);
	const colW = Math.floor((width - pad * 2) / 7);

	const titleSize = Math.round(72 * scale);
	const weekdaySize = Math.round(28 * scale);
	const daySize = Math.round(52 * scale);

	const monthTitle = formatMonthYear(displayYear, displayMonth);

	return (
		<PreSatori useDoubling width={width} height={height}>
			<div
				className="flex h-full w-full flex-col"
				style={{
					padding: pad,
					backgroundColor: display6.white,
					color: display6.black,
				}}
			>
				<header
					className="flex shrink-0 items-end justify-between"
					style={{
						height: headerH,
						paddingBottom: Math.round(16 * scale),
						borderBottom: `4px solid ${display6.black}`,
					}}
				>
					<h1
						className="font-inter font-normal leading-none tracking-tight"
						style={{ fontSize: titleSize }}
					>
						{monthTitle}
					</h1>
					<span
						className="font-inter"
						style={{
							fontSize: Math.round(24 * scale),
							color: display6.blue,
						}}
					>
						Danmark · helligdage
					</span>
				</header>

				<div
					className="grid shrink-0 grid-cols-7"
					style={{
						height: weekdayH,
						borderBottom: `1px solid ${display6.black}`,
					}}
				>
					{WEEKDAY_LABELS.map((label) => (
						<div
							key={label}
							className="flex items-center justify-center font-inter font-bold uppercase"
							style={{
								fontSize: weekdaySize,
								width: colW,
								color: display6.black,
							}}
						>
							{label}
						</div>
					))}
				</div>

				<div
					className="grid flex-1 grid-cols-7"
					style={{ gridTemplateRows: `repeat(6, ${rowH}px)` }}
				>
					{cells.map((cell) => {
						const bg = cell.isHoliday
							? display6.red
							: cell.inMonth
								? display6.white
								: display6.yellow;
						const color = cell.isHoliday ? display6.white : display6.black;
						const border = cell.isToday
							? `4px solid ${display6.black}`
							: `1px solid ${display6.black}`;

						return (
							<div
								key={`${cell.year}-${cell.month}-${cell.day}`}
								className="flex items-start justify-end font-inter leading-none"
								style={{
									width: colW,
									height: rowH,
									backgroundColor: bg,
									color,
									border,
									fontSize: daySize,
									padding: Math.round(12 * scale),
									boxSizing: "border-box",
								}}
							>
								{cell.day}
							</div>
						);
					})}
				</div>
			</div>
		</PreSatori>
	);
}
