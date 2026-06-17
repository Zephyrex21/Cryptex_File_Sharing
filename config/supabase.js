import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

// Using the service_role key (NOT anon key) so server-side uploads
// bypass Supabase Row Level Security completely. Never expose this key
// to the browser — it lives only in your .env on the server.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default supabase;
