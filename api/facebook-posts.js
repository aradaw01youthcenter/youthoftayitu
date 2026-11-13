// Facebook Page feed proxy. Keep the Page access token in Vercel environment variables;
// never put it in browser JavaScript or commit it to the repository.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) {
    return res.status(503).json({ error: 'Facebook feed is not configured yet.' });
  }
  try {
    const pageId = '61596388683640';
    const graphUrl = new URL('https://graph.facebook.com/v27.0/' + pageId + '/feed');
    graphUrl.searchParams.set('fields', 'id,message,story,created_time,permalink_url,full_picture,attachments{media{image{src}}}');
    graphUrl.searchParams.set('limit', '6');
    graphUrl.searchParams.set('access_token', token);
    const response = await fetch(graphUrl);
    const data = await response.json();
    if (!response.ok) {
      return res.status(502).json({ error: 'Meta could not return the Page posts.' });
    }
    return res.status(200).json({ data: data.data || [] });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load Facebook posts.' });
  }
};
