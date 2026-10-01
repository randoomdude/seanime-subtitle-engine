const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const ts = require('typescript');
const source = fs.readFileSync('subtitle-engine/subtitle-engine.ts', 'utf8');
const instrumented = source.replace('        async function loadMediaData(anilistId: number) {', `        globalThis.test = {fetchSubtitles,loadMediaData,resetSearchContext,subtitleResults,searchError,wyzieServer,imdbRef,seasonRef,episodeRef,mediaTypeRef,imdbId,seasonNumber,episodeNumber}; throw new Error("TEST_READY");\n        async function loadMediaData(anilistId: number) {`);
assert.notEqual(instrumented, source);
const prefs = {source:'all',language:'spanish',format:'all',wyzieKey:'fixture-key',wyzieBackup:'true',autoSelect:'none'};
const requests = [];
const subs = [{language:'es',display:'Spanish',format:'srt',url:'https://example.invalid/sub.srt'}];
const ok = () => ({ok:true,status:200,json:async()=>subs});
let register, handler = async()=>ok(), injected = 0;
const context = {console,Error,$ui:{register:cb=>{register=cb}},$getUserPreference:k=>prefs[k] || '',
  fetch:async url=>{requests.push(url);return handler(url);}};
vm.createContext(context);
vm.runInContext(ts.transpileModule(instrumented,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
context.init();
try {
  register({newTray:()=>({update:()=>{}}),state:initial=>{let value=initial;return {get:()=>value,set:next=>{value=next}}},fieldRef:initial=>({current:initial,setValue(next){this.current=next}}),toast:{warning:()=>{},error:()=>{},success:()=>{}},
    anime:{getAnimeMetadata:async()=>({mappings:{themoviedbId:372058},episodes:{'1':{seasonNumber:1}}})},
    videoCore:{getCurrentPlaybackInfo:async()=>({media:{id:21519,format:'MOVIE'},episode:{episodeNumber:1}}),addExternalSubtitleTrack:async()=>{injected++}}});
} catch(e) {assert.equal(e.message,'TEST_READY');}

async function run() {
  const t=context.test;
  t.imdbRef.setValue('372058');t.seasonRef.setValue('3');t.episodeRef.setValue('7');
  t.mediaTypeRef.setValue('movie');
  for (const auto of [false,true]) {
    t.resetSearchContext();await t.fetchSubtitles(auto);
    const url=new URL(requests.at(-1));
    assert.equal(url.searchParams.get('id'),'372058');
    assert(!url.searchParams.has('season'));assert(!url.searchParams.has('episode'));
  }
  t.mediaTypeRef.setValue('series');t.seasonRef.setValue('');t.episodeRef.setValue('');
  t.seasonNumber.set('9');t.episodeNumber.set('12');
  await t.fetchSubtitles(false);
  assert(!new URL(requests.at(-1)).searchParams.has('season'),'Manual search must not borrow cached episodes');
  t.imdbRef.setValue('');t.imdbId.set('13916');
  let count=requests.length;
  await t.fetchSubtitles(false);assert.equal(requests.length,count,'Manual ID must not borrow the previous show');
  await t.loadMediaData(21519);
  assert.equal(t.mediaTypeRef.current,'movie');
  assert(!new URL(requests.at(-1)).searchParams.has('season'),'Detected movie must omit seasons');
  assert.equal(injected,0,'Auto Select None must not add any subtitle');

  for (const failure of ['http','network']) {
    requests.length=0;t.resetSearchContext();
    handler=async url=>{
      if(new URL(url).hostname==='sub.wyzie.io') {
        if(failure==='network') throw new Error('Connection failed');
        return {ok:false,status:503,json:async()=>{throw new Error('HTML outage page should not be parsed before retry')}};
      }
      return ok();
    };
    await t.fetchSubtitles();
    assert.equal(requests.length,2);
    assert.equal(new URL(requests[0]).hostname,'sub.wyzie.io');
    assert.equal(new URL(requests[1]).hostname,'sub.wyzie.ru');
    assert.equal(new URL(requests[0]).search,new URL(requests[1]).search,'Keep the same personal key and search parameters');
    assert.equal(t.wyzieServer.get(),'backup');assert.equal(t.searchError.get(),'');
    assert.equal(t.subtitleResults.get().length,1);
    count=requests.length;await t.fetchSubtitles(true);
    assert.equal(requests.length,count);assert.equal(t.wyzieServer.get(),'backup','Cached search should retain server label');
  }
  for(const status of [400,401,403,404,429]) {
    requests.length=0;
    handler=async()=>({ok:false,status,json:async()=>({message:'Fixture rejection'})});
    await t.fetchSubtitles();
    assert.equal(requests.length,1,'Client errors must not retry on the backup');
    assert.match(t.searchError.get(),new RegExp(String(status)));
  }
  requests.length=0;handler=async()=>({ok:true,status:200,json:async()=>[]});
  await t.fetchSubtitles();assert.equal(requests.length,1);assert.equal(t.searchError.get(),'');
  requests.length=0;handler=async()=>({ok:true,status:200,json:async()=>{throw new Error('bad JSON')}});
  await t.fetchSubtitles();assert.equal(requests.length,1);assert.match(t.searchError.get(),/200.*Unexpected response/);
  requests.length=0;handler=async()=>({ok:false,status:502,json:async()=>({message:'Outage'})});
  await t.fetchSubtitles();assert.equal(requests.length,2,'Both servers failing must stop after one retry');
  assert.match(t.searchError.get(),/502.*Outage/);assert.equal(t.subtitleResults.get().length,0);
  requests.length=0;prefs.wyzieBackup='false';
  await t.fetchSubtitles();assert.equal(requests.length,1,'Disabled backup must never receive a request');
  prefs.wyzieBackup='true';requests.length=0;
  let resolve;
  handler=()=>new Promise(r=>{resolve=r});
  const old=t.fetchSubtitles();assert(resolve);t.resetSearchContext();
  resolve({ok:false,status:503});await old;
  assert.equal(requests.length,1,'Obsolete outage must not start a backup request');
  assert.equal(t.wyzieServer.get(),'');assert.equal(t.subtitleResults.get().length,0);
  console.log('Passed: movie/manual ID isolation, automatic movie detection, Auto Select None, optional backup, outage-only retry, empty searches, bad JSON, obsolete requests, and retry limit.');
}
run().catch(e=>{console.error(e);process.exit(1)});
