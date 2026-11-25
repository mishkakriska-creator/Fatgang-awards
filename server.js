const express=require('express'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),session=require('express-session'),crypto=require('crypto');
const fs = require('node:fs');
const production = process.env.NODE_ENV === 'production';
const connection = new URL(process.env.DATABASE_URL);
const dbOptions = {};
if (production) {
  for (const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat']) connection.searchParams.delete(key);
  dbOptions.ssl = {rejectUnauthorized:true};
  if (!process.env.SESSION_SECRET) throw Error('SESSION_SECRET is required');
}
const app=express(),pool=new Pool({...dbOptions,connectionString:connection.toString()}), nominees=require('./nominees.json');
app.set('trust proxy',1);app.use(express.json({limit:'16kb'}));app.use(express.static('public'));
pool.on("error", error => console.error("PostgreSQL connection error", error.code));
const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const browserCookie = production ? '__Host-fatgang-voter' : 'fatgang-voter';
app.use('/api', require('cookie-parser')(secret), (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
app.use(session({store:new (require('connect-pg-simple')(session))({pool,createTableIfMissing:false}),secret,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:86400000*30}}));
const start=Date.parse(process.env.VOTING_START||''),end=start+14*86400000,open=()=>Date.now()>=start&&Date.now()<end;
const wrap=f=>(q,s,n)=>Promise.resolve(f(q,s,n)).catch(n);
function browserId(req) {
  const value = req.signedCookies[browserCookie];
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function ballotKey(browser, category) {
  return crypto.createHmac('sha256', secret).update(category + '/' + browser).digest('hex');
}

const {protection,duplicateMessage} = require('./protection');
const guard = protection(pool,secret,production,browserCookie);
app.use('/api', (req,res,next) => {
  if(req.method==='POST' && (!req.is('application/json') || !req.body || Array.isArray(req.body))) return res.sendStatus(415);
  if(req.method==='POST') return wrap(guard.limit)(req,res,next);
  next();
});
// Adopt existing signed-in sessions before serving any account operation.
app.use('/api',wrap(async(req,res,next)=>{
  if(!req.session.user) return next();
  const device=guard.device(req,res);
  const {id}=device;
  const key=ballotKey(id,'account');
  const result=await pool.query('select user_id from award_device_accounts where device_key=$1',[key]);
  let owner=result.rows[0]?.user_id;
  if(owner===undefined) {
    await pool.query('insert into award_device_accounts values($1,$2) on conflict do nothing',[key,req.session.user.id]);
    owner=(await pool.query('select user_id from award_device_accounts where device_key=$1',[key])).rows[0].user_id;
  }
  if(owner!==req.session.user.id) delete req.session.user;
  req.awardDevice=device;
  next();
}));
app.post('/api/challenge', guard.challenge);
app.post(['/api/login','/api/register'],wrap(guard.verify));
app.get('/api/info', wrap(async (req, res) => {
  const {id:browser,recovery} = req.awardDevice || guard.device(req,res);
  let usedCategories = [];
  if (req.session.user) {
    const keys = nominees.map(category => ballotKey(browser, category.id));
    const result = await pool.query('select category from ballots where browser_key = any($1::text[])', [keys]);
    usedCategories = result.rows.map(row => row.category);
  }
  const accountBound=!!req.session.user || !!(await pool.query('select 1 from award_device_accounts where device_key=$1',[ballotKey(browser,'account')])).rowCount;
  res.json({nominees, recovery, accountBound, start: Number.isFinite(start) ? start : null,
    end: Number.isFinite(end) ? end : null, open: open(), user: req.session.user || null, usedCategories});
}));
const lockedMessage='Этот браузер уже привязан к аккаунту. Войди под прежним ником.';
async function authenticate(req,res) {
  const {name,password}=req.body;
  const registering=req.path==='/api/register';
  const id=browserId(req);
  if (!id) return res.status(400).json({error:'Обнови страницу и разреши cookie.'});
  if (req.session.user) return res.status(409).json({error:lockedMessage});
  if (typeof name!=='string'||typeof password!=='string') return res.sendStatus(400);
  if (registering && (!/^[\p{L}\p{N}_-]{3,32}$/u.test(name)||password.length<8||password.length>72))
    return res.status(400).json({error:'Ник 3–32 символа, пароль 8–72'});
  const key=ballotKey(id,'account');
  const db=await pool.connect();
  try {
    await db.query('begin');
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
    const bound=(await db.query('select user_id from award_device_accounts where device_key=$1',[key])).rows[0];
    let user,error,status;
    if(registering && !bound) {
      user=(await db.query('insert into users(name,hash) values($1,$2) on conflict do nothing returning id',[name.toLowerCase(),await bcrypt.hash(password,12)])).rows[0];
      if(!user){error='Ник занят';status=409;}
    } else if(registering) {
      error=lockedMessage;status=409;
    } else {
      user=(await db.query('select id,hash from users where name=$1',[name.toLowerCase()])).rows[0];
      if(!user||!await bcrypt.compare(password,user.hash)){error='Неверный логин или пароль';status=401;}
      else if(bound && bound.user_id!==user.id){error=lockedMessage;status=409;}
    }
    if(error){await db.query('rollback');return res.status(status).json({error});}
    if(!bound) await db.query('insert into award_device_accounts(device_key,user_id) values($1,$2)',[key,user.id]);
    await db.query('commit');
    req.session.user={id:user.id,name};
    res.json({ok:true});
  } catch(error) {await db.query('rollback');throw error;}
  finally {db.release();}
}
app.post(['/api/register','/api/login'],wrap(authenticate));
app.post('/api/logout',(req,res)=>res.status(403).json({error:'Аккаунт закреплён за этим браузером.'}));
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
  let passed = false;
  // Check challenge only after auth, schedule and ballot validation.
  await guard.verify(req,res,()=>{ passed=true; });
  if (!passed) return;
  const fp=guard.fingerprint(req,category);
  const client=await pool.connect();
  let inserted;
  try {
    await client.query('begin');
    if(fp) await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[fp]);
    const key=ballotKey(browser,category);
    inserted=await client.query(
      'insert into ballots(user_id,category,choices,browser_key,fingerprint_key) values($1,$2,$3,$4,$5) on conflict do nothing returning user_id',
      [req.session.user.id,category,JSON.stringify(ids),key,fp]);
    if(!inserted.rowCount) await guard.log('duplicate','vote',category,client);
    else if(fp) {
      const other=await client.query('select 1 from ballots where fingerprint_key=$1 and browser_key<>$2 limit 1',[fp,key]);
      if(other.rowCount) await guard.log('fingerprint_match','vote',category,client);
    }
    await client.query('commit');
  } catch(error) {
    await client.query('rollback');
    throw error;
  } finally {client.release();}
  if(!inserted.rowCount) return res.status(409).json({error:duplicateMessage});
  res.json({ok:true});
}));
app.get('/api/my-votes',wrap(async(q,s)=>{if(!q.session.user)return s.sendStatus(401);s.json((await pool.query('select category,choices from ballots where user_id=$1',[q.session.user.id])).rows)}));
app.post('/api/admin',wrap(async(q,s)=>{if(!process.env.ADMIN_PASSWORD||q.body.password!==process.env.ADMIN_PASSWORD){await guard.log('admin_denied','admin');return s.sendStatus(403)}s.json({activity:(await pool.query('select * from award_activity order by hour desc,hits desc limit 200')).rows,users:(await pool.query('select count(*) from users')).rows[0].count,results:(await pool.query('select category,jsonb_array_elements_text(choices) as nominee,count(*) from ballots group by 1,2 order by 3 desc')).rows})}));
app.use((e,q,s,n)=>{console.error(e.message);s.status(500).json({error:'Ошибка сервера'})});
async function startServer() {
  const db=await pool.connect();
  try {
    await db.query('begin');
    await db.query(fs.readFileSync(require.resolve('./schema.sql'),'utf8'));
    await db.query('commit');
  } catch(error) {
    await db.query('rollback');
    throw error;
  } finally { db.release(); }
  async function expire() {
    await pool.query('delete from award_limits where until_at<=now()');
    await pool.query("delete from award_activity where hour < now()-interval '30 days'");
  }
  setInterval(()=>expire().catch(e=>console.error(e.code)),3600000).unref();
  app.listen(process.env.PORT||3000,'0.0.0.0');
}
startServer().catch(e=>{console.error(e.message);process.exit(1)});
