import type { Weekday } from "./getData";

const ICON_BASE = "https://tangerine-labs.com/week-dinners/lucide-icons";

interface MealsOfTheWeekProps {
	weekdays?: Weekday[];
	width?: number;
	height?: number;
}

export default function MealsOfTheWeek({
	weekdays = [],
	width = 800,
	height = 480,
}: MealsOfTheWeekProps) {
	return (
		<>
			<link rel="stylesheet" href="https://trmnl.com/css/latest/plugins.css" />
			<script src="https://trmnl.com/js/latest/plugins.js" defer />
			<div className="environment trmnl" style={{ width, height }}>
				<div className="screen">
					<div className="view view--full">
						<div className="layout layout--col gap">
							<div className="title title--large lg:title--xlarge mb--large">
								Weekly Schedule
							</div>
							<div className="grid grid--cols-5 portrait:grid--cols-1 gap stretch-y mt--large">
								{weekdays.map((day) => (
									<div
										key={day.day}
										className="col gap--small bg--gray-75 rounded--base"
									>
										<div className="title title--large lg:title--xlarge">
											{day.day}
										</div>

										<div className="item mt--large">
											<div className="content">
												<div className="label label--large label--underline">
													<img
														src={`${ICON_BASE}/apple.svg`}
														className="icon"
														width={24}
														height={24}
														alt=""
													/>{" "}
													Snack
												</div>
												<div
													className="description description--large lg:description--xlarge"
													data-clamp="4"
												>
													{day.snack}
												</div>
											</div>
										</div>

										<div className="item mt--large">
											<div className="content">
												<div className="label label--large label--underline">
													<img
														src={`${ICON_BASE}/sandwich.svg`}
														className="icon"
														width={24}
														height={24}
														alt=""
													/>{" "}
													Lunch
												</div>
												<div
													className="description description--large lg:description--xlarge"
													data-clamp="4"
												>
													{day.lunch}
												</div>
											</div>
										</div>

										<div className="item mt--large">
											<div className="content">
												<div className="label label--large label--underline">
													<img
														src={`${ICON_BASE}/utensils.svg`}
														className="icon"
														width={24}
														height={24}
														alt=""
													/>{" "}
													Dinner
												</div>
												<div
													className="description description--large lg:description--xlarge"
													data-clamp="4"
												>
													{day.dinner}
												</div>
											</div>
										</div>
									</div>
								))}
							</div>
						</div>
						<div className="title_bar">
							<span className="title">Week Dinners</span>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}
