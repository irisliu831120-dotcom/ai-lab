const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
function backend() {
 const rows=[],cached=new Map(),props=new Map([['SPREADSHEET_ID','private-sheet'],['ACCEPT_LIVE_ORDERS','false']]);let lockBusy=false,released=0,created=0;
 const range=(row,col,height=1,width=1)=>({getValues:()=>Array.from({length:height},(_,i)=>rows[row-1+i].slice(col-1,col-1+width)),setValues:values=>{values.forEach((v,i)=>rows[row-1+i]=[...v]);},createTextFinder:value=>({matchEntireCell(){return this;},findNext:()=>{const index=rows.findIndex((r,i)=>i>=row-1&&r[col-1]===value);return index<0?null:{getRow:()=>index+1};}})});
 const style={setFontWeight(){return this;},setBackground(){return this;},setNumberFormat(){return this;}};
 const sheet={getLastRow:()=>rows.length,appendRow:row=>rows.push([...row]),getRange:(...args)=>typeof args[0]==='string'?style:{...range(...args),...style},setFrozenRows(){}};
 const book={getSheetByName:()=>sheet,getId:()=>'private-sheet',getUrl:()=>'https://docs.google.com/spreadsheets/d/private-sheet',setSpreadsheetTimeZone(){}};
 const context={console,PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key)||null,setProperty:(k,v)=>props.set(k,v)})},SpreadsheetApp:{openById:()=>book,getActiveSpreadsheet:()=>book,create:()=>{created++;return book;},flush:()=>{}},LockService:{getScriptLock:()=>({tryLock:()=>!lockBusy,releaseLock:()=>released++})},CacheService:{getScriptCache:()=>({get:key=>cached.get(key),put:(k,v)=>cached.set(k,v)})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,value)=>[...crypto.createHash('sha256').update(value).digest()],getUuid:()=>crypto.randomUUID(),formatDate:(_,__,format)=>format==='yyyyMMdd'?'20261116':'2026-11-16 21:00:00'},HtmlService:{XFrameOptionsMode:{ALLOWALL:1},createHtmlOutput:html=>({html,setXFrameOptionsMode(){return this;}})},ContentService:{MimeType:{JSON:1},createTextOutput:content=>({content,setMimeType(){return this;}})}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('gas/Code.gs','utf8'),context);
 const properties={getProperty:key=>props.get(key)||null};
 return {context,rows,props,save:input=>context.saveOrder_(input,properties),busy:()=>lockBusy=true,released:()=>released,created:()=>created};
}
const order=(overrides={})=>({requestId:crypto.randomUUID(),mode:'test',consent:true,items:[{id:'p1',quantity:2}],fulfillment:'takeout',store:'旗艦店',customer:{name:'測試顧客',phone:'0900000000',email:'test@example.com',address:''},expectedTotal:170,...overrides});
test('server prices and delivery rules are authoritative',()=>{
 const b=backend();const cold=order({items:[{id:'g1',quantity:2}],fulfillment:'delivery',store:'',customer:{name:'測試',phone:'0900000000',address:'測試地址，請勿配送'},expectedTotal:1060});
 const receipt=b.save(cold);assert.equal(receipt.shipping,160);assert.equal(receipt.total,1060);assert.equal(b.rows.length,2);assert.equal(b.rows[1][5],'測試／不履約');assert.equal(b.rows[1][16],'未付款');
 for(const invalid of [order({expectedTotal:1}),order({fulfillment:'delivery',expectedTotal:330}),order({items:[{id:'g1',quantity:1}],fulfillment:'dine',expectedTotal:450}),order({items:[{id:'unknown',quantity:1}]}),order({items:[{id:'p1',quantity:0}]}),order({items:[{id:'p1',quantity:1},{id:'p1',quantity:1}]}),order({store:'任意門市'})])assert.throws(()=>b.save(invalid));
 assert.equal(b.rows.length,2);
});
test('durable request id deduplicates retries and rejects altered payload',()=>{
 const b=backend(),input=order();const first=b.save(input),retry=b.save(input);assert.equal(first.orderId,retry.orderId);assert.equal(retry.duplicate,true);assert.equal(b.rows.length,2);
 assert.throws(()=>b.save({...input,customer:{...input.customer,name:'另一人'}}),/IDEMPOTENCY_CONFLICT/);assert.equal(b.rows.length,2);assert.equal(b.released(),3);
});
test('formula injection, validation, live gate, throttling and lock',()=>{
 const b=backend();b.save(order({customer:{name:'=IMPORTXML("x")',phone:'+886900000000',email:'test@example.com',address:''}}));assert.equal(b.rows[1][6][0],"'");assert.equal(b.rows[1][7],"'+886900000000");
 assert.throws(()=>b.save(order({mode:'live'})),/LIVE_DISABLED/);assert.throws(()=>b.save(order({consent:false})),/INVALID_REQUEST/);assert.throws(()=>b.save(order({customer:{name:'測試',phone:'--------'}})),/INVALID_CUSTOMER/);
 b.save(order());b.save(order());b.save(order());assert.throws(()=>b.save(order()),/TOO_MANY_REQUESTS/);
 const busy=backend();busy.busy();assert.throws(()=>busy.save(order()),/BUSY/);assert.equal(busy.rows.length,0);
});
test('POST replies are sanitized and never include personal information',()=>{
 const b=backend(),input={...order(),nonce:crypto.randomUUID(),replyOrigin:'https://irisliu831120-dotcom.github.io'};const result=b.context.doPost({parameter:{payload:JSON.stringify(input)}});assert(result.html.includes('TEST-20261116-'));assert(!result.html.includes(input.customer.phone));assert(!result.html.includes(input.customer.name));assert(!result.html.includes('private-sheet'));
 for(const value of ['null','{','[]'])assert(b.context.doPost({parameter:{payload:value}}).html.includes('INVALID_REQUEST'));
 const html=b.context.reply_({message:'</script><img src=x onerror=alert(1)>'},'https://example.com').html;assert(!html.includes('<img'));assert(html.includes('\\u003c'));
});
function frontend() {
 const listeners={},storage=new Map(),children=[],elements={},timers=new Map();let timerId=0;
 const context={console,URL,TextEncoder,Uint8Array,crypto:crypto.webcrypto,navigator:{onLine:true},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)};
 function element(tag){return {tag,children:[],setAttribute(){},appendChild(child){this.children.push(child);},remove(){},submit(){}};}
 context.document={getElementById:id=>elements[id]||(elements[id]=element('div')),createElement:element,body:{appendChild:node=>children.push(node)}};
 context.window={SHAN_JIAO_ORDER_CONFIG:{endpoint:'https://script.google.com/macros/s/test-deployment/exec',mode:'test'},location:{origin:'https://irisliu831120-dotcom.github.io'},addEventListener:(n,fn)=>listeners[n]=fn,removeEventListener:n=>delete listeners[n]};
 vm.createContext(context);vm.runInContext(fs.readFileSync('checkout.js','utf8'),context);
 const latest=()=>JSON.parse(children.filter(x=>x.tag==='form').at(-1).children[0].value);
 const ready=async previous=>{for(let i=0;i<100;i++){if(children.filter(x=>x.tag==='form').length>previous)return latest();await new Promise(resolve=>setImmediate(resolve));}throw Error('form not ready');};
 return {context,storage,children,timers,api:context.window.ShanJiaoCheckout,ready,message:(origin,payload,result,nonce=payload.nonce)=>listeners.message?.({origin,data:{source:'shan-jiao-orders',requestId:payload.requestId,nonce,result}})};
}
const validReceipt={ok:true,orderId:'TEST-20261116-ABCDEF123456',mode:'test',total:170};
test('frontend ignores forged messages and verifies receipt before resolving',async()=>{
 const f=frontend(),input=order();delete input.requestId;delete input.mode;
 const promise=f.api.submitOrder(input);const body=await f.ready(0);let resolved=false;promise.then(()=>resolved=true);
 f.message('https://evil.example',body,validReceipt);f.message('https://script.google.com',body,validReceipt,'wrong-nonce');await new Promise(resolve=>setImmediate(resolve));assert.equal(resolved,false);
 f.message('https://n-abc-script.googleusercontent.com',body,validReceipt);assert.equal((await promise).orderId,validReceipt.orderId);assert(f.storage.size);f.api.completeOrder();assert.equal(f.storage.size,0);
});
test('timeout keeps retry ID, failures do not become successful orders',async()=>{
 const f=frontend(),input=order();delete input.requestId;delete input.mode;
 const first=f.api.submitOrder(input);const a=await f.ready(0);const failure=assert.rejects(first,/尚未收到/);[...f.timers.values()][0]();await failure;
 const retry=f.api.submitOrder(input);const b=await f.ready(1);assert.equal(a.requestId,b.requestId);f.message('https://script.google.com',b,{ok:false,message:'BUSY'});await assert.rejects(retry,/BUSY/);
 const again=f.api.submitOrder(input);const c=await f.ready(2);f.message('https://script.google.com',c,{...validReceipt,total:1});await assert.rejects(again,/無法驗證/);
 f.context.navigator.onLine=false;await assert.rejects(f.api.submitOrder(input),/離線/);
});

test('setup reuses the bound Sheet and is safe to run twice',()=>{const b=backend();b.props.delete('SPREADSHEET_ID');const url=b.context.setup();assert.equal(b.props.get('SPREADSHEET_ID'),'private-sheet');assert.equal(b.created(),0);assert.equal(b.rows.length,1);assert(url.includes('private-sheet'));b.context.setup();assert.equal(b.rows.length,1);assert.equal(b.props.get('ACCEPT_LIVE_ORDERS'),'false');});
