// src/lib/supabaseAdmin.ts
import * as dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// This client has full access (service role). Use only on backend.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
