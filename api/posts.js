const SUPABASE_URL = "https://vroxuvzbnzfelyndchyl.supabase.co";
const SUPABASE_KEY = "sb_publishable_EAh6WbHkV-FRnSx6SjRUgw_ev0JMnZH";

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const url = new URL(SUPABASE_URL + '/rest/v1/posts');
    url.search = new URLSearchParams({
      select: 'title,slug,excerpt,content,category,cover_image,images,published_at,created_at,social_url,social_platform',
      status: 'eq.published',
      order: 'published_at.desc.nullslast,created_at.desc'
    }).toString();

    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('Public posts query failed:', response.status, detail.slice(0, 500));
      return res.status(502).json({ error: 'Posts are temporarily unavailable' });
    }

    const posts = await response.json();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Public-Post-Count', String(posts.length));
    return res.status(200).json(posts);
  } catch (error) {
    console.error('Public posts endpoint failed:', error);
    return res.status(500).json({ error: 'Unable to load posts' });
  }
};
