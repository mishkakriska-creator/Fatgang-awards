const crypto = require('node:crypto');
const captcha = require('svg-captcha');
const duplicateMessage = 'С этого устройства уже голосовали в данной номинации';

function protection(pool, secret, production, browserCookie) {
  const sign = (scope, value) => crypto.createHmac('sha256', secret).update(scope + '/' + value).digest('hex');
  const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
    crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  const valid = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  function device(req, res) {
    const cookie = req.signedCookies[browserCookie];
    let id = valid(cookie) ? cookie : null;
    if (!id) {
      const [copy, mac] = (req.get('X-Device-Recovery') || '').split('.');
      id = valid(copy) && valid(mac) && equal(mac, sign('recovery', copy)) ? copy : crypto.randomBytes(32).toString('hex');
      res.cookie(browserCookie, id, {signed:true,httpOnly:true,sameSite:'lax',secure:production,path:'/',maxAge:365*86400000});
    }
    return {id, recovery:id + '.' + sign('recovery', id)};
  }
  function fingerprint(req, category) {
    const f = req.body.fingerprint;
    if (!Array.isArray(f) || f.length !== 4 || !f.every(v => typeof v === 'string' && v.length > 0 && v.length <= 48)) return null;
    const ua = (req.get('user-agent') || '').slice(0,512).replace(/[\d.]+/g,'#');
    return sign('fp:' + category, JSON.stringify([ua,...f]));
  }
  async function log(kind,action,category='', db=pool) {
    await db.query(`insert into award_activity values(date_trunc('hour',now()),$1,$2,$3,1)
      on conflict(hour,kind,action,category) do update set hits=award_activity.hits+1`,[kind,action,category]);
  }
  async function count(scope, value, seconds) {
    const result = await pool.query(`insert into award_limits values($1,now()+$2*interval '1 second',1)
      on conflict(bucket) do update set hits=case when award_limits.until_at<=now() then 1 else least(award_limits.hits+1,1000000) end,
      until_at=case when award_limits.until_at<=now() then excluded.until_at else award_limits.until_at end returning hits`,
      [sign('limit:'+scope,value),seconds]);
    return result.rows[0].hits;
  }
  async function limit(req,res,next) {
    const action=req.path.slice(1);
    const rules={
      register:[['ip',45],['device',8]], login:[['ip',100],['name',25],['device',35]],
      admin:[['ip',12]], vote:[['device',25],['user',25]], challenge:[['ip',160],['device',60]]
    };
    const values={ip:req.ip,device:req.signedCookies[browserCookie],name:typeof req.body?.name==='string'?req.body.name.toLowerCase().slice(0,32):null,user:req.session.user?.id};
    if (action==='vote' && req.session.user && values.ip && await count('vote-network',values.ip,600)===20)
      await log('vote_burst',action);
    for(const [key,max] of rules[action] || []) {
      if (!values[key]) continue;
      const hits=await count(action+':'+key,String(values[key]),600);
      if(action==='register' && key==='ip' && hits===8) await log('registration_burst',action);
      if(hits>max) {
        await log('rate_limit',action);
        return res.set('Retry-After','600').status(429).json({error:'Слишком много запросов. Попробуй через 10 минут.'});
      }
    }
    next();
  }
  const siteKey=process.env.TURNSTILE_SITE_KEY, secretKey=process.env.TURNSTILE_SECRET_KEY;
  if (Boolean(siteKey)!==Boolean(secretKey)) throw Error('Configure both Turnstile keys');
  const actions=['register','login','vote'];
  function challenge(req,res) {
    const id=req.signedCookies[browserCookie], action=req.body.action;
    if(!valid(id)||!actions.includes(action)) return res.sendStatus(400);
    if(siteKey) return res.json({siteKey});
    const {data,text}=captcha.create({size:5,ignoreChars:'0oO1ilI',noise:3});
    const nonce=crypto.randomBytes(16).toString('hex'), expires=Date.now()+300000;
    const tag=sign('quiz',[id,action,expires,nonce,text.toLowerCase()].join('/'));
    res.json({image:'data:image/svg+xml;base64,'+Buffer.from(data).toString('base64'),ticket:[expires,nonce,tag].join('.')});
  }
  async function verify(req,res,next) {
    const action=req.path.split('/').pop(), id=req.signedCookies[browserCookie], proof=req.body.proof || {};
    let ok=false;
    if(valid(id) && siteKey && typeof proof.token==='string' && proof.token.length<=2048) {
      const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:secretKey,response:proof.token}),signal:AbortSignal.timeout(8000)});
      const data=await response.json();
      ok=response.ok && data.success && data.action===action && data.hostname===(process.env.TURNSTILE_HOSTNAME||'fatgang-awards.onrender.com');
    } else if(valid(id) && !siteKey && typeof proof.ticket==='string' && typeof proof.answer==='string') {
      const [expires,nonce,tag]=proof.ticket.split('.');
      if(/^\d{13}$/.test(expires) && Number(expires)>Date.now() && Number(expires)<=Date.now()+300000 && /^[a-f0-9]{32}$/.test(nonce) && valid(tag) && /^[a-z0-9]{5}$/i.test(proof.answer)) {
        const first=await count('quiz',id+'/'+nonce,300)===1;
        ok=first && equal(tag,sign('quiz',[id,action,expires,nonce,proof.answer.toLowerCase()].join('/')));
      }
    }
    if(!ok) { await log('captcha',action); return res.status(403).json({error:'Пройди проверку ещё раз.'}); }
    next();
  }
  return {device,fingerprint,log,limit,challenge,verify};
}
module.exports={protection,duplicateMessage};
