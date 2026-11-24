const deviceStore='fatgang-device-v1';
function recoveryHeaders() {
  try {
    const copy=localStorage.getItem(deviceStore);
    if(copy && /^[0-9a-f]{64}\.[0-9a-f]{64}$/.test(copy)) return {'X-Device-Recovery':copy};
  } catch {}
  return {};
}
function browserSignals() {
  const {width,height,colorDepth}=screen;
  return [navigator.language,Intl.DateTimeFormat().resolvedOptions().timeZone,
    [Math.min(width,height),Math.max(width,height),colorDepth].join('x'),String(navigator.hardwareConcurrency||0)];
}
let widgetScript;
function loadWidget() {
  if(!widgetScript) widgetScript=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload=()=>window.turnstile.ready(resolve);
    script.onerror=()=>{widgetScript=null;reject(Error('Не удалось загрузить проверку.'));};
    document.head.append(script);
  });
  return widgetScript;
}
let checking=false;
async function humanCheck(action) {
  if(checking) throw Error('Проверка уже открыта.');
  checking=true;
  const dialog=document.createElement('dialog');
  let widget;
  try {
    const challenge=await api('challenge',{action});
    const form=document.createElement('form');
    const title=document.createElement('h3');
    title.textContent='Проверка перед отправкой';
    const cancel=document.createElement('button');
    cancel.type='button'; cancel.textContent='Отмена'; cancel.className='secondary';
    form.append(title); dialog.append(form); document.body.append(dialog);
    dialog.showModal();
    if(challenge.siteKey) await loadWidget();
    return await new Promise((resolve,reject)=>{
      const abort=()=>reject(Error('Проверка отменена.'));
      cancel.onclick=abort; dialog.oncancel=abort;
      if(challenge.siteKey) {
        const target=document.createElement('div');
        form.append(target);
        widget=turnstile.render(target,{sitekey:challenge.siteKey,action,callback:token=>resolve({token}),
          'error-callback':()=>reject(Error('Проверка недоступна. Попробуй ещё раз.'))});
      } else {
        const img=document.createElement('img'); img.src=challenge.image; img.alt='Проверочный код';
        const label=document.createElement('label'); label.textContent='Введи пять символов с картинки';
        const input=document.createElement('input'); input.required=true; input.maxLength=5; input.autocomplete='off';
        label.append(input);
        const submit=document.createElement('button'); submit.className='primary'; submit.textContent='Продолжить';
        form.append(img,label,submit); input.focus();
        form.onsubmit=e=>{e.preventDefault();resolve({ticket:challenge.ticket,answer:input.value.trim()});};
      }
      form.append(cancel);
    });
  } finally {if(widget!=null) turnstile.remove(widget); dialog.remove(); checking=false;}
}
