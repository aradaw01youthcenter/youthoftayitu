REVOKE INSERT ON TABLE public.youth_portal_click_events FROM anon, authenticated;
GRANT INSERT (link_id, source, event_type)
  ON TABLE public.youth_portal_click_events TO anon, authenticated;
