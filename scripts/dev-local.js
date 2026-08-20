#!/usr/bin/env node
// Orbit Axis :: local development launcher (Update 4.0.2).
//
// Pins the database to the LOCAL Supabase stack before anything reads
// configuration, so `.env.local` (which holds the hosted project URL) cannot
// pull a development session onto production. The port comes from the tracked
// supabase/config.toml, so nobody copies port numbers between terminals.

import { localSupabaseUrl, LOCAL_ANON_KEY } from "../lib/env/environment.js";

// Pre-set values win over .env.local — see loadEnvLocal() in lib/local-llm/config.js.
process.env.ORBIT_ENVIRONMENT = "local";
process.env.SUPABASE_URL ||= localSupabaseUrl();
process.env.SUPABASE_ANON_KEY ||= LOCAL_ANON_KEY;
// A service-role key is never needed for ordinary local development.
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
// The Orbit X desk is on by default AGAINST THE LOCAL STACK ONLY (Dev Update
// 5.1): this launcher pins the database to local Supabase above, and the desk
// still requires a session plus an orbit_x_admins row in that local database.
// Production's flag stays where it lives — in Vercel's environment.
process.env.ORBIT_X_ENABLED ||= "true";

await import("../server.js");
