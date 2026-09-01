import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example). This backend only ever talks to Supabase with the service_role key.");
}

export const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
});

export const PUZZLES_BUCKET = "puzzles";
