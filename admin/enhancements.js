/* Youth of Tayitu admin enhancements — loaded after the core dashboard */
(() => {
  const h = (v) => escapeHtml(v ?? '');
  const isOwner = () => currentUser?.email?.toLowerCase() === 'aradaw01youthcenter@gmail.com';
  const saveLog = (action, type, label, details={}) => logActivity(action,type,label,details);
  const download = (name, content, type='application/json') => {
    const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  };
  const csv = (name, rows) => download(name,rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n'),'text/csv;charset=utf-8');

  // Activity history: searchable, filterable and exportable. RLS keeps this owner-only.
  let activityRows=[];
  loadActivityLogs = async function(){
    if(!isOwner())return;
    $('activityStatus').textContent='Loading activity…';
    const {data,error}=await client.from('admin_activity_logs').select('actor_email,action,target_type,target_label,details,created_at').order('created_at',{ascending:false}).limit(500);
    if(error){$('activityStatus').textContent='Could not load activity: '+error.message;$('activityList').innerHTML='';return}
    activityRows=data||[];
    const actions=[...new Set(activityRows.map(x=>x.action))].sort();
    $('activityActionFilter').innerHTML='<option value="all">All actions</option>'+actions.map(x=>'<option value="'+h(x)+'">'+h(x)+'</option>').join('');
    renderActivity();
  };
  function renderActivity(){
    const q=($('activitySearch').value||'').toLowerCase(),action=$('activityActionFilter').value;
    const rows=activityRows.filter(x=>(action==='all'||x.action===action)&&[x.actor_email,x.action,x.target_type,x.target_label].join(' ').toLowerCase().includes(q));
    $('activityStatus').textContent='Showing '+rows.length+' of '+activityRows.length+' recorded actions.';
    $('activityList').innerHTML=rows.map(x=>'<div class="post"><strong>'+h(x.action)+'</strong><span class="status">'+h(x.actor_email)+' · '+new Date(x.created_at).toLocaleString()+'</span><div class="muted">'+h((x.target_type||'')+' '+(x.target_label||''))+'</div></div>').join('')||'<div class="empty-state">No activity matches this filter.</div>';
  }
  $('activitySearch')?.addEventListener('input',renderActivity);
  $('activityActionFilter')?.addEventListener('change',renderActivity);
  $('exportActivity')?.addEventListener('click',()=>csv('youth-of-tayitu-admin-activity.csv',[
    ['Time','Admin','Action','Target type','Target','Details'],
    ...activityRows.map(x=>[x.created_at,x.actor_email,x.action,x.target_type,x.target_label,JSON.stringify(x.details||{})])
  ]));

  // Better post preview and revision restore.
  function previewPost(p){
    if(!p)return;
    const imgs=Array.isArray(p.images)?p.images:[],cover=p.cover_image||imgs[0];
    $('previewTitle').textContent=p.title||'Post preview';
    $('previewContent').innerHTML=(cover?'<img src="'+h(cover)+'" alt="" style="width:100%;max-height:280px;object-fit:cover;border-radius:12px;margin:12px 0">':'')+
      '<div class="post-chip">'+h(p.category||'')+'</div><p class="muted">'+h(p.excerpt||'')+'</p><div class="preview-copy">'+h(p.content||'')+'</div>'+
      (imgs.length>1?'<div class="gallery">'+imgs.slice(1).map(u=>'<img class="thumb" src="'+h(u)+'" alt="">').join('')+'</div>':'');
    $('previewModal').classList.add('open');
  }
  async function showHistory(id){
    $('revisionList').textContent='Loading revisions…';$('revisionModal').classList.add('open');
    const {data,error}=await client.from('post_revisions').select('id,actor_email,revision_action,snapshot,created_at').eq('post_id',id).order('created_at',{ascending:false}).limit(40);
    if(error){$('revisionList').textContent='Could not load revisions: '+error.message;return}
    $('revisionList').innerHTML=(data||[]).map(r=>'<div class="post"><strong>'+h(r.snapshot?.title||'Deleted post')+'</strong><span class="status">'+h(r.revision_action)+' · '+new Date(r.created_at).toLocaleString()+' · '+h(r.actor_email||'Admin')+'</span><p class="muted">'+h(String(r.snapshot?.excerpt||r.snapshot?.content||'').slice(0,180))+'</p><button type="button" data-revision-restore="'+r.id+'">Restore this version</button></div>').join('')||'<div class="empty-state">No earlier versions are available.</div>';
    $('revisionList').querySelectorAll('[data-revision-restore]').forEach(btn=>btn.onclick=async()=>{
      const r=data.find(x=>x.id===btn.dataset.revisionRestore),s=r?.snapshot;if(!s)return;
      if(!confirm('Restore this saved version? The current version will be retained in history.'))return;
      const keys=['title','slug','excerpt','content','cover_image','status','published_at','category','images','social_url','social_platform'];
      const payload=Object.fromEntries(keys.filter(k=>k in s).map(k=>[k,s[k]]));
      payload.id=id;payload.updated_at=new Date().toISOString();
      const {error}=await client.from('posts').upsert(payload,{onConflict:'id'});
      if(error){message('Restore failed: '+error.message);return}
      await saveLog('Restored post revision','post',s.title||id,{revision_id:r.id});
      message('Previous version restored.');$('revisionModal').classList.remove('open');await loadPosts();
    });
  }
  $('closePreview')?.addEventListener('click',()=>$('previewModal').classList.remove('open'));
  $('closeRevision')?.addEventListener('click',()=>$('revisionModal').classList.remove('open'));
  ['previewModal','revisionModal'].forEach(id=>$(id)?.addEventListener('click',e=>{if(e.target===$(id))$(id).classList.remove('open')}));
  const baseRenderPosts=renderPosts;
  renderPosts=function(){
    baseRenderPosts();
    $('postGrid').querySelectorAll('.post-card').forEach(card=>{
      const id=card.querySelector('[data-edit]')?.dataset.edit;if(!id)return;
      const p=allPosts.find(x=>x.id===id);if(!p)return;
      const actions=card.querySelector('.post-card-actions');
      if(!actions)return;
      const preview=document.createElement('button');preview.type='button';preview.className='secondary';preview.textContent='Preview';preview.onclick=()=>previewPost(p);
      const history=document.createElement('button');history.type='button';history.className='secondary';history.textContent='History';history.onclick=()=>showHistory(id);
      actions.prepend(history);actions.prepend(preview);
      const oldPreview=actions.querySelector('a[data-preview]');if(oldPreview)oldPreview.remove();
    });
  };

  // Media library. Prevent deleting any asset referenced by a post or homepage settings.
  async function loadMedia(){
    $('mediaStatus').textContent='Loading media library…';const files=[];
    async function walk(prefix='',depth=0){
      if(depth>4)return;
      const {data,error}=await client.storage.from('post-images').list(prefix,{limit:100,sortBy:{column:'name',order:'asc'}});
      if(error)throw error;
      for(const item of data||[]){const path=prefix?prefix+'/'+item.name:item.name;if(item.id===null)await walk(path,depth+1);else files.push({path,name:item.name})}
    }
    try{await walk();window.ytMediaFiles=files;renderMedia();$('mediaStatus').textContent=files.length+' image file(s) available.'}
    catch(e){$('mediaStatus').textContent='Could not load media: '+e.message}
  }
  function renderMedia(){
    const q=($('mediaSearch').value||'').toLowerCase(),files=(window.ytMediaFiles||[]).filter(x=>x.path.toLowerCase().includes(q));
    $('mediaGrid').innerHTML=files.map(f=>{const url=client.storage.from('post-images').getPublicUrl(f.path).data.publicUrl;return '<article class="media-item"><img loading="lazy" src="'+h(url)+'" alt="'+h(f.name)+'"><div class="media-meta">'+h(f.path)+'</div><button type="button" class="danger" data-media-delete="'+h(f.path)+'">Delete image</button></article>'}).join('')||'<div class="empty-state">No images found.</div>';
    $('mediaGrid').querySelectorAll('[data-media-delete]').forEach(btn=>btn.onclick=async()=>{
      const path=btn.dataset.mediaDelete,url=client.storage.from('post-images').getPublicUrl(path).data.publicUrl;
      const [posts,site]=await Promise.all([client.from('posts').select('images,cover_image'),client.from('site_content').select('content').eq('section_key','homepage').maybeSingle()]);
      const inPost=(posts.data||[]).some(p=>p.cover_image===url||(Array.isArray(p.images)&&p.images.includes(url)));
      const inSite=JSON.stringify(site.data?.content||{}).includes(url);
      if(inPost||inSite){alert('This image is currently used by a post or homepage section. Replace it there before deleting.');return}
      if(!confirm('Permanently delete '+path+'?'))return;
      const {error}=await client.storage.from('post-images').remove([path]);if(error){message('Could not delete image: '+error.message);return}
      await saveLog('Deleted media file','media',path);message('Image deleted.');await loadMedia();
    });
  }
  $('mediaSearch')?.addEventListener('input',renderMedia);
  $('refreshMedia')?.addEventListener('click',loadMedia);
  $('mediaUpload')?.addEventListener('change',async e=>{
    const files=Array.from(e.target.files||[]);if(!files.length)return;
    try{
      for(const file of files){
        if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)||file.size>10*1024*1024)throw new Error('Use JPG, PNG, WebP or GIF images up to 10 MB each.');
        const path='library/'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'-');
        const {error}=await client.storage.from('post-images').upload(path,file,{upsert:false,contentType:file.type});if(error)throw error;
        await saveLog('Uploaded media file','media',path);
      }
      e.target.value='';message(files.length+' image(s) uploaded.');await loadMedia();
    }catch(err){message('Upload failed: '+err.message)}
  });

  // Owner-only backup/restore. This is a content backup; Storage binaries stay in the bucket.
  $('downloadBackup')?.addEventListener('click',async()=>{
    $('backupStatus').textContent='Preparing backup…';
    const [posts,site]=await Promise.all([client.from('posts').select('*').order('created_at',{ascending:true}),client.from('site_content').select('*')]);
    if(posts.error||site.error){$('backupStatus').textContent='Backup failed: '+(posts.error||site.error).message;return}
    const backup={format:'youth-of-tayitu-backup',version:1,created_at:new Date().toISOString(),posts:posts.data||[],site_content:site.data||[],note:'Image binaries remain in Supabase Storage; their public URLs are included.'};
    download('youth-of-tayitu-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(backup,null,2));
    await saveLog('Downloaded website backup','backup','Posts and homepage settings');$('backupStatus').textContent='Backup downloaded successfully.';
  });
  $('restoreBackup')?.addEventListener('click',async()=>{
    const file=$('backupFile').files?.[0];if(!file){message('Choose a backup JSON file first.');return}
    let backup;try{backup=JSON.parse(await file.text())}catch{message('The selected file is not valid JSON.');return}
    if(backup?.format!=='youth-of-tayitu-backup'||!Array.isArray(backup.posts)||!Array.isArray(backup.site_content)){message('Unsupported backup file.');return}
    if(!confirm('Import '+backup.posts.length+' posts and '+backup.site_content.length+' homepage records? Matching IDs/keys will be updated; other current content will not be deleted.'))return;
    $('backupStatus').textContent='Restoring backup…';
    if(backup.posts.length){const {error}=await client.from('posts').upsert(backup.posts,{onConflict:'id'});if(error){$('backupStatus').textContent='Posts restore failed: '+error.message;return}}
    if(backup.site_content.length){const {error}=await client.from('site_content').upsert(backup.site_content,{onConflict:'section_key'});if(error){$('backupStatus').textContent='Homepage restore failed: '+error.message;return}}
    await saveLog('Restored website backup','backup','Posts and homepage settings',{post_count:backup.posts.length,site_content_count:backup.site_content.length});
    $('backupStatus').textContent='Backup restored. Refresh the public website to see the content.';await loadPosts();
  });

  // Privacy-friendly aggregate page-view reporting (no cookies, IP or user-agent stored).
  async function loadVisitors(){
    if(!isOwner())return;
    const {data,error}=await client.from('site_page_views').select('page_path,created_at').gte('created_at',new Date(Date.now()-30*86400000).toISOString()).limit(5000);
    if(error){$('visitorAnalytics').textContent='Analytics unavailable: '+error.message;return}
    const rows=data||[],counts={};rows.forEach(x=>counts[x.page_path]=(counts[x.page_path]||0)+1);
    $('visitorAnalytics').innerHTML='<div class="analytics-kpi"><strong>'+rows.length+'</strong><span>Page views · last 30 days</span></div><div class="analytics-kpi"><strong>'+new Set(rows.map(x=>x.page_path)).size+'</strong><span>Pages visited</span></div>';
    const max=Math.max(1,...Object.values(counts));
    $('topPages').innerHTML=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([path,n])=>'<div class="category-row"><span>'+h(path)+'</span><strong>'+n+'</strong><div class="category-track"><div class="category-fill" style="width:'+n/max*100+'%"></div></div></div>').join('')||'<span class="muted">No visitor data recorded yet.</span>';
  }
  const baseLoadPosts=loadPosts;
  loadPosts=async function(){await baseLoadPosts();if(isOwner())await loadVisitors()};
  const baseShowPage=showPage;
  showPage=function(page){baseShowPage(page);if(page==='media')loadMedia();if(page==='backups'&&isOwner())$('backupStatus').textContent=''};
  // Attach scheduling field behavior; save handler is extended by the inline form patch.
  $('status')?.addEventListener('change',()=>{const scheduled=$('status').value==='scheduled';$('scheduleField').classList.toggle('hidden',!scheduled);$('scheduledAt').required=scheduled});
  $('reset')?.addEventListener('click',()=>{$('scheduleField').classList.add('hidden');$('scheduledAt').required=false});
  const baseEditPost=editPost;
  editPost=function(p){baseEditPost(p);$('scheduledAt').value=p?.status==='scheduled'&&p.published_at?new Date(new Date(p.published_at).getTime()-new Date(p.published_at).getTimezoneOffset()*60000).toISOString().slice(0,16):'';$('scheduleField').classList.toggle('hidden',p?.status!=='scheduled');$('scheduledAt').required=p?.status==='scheduled'};
})();