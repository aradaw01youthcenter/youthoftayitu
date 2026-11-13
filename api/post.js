const SUPABASE_URL = "https://vroxuvzbnzfelyndchyl.supabase.co";
const SUPABASE_KEY = "sb_publishable_EAh6WbHkV-FRnSx6SjRUgw_ev0JMnZH";
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
module.exports = async (req, res) => {
  const slug = String(req.query.slug || '').trim();
  if (!slug || slug.length > 180) return res.status(404).send('Not found');
  try {
    const url = new URL(SUPABASE_URL + '/rest/v1/posts');
    url.search = new URLSearchParams({select:'title,slug,excerpt,content,cover_image,published_at',slug:'eq.'+slug,status:'eq.published',limit:'1'}).toString();
    const response = await fetch(url, {headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY}});
    if (!response.ok) throw new Error('Post lookup failed');
    const rows = await response.json();
    if (!rows.length) return res.status(404).setHeader('Cache-Control','public, s-maxage=60').send('Post not found');
    const p = rows[0];
    const title = esc(p.title);
    const description = esc(p.excerpt || p.content.slice(0,155));
    const canonical = 'https://youthoftayitu.vercel.app/posts/' + encodeURIComponent(p.slug);
    const image = p.cover_image ? '<meta property="og:image" content="'+esc(p.cover_image)+'">' : '';
    const article = {
      '@context':'https://schema.org','@type':'Article','headline':p.title,
      'description':p.excerpt || p.content.slice(0,200),'datePublished':p.published_at,
      'image':p.cover_image || undefined,'mainEntityOfPage':canonical,
      'publisher':{'@type':'Organization','name':'Arada Woreda 1 Youth Personal Development Center'}
    };
    const body = esc(p.content).replace(/\r?\n/g,'<br>');
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' | Youth of Tayitu</title><meta name="description" content="'+description+'"><meta name="robots" content="index,follow"><link rel="canonical" href="'+canonical+'"><meta property="og:type" content="article"><meta property="og:title" content="'+title+'"><meta property="og:description" content="'+description+'">'+image+'<script type="application/ld+json">'+JSON.stringify(article).replace(/</g,'\\u003c')+'</scr'+'ipt><style>*{box-sizing:border-box}body{margin:0;font:17px/1.8 Arial,sans-serif;color:#172033;background:#f6f8fb}header{background:#102d50;color:#fff;padding:22px max(5vw,20px)}a{color:inherit}main{max-width:850px;margin:42px auto;padding:0 20px}.article{background:#fff;padding:clamp(22px,5vw,48px);border-radius:14px;box-shadow:0 5px 22px #14213d10}h1{font-size:clamp(30px,5vw,46px);line-height:1.2;margin:0 0 12px}.date{color:#6b7280;font-size:14px;margin-bottom:24px}.cover{width:100%;max-height:440px;object-fit:cover;border-radius:10px;margin:10px 0 25px}.content{overflow-wrap:anywhere}footer{text-align:center;padding:30px;color:#778196}</style></head><body><header><a href="/posts/">← All posts</a></header><main><article class="article"><h1>'+title+'</h1><div class="date">'+(p.published_at?new Date(p.published_at).toLocaleDateString():'')+'</div>'+(p.cover_image?'<img class="cover" src="'+esc(p.cover_image)+'" alt="'+title+'">':'')+'<div class="content">'+body+'</div></article></main><footer>Arada Woreda 1 Youth Personal Development Center</footer></body></html>';
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send('Unable to load this post right now.');
  }
};