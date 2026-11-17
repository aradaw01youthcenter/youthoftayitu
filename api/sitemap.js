const SUPABASE_URL = "https://vroxuvzbnzfelyndchyl.supabase.co";
const SUPABASE_KEY = "sb_publishable_EAh6WbHkV-FRnSx6SjRUgw_ev0JMnZH";
const SITE_URL = "https://youthoftayitu.vercel.app";

const escapeXml = value => String(value ?? "").replace(/[<>&"']/g, char => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
}[char]));

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).send("Method not allowed");
  }

  const urls = [
    { loc: SITE_URL + "/", changefreq: "weekly", priority: "1.0" },
    { loc: SITE_URL + "/posts/", changefreq: "daily", priority: "0.9" },
    { loc: SITE_URL + "/for-youth/", changefreq: "weekly", priority: "0.9" },
  ];

  try {
    const endpoint = new URL(SUPABASE_URL + "/rest/v1/posts");
    endpoint.search = new URLSearchParams({
      select: "slug,published_at",
      status: "eq.published",
      order: "published_at.desc",
      limit: "5000",
    }).toString();
    const response = await fetch(endpoint, {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
    });
    if (!response.ok) throw new Error("Published post sitemap query failed");
    const posts = await response.json();
    for (const post of posts) {
      if (!post.slug) continue;
      urls.push({
        loc: SITE_URL + "/posts/" + encodeURIComponent(post.slug),
        changefreq: "monthly",
        priority: "0.7",
        lastmod: post.published_at,
      });
    }
  } catch (error) {
    console.error("Dynamic sitemap could not load published posts:", error);
  }

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(item => {
      const lastmod = item.lastmod && !Number.isNaN(Date.parse(item.lastmod))
        ? '<lastmod>' + new Date(item.lastmod).toISOString() + '</lastmod>' : "";
      return "  <url><loc>" + escapeXml(item.loc) + "</loc>" + lastmod +
        "<changefreq>" + item.changefreq + "</changefreq><priority>" + item.priority +
        "</priority></url>";
    }).join("\n") +
    "\n</urlset>";

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(xml);
};
