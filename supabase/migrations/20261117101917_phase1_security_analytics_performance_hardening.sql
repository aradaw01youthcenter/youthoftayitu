-- Keep role checks out of the exposed Data API schema.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_site_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = (SELECT auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_site_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = (SELECT auth.uid()) AND role = 'owner'
  );
$function$;

REVOKE ALL ON FUNCTION private.is_site_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_site_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_site_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_site_owner() TO authenticated, service_role;

DO $$
DECLARE p record; stmt text; q text; wc text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE COALESCE(qual, '') ILIKE '%is_site_admin()%'
       OR COALESCE(with_check, '') ILIKE '%is_site_admin()%'
  LOOP
    q := CASE WHEN p.qual IS NULL THEN NULL ELSE replace(p.qual, 'is_site_admin()', 'private.is_site_admin()') END;
    wc := CASE WHEN p.with_check IS NULL THEN NULL ELSE replace(p.with_check, 'is_site_admin()', 'private.is_site_admin()') END;
    stmt := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF q IS NOT NULL THEN stmt := stmt || format(' USING (%s)', q); END IF;
    IF wc IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', wc); END IF;
    EXECUTE stmt;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.is_site_admin();

ALTER POLICY "Admin can insert site content"
  ON public.site_content WITH CHECK ((SELECT private.is_site_owner()));
ALTER POLICY "Admin can update site content"
  ON public.site_content
  USING ((SELECT private.is_site_owner()))
  WITH CHECK ((SELECT private.is_site_owner()));
ALTER POLICY "Admin can delete site content"
  ON public.site_content USING ((SELECT private.is_site_owner()));

ALTER POLICY "Admins can upload post images"
  ON storage.objects WITH CHECK (
    bucket_id = 'post-images' AND (SELECT private.is_site_admin())
    AND ((storage.foldername(name))[1] IS DISTINCT FROM 'homepage' OR (SELECT private.is_site_owner()))
  );
ALTER POLICY "Admins can update post images"
  ON storage.objects
  USING (
    bucket_id = 'post-images' AND (SELECT private.is_site_admin())
    AND ((storage.foldername(name))[1] IS DISTINCT FROM 'homepage' OR (SELECT private.is_site_owner()))
  )
  WITH CHECK (
    bucket_id = 'post-images' AND (SELECT private.is_site_admin())
    AND ((storage.foldername(name))[1] IS DISTINCT FROM 'homepage' OR (SELECT private.is_site_owner()))
  );
ALTER POLICY "Admins can delete post images"
  ON storage.objects USING (
    bucket_id = 'post-images' AND (SELECT private.is_site_admin())
    AND ((storage.foldername(name))[1] IS DISTINCT FROM 'homepage' OR (SELECT private.is_site_owner()))
  );

DROP POLICY IF EXISTS "Visitors can record active portal clicks" ON public.youth_portal_click_events;
CREATE POLICY "Public visitors can record public portal events"
  ON public.youth_portal_click_events FOR INSERT TO anon, authenticated
  WITH CHECK (
    source = 'public' AND event_type IN ('click', 'impression')
    AND EXISTS (
      SELECT 1 FROM public.youth_links l
      WHERE l.id = youth_portal_click_events.link_id AND l.is_active = true
    )
  );
CREATE POLICY "Site admins can record admin preview clicks"
  ON public.youth_portal_click_events FOR INSERT TO authenticated
  WITH CHECK (
    source = 'admin' AND event_type = 'click'
    AND (SELECT private.is_site_admin())
    AND EXISTS (
      SELECT 1 FROM public.youth_links l
      WHERE l.id = youth_portal_click_events.link_id AND l.is_active = true
    )
  );
ALTER POLICY "Site admins can read portal click analytics"
  ON public.youth_portal_click_events USING ((SELECT private.is_site_admin()));

REVOKE ALL ON TABLE public.youth_portal_click_events FROM anon, authenticated;
GRANT INSERT ON TABLE public.youth_portal_click_events TO anon, authenticated;
GRANT SELECT ON TABLE public.youth_portal_click_events TO authenticated;

DROP POLICY IF EXISTS "Admins can view all youth links" ON public.youth_links;
DROP POLICY IF EXISTS "Public can view active youth links" ON public.youth_links;
CREATE POLICY "Public can view active youth links"
  ON public.youth_links FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "Authenticated users can view active and admin youth links"
  ON public.youth_links FOR SELECT TO authenticated
  USING (is_active = true OR (SELECT private.is_site_admin()));

ALTER POLICY "Admins can record their own activity"
  ON public.admin_activity_logs
  WITH CHECK (
    actor_user_id = (SELECT auth.uid())
    AND actor_email = COALESCE((SELECT auth.jwt()) ->> 'email', '')
    AND (SELECT private.is_site_admin())
  );
ALTER POLICY "Only owner can view activity logs"
  ON public.admin_activity_logs USING ((SELECT private.is_site_owner()));
ALTER POLICY "Admins can manage youth portal suggestions"
  ON public.youth_portal_suggestions
  USING ((SELECT private.is_site_admin()))
  WITH CHECK ((SELECT private.is_site_admin()));
ALTER POLICY "Read published posts or admin drafts"
  ON public.posts
  USING (
    status = 'published'
    OR ((SELECT auth.uid()) IS NOT NULL AND (SELECT private.is_site_admin()))
  );

CREATE INDEX IF NOT EXISTS youth_links_created_by_idx ON public.youth_links (created_by);
CREATE INDEX IF NOT EXISTS facebook_connections_connected_by_idx ON private.facebook_connections (connected_by);
CREATE INDEX IF NOT EXISTS facebook_oauth_states_user_id_idx ON private.facebook_oauth_states (user_id);
CREATE INDEX IF NOT EXISTS youth_portal_events_source_type_clicked_idx
  ON public.youth_portal_click_events (source, event_type, clicked_at DESC);
