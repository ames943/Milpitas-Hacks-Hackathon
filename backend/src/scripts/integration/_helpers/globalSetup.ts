import 'dotenv/config';

export default async function globalSetup() {
  // Load env vars. Integration tests require SUPABASE_URL and SUPABASE_SERVICE_KEY.
  // If these are missing, individual tests will fail when Supabase calls are made.
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn(
      `[integration] WARNING: Missing env vars: ${missing.join(', ')}. ` +
      'Create backend/.env from .env.example. Integration tests will fail.',
    );
  }
}
