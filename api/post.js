const SUPABASE_URL = "https://vroxuvzbnzfelyndchyl.supabase.co";
const SUPABASE_KEY = "sb_publishable_EAh6WbHkV-FRnSx6SjRUgw_ev0JMnZH";
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const socialEmbed = (platform, rawUrl) => {
  if (!rawUrl) return '';
  let u;
  try { u = new URL(rawUrl); } catch { return ''; }
  if (u.protocol !== 'https:') return '';
  const host = u.hostname.toLowerCase().replace(/^www\\./, '');
  let src = '';
  if (platform === 'youtube' || host === 'youtu.be' || host.endsWith('youtube.com')) {
    const id = host === 'youtu.be' ? u.pathname.split('/').filter(Boolean)[0] : (u.searchParams.get('v') || u.pathname.match(/\\/(?:shorts|embed)\\/([^/?]+)/)?.[1]);
    if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) src = 'https://www.youtube-nocookie.com/embed/' + id;
  } else if (platform === 'instagram' || host.endsWith('instagram.com')) {
    const m = u.pathname.match(/^\\/(p|reel|tv)\\/([A-Za-z0-9_-]+)/);
    if (m) src = 'https://www.instagram.com/' + m[1] + '/' + m[2] + '/embed/';
  } else if (platform === 'facebook' || host.endsWith('facebook.com') || host === 'fb.watch') {
    src = 'https://www.facebook.com/plugins/post.php?href=' + encodeURIComponent(u.href) + '&show_text=true&width=550';
  } else if (platform === 'tiktok' || host.endsWith('tiktok.com')) {
    const m = u.pathname.match(/\\/video\\/(\\d+)/);
    if (m) src = 'https://www.tiktok.com/embed/v2/' + m[1];
  }
  if (!src) return '<p class="social-source"><a href="' + esc(u.href) + '" target="_blank" rel="noopener noreferrer">View original ' + esc(platform || 'social media') + ' post ↗</a></p>';
  return '<section class="social-embed" aria-label="Embedded social media post"><iframe src="' + esc(src) + '" title="Social media post" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe><p class="social-source"><a href="' + esc(u.href) + '" target="_blank" rel="noopener noreferrer">Open original post ↗</a></p></section>';
};

module.exports = async (req, res) => {
  const slug = String(req.query.slug || '').trim();
  if (!slug || slug.length > 180) return res.status(404).send('Not found');
  try {
    const url = new URL(SUPABASE_URL + '/rest/v1/posts');
    url.search = new URLSearchParams({select:'title,slug,excerpt,content,category,cover_image,images,published_at,social_url,social_platform',slug:'eq.'+slug,status:'eq.published',limit:'1'}).toString();
    const response = await fetch(url, {headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY}});
    if (!response.ok) throw new Error('Post lookup failed');
    const rows = await response.json();
    if (!rows.length) return res.status(404).setHeader('Cache-Control','public, s-maxage=60').send('Post not found');
    const p = rows[0], gallery = Array.isArray(p.images) && p.images.length ? p.images : (p.cover_image ? [p.cover_image] : []);
    const title = esc(p.title), description = esc(p.excerpt || p.content.slice(0,155));
    const canonical = 'https://youthoftayitu.vercel.app/posts/' + encodeURIComponent(p.slug);
    const imageTags = gallery.map((src,i)=>'<img class="gallery-image" loading="lazy" src="'+esc(src)+'" alt="'+title+' - photo '+(i+1)+'">').join('');
    const article = {'@context':'https://schema.org','@type':'Article','headline':p.title,'description':p.excerpt || p.content.slice(0,200),'datePublished':p.published_at,'image':gallery,'articleSection':p.category,'mainEntityOfPage':canonical,'publisher':{'@type':'Organization','name':'Arada Woreda 1 Youth Personal Development Center'}};
    const body = esc(p.content).replace(/\r?\n/g,'<br>');
    const html = '<!doctype html><html lang="am"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' | Youth of Tayitu</title><meta name="description" content="'+description+'"><meta name="robots" content="index,follow"><link rel="canonical" href="'+canonical+'"><meta property="og:type" content="article"><meta property="og:title" content="'+title+'"><meta property="og:description" content="'+description+'">'+(gallery[0]?'<meta property="og:image" content="'+esc(gallery[0])+'">':'')+'<script type="application/ld+json">'+JSON.stringify(article).replace(/</g,'\\u003c')+'</scr'+'ipt><style>*{box-sizing:border-box}body{margin:0;font:17px/1.8 Arial,sans-serif;color:#172033;background:#f6f8fb}header{background:#102d50;color:#fff;padding:22px max(5vw,20px)}a{color:inherit}main{max-width:900px;margin:42px auto;padding:0 20px}.article{background:#fff;padding:clamp(22px,5vw,48px);border-radius:14px;box-shadow:0 5px 22px #14213d10}h1{font-size:clamp(30px,5vw,46px);line-height:1.2;margin:0 0 12px}.date{color:#6b7280;font-size:14px;margin-bottom:10px}.category{display:inline-block;background:#eaf2fb;color:#164c80;padding:4px 10px;border-radius:20px;font-size:13px;margin:8px 0 20px}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:18px 0 28px}.gallery-image{width:100%;height:260px;object-fit:cover;border-radius:10px}.content{overflow-wrap:anywhere}.social-embed{margin:28px 0;padding:16px;background:#f7f9fc;border:1px solid #e3e9f1;border-radius:14px}.social-embed iframe{display:block;width:100%;max-width:550px;height:620px;margin:auto;border:0;border-radius:10px;background:#fff}.social-source{text-align:center;font-size:14px;margin:12px 0 0}.social-source a{color:#0758a5;font-weight:700}footer{text-align:center;padding:30px;color:#778196}</style></head><body><header><a href="/posts/">← ወደ ሁሉም ጽሑፎች</a></header><main><article class="article"><h1>'+title+'</h1><div class="date">'+(p.published_at?new Date(p.published_at).toLocaleDateString():'')+'</div><div class="category">'+esc(p.category||'')+'</div>'+(gallery.length?'<div class="gallery">'+imageTags+'</div>':'')+'<div class="content">'+body+'</div>'+socialEmbed(p.social_platform,p.social_url)+'</article></main><footer>Arada Woreda 1 Youth Personal Development Center</footer></body></html>';
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(html);
  } catch (error) { return res.status(500).send('Unable to load this post right now.'); }
};