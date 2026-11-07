// ==UserScript==
// @name         Video Bilingual Captions
// @namespace    local.bilingual
// @version      32
// @match        https://example.invalid/video/demo
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function(){
const cues = [];
const panel=document.createElement('section');
panel.id='pai-bilingual-panel';
panel.style.cssText='position:fixed;right:18px;top:150px;width:min(480px,40vw);z-index:2147483646;background:#fff;color:#222;border:2px solid #3465d9;border-radius:10px;box-shadow:0 3px 15px #0003;font:16px/1.5 sans-serif;max-height:45vh;overflow:auto;padding:12px;box-sizing:border-box';
const header=document.createElement('div');
header.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';
const label=document.createElement('strong');label.textContent='中英对照字幕';
const close=document.createElement('button');close.textContent='关闭翻译 ×';close.type='button';
header.append(label,close);
header.className='pai-bilingual-toolbar';
const toolbarStyle=document.createElement('style');
toolbarStyle.textContent='#pai-bilingual-panel .pai-bilingual-toolbar{opacity:0;pointer-events:none;transition:opacity .15s ease}#pai-bilingual-panel:hover .pai-bilingual-toolbar,#pai-bilingual-panel:focus-within .pai-bilingual-toolbar{opacity:1;pointer-events:auto}';
document.head.appendChild(toolbarStyle);

const transparency=document.createElement('button');transparency.type='button';
header.insertBefore(transparency,close);
let transparent=false;const transparencyKey='pai-bilingual-transparent';
try{transparent=localStorage.getItem(transparencyKey)==='true';}catch(e){}
function applyTransparency(){panel.style.background=transparent?'transparent':'#fff';panel.style.color=transparent?'#fff':'#222';panel.style.boxShadow=transparent?'none':'0 3px 15px #0003';panel.style.borderColor=transparent?'transparent':'#3465d9';panel.style.textShadow=transparent?'0 1px 3px #000,1px 0 2px #000,-1px 0 2px #000,0 -1px 2px #000':'none';panel.style.webkitTextStroke=transparent?'0.3px #000':'0';transparency.textContent=transparent?'切换白底':'切换透明';transparency.setAttribute('aria-pressed',String(transparent));if(typeof zh!=='undefined')zh.style.color=transparent?'#ffe14a':'#175b36';}
transparency.onclick=()=>{transparent=!transparent;applyTransparency();try{localStorage.setItem(transparencyKey,String(transparent));}catch(e){}};

const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px';
const en=document.createElement('div'),zh=document.createElement('div');zh.style.color='#175b36';grid.append(en,zh);panel.append(header,grid);
const toggle=document.createElement('button');toggle.type='button';toggle.style.cssText='position:fixed;right:18px;top:100px;z-index:2147483647;padding:10px 16px;background:#2556ba;color:white;border:0;border-radius:8px;font-size:16px;cursor:pointer';
let enabled=true,last=-2;
function setEnabled(value){enabled=value;panel.hidden=!value;panel.style.setProperty("display",value?"block":"none","important");toggle.textContent=value?'关闭双语字幕':'开启双语字幕';toggle.setAttribute('aria-pressed',String(value));}
toggle.onclick=()=>setEnabled(!enabled);close.onclick=()=>setEnabled(false);
document.body.append(panel,toggle);setEnabled(true);applyTransparency();
const positionKey='pai-bilingual-panel-position';
header.style.cursor='grab';header.style.touchAction='none';header.style.userSelect='none';
label.textContent='中英对照字幕 · 拖动移动';
let dragging=null;
function movePanel(x,y){const r=panel.getBoundingClientRect();panel.style.right='auto';panel.style.left=Math.max(0,Math.min(x,innerWidth-r.width))+'px';panel.style.top=Math.max(0,Math.min(y,innerHeight-Math.min(r.height,innerHeight)))+'px';}
try{const pos=JSON.parse(localStorage.getItem(positionKey));if(pos&&Number.isFinite(pos.x)&&Number.isFinite(pos.y))movePanel(pos.x,pos.y);}catch(e){}
header.addEventListener('pointerdown',e=>{if(e.target.closest('button')||e.button!==0)return;const r=panel.getBoundingClientRect();dragging={id:e.pointerId,x:e.clientX-r.left,y:e.clientY-r.top};header.setPointerCapture(e.pointerId);header.style.cursor='grabbing';e.preventDefault();});
header.addEventListener('pointermove',e=>{if(dragging&&dragging.id===e.pointerId)movePanel(e.clientX-dragging.x,e.clientY-dragging.y);});
function endDrag(e){if(!dragging||dragging.id!==e.pointerId)return;dragging=null;header.style.cursor='grab';const r=panel.getBoundingClientRect();try{localStorage.setItem(positionKey,JSON.stringify({x:r.left,y:r.top}));}catch(e){}}
header.addEventListener('pointerup',endDrag);header.addEventListener('pointercancel',endDrag);
window.addEventListener('resize',()=>{if(!panel.hidden){const r=panel.getBoundingClientRect();movePanel(r.left,r.top);}});

function time(){const vs=[...document.querySelectorAll('video')];const v=vs.find(v=>v.offsetWidth>0)||vs[0];return v&&Number.isFinite(v.currentTime)?v.currentTime:-1;}
setInterval(()=>{if(!enabled)return;const t=time();let lo=0,hi=cues.length-1,idx=-1;while(lo<=hi){const m=(lo+hi)>>1;if(cues[m].start<=t){idx=m;lo=m+1;}else hi=m-1;}if(idx===last)return;last=idx;en.textContent=idx<0?'等待课程字幕…':cues[idx].en;zh.textContent=idx<0?'':cues[idx].zh;},250);
})();
