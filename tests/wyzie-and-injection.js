const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const ts = require('typescript');
const source = fs.readFileSync('subtitle-engine/subtitle-engine.ts', 'utf8');
function compile(text) {
  const result = ts.transpileModule(text, {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None},reportDiagnostics:true});
  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  return result.outputText;
}
compile(source);
assert(!/const key = "wyzie-/.test(source));
const prefs = {source:'all',language:'spanish',format:'all'};
const messages = [];
const requests = [];
let response, callback, injected;
const state = initial => {let value = initial; return {get:()=>value,set:next=>{value=next}}};
const context = {
  console, Error, $ui:{register:cb=>{callback=cb}},
  $getUserPreference:key=>prefs[key] || '',
  $habari:{parse:()=>({})},
  fetch: async url=>{requests.push(url);return response;},
};
vm.createContext(context);
const instrumented = source.replace('        async function loadMediaData(anilistId: number) {', `        globalThis.test = {fetchSubtitles,injectSubtitle,applyFilters,subtitleResults,filteredSubtitleResults,searchError,lastSearchedKey,imdbRef,seasonRef,episodeRef,langRef,sourceRef}; throw new Error("TEST_READY");\n        async function loadMediaData(anilistId: number) {`);
assert.notEqual(instrumented, source);
vm.runInContext(compile(instrumented), context);
context.init();
try {
  callback({newTray:()=>({}),state,fieldRef:initial=>({current:initial,setValue(next){this.current=next}}),toast:{warning:m=>messages.push(m),error:m=>messages.push(m),success:m=>messages.push(m)},videoCore:{addExternalSubtitleTrack:async track=>{injected=track}}});
} catch (e) {assert.equal(e.message,'TEST_READY');}
async function run() {
  const t = context.test;
  t.imdbRef.setValue('13916');t.seasonRef.setValue('1');t.episodeRef.setValue('1');
  await t.fetchSubtitles();
  assert.equal(requests.length,0);assert.match(t.searchError.get(),/Add your Wyzie API key/);
  prefs.wyzieKey = 'fixture-key';
  response = {ok:false,status:403,json:async()=>({message:'Invalid API key'})};
  await t.fetchSubtitles();
  assert.match(t.searchError.get(),/403.*Invalid API key/);assert.equal(t.lastSearchedKey.get(),'');
  assert.equal(t.filteredSubtitleResults.get().length,0);
  const subs = ['es','es-MX','ea','spa','ja','en'].map(language=>({language,format:'srt',url:'https://example.invalid/sub.srt'}));
  response = {ok:true,status:200,json:async()=>subs};
  await t.fetchSubtitles();
  assert.equal(t.filteredSubtitleResults.get().length,4);
  const url = new URL(requests.at(-1));
  assert.equal(url.searchParams.get('source'),'all');assert.equal(url.searchParams.get('key'),'fixture-key');
  assert.equal(url.searchParams.get('season'),'1');assert.equal(url.searchParams.get('episode'),'1');
  const count = requests.length;
  await t.fetchSubtitles(true);assert.equal(requests.length,count);
  response = {ok:false,status:429,json:async()=>({message:'Daily request limit reached'})};
  await t.fetchSubtitles();assert.match(t.searchError.get(),/429.*Daily request limit/);
  assert.equal(t.filteredSubtitleResults.get().length,0);
  response = {ok:true,status:200,text:async()=> '1\n00:00:01,000 --> 00:00:02,000\nHola\n'};
  await t.injectSubtitle({media:'test',display:'Spanish',language:'es',format:'SRT',url:'https://example.invalid/test.srt'});
  assert.match(injected.content,/Hola/);assert.equal(injected.format,'srt');assert.equal(injected.language,'es');
  assert(!('src' in injected));
  console.log('Passed: syntax, missing key, invalid key, quota error, current source request, Spanish variants, auto-search cache, native subtitle injection.');
}
run().catch(e=>{console.error(e);process.exit(1)});
