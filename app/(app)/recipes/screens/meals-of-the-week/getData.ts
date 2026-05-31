import { unstable_cache } from "next/cache";

export const dynamic = "force-dynamic";

const MEALS_URL = "https://tangerine-labs.com/week-dinners/weekdays.json";

export interface Weekday {
	day: string;
	snack: string;
	lunch: string;
	dinner: string;
}

export interface MealsData {
	weekdays: Weekday[];
}

function isValidMealsData(data: unknown): data is MealsData {
	if (!data || typeof data !== "object") return false;
	const weekdays = (data as MealsData).weekdays;
	return (
		Array.isArray(weekdays) &&
		weekdays.every(
			(day) =>
				day &&
				typeof day === "object" &&
				typeof day.day === "string" &&
				typeof day.snack === "string" &&
				typeof day.lunch === "string" &&
				typeof day.dinner === "string",
		)
	);
}

async function fetchMealsData(): Promise<MealsData> {
	try {
		const response = await fetch(MEALS_URL, {
			headers: { "User-Agent": "BYOS/1.0" },
			next: { revalidate: 900 },
		});

		if (!response.ok) {
			console.error(`Meals fetch failed: ${response.status}`);
			return { weekdays: [] };
		}

		const data: unknown = await response.json();
		if (!isValidMealsData(data)) {
			console.error("Meals fetch returned invalid data shape");
			return { weekdays: [] };
		}

		return data;
	} catch (error) {
		console.error("Error fetching meals data:", error);
		return { weekdays: [] };
	}
}

const getCachedMealsData = unstable_cache(
	async (): Promise<MealsData> => {
		const data = await fetchMealsData();
		if (data.weekdays.length === 0) {
			throw new Error("Empty or invalid meals data - skip caching");
		}
		return data;
	},
	["meals-of-the-week"],
	{
		tags: ["meals-of-the-week"],
		revalidate: 900,
	},
);

export default async function getData(): Promise<MealsData> {
	try {
		return await getCachedMealsData();
	} catch (error) {
		console.log("Meals cache skipped or error:", error);
		return fetchMealsData();
	}
}
