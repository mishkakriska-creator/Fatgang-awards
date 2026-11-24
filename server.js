const express=require('express'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),session=require('express-session'),crypto=require('crypto');
const app=express(),pool=new Pool({connectionString:process.env.DATABASE_URL}), nominees=require('./nominees.json');
app.set('trust proxy',1);app.use(express.json({limit:'16kb'}));app.use(express.static('public'));
const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const production = process.env.NODE_ENV === 'production';
const browserCookie = production ? '__Host-fatgang-voter' : 'fatgang-voter';
app.use('/api', require('cookie-parser')(secret), (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
app.use(session({store:new (require('connect-pg-simple')(session))({pool,createTableIfMissing:true}),secret,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:86400000*30}}));
const start=Date.parse(process.env.VOTING_START||''),end=start+14*86400000,open=()=>Date.now()>=start&&Date.now()<end;
const wrap=f=>(q,s,n)=>Promise.resolve(f(q,s,n)).catch(n);
function browserId(req) {
  const value = req.signedCookies[browserCookie];
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function ballotKey(browser, category) {
  return crypto.createHmac('sha256', secret).update(category + '/' + browser).digest('hex');
}

app.get('/api/info', wrap(async (req, res) => {
  let browser = browserId(req);
  if (!browser) {
    browser = crypto.randomBytes(32).toString('hex');
    res.cookie(browserCookie, browser, {
      signed: true, httpOnly: true, sameSite: 'lax', secure: production,
      path: '/', maxAge: 365 * 86400000
    });
  }
  let usedCategories = [];
  if (req.session.user) {
    const keys = nominees.map(category => ballotKey(browser, category.id));
    const result = await pool.query('select category from ballots where browser_key = any($1::text[])', [keys]);
    usedCategories = result.rows.map(row => row.category);
  }
  res.json({nominees, start: Number.isFinite(start) ? start : null,
    end: Number.isFinite(end) ? end : null, open: open(), user: req.session.user || null, usedCategories});
}));
app.post('/api/register',wrap(async(q,s)=>{let {name,password}=q.body;if(typeof name!=='string'||! /^[\p{L}\p{N}_-]{3,32}$/u.test(name)||typeof password!=='string'||password.length<8||password.length>72)return s.status(400).json({error:'Ник 3–32 символа, пароль 8–72'});let r=await pool.query('insert into users(name,hash) values($1,$2) on conflict do nothing returning id',[name.toLowerCase(),await bcrypt.hash(password,12)]);if(!r.rowCount)return s.status(409).json({error:'Ник занят'});q.session.user={id:r.rows[0].id,name};s.json({ok:true})}));
app.post('/api/login',wrap(async(q,s)=>{let {name,password}=q.body;if(typeof name!=='string'||typeof password!=='string')return s.sendStatus(400);let r=await pool.query('select * from users where name=$1',[name.toLowerCase()]);if(!r.rowCount||!await bcrypt.compare(password,r.rows[0].hash))return s.status(401).json({error:'Неверный логин или пароль'});q.session.user={id:r.rows[0].id,name};s.json({ok:true})}));
app.post('/api/logout',(q,s)=>q.session.destroy(()=>s.json({ok:true})));
app.post('/api/vote', wrap(async (req, res) => {
  if (!req.session.user) return res.status(401).json({error: 'Войди в аккаунт, чтобы голосовать.'});
  if (!open()) return res.status(403).json({error: 'Голосование закрыто'});
  const browser = browserId(req);
  if (!browser) return res.status(403).json({error: 'Для голосования включи cookie и обнови страницу.'});
  const {category, ids} = req.body;
  const list = nominees.find(item => item.id === category);
  if (!list || !Array.isArray(ids) || ids.length < 1 || ids.length > 3 ||
      new Set(ids).size !== ids.length || !ids.every(id => list.items.some(item => item.id === id))) {
    return res.sendStatus(400);
  }
  const result = await pool.query(
    'insert into ballots(user_id,category,choices,browser_key) values($1,$2,$3,$4) on conflict do nothing returning user_id',
    [req.session.user.id, category, JSON.stringify(ids), ballotKey(browser, category)]
  );
  if (!result.rowCount) return res.status(409).json({error: 'С этого аккаунта или браузера уже голосовали в этой номинации.'});
  res.json({ok:true});
}));
app.get('/api/my-votes',wrap(async(q,s)=>{if(!q.session.user)return s.sendStatus(401);s.json((await pool.query('select category,choices from ballots where user_id=$1',[q.session.user.id])).rows)}));
app.post('/api/admin',wrap(async(q,s)=>{if(!process.env.ADMIN_PASSWORD||q.body.password!==process.env.ADMIN_PASSWORD)return s.sendStatus(403);s.json({users:(await pool.query('select count(*) from users')).rows[0].count,results:(await pool.query('select category,jsonb_array_elements_text(choices) as nominee,count(*) from ballots group by 1,2 order by 3 desc')).rows})}));
app.use((e,q,s,n)=>{console.error(e.message);s.status(500).json({error:'Ошибка сервера'})});
(async()=>{await pool.query('create table if not exists users(id serial primary key,name text unique not null,hash text not null);create table if not exists ballots(user_id integer references users(id),category text,choices jsonb not null,primary key(user_id,category));alter table ballots add column if not exists browser_key text;create unique index if not exists ballots_browser_key_unique on ballots(browser_key) where browser_key is not null');app.listen(process.env.PORT||3000,'0.0.0.0')})().catch(e=>{console.error(e);process.exit(1)});