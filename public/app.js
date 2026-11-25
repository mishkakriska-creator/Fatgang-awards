let info=null,active=null,myVotes=[],selection=new Set();const $=id=>document.getElementById(id);
function el(tag,cls,txt){let x=document.createElement(tag);if(cls)x.className=cls;if(txt!==undefined)x.textContent=txt;return x}
async function api(path,data){let r=await fetch('/api/'+path,data===undefined?{headers:path==='info'?recoveryHeaders():{}}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(['register','login','vote'].includes(path)?{...data,proof:await humanCheck(path),...(path==='vote'?{fingerprint:browserSignals()}:{})}:data)});let j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(j.error||'Ошибка '+r.status),{status:r.status});return j}
let loadingWinners = false;
let retryWinnersAt = 0;
async function displayWinners() {
  if (!$('winners').hidden || loadingWinners || Date.now() < retryWinnersAt) return;
  loadingWinners = true;
  try {
    const results = await api('winners');
    const cards = results.map(({category, winners}) => {
      const c = info.nominees.find(item => item.id === category);
      const card = el('article', 'winner-card');
      card.dataset.category = category;
      card.append(el('h3', '', c.name));
      if (!winners.length) card.append(el('p', '', 'Голосов нет'));
      if (winners.length > 1) card.append(el('p', '', 'Разделили первое место'));
      for (const id of winners) {
        const n = c.items.find(item => item.id === id);
        const row = el('div', 'winner-row');
        const image = el('img');
        image.alt = ''; image.src = n?.image || '/logo.webp';
        const credit = el('div');
        credit.append(el('strong', '', n?.name || id));
        if (n?.artist) credit.append(el('small', '', n.artist));
        row.append(image, credit); card.append(row);
      }
      return card;
    });
    $('winner-list').replaceChildren(...cards);
    $('winners').hidden = false;
  } catch {
    retryWinnersAt = Date.now() + 10000;
  } finally { loadingWinners = false; }
}
function timer(){if(!info)return;let now=Date.now();
  const open=!!info.start && now>=info.start && now<info.end;
  if (open!==info.open) {
    info.open=open;
    if(!open){drafts.clear();renderBallot()}
    if(active)show(info.nominees.find(c=>c.id===active),false);
  }
  if(!info.start){$('timer').textContent='Скоро начало голосования';return}let target=now<info.start?info.start:info.end;if(now>=info.end){$('timer').textContent='Голосование завершено';displayWinners();return}let ms=Math.max(0,target-now),d=Math.floor(ms/86400000),h=Math.floor(ms/3600000)%24,m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;$('timer').textContent=(now<info.start?'До начала: ':'До конца: ')+d+'д '+[h,m,s].map(x=>String(x).padStart(2,'0')).join(':')}
const drafts=new Map();
function nomineeCaption(category, nominee) {
  const [performer, producer] = category.id === 'producer' ? (nominee.artist || '').split(' · прод. ') : [];
  return {title: producer || nominee.name, subtitle: producer ? nominee.name + ' — ' + performer : nominee.artist};
}
function renderBallot() {
  $('my-ballot').hidden = !info.user;
  if (!info.user) return;
  const groups = [];
  for (const c of info.nominees) {
    const vote = myVotes.find(v => v.category === c.id);
    const ids = vote?.choices || [...(drafts.get(c.id) || [])];
    if (!ids.length) continue;
    const group = el('section', 'ballot-group');
    const header = el('div', 'ballot-heading');
    header.append(el('h3', '', c.name), el('small', '', vote ? 'Голос принят' : 'До подтверждения'));
    const list = el('ul', 'ballot-cards');
    for (const id of ids) {
      const nominee = c.items.find(item => item.id === id) || {name:id};
      const {title, subtitle} = nomineeCaption(c, nominee);
      const card = el('li', 'ballot-card');
      const art = el('img');
      art.alt = ''; art.loading = 'lazy'; art.src = nominee.image || '/logo.webp';
      const caption = el('div', 'ballot-caption');
      caption.append(el('strong', '', title));
      if (subtitle) caption.append(el('small', '', subtitle));
      card.append(art, caption); list.append(card);
    }
    group.append(header, list); groups.push(group);
  }
  $('ballot-list').replaceChildren(...(groups.length ? groups : [el('p', 'muted', 'Здесь появятся карточки выбранных номинантов.')]));
}
async function init(){info=await api('info');try{localStorage.setItem(deviceStore,info.recovery)}catch{};myVotes=info.user?await api('my-votes'):[];$('account').textContent=info.user?info.user.name:'Войти ↗︎';$('account').title=info.user?'Мои голоса':'Войти';$('login').querySelector('[value=register]').hidden=info.accountBound;renderBallot();renderCategories();timer();if(active){let c=info.nominees.find(x=>x.id===active);if(c)show(c,false)}}
function renderCategories() {
  const buttons = info.nominees.map(category => {
    const button = el('button', 'category');
    button.type = 'button';
    button.dataset.category = category.id;
    button.setAttribute('aria-expanded', String(active === category.id));
    button.setAttribute('aria-controls', 'detail');

    const art = el('span', 'cover-art');
    art.setAttribute('aria-hidden', 'true');
    art.append(el('i', 'shape'));
    const title = el('strong', '', category.name);
    const status = myVotes.some(vote => vote.category === category.id)
      ? 'Голос принят'
      : info.usedCategories?.includes(category.id) ? 'Здесь уже голосовали'
      : category.items.length ? 'Номинантов: ' + category.items.length : 'Скоро';
    const meta = el('span', 'cat-bottom', status);
    const arrow = el('span', 'cat-arrow', active === category.id ? '−' : '↘');
    arrow.setAttribute('aria-hidden', 'true');
    meta.append(arrow);
    button.append(art, title, meta);
    button.onclick = () => {
      if (active === category.id) {
        active = null;
        $('detail').hidden = true;
        renderCategories();
      } else {
        show(category, true);
      }
      Array.from($('categories').children)
        .find(item => item.dataset.category === category.id)?.focus({preventScroll:true});
    };
    return button;
  });
  $('categories').replaceChildren(...buttons);
}
const song = $('song');
let currentTrack = null;
const seek = $('seek');
function clock(seconds) {
  const value = Math.floor(seconds);
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
}
function updateTimeline() {
  const duration = song.duration;
  const ready = Number.isFinite(duration) && duration > 0;
  seek.disabled = !ready;
  seek.max = ready ? duration : 0;
  seek.value = song.currentTime || 0;
  $('elapsed').textContent = clock(song.currentTime || 0);
  $('duration').textContent = ready ? clock(duration) : '–:––';
  seek.setAttribute('aria-valuetext', $('elapsed').textContent + ' / ' + $('duration').textContent);
}
seek.oninput = () => {
  if (!seek.disabled) song.currentTime = Number(seek.value);
  updateTimeline();
};
function syncTransport() {
  const playing = !song.paused && !song.ended;
  $('deck-toggle').dataset.playing = String(playing);
  $('deck-toggle').setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
  for (const button of document.querySelectorAll('.listen')) {
    const selected = button.dataset.src === currentTrack?.audio;
    button.dataset.playing = String(selected && playing);
    button.closest('.nominee').classList.toggle('on-deck', selected);
    button.setAttribute('aria-label', (selected && playing ? 'Пауза — ' : 'Слушать — ') + button.dataset.title);
  }
}
function playTrack(track) {
  const same = track.audio === currentTrack?.audio;
  if (same && !song.paused) { song.pause(); return; }
  if (!same || song.error) {
    currentTrack = track;
    song.src = track.audio;
    $('deck-title').textContent = track.name;
    $('deck-artist').textContent = track.artist || '';
    $('deck-cover').src = track.image || '/logo.webp';
    $('deck').hidden = false;
    document.body.classList.add('has-deck');
    updateTimeline();
  }
  $('deck-error').textContent = '';
  song.play().catch(error => {
    if (currentTrack?.audio === track.audio && error.name !== 'AbortError')
      $('deck-error').textContent = 'Не удалось воспроизвести. Нажми ещё раз.';
    syncTransport();
  });
}
$('deck-toggle').onclick = () => { if (currentTrack) playTrack(currentTrack); };
for (const event of ['timeupdate','loadedmetadata','durationchange','seeked','emptied'])
  song.addEventListener(event, updateTimeline);
for (const event of ['play','pause','ended','error'])
  song.addEventListener(event, syncTransport);
function listenButton(track) {
  const button = el('button','listen transport');
  button.type = 'button';
  button.dataset.src = track.audio;
  button.dataset.title = track.name;
  button.onclick = () => playTrack(track);
  return button;
}
function show(c,scroll){active=c.id;selection=drafts.get(c.id)||new Set();drafts.set(c.id,selection);renderCategories();let d=$('detail');d.hidden=false;d.dataset.category=c.id;d.replaceChildren(el('h2','',c.name));const saved=myVotes.find(v=>v.category===c.id);if(!c.items.length){d.append(el('p','empty','Номинанты пока не объявлены.'));if(scroll)d.scrollIntoView({behavior:'smooth',block:'start'});return}
const limit=c.maxChoices;
const usedHere=info.usedCategories?.includes(c.id);
const isOpen=()=>Date.now()>=info.start&&Date.now()<info.end&&!!info.start;d.append(el('p','muted',saved?'Твой голос уже принят. Изменить выбор нельзя.':usedHere?'С этого устройства уже голосовали в данной номинации':isOpen()&&!info.user?'Войди в аккаунт, чтобы выбрать номинантов.':isOpen()?(limit===1?'Выбери один альбом и подтверди выбор внизу.':'Нажми на карточки до трёх номинантов и подтверди выбор внизу.'):'Голосование сейчас закрыто.'));
let grid=el('div','nominee-grid'),count=el('strong','',''),submit=el('button','primary','Подтвердить голоса'),inputs=[];const refresh=()=>{count.textContent='Выбрано: '+selection.size+' / '+limit;submit.disabled=!info.user||!!saved||usedHere||!isOpen()||selection.size===0;for(let x of inputs)x.disabled=!info.user||!!saved||usedHere||!isOpen()||(!x.checked&&selection.size>=limit)};
for (const n of c.items) {
  const card = el('article','nominee');
  const art = el('div','nominee-art');
  if (n.image) {
    const image = el('img');
    image.src = n.image;
    image.alt = '';
    image.loading = 'lazy';
    art.append(image);
  }
  if (n.audio) art.append(listenButton(n));
  const label = el('label');
  const check = el('input');
  check.type = 'checkbox';
  check.checked = saved ? saved.choices.includes(n.id) : selection.has(n.id);
  card.addEventListener('click',event=>{
    if(!event.target.closest('label,input,a,button') && !check.disabled) check.click();
  });
  check.onchange = () => {
    if (check.checked) selection.add(n.id);
    else selection.delete(n.id);
    refresh();renderBallot();
  };
  inputs.push(check);
  const {title, subtitle} = nomineeCaption(c, n);
  label.append(check,el('span','',title));
  card.append(art,label);
  if (subtitle) card.append(el('span','credit',subtitle));
  for (const work of n.works || []) {
    const row = el('div','work-row');
    row.append(el('span','',work.name), listenButton({...work,image:n.image}));
    card.append(row);
  }
  if(n.url) {
    const link = el('a','album-link',c.id==='artist'?'Профиль в SoundCloud':'Слушать на SoundCloud');
    const icon=el('img','sc-icon');
    icon.src='/soundcloud.svg';icon.alt='';
    link.append(' ',icon);
    link.href = n.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    card.append(link);
  }
  grid.append(card);
}
d.append(grid);
syncTransport();
if(!info.user && isOpen()){
  const loginButton=el('button','primary','Войти для голосования');
  loginButton.onclick=()=>$('auth').showModal();
  d.append(loginButton);
} else if(info.user && !saved && !usedHere && isOpen()){const actions=el('div','vote-actions');actions.append(count,submit);d.append(actions)}refresh();submit.onclick=async()=>{if(!info.user){$('auth').showModal();return}if(!confirm('Подтвердить выбор? Изменить его будет нельзя.'))return;submit.disabled=true;try{await api('vote',{category:c.id,ids:[...selection]});drafts.delete(c.id);await init()}catch(e){alert(e.message);if(e.status===401||e.status===409){drafts.delete(c.id);await init()}else refresh()}};if(scroll)d.scrollIntoView({behavior:'smooth',block:'start'})}
$('account').onclick=()=>{if(info?.user){$('my-ballot').focus();$('my-ballot').scrollIntoView({behavior:'smooth',block:'start'});}else $('auth').showModal();};
$('close-auth').onclick=()=>$('auth').close();$('login').onsubmit=async e=>{e.preventDefault();$('error').textContent='';try{await api(e.submitter?.value||'login',Object.fromEntries(new FormData(e.target)));e.target.reset();$('auth').close();await init()}catch(e){$('error').textContent=e.message}};
init().catch(e=>$('timer').textContent=e.message);setInterval(timer,1000);
// Remove only connected dark background from the existing logo, preserving lettering.
(function cleanLogo(){const original=new Image();original.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=original.naturalWidth;canvas.height=original.naturalHeight;const w=canvas.width,h=canvas.height,ctx=canvas.getContext('2d');ctx.drawImage(original,0,0);const im=ctx.getImageData(0,0,w,h),p=im.data,seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;function visit(i){if(seen[i])return;seen[i]=1;let k=i*4;const max=Math.max(p[k],p[k+1],p[k+2]);if(max>76)return;queue[tail++]=i;p[k+3]=0}for(let x=0;x<w;x++){visit(x);visit((h-1)*w+x)}for(let y=0;y<h;y++){visit(y*w);visit(y*w+w-1)}while(head<tail){let i=queue[head++],x=i%w,y=Math.floor(i/w);if(x>0)visit(i-1);if(x<w-1)visit(i+1);if(y>0)visit(i-w);if(y<h-1)visit(i+w)}ctx.putImageData(im,0,0);let l=w,r=0,t=h,b=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(p[(y*w+x)*4+3]){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y)}if(r<l||b<t)return;const out=document.createElement('canvas');out.width=r-l+1;out.height=b-t+1;out.getContext('2d').drawImage(canvas,l,t,out.width,out.height,0,0,out.width,out.height);const uri=out.toDataURL('image/png');document.querySelectorAll('img[src="/logo.webp"]').forEach(img=>{img.src=uri;img.dataset.cleanLogo='true'})}catch(e){console.warn('Logo background fallback',e.message)}};original.src='/logo.webp'})();
