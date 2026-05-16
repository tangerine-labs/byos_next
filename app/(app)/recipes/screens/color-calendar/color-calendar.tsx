import { Temporal } from "@/lib/temporal";
import { PreSatori } from "@/utils/pre-satori";
import { getDanishHolidayMap, isDanishHoliday } from "./danish-holidays";

const COPENHAGEN = "Europe/Copenhagen";

const WEEKDAYS_DA = ["man", "tir", "ons", "tor", "fre", "lør", "søn"] as const;

const MONTHS_DA = [
	"januar",
	"februar",
	"marts",
	"april",
	"maj",
	"juni",
	"juli",
	"august",
	"september",
	"oktober",
	"november",
	"december",
] as const;

type CalendarCell = {
	day: number;
	month: number;
	year: number;
	inMonth: boolean;
	isToday: boolean;
	isHoliday: boolean;
};

function buildMonthGrid(
	displayYear: number,
	displayMonth: number,
	today: Temporal.PlainDate,
	holidayYears: Map<number, ReturnType<typeof getDanishHolidayMap>>,
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

		const holidays =
			holidayYears.get(date.year) ?? getDanishHolidayMap(date.year);
		if (!holidayYears.has(date.year)) holidayYears.set(date.year, holidays);

		cells.push({
			day: date.day,
			month: date.month,
			year: date.year,
			inMonth,
			isToday: Temporal.PlainDate.compare(date, today) === 0,
			isHoliday: isDanishHoliday(date.year, date.month, date.day, holidays),
		});
	}

	return cells;
}

export default function ColorCalendar({
	width = 1600,
	height = 1200,
}: {
	width?: number;
	height?: number;
}) {
	const today = Temporal.Now.plainDateISO(COPENHAGEN);
	const displayYear = today.year;
	const displayMonth = today.month;

	const holidayYears = new Map<
		number,
		ReturnType<typeof getDanishHolidayMap>
	>();
	const cells = buildMonthGrid(displayYear, displayMonth, today, holidayYears);

	// Layout tuned for 1600×1200; scales down for smaller previews
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

	const monthTitle = `${MONTHS_DA[displayMonth - 1]} ${displayYear}`;

	return (
		<PreSatori useDoubling width={width} height={height}>
			<div
				className="flex h-full w-full flex-col bg-white text-black"
				style={{ padding: pad }}
			>
				<header
					className="flex shrink-0 items-end justify-between border-b-4 border-black"
					style={{ height: headerH, paddingBottom: Math.round(16 * scale) }}
				>
					<h1
						className="font-blockkie font-normal leading-none tracking-tight"
						style={{ fontSize: titleSize }}
					>
						{monthTitle}
					</h1>
					<span
						className="font-geneva9 text-neutral-600"
						style={{ fontSize: Math.round(24 * scale) }}
					>
						Danmark · helligdage
					</span>
				</header>

				<div
					className="grid shrink-0 grid-cols-7 border-b border-neutral-300"
					style={{ height: weekdayH }}
				>
					{WEEKDAYS_DA.map((label) => (
						<div
							key={label}
							className="flex items-center justify-center font-geneva9 font-bold uppercase text-neutral-700"
							style={{ fontSize: weekdaySize, width: colW }}
						>
							{label}
						</div>
					))}
				</div>

				<div
					className="grid flex-1 grid-cols-7"
					style={{ gridTemplateRows: `repeat(6, ${rowH}px)` }}
				>
					{cells.map((cell, index) => {
						const bg = cell.isHoliday
							? "#dc2626"
							: cell.inMonth
								? "#ffffff"
								: "#f5f5f5";
						const color = cell.isHoliday
							? "#ffffff"
							: cell.inMonth
								? "#000000"
								: "#a3a3a3";
						const border = cell.isToday
							? "4px solid #000000"
							: "1px solid #e5e5e5";

						return (
							<div
								key={`${cell.year}-${cell.month}-${cell.day}-${index}`}
								className="flex items-start justify-end font-blockkie leading-none"
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
