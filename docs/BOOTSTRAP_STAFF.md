# Staff bootstrap

Staff accounts live in `public.staff_profiles`; slow hashes of HMAC PIN proofs live in `private.staff_credentials`.

To create the initial super administrator, generate the PIN proof with the same `STAFF_PIN_PEPPER` used by the app, then insert it with:

```sql
with staff as (
  insert into public.staff_profiles(employee_code, display_name, role)
  values ('9001', 'Super Administrator', 'super_admin')
  returning auth_user_id
)
insert into private.staff_credentials(staff_user_id, pin_hash)
select auth_user_id, extensions.crypt('<64-character PIN proof>', extensions.gen_salt('bf', 12))
from staff;
```

Never put raw PINs or production PIN proofs in migrations, repository files, logs, or audit payloads. Staff lifecycle should be moved behind a protected super-admin API after the initial bootstrap.

## One-command demo bootstrap

After `.env.local` is present and dependencies are installed, run:

```bash
npm run db:bootstrap-demo
```

The database function accepts only HMAC proofs, not raw PINs, and permanently refuses to run after any staff credential has been created. It creates four demonstration staff roles, one demonstration student wallet/card, five inventory-backed products, and the `WELCOME10` coupon.
