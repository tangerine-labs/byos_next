import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "./db.d";

function createPool() {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		console.warn("DATABASE_URL is not set. Database connection may fail.");
	}
	return new Pool({
		connectionString,
		ssl: connectionString?.includes("sslmode=disable")
			? false
			: process.env.NODE_ENV === "production"
				? { rejectUnauthorized: false }
				: false,
	});
}

let pool: Pool | undefined;

function getPool() {
	if (!pool) {
		pool = createPool();
	}
	return pool;
}

// Create a new Kysely instance with Postgres dialect
export const db = new Kysely<DB>({
	dialect: new PostgresDialect({
		pool: getPool(),
	}),
});
