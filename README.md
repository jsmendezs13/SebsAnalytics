# sebsanalytics.com

The website of Seb's Analytics LLC: the home page, the demo calendar, the admin page (/admin) and the privacy page.

- Hosting: Vercel (Framework Preset "Other"). The functions are `api/demo.js` and `api/admin.js`.
- Database: Supabase, the `sa_` tables (SQL 1, "sa-1-demos.sql").
- Emails: Resend, from `demos@send.sebsanalytics.com`.
- Vercel settings (Environment Variables): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`.
- Fonts: Lora and Lato (SIL Open Font License, in `fonts/`), served from this site.
