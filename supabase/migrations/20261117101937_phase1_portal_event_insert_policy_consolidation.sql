DROP POLICY IF EXISTS "Public visitors can record public portal events"
  ON public.youth_portal_click_events;
DROP POLICY IF EXISTS "Site admins can record admin preview clicks"
  ON public.youth_portal_click_events;

CREATE POLICY "Public visitors can record public portal events"
  ON public.youth_portal_click_events
  FOR INSERT TO anon
  WITH CHECK (
    source = 'public'
    AND event_type IN ('click', 'impression')
    AND EXISTS (
      SELECT 1 FROM public.youth_links l
      WHERE l.id = youth_portal_click_events.link_id AND l.is_active = true
    )
  );

CREATE POLICY "Authenticated visitors and admins can record portal events"
  ON public.youth_portal_click_events
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      source = 'public'
      AND event_type IN ('click', 'impression')
      AND EXISTS (
        SELECT 1 FROM public.youth_links l
        WHERE l.id = youth_portal_click_events.link_id AND l.is_active = true
      )
    )
    OR
    (
      source = 'admin'
      AND event_type = 'click'
      AND (SELECT private.is_site_admin())
      AND EXISTS (
        SELECT 1 FROM public.youth_links l
        WHERE l.id = youth_portal_click_events.link_id AND l.is_active = true
      )
    )
  );
