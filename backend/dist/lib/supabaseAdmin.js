"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseAdmin = void 0;
// src/lib/supabaseAdmin.ts
const supabase_js_1 = require("@supabase/supabase-js");
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// This client has full access (service role). Use only on backend.
exports.supabaseAdmin = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceRoleKey);
