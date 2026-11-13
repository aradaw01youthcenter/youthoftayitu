// Privacy-friendly anonymous page-view counter. No cookies, IP addresses or user-agent data are collected.
(() => {
  if (window.__ytPageViewRecorded) return;
  window.__ytPageViewRecorded = true;
  const projectUrl = 'https://vroxuvzbnzfelyndchyl.supabase.co';
  const publishableKey = 'sb_publishable_EAh6WbHkV-FRnSx6SjRUgw_ev0JMnZH';
  let referrerHost = null;
  try { referrerHost = document.referrer ? new URL(document.referrer).hostname.slice(0,255) : null; } catch {}
  fetch(projectUrl + '/rest/v1/site_page_views', {
    method: 'POST',
    mode: 'cors',
    headers: {
      apikey: publishableKey,
      Authorization: 'Bearer ' + publishableKey,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ page_path: location.pathname.slice(0,300) || '/', referrer_host: referrerHost }),
    keepalive: true
  }).catch(() => {});
})();