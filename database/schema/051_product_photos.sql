-- Product photos only. Additive, forward-only successor to schema 050.
-- No financial table, historical migration, role assignment or activation changes.
do $$ begin
  if (select relowner from pg_class where oid='public.products'::regclass)
     <> (select oid from pg_roles where rolname=current_user) then
    raise exception 'PRODUCT_PHOTO_OWNER_PRECONDITION';
  end if;
  if to_regprocedure('api.recover_stock_adjustment(uuid,uuid)') is null then
    raise exception 'PRODUCT_PHOTO_REQUIRES_SCHEMA_050';
  end if;
end $$;

create table private.product_photo_assets (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  namespace text not null check (namespace ~ '^(development|test|production)/[a-z0-9][a-z0-9-]{2,47}$'),
  origin text not null check (origin ~ '^https://[a-z0-9]+[.]public[.]blob[.]vercel-storage[.]com$'),
  state text not null check (state in ('UPLOADING','READY','LIVE','RETIRED','DELETING','DELETED')),
  width integer not null check (width between 1 and 1280),
  height integer not null check (height between 1 and 1280),
  bytes integer not null check (bytes between 1 and 2000000),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  thumbnail_width integer not null check (thumbnail_width between 1 and 384),
  thumbnail_height integer not null check (thumbnail_height between 1 and 384),
  thumbnail_bytes integer not null check (thumbnail_bytes between 1 and 500000),
  thumbnail_sha256 text not null check (thumbnail_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  eligible_at timestamptz not null default clock_timestamp()+interval '24 hours',
  cleanup_token uuid,
  lease_until timestamptz,
  unique(product_id,id)
);
create unique index product_photo_one_live on private.product_photo_assets(product_id) where state='LIVE';
create index product_photo_cleanup_due on private.product_photo_assets(eligible_at) where state not in ('LIVE','DELETED');
create table private.product_photo_states (
  product_id uuid primary key references public.products(id) on delete restrict,
  revision integer not null default 0 check (revision>=0),
  asset_id uuid,
  foreign key(product_id,asset_id) references private.product_photo_assets(product_id,id) on delete restrict
);
create table private.product_photo_operations (
  request_id uuid primary key,
  product_id uuid not null references public.products(id) on delete restrict,
  actor_id uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
  terminal_id uuid not null references private.terminals(id) on delete restrict,
  kind text not null check (kind in ('UPLOAD','REMOVE','CLOSED')),
  state text not null check (state in ('UPLOADING','READY','SAVED','CANCELLED','CONFLICT')),
  expected_revision integer,
  saved_revision integer,
  asset_id uuid,
  proof text,
  reason text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '20 minutes',
  foreign key(product_id,asset_id) references private.product_photo_assets(product_id,id) on delete restrict
);
create index product_photo_operation_product on private.product_photo_operations(product_id,created_at);
create table private.product_photo_rate_limits (
  bucket text primary key,
  window_started timestamptz not null,
  attempts integer not null check (attempts between 1 and 60)
);
revoke all on private.product_photo_assets,private.product_photo_states,
  private.product_photo_operations,private.product_photo_rate_limits from public,campuspay_runtime;

-- Paths are generated from application namespace and database-generated asset IDs.
-- No filename, remote URL, object key or deletion target comes from the browser.
create function private.product_photo_descriptor(p_asset_id uuid) returns jsonb
language sql volatile set search_path = '' as $$
  select jsonb_build_object('asset_id',a.id,
    'url',a.origin||'/campuspay-products/'||a.namespace||'/'||a.product_id||'/'||a.id||'/display.webp',
    'thumbnail_url',a.origin||'/campuspay-products/'||a.namespace||'/'||a.product_id||'/'||a.id||'/thumbnail.webp',
    'width',a.width,'height',a.height,'thumbnail_width',a.thumbnail_width,'thumbnail_height',a.thumbnail_height,
    'content_type','image/webp') from private.product_photo_assets a where a.id=p_asset_id;
$$;
create function private.product_photo_snapshot(p_product_id uuid,p_request_id uuid) returns jsonb
language sql volatile set search_path = '' as $$
  select jsonb_build_object('product_id',p_product_id,'revision',coalesce(s.revision,0),
    'photo',private.product_photo_descriptor(s.asset_id),
    'operation',(select jsonb_build_object('request_id',o.request_id,'state',o.state,
      'saved_revision',o.saved_revision,
      'photo',case when o.state in ('READY','SAVED') then private.product_photo_descriptor(o.asset_id) end)
      from private.product_photo_operations o where o.request_id=p_request_id and o.product_id=p_product_id))
  from (select 1) seed left join private.product_photo_states s on s.product_id=p_product_id;
$$;
create function private.product_photo_rate(p_actor_id uuid) returns void
language plpgsql set search_path = '' as $$
declare b text; maximum integer; n integer;
begin
  foreach b in array array['global',p_actor_id::text] loop
    maximum:=case when b='global' then 60 else 12 end;
    insert into private.product_photo_rate_limits(bucket,window_started,attempts)
      values(b,clock_timestamp(),1)
      on conflict(bucket) do update set
        attempts=case when private.product_photo_rate_limits.window_started<clock_timestamp()-interval '1 minute' then 1 else private.product_photo_rate_limits.attempts+1 end,
        window_started=case when private.product_photo_rate_limits.window_started<clock_timestamp()-interval '1 minute' then clock_timestamp() else private.product_photo_rate_limits.window_started end
      where private.product_photo_rate_limits.window_started<clock_timestamp()-interval '1 minute'
         or private.product_photo_rate_limits.attempts<maximum
      returning attempts into n;
    if not found then raise exception 'RATE_LIMITED'; end if;
  end loop;
end $$;

-- All state transitions take the same product lock, after the established staff
-- administration/session locks. The RPC cannot accept storage deletion targets.
create function api.product_photo_command(
  p_session_id uuid,p_product_id uuid,p_request_id uuid,p_action text,p_payload jsonb
) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; p public.products; current_photo private.product_photo_states;
  op private.product_photo_operations; a private.product_photo_assets; expected integer; proof text;
  image jsonb; image_name text; allowed text[]; old_asset uuid; fresh boolean:=false;
begin
  if p_product_id is null or p_action is null or p_action not in ('READ','RATE','RESERVE','READY','COMMIT','CANCEL','REMOVE')
    or jsonb_typeof(p_payload) is distinct from 'object'
    or (p_action not in ('READ','RATE') and p_request_id is null) then raise exception 'BAD_REQUEST'; end if;
  allowed:=case p_action when 'RESERVE' then array['revision','reason','namespace','origin','display','thumbnail']
    when 'REMOVE' then array['revision','reason'] else array[]::text[] end;
  if exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(allowed)) then raise exception 'BAD_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0));
  s:=private.assert_session(p_session_id,'inventory.product.manage');
  select * into p from public.products where id=p_product_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into private.product_photo_states(product_id) values(p.id) on conflict do nothing;
  select * into current_photo from private.product_photo_states where product_id=p.id for update;
  if p_request_id is not null then
    -- Also serialize identical keys aimed at different products.
    perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,40501));
    select * into op from private.product_photo_operations where request_id=p_request_id;
    if found and (op.product_id<>p.id or op.actor_id<>s.auth_user_id or op.terminal_id<>s.terminal_id) then raise exception 'FORBIDDEN'; end if;
  end if;
  if p_action='RATE' then
    perform private.product_photo_rate(s.auth_user_id);
  elsif p_action in ('RESERVE','REMOVE') then
    if jsonb_typeof(p_payload->'revision') is distinct from 'number' or p_payload->>'revision' !~ '^[0-9]+$'
      or (p_payload->>'revision')::numeric not between 0 and 2147483646
      or jsonb_typeof(p_payload->'reason') is distinct from 'string'
      or length(btrim(p_payload->>'reason')) not between 10 and 500 or p_payload->>'reason' ~ '[[:cntrl:]]'
      then raise exception 'BAD_REQUEST'; end if;
    expected:=(p_payload->>'revision')::integer;
    proof:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
    if op.request_id is not null then
      if op.state<>'CANCELLED' and (op.kind<>case when p_action='REMOVE' then 'REMOVE' else 'UPLOAD' end or op.proof is distinct from proof)
        then raise exception 'CONFLICT'; end if;
    else
      if p_action='RESERVE' and not p.active then raise exception 'CONFLICT'; end if;
      if p_action='RESERVE' then
        if jsonb_typeof(p_payload->'namespace') is distinct from 'string' or p_payload->>'namespace' !~ '^(development|test|production)/[a-z0-9][a-z0-9-]{2,47}$'
          or jsonb_typeof(p_payload->'origin') is distinct from 'string' or p_payload->>'origin' !~ '^https://[a-z0-9]+[.]public[.]blob[.]vercel-storage[.]com$'
          then raise exception 'BAD_REQUEST'; end if;
        foreach image_name in array array['display','thumbnail'] loop
          image:=p_payload->image_name;
          if jsonb_typeof(image) is distinct from 'object' or exists(select 1 from jsonb_object_keys(image) k where k<>all(array['width','height','bytes','sha256']))
            or jsonb_typeof(image->'width') is distinct from 'number' or image->>'width' !~ '^[0-9]+$'
            or jsonb_typeof(image->'height') is distinct from 'number' or image->>'height' !~ '^[0-9]+$'
            or jsonb_typeof(image->'bytes') is distinct from 'number' or image->>'bytes' !~ '^[0-9]+$'
            or (image->>'width')::numeric not between 1 and case when image_name='display' then 1280 else 384 end
            or (image->>'height')::numeric not between 1 and case when image_name='display' then 1280 else 384 end
            or (image->>'bytes')::numeric not between 1 and case when image_name='display' then 2000000 else 500000 end
            or jsonb_typeof(image->'sha256') is distinct from 'string' or image->>'sha256' !~ '^[a-f0-9]{64}$'
            then raise exception 'BAD_REQUEST'; end if;
        end loop;
      end if;
      insert into private.product_photo_operations(request_id,product_id,actor_id,terminal_id,kind,state,expected_revision,proof,reason)
        values(p_request_id,p.id,s.auth_user_id,s.terminal_id,case when p_action='REMOVE' then 'REMOVE' else 'UPLOAD' end,
          case when expected<>current_photo.revision then 'CONFLICT' when p_action='REMOVE' then 'SAVED' else 'UPLOADING' end,
          expected,proof,btrim(p_payload->>'reason')) returning * into op;
      if op.state<>'CONFLICT' and p_action='RESERVE' then
        if (select count(*) from private.product_photo_assets where product_id=p.id and state in ('UPLOADING','READY'))>=3
          or (select count(*) from private.product_photo_assets where state not in ('LIVE','DELETED'))>=500 then raise exception 'RATE_LIMITED'; end if;
        insert into private.product_photo_assets(product_id,namespace,origin,state,width,height,bytes,sha256,
          thumbnail_width,thumbnail_height,thumbnail_bytes,thumbnail_sha256)
          values(p.id,p_payload->>'namespace',p_payload->>'origin','UPLOADING',
            (p_payload#>>'{display,width}')::integer,(p_payload#>>'{display,height}')::integer,(p_payload#>>'{display,bytes}')::integer,p_payload#>>'{display,sha256}',
            (p_payload#>>'{thumbnail,width}')::integer,(p_payload#>>'{thumbnail,height}')::integer,(p_payload#>>'{thumbnail,bytes}')::integer,p_payload#>>'{thumbnail,sha256}') returning * into a;
        update private.product_photo_operations set asset_id=a.id where request_id=op.request_id;
        fresh:=true;
      elsif op.state='SAVED' then
        old_asset:=current_photo.asset_id;
        update private.product_photo_states set asset_id=null,revision=revision+1 where product_id=p.id;
        update private.product_photo_operations set saved_revision=current_photo.revision+1 where request_id=op.request_id;
        update private.product_photo_assets set state='RETIRED',eligible_at=clock_timestamp()+interval '24 hours' where id=old_asset;
        insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
          values('PRODUCT_PHOTO_REMOVED',s.auth_user_id,s.id,'PRODUCT',p.id,'PHOTO-'||op.request_id,
            jsonb_build_object('request_id',op.request_id,'previous_asset_id',old_asset,'revision',current_photo.revision+1,'reason',op.reason));
      end if;
    end if;
  elsif p_action='CANCEL' then
    if op.request_id is null then
      insert into private.product_photo_operations(request_id,product_id,actor_id,terminal_id,kind,state)
        values(p_request_id,p.id,s.auth_user_id,s.terminal_id,'CLOSED','CANCELLED');
    elsif op.state in ('UPLOADING','READY') then
      update private.product_photo_operations set state='CANCELLED' where request_id=op.request_id;
      update private.product_photo_assets set state='RETIRED',eligible_at=clock_timestamp()+interval '24 hours' where id=op.asset_id and state in ('UPLOADING','READY');
    end if;
  elsif p_action in ('READY','COMMIT') then
    if op.request_id is null then raise exception 'NOT_FOUND'; end if;
    select * into a from private.product_photo_assets where id=op.asset_id for update;
    if op.state in ('UPLOADING','READY') and (op.expires_at<=clock_timestamp() or not p.active) then
      update private.product_photo_operations set state='CANCELLED' where request_id=op.request_id;
      update private.product_photo_assets set state='RETIRED',eligible_at=clock_timestamp()+interval '24 hours' where id=a.id and state in ('UPLOADING','READY');
    elsif p_action='READY' and op.state='UPLOADING' and a.state='UPLOADING' then
      update private.product_photo_operations set state='READY' where request_id=op.request_id;
      update private.product_photo_assets set state='READY' where id=a.id;
    elsif p_action='COMMIT' and op.state='READY' and a.state='READY' then
      if op.expected_revision<>current_photo.revision then
        update private.product_photo_operations set state='CONFLICT' where request_id=op.request_id;
        update private.product_photo_assets set state='RETIRED',eligible_at=clock_timestamp()+interval '24 hours' where id=a.id;
      else
        old_asset:=current_photo.asset_id;
        update private.product_photo_assets set state='RETIRED',eligible_at=clock_timestamp()+interval '24 hours' where id=old_asset;
        update private.product_photo_assets set state='LIVE' where id=a.id;
        update private.product_photo_states set asset_id=a.id,revision=revision+1 where product_id=p.id;
        update private.product_photo_operations set state='SAVED',saved_revision=current_photo.revision+1 where request_id=op.request_id;
        insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
          values('PRODUCT_PHOTO_SAVED',s.auth_user_id,s.id,'PRODUCT',p.id,'PHOTO-'||op.request_id,
            jsonb_build_object('request_id',op.request_id,'previous_asset_id',old_asset,'asset_id',a.id,'revision',current_photo.revision+1,'reason',op.reason));
      end if;
    end if;
  end if;
  return query select private.product_photo_snapshot(p.id,p_request_id)||jsonb_build_object('created',fresh,
    'upload',case when fresh then jsonb_build_object('asset_id',a.id,'namespace',a.namespace,'origin',a.origin) end);
end $$;

-- Separate session arguments prevent a store customer from presenting staff IDs.
-- No unauthenticated catalog, students or financial data is exposed here.
create function api.product_photo_catalog(p_session_id uuid,p_customer_session_id uuid,p_product_ids uuid[])
returns table(product_id uuid,photo jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  if (p_session_id is null)=(p_customer_session_id is null) or p_product_ids is null or cardinality(p_product_ids)>5000 then raise exception 'BAD_REQUEST'; end if;
  if p_session_id is not null then perform private.assert_session_any(p_session_id,array['pos.read','inventory.read']);
  else perform private.assert_customer_session(p_customer_session_id); end if;
  return query select s.product_id,private.product_photo_descriptor(s.asset_id)
    from private.product_photo_states s join public.products p on p.id=s.product_id and p.active
    join private.product_photo_assets a on a.id=s.asset_id and a.state='LIVE'
    where s.product_id=any(p_product_ids);
end $$;

-- Explicit, bounded operator cleanup. No scheduler and no caller-provided paths.
-- A 24-hour grace period exceeds the 60-second producer lifetime. Claiming is
-- irreversible: DELETING can never become a current photo, even after lease loss.
create function api.product_photo_cleanup(p_session_id uuid,p_namespace text,p_origin text,p_asset_id uuid,p_token uuid)
returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; a private.product_photo_assets; candidate uuid; product uuid; output jsonb:='[]'::jsonb; token uuid;
begin
  if p_namespace is null or p_namespace !~ '^(development|test|production)/[a-z0-9][a-z0-9-]{2,47}$'
    or p_origin is null or p_origin !~ '^https://[a-z0-9]+[.]public[.]blob[.]vercel-storage[.]com$'
    or (p_asset_id is null)<>(p_token is null) then raise exception 'BAD_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0));
  s:=private.assert_session(p_session_id,'inventory.product.manage');
  if p_asset_id is not null then
    select product_id into product from private.product_photo_assets where id=p_asset_id;
    perform 1 from public.products where id=product for update;
    select * into a from private.product_photo_assets where id=p_asset_id for update;
    if not found or a.namespace<>p_namespace or a.origin<>p_origin or a.state<>'DELETING' or a.cleanup_token is distinct from p_token
      or exists(select 1 from private.product_photo_states where asset_id=a.id) then raise exception 'CONFLICT'; end if;
    update private.product_photo_assets set state='DELETED',lease_until=null where id=a.id;
    insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
      values('PRODUCT_PHOTO_OBJECTS_RETIRED',s.auth_user_id,s.id,'PRODUCT',a.product_id,'PHOTO-GC-'||a.id,jsonb_build_object('asset_id',a.id));
  else
    perform private.product_photo_rate(s.auth_user_id);
    for candidate,product in select id,product_id from private.product_photo_assets
      where namespace=p_namespace and origin=p_origin and state not in ('LIVE','DELETED')
        and eligible_at<clock_timestamp() and (lease_until is null or lease_until<clock_timestamp())
      order by eligible_at,id limit 5 loop
      perform 1 from public.products where id=product for update;
      select * into a from private.product_photo_assets where id=candidate for update;
      if a.state in ('LIVE','DELETED') or a.eligible_at>=clock_timestamp() or a.lease_until>clock_timestamp()
        or exists(select 1 from private.product_photo_states where asset_id=a.id) then continue; end if;
      token:=gen_random_uuid();
      update private.product_photo_assets set state='DELETING',cleanup_token=token,lease_until=clock_timestamp()+interval '5 minutes' where id=a.id;
      update private.product_photo_operations set state='CANCELLED' where asset_id=a.id and state in ('UPLOADING','READY');
      output:=output||jsonb_build_array(jsonb_build_object('asset_id',a.id,'product_id',a.product_id,'namespace',a.namespace,'origin',a.origin,'token',token));
    end loop;
  end if;
  return query select jsonb_build_object('objects',output);
end $$;

revoke all on function private.product_photo_descriptor(uuid),private.product_photo_snapshot(uuid,uuid),private.product_photo_rate(uuid) from public,campuspay_runtime;
revoke all on function api.product_photo_command(uuid,uuid,uuid,text,jsonb),api.product_photo_catalog(uuid,uuid,uuid[]),api.product_photo_cleanup(uuid,text,text,uuid,uuid) from public,campuspay_runtime;
grant execute on function api.product_photo_command(uuid,uuid,uuid,text,jsonb),api.product_photo_catalog(uuid,uuid,uuid[]),api.product_photo_cleanup(uuid,text,text,uuid,uuid) to campuspay_runtime;

-- Fail closed on unexpected owner/default-ACL grants; never silently bless a new
-- grantee. Existing object ownership/default privileges are not modified.
do $$ declare r record; owner_id oid:=(select oid from pg_roles where rolname=current_user); runtime_id oid:=(select oid from pg_roles where rolname='campuspay_runtime');
begin
  for r in select c.relowner,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname in ('product_photo_assets','product_photo_states','product_photo_operations','product_photo_rate_limits') loop
    if r.relowner<>owner_id or exists(select 1 from aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) a where a.grantee<>owner_id)
      then raise exception 'PRODUCT_PHOTO_TABLE_ACL_PRECONDITION'; end if;
  end loop;
  for r in select p.proowner,p.proacl,p.prosecdef,p.proconfig,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('api','private') and p.proname in ('product_photo_descriptor','product_photo_snapshot','product_photo_rate','product_photo_command','product_photo_catalog','product_photo_cleanup') loop
    if r.proowner<>owner_id or r.proconfig is distinct from array['search_path=""']
      or ((r.nspname='api') is distinct from r.prosecdef)
      or exists(select 1 from aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) a
        where a.grantee<>owner_id and not(r.nspname='api' and a.grantee=runtime_id and a.privilege_type='EXECUTE' and not a.is_grantable))
      then raise exception 'PRODUCT_PHOTO_FUNCTION_ACL_PRECONDITION'; end if;
  end loop;
end $$;
