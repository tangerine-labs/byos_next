"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/auth/get-user";
import {
	deleteCredentials,
	getStoredCredentials,
	isGoogleOAuthConfigured,
} from "@/lib/integrations/google-calendar";

export type GoogleCalendarStatus = {
	configured: boolean;
	connected: boolean;
	email: string | null;
};

/** Connection status for the dashboard "Connect Google Calendar" UI. */
export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
	const configured = isGoogleOAuthConfigured();
	const userId = await getCurrentUserId();
	if (!userId) {
		return { configured, connected: false, email: null };
	}
	const row = await getStoredCredentials(userId);
	return {
		configured,
		connected: Boolean(row),
		email: row?.google_email ?? null,
	};
}

/** Remove the stored Google credentials for the current user. */
export async function disconnectGoogleCalendar(): Promise<{
	success: boolean;
}> {
	const userId = await getCurrentUserId();
	if (!userId) {
		return { success: false };
	}
	await deleteCredentials(userId);
	revalidatePath("/recipes/google-calendar");
	return { success: true };
}
