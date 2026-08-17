-- Public delivery bucket for user-approved KREVUNO listing media.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('krevuno-media','krevuno-media',true,26214400,array['image/jpeg','image/png','image/webp','video/mp4','video/webm','audio/webm','audio/mp4','audio/mpeg'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

do $$ begin
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='krevuno_media_insert_own') then
    create policy "krevuno_media_insert_own" on storage.objects for insert to authenticated
      with check(bucket_id='krevuno-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
  end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='krevuno_media_update_own') then
    create policy "krevuno_media_update_own" on storage.objects for update to authenticated
      using(bucket_id='krevuno-media' and owner_id=(select auth.uid())::text)
      with check(bucket_id='krevuno-media' and owner_id=(select auth.uid())::text);
  end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='krevuno_media_delete_own') then
    create policy "krevuno_media_delete_own" on storage.objects for delete to authenticated
      using(bucket_id='krevuno-media' and owner_id=(select auth.uid())::text);
  end if;
end $$;
