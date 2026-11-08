const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
class Element extends EventTarget {
  constructor() { super(); this.dataset={}; this.style={}; this.attrs={}; this.value=''; this.checked=true; }
  setAttribute(k,v) { this.attrs[k]=v; }
  replaceChildren(...children) { this.value=children[0]?.value || ''; }
  querySelector(s) { return this.nodes[s]; }
}
function fixture(voiceList=[{lang:'zh-CN',voiceURI:'local',name:'Tingting',localService:true}]) {
  const nodes=Object.fromEntries(['toggle','status','duck','select'].map(k=>['#pai-voice-'+k,new Element()]));
  const box=new Element(); box.nodes=nodes;
  const video=new Element(); Object.assign(video,{currentTime:1,paused:true,seeking:false,ended:false,offsetWidth:100,playbackRate:1,volume:.8});
  const synth=new EventTarget(); Object.assign(synth,{paused:false,cancelled:0,spoke:[],getVoices:()=>voiceList,
    speak(u){this.spoke.push(u);this.current=u;},cancel(){this.cancelled++;this.current=null;},pause(){this.paused=true;},resume(){this.paused=false;}});
  let timer;
  const document={getElementById:()=>null,createElement:t=>t==='section'?box:new Element(),body:{append(){}},querySelectorAll:()=>[video]};
  const window=new EventTarget(); window.speechSynthesis=synth;window.SpeechSynthesisUtterance=function(text){this.text=text;};
  const context={window,document,SpeechSynthesisUtterance:window.SpeechSynthesisUtterance,performance:{now:()=>1000},setInterval:f=>{timer=f;return 1;},clearInterval(){}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../assets/chinese-interpretation.js','utf8'),context);
  context.installChineseInterpretation([{start:0,end:5,zh:'第一句。'},{start:5,end:10,zh:'第二句。'},{start:15,end:20,zh:'第三句。'}]);
  return {video,synth,box,nodes,window,tick:()=>timer(),event:name=>video.dispatchEvent(new Event(name)),button:nodes['#pai-voice-toggle']};
}
const f=fixture();
assert.equal(f.synth.spoke.length,0,'must not auto speak');
f.button.onclick(); assert.equal(f.synth.spoke.length,0,'paused video stays silent');
f.video.paused=false; f.event('playing'); assert.equal(f.synth.spoke.length,1); f.synth.current.onstart(); assert.equal(f.video.volume,.8*.2);
f.tick(); assert.equal(f.synth.spoke.length,1,'no duplicate queue');
f.video.paused=true; f.event('pause'); assert.equal(f.synth.paused,true); assert.equal(f.video.volume,.8);
f.video.paused=false; f.event('playing'); assert.equal(f.synth.paused,false); assert.equal(f.synth.spoke.length,1,'resume does not restart sentence');
f.video.currentTime=5.5; f.tick(); assert.equal(f.synth.current.text,'第二句。'); assert.equal(f.synth.cancelled,1,'old sentence cancelled');
f.synth.current.onstart(); f.button.onclick(); assert.equal(f.video.volume,.8); assert.equal(f.synth.current,null,'off immediately stops audio');
f.button.onclick(); f.synth.current.onstart(); f.video.volume=.5; f.button.onclick(); assert.equal(f.video.volume,.5,'respect user volume changes');
f.button.onclick(); f.video.seeking=true; f.event('seeking'); assert.equal(f.synth.current,null);
f.video.currentTime=12; f.video.seeking=false; f.event('seeked'); assert.equal(f.synth.current,null,'no speech in transcript gap');
f.video.currentTime=16; f.tick(); assert.equal(f.synth.current.text,'第三句。');
f.video.ended=true; f.event('ended'); assert.equal(f.synth.current,null);
const missing=fixture([]); assert.equal(missing.button.disabled,true,'missing Chinese voice is explicit');
const paused=fixture(); paused.video.paused=false; paused.button.onclick(); paused.synth.current.onstart();
paused.video.paused=true; paused.event('pause'); paused.button.onclick();
assert.equal(paused.synth.paused,false,'turning off releases the speech pause owned by this module');
paused.button.onclick(); paused.video.paused=false; paused.event('playing');
assert.ok(paused.synth.current,'can speak after disabling while paused');
const stale=paused.synth.current;
paused.video.currentTime=6; paused.event('seeking'); paused.event('seeked');
paused.synth.current.onstart(); const volume=paused.video.volume;
stale.onend(); assert.equal(paused.video.volume,volume,'stale completion must not restore volume during a newer cue');
paused.window.dispatchEvent(new Event('pagehide'));
assert.equal(paused.synth.current,null,'navigation stops speech');
paused.window.dispatchEvent(new Event('pageshow')); paused.tick();
assert.equal(paused.synth.current,null,'back navigation never auto enables speech');
paused.button.onclick(); assert.ok(paused.synth.current,'back navigation can reenable speech');
const beforeRateChange=paused.synth.current;
paused.video.playbackRate=2; paused.event('ratechange');
assert.notEqual(paused.synth.current,beforeRateChange,'rate changes reschedule the current spoken cue');
assert.equal(paused.synth.current.text,beforeRateChange.text,'rate changes keep the current translated cue');
console.log('PASS: off/default, pause/resume, no queue buildup, cue transitions, volume restore/manual changes, seek/gaps, end, missing voice');
