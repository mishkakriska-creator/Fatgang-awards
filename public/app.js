let info=null,active=null,myVotes=[],selection=new Set();const $=id=>document.getElementById(id);
function el(tag,cls,txt){let x=document.createElement(tag);if(cls)x.className=cls;if(txt!==undefined)x.textContent=txt;return x}
async function api(path,data){let r=await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});let j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(j.error||'Ошибка '+r.status),{status:r.status});return j}
function timer(){if(!info)return;let now=Date.now();if(!info.start){$('timer').textContent='Скоро начало голосования';return}let target=now<info.start?info.start:info.end;if(now>=info.end){$('timer').textContent='Голосование завершено';return}let ms=Math.max(0,target-now),d=Math.floor(ms/86400000),h=Math.floor(ms/3600000)%24,m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;$('timer').textContent=(now<info.start?'До начала: ':'До конца: ')+d+'д '+[h,m,s].map(x=>String(x).padStart(2,'0')).join(':')}
async function init(){info=await api('info');myVotes=info.user?await api('my-votes').catch(()=>[]):[];$('account').textContent=info.user?info.user.name+' · Выйти':'Войти ↗︎';renderCategories();timer();if(active){let c=info.nominees.find(x=>x.id===active);if(c)show(c,false)}}
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
        selection.clear();
        show(category, true);
      }
      Array.from($('categories').children)
        .find(item => item.dataset.category === category.id)?.focus({preventScroll:true});
    };
    return button;
  });
  $('categories').replaceChildren(...buttons);
}
function audioPlayer(src, title) {
  const player = el('audio');
  player.controls = true;
  player.preload = 'none';
  player.src = src;
  player.setAttribute('aria-label', title);
  return player;
}
function show(c,scroll){active=c.id;renderCategories();let d=$('detail');d.hidden=false;d.replaceChildren(el('h2','',c.name));const saved=myVotes.find(v=>v.category===c.id);if(!c.items.length){d.append(el('p','empty','Номинанты пока не объявлены.'));if(scroll)d.scrollIntoView({behavior:'smooth',block:'start'});return}
const usedHere=info.usedCategories?.includes(c.id);
const isOpen=()=>Date.now()>=info.start&&Date.now()<info.end&&!!info.start;d.append(el('p','muted',saved?'Твой голос уже принят. Изменить выбор нельзя.':usedHere?'С этого браузера уже голосовали в этой номинации.':isOpen()&&!info.user?'Войди в аккаунт, чтобы выбрать номинантов.':isOpen()?'Выбери до трёх номинантов.':'Голосование сейчас закрыто.'));
let grid=el('div','nominee-grid'),count=el('strong','',''),submit=el('button','primary','Подтвердить голоса'),inputs=[];const refresh=()=>{count.textContent='Выбрано: '+selection.size+' / 3';submit.disabled=!info.user||!!saved||usedHere||!isOpen()||selection.size===0;for(let x of inputs)x.disabled=!info.user||!!saved||usedHere||!isOpen()||(!x.checked&&selection.size>=3)};
for(let n of c.items){let card=el('article','nominee'),label=el('label'),check=el('input');check.type='checkbox';check.checked=saved?saved.choices.includes(n.id):selection.has(n.id);check.onchange=()=>{if(check.checked)selection.add(n.id);else selection.delete(n.id);refresh()};inputs.push(check);if(n.image){let im=el('img');im.src=n.image;im.alt=n.name;im.loading='lazy';card.append(im)}label.append(check,el('span','',n.name));card.append(label);if(n.artist) card.append(el('span','muted',n.artist));
  if(n.audio) card.append(audioPlayer(n.audio, [n.artist,n.name].filter(Boolean).join(' — ')));
  for(const work of n.works || []) {
    card.append(el('span','',work.name),audioPlayer(work.audio,work.name));
  }
  if(n.url) {
    const link = el('a','album-link','Слушать на SoundCloud ↗');
    link.href = n.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    card.append(link);
  }
  grid.append(card);
}
d.append(grid);
if(!info.user && isOpen()){
  const loginButton=el('button','primary','Войти для голосования');
  loginButton.onclick=()=>$('auth').showModal();
  d.append(loginButton);
} else if(info.user && !saved && !usedHere){const actions=el('div','vote-actions');actions.append(count,submit);d.append(actions)}refresh();submit.onclick=async()=>{if(!info.user){$('auth').showModal();return}if(!confirm('Подтвердить выбор? Изменить его будет нельзя.'))return;submit.disabled=true;try{await api('vote',{category:c.id,ids:[...selection]});selection.clear();await init()}catch(e){alert(e.message);if(e.status===401||e.status===409){selection.clear();await init()}else refresh()}};if(scroll)d.scrollIntoView({behavior:'smooth',block:'start'})}
$('account').onclick=async()=>{if(info?.user){if(confirm('Выйти из аккаунта?')){await api('logout',{});selection.clear();await init()}}else $('auth').showModal()};
$('close-auth').onclick=()=>$('auth').close();$('login').onsubmit=async e=>{e.preventDefault();$('error').textContent='';try{await api(e.submitter?.value||'login',Object.fromEntries(new FormData(e.target)));e.target.reset();$('auth').close();await init()}catch(e){$('error').textContent=e.message}};
document.addEventListener('play',e=>{if(e.target.tagName==='AUDIO')document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause()})},true);init().catch(e=>$('timer').textContent=e.message);setInterval(timer,1000);
// Remove only connected dark background from the existing logo, preserving lettering.
(function cleanLogo(){const original=new Image();original.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=original.naturalWidth;canvas.height=original.naturalHeight;const w=canvas.width,h=canvas.height,ctx=canvas.getContext('2d');ctx.drawImage(original,0,0);const im=ctx.getImageData(0,0,w,h),p=im.data,seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;function visit(i){if(seen[i])return;seen[i]=1;let k=i*4;const max=Math.max(p[k],p[k+1],p[k+2]);if(max>76)return;queue[tail++]=i;p[k+3]=0}for(let x=0;x<w;x++){visit(x);visit((h-1)*w+x)}for(let y=0;y<h;y++){visit(y*w);visit(y*w+w-1)}while(head<tail){let i=queue[head++],x=i%w,y=Math.floor(i/w);if(x>0)visit(i-1);if(x<w-1)visit(i+1);if(y>0)visit(i-w);if(y<h-1)visit(i+w)}ctx.putImageData(im,0,0);let l=w,r=0,t=h,b=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(p[(y*w+x)*4+3]){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y)}if(r<l||b<t)return;const out=document.createElement('canvas');out.width=r-l+1;out.height=b-t+1;out.getContext('2d').drawImage(canvas,l,t,out.width,out.height,0,0,out.width,out.height);const uri=out.toDataURL('image/png');document.querySelectorAll('img[src="/logo.webp"]').forEach(img=>{img.src=uri;img.dataset.cleanLogo='true'})}catch(e){console.warn('Logo background fallback',e.message)}};original.src='/logo.webp'})();
