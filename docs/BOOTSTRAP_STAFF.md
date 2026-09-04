# Staff bootstrap

The UI shows only employee code and PIN. Internally, Supabase Auth uses a deterministic email:

```text
<lowercase employee code>@<STAFF_AUTH_EMAIL_DOMAIN>
```

Example:

```text
Employee code: 1001
Auth email: 1001@campuspay.internal
```

Create the Auth user in the Supabase dashboard or an isolated administrator script, then insert the corresponding `public.staff_profiles` row using the Auth user UUID. Never place a PIN in seed SQL, source control, staff metadata, or application logs.

After the first super administrator exists, staff lifecycle should move behind a protected super-admin API.
