import type { CSSProperties } from "react";
import { PreSatori } from "@/utils/pre-satori";
import type {
	CalendarEvent,
	GoogleCalendarData,
	MonthCell,
	WeekDay,
} from "./getData";
import { display6, display6Soft } from "./tokens";

type Props = Partial<GoogleCalendarData> & {
	width?: number;
	height?: number;
};

type DayFlags = { isHoliday: boolean; isVacation: boolean; isWeekend: boolean };

/**
 * Text colour for an inverted "today" (black background): the day-type colour,
 * defaulting to white for an ordinary day. holiday > vacation/weekend.
 */
function todayForeground(d: DayFlags): string {
	if (d.isHoliday) return display6.red;
	if (d.isVacation || d.isWeekend) return display6.green;
	return display6.white;
}

/** Background fill for a month-overview cell (today > holiday > vacation/weekend). */
function cellFill(cell: MonthCell): { bg: string; fg: string } {
	if (!cell.inMonth) return { bg: display6.white, fg: "#999999" };
	if (cell.isToday) return { bg: display6.black, fg: todayForeground(cell) };
	if (cell.isHoliday) return { bg: display6Soft.red, fg: display6.black };
	if (cell.isVacation || cell.isWeekend)
		return { bg: display6Soft.green, fg: display6.black };
	return { bg: display6.white, fg: display6.black };
}

/** Day-type colour for the week-view underline (red holiday, green weekend). */
function headerColor(day: WeekDay): string {
	if (day.isHoliday) return display6.red;
	if (day.isVacation || day.isWeekend) return display6.green;
	return display6.black;
}

export default function GoogleCalendar({
	width = 1600,
	height = 1200,
	connected = false,
	configured = false,
	monthTitle = "",
	weekdayLabels = [],
	monthCells = [],
	weekDays = [],
	weekNumber = 0,
	showWeekNumbers = true,
}: Props) {
	// Layout designed against a 1600×1200 reference; scales uniformly to the
	// actual canvas (Inky 13.3 default → ×1, smaller panels → down).
	const scale = Math.min(width / 1600, height / 1200);
	const px = (n: number) => Math.round(n * scale);

	const pad = px(36);
	const headerH = px(96);
	const monthColW = px(440);
	const gap = px(28);

	const titleSize = px(56);
	const subSize = px(26);
	const miniWeekday = px(20);
	const miniDay = px(28);
	const dayHeadSize = px(30);
	const dayNumSize = px(40);
	const eventTime = px(20);
	const eventTitle = px(22);

	// NOTE: these are plain functions called inline (not <Components/>) so that
	// PreSatori traverses the elements they return and applies the font-* family.
	// Custom component boundaries are opaque to PreSatori's tree walk.

	const renderEvent = (ev: CalendarEvent, key: string) => (
		<div
			key={key}
			className="flex flex-col"
			style={{
				borderLeft: `${px(5)}px solid ${ev.color}`,
				paddingLeft: px(6),
			}}
		>
			<span
				className="font-inter font-bold leading-none"
				style={{
					fontSize: eventTime,
					color: ev.allDay ? ev.color : display6.black,
				}}
			>
				{ev.allDay ? "hele dagen" : ev.startLabel}
			</span>
			<span
				className="font-inter leading-tight"
				style={{
					fontSize: eventTitle,
					color: display6.black,
					marginTop: px(2),
					display: "-webkit-box",
					WebkitLineClamp: 3,
					WebkitBoxOrient: "vertical" as const,
					overflow: "hidden",
				}}
			>
				{ev.title}
			</span>
		</div>
	);

	const renderDay = (day: WeekDay) => {
		const accent = headerColor(day);
		// Today inverts to a black block with day-type-coloured text; other days
		// keep black text with the day-type colour on the underline.
		const textColor = day.isToday ? todayForeground(day) : display6.black;
		const headerStyle: CSSProperties = day.isToday
			? {
					backgroundColor: display6.black,
					padding: px(6),
					marginBottom: px(8),
				}
			: {
					borderBottom: `${px(2)}px solid ${accent}`,
					paddingBottom: px(4),
					marginBottom: px(8),
				};
		return (
			<div
				key={day.dateStr}
				className="flex flex-col"
				style={{
					borderLeft: `${px(1)}px solid #DDDDDD`,
					paddingLeft: px(6),
					paddingRight: px(4),
					minHeight: 0,
				}}
			>
				<div className="flex shrink-0 flex-col items-start" style={headerStyle}>
					<span
						className="font-inter font-bold uppercase leading-none"
						style={{ fontSize: dayHeadSize, color: textColor }}
					>
						{day.weekdayLabel}
					</span>
					<span
						className="font-inter leading-none"
						style={{
							fontSize: dayNumSize,
							color: textColor,
							fontWeight: day.isToday ? 700 : 400,
						}}
					>
						{day.dayNum}
					</span>
				</div>
				<div
					className="flex flex-col"
					style={{ gap: px(6), overflow: "hidden", minHeight: 0 }}
				>
					{day.events.map((ev, i) => renderEvent(ev, `${day.dateStr}-${i}`))}
				</div>
			</div>
		);
	};

	const renderNotConnected = () => (
		<section className="flex items-center justify-center">
			<div
				className="flex flex-col items-center text-center"
				style={{ gap: px(16), maxWidth: px(620) }}
			>
				<span
					className="font-inter font-bold leading-tight"
					style={{ fontSize: px(40), color: display6.blue }}
				>
					Google Kalender
				</span>
				<span
					className="font-inter leading-snug"
					style={{ fontSize: px(26), color: display6.black }}
				>
					{configured
						? "Forbind din Google-konto i dashboardet for at se dine begivenheder her."
						: "Google-integrationen er ikke konfigureret. Tilføj GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET og GOOGLE_TOKEN_ENCRYPTION_KEY."}
				</span>
			</div>
		</section>
	);

	return (
		<PreSatori useDoubling width={width} height={height}>
			<div
				className="flex h-full w-full flex-col font-inter"
				style={{
					padding: pad,
					backgroundColor: display6.white,
					color: display6.black,
				}}
			>
				{/* Header */}
				<header
					className="flex shrink-0 items-end justify-between"
					style={{
						height: headerH,
						paddingBottom: px(12),
						borderBottom: `${px(4)}px solid ${display6.black}`,
					}}
				>
					<h1
						className="font-inter font-normal leading-none tracking-tight"
						style={{ fontSize: titleSize, textTransform: "capitalize" }}
					>
						{monthTitle}
					</h1>
					<span
						className="font-inter"
						style={{ fontSize: subSize, color: display6.blue }}
					>
						{showWeekNumbers ? `Uge ${weekNumber} · ` : ""}Google Kalender
					</span>
				</header>

				{/* Body: month overview (left) + week view (right) */}
				<div
					className="grid flex-1"
					style={{
						gridTemplateColumns: `${monthColW}px 1fr`,
						gap,
						paddingTop: px(20),
						minHeight: 0,
					}}
				>
					{/* Month overview */}
					<section className="flex flex-col" style={{ minHeight: 0 }}>
						<div
							className="grid shrink-0 grid-cols-7"
							style={{ paddingBottom: px(6) }}
						>
							{weekdayLabels.map((label) => (
								<div
									key={label}
									className="flex items-center justify-center font-inter font-bold uppercase"
									style={{ fontSize: miniWeekday, color: display6.black }}
								>
									{label}
								</div>
							))}
						</div>
						<div
							className="grid flex-1 grid-cols-7"
							style={{ gridTemplateRows: "repeat(6, 1fr)", gap: px(3) }}
						>
							{monthCells.map((cell, i) => {
								const { bg, fg } = cellFill(cell);
								return (
									<div
										key={`${cell.day}-${i}`}
										className="flex items-center justify-center font-inter leading-none"
										style={{
											backgroundColor: bg,
											color: fg,
											fontSize: miniDay,
											border: cell.isToday
												? `${px(4)}px solid ${display6.black}`
												: `${px(1)}px solid #CCCCCC`,
											boxSizing: "border-box",
										}}
									>
										{cell.day}
									</div>
								);
							})}
						</div>
					</section>

					{/* Week view */}
					{connected ? (
						<section
							className="grid"
							style={{
								gridTemplateColumns: "repeat(7, 1fr)",
								gap: px(2),
								minHeight: 0,
							}}
						>
							{weekDays.map((day) => renderDay(day))}
						</section>
					) : (
						renderNotConnected()
					)}
				</div>
			</div>
		</PreSatori>
	);
}
