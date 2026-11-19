(function(global){
'use strict';
const num=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(String(v).replace(/,/g,'').trim());return Number.isFinite(n)?n:null};
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
function sd(a){if(a.length<2)return null;const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1))}
function stats(a){const x=a.filter(Number.isFinite),m=mean(x),s=sd(x);return{n:x.length,mean:m,sd:s,se:s==null?null:s/Math.sqrt(x.length),ci:s==null?null:1.96*s/Math.sqrt(x.length),cv:s==null||m===0?null:Math.abs(s/m)*100,min:x.length?Math.min(...x):null,max:x.length?Math.max(...x):null}}
function groupBy(items,keyFn){const m=new Map();for(const x of items){const k=keyFn(x);if(!m.has(k))m.set(k,[]);m.get(k).push(x)}return m}
function parseLevels(text){return String(text||'').split(/[,，;；\n]+/).map(x=>x.trim()).filter(Boolean)}
function isIncluded(v){return !['否','no','false','0','排除'].includes(String(v??'').trim().toLowerCase())}
function normalizeRows(rows,design,indicator){return (rows||[]).map((r,i)=>({
 rowNumber:i+2,Factor1:String(r.Factor1??r[design.factors[0].header]??'').trim(),Factor2:design.factorCount===2?String(r.Factor2??r[design.factors[1].header]??'').trim():'',
 ParallelSample:num(r.ParallelSample??r['平行样品']??r['独立平行']),MeasureReplicate:num(r.MeasureReplicate??r['测量重复']??r['技术重复'])??1,
 pH:num(r.pH??r['pH值']),L:num(r.L??r['L*']??r['L值']),a:num(r.a??r['a*']??r['a值']),b:num(r.b??r['b*']??r['b值']),
 Include:isIncluded(r.Include??r['纳入']),Notes:String(r.Notes??r['备注']??'').trim(),raw:r
}))}
function validate(rows,design,indicator){const errors=[],warnings=[],inc=rows.filter(r=>r.Include);if(!inc.length)errors.push('没有可用于分析的数据。');const seen=new Set();for(const r of inc){if(!r.Factor1)errors.push(`第${r.rowNumber}行缺少因素A。`);if(design.factorCount===2&&!r.Factor2)errors.push(`第${r.rowNumber}行缺少因素B。`);if(!Number.isInteger(r.ParallelSample)||r.ParallelSample<1)errors.push(`第${r.rowNumber}行平行样品编号无效。`);if(!Number.isInteger(r.MeasureReplicate)||r.MeasureReplicate<1)errors.push(`第${r.rowNumber}行测量重复编号无效。`);if(indicator==='pH'){if(!Number.isFinite(r.pH))errors.push(`第${r.rowNumber}行 pH 不是有效数值。`);else if(r.pH<0||r.pH>14)warnings.push(`第${r.rowNumber}行 pH=${r.pH} 超出0–14，请检查。`)}else{for(const k of ['L','a','b'])if(!Number.isFinite(r[k]))errors.push(`第${r.rowNumber}行 ${k==='L'?'L*':k+'*'} 不是有效数值。`);if(Number.isFinite(r.L)&&(r.L<0||r.L>100))warnings.push(`第${r.rowNumber}行 L* 超出0–100，请检查。`)}const key=[r.Factor1,r.Factor2,r.ParallelSample,r.MeasureReplicate].join('|');if(seen.has(key))errors.push(`第${r.rowNumber}行条件、样品和测量重复编号重复。`);seen.add(key)}
 const cells=groupBy(inc,r=>`${r.Factor1}|${r.Factor2}`);for(const [key,rr] of cells){const samples=groupBy(rr,r=>r.ParallelSample);if(samples.size!==design.parallelCount)warnings.push(`${key.replace('|',' × ')} 检测到 ${samples.size} 个独立平行，设计要求 ${design.parallelCount} 个。`);for(const [sid,sr] of samples)if(sr.length!==design.measureCount)warnings.push(`${key.replace('|',' × ')} 的样品${sid}检测 ${sr.length} 次，设计要求 ${design.measureCount} 次。`)}
 const expected=design.factors[0].levels.length*(design.factorCount===2?design.factors[1].levels.length:1);if(cells.size!==expected)warnings.push(`检测到 ${cells.size} 个条件组合，设计中共有 ${expected} 个。`);return{errors,warnings,valid:!errors.length,rows:inc}}
function sampleLevel(rows,indicator){const g=groupBy(rows,r=>[r.Factor1,r.Factor2,r.ParallelSample].join('|')),out=[];for(const rr of g.values()){const f=rr[0],o={Factor1:f.Factor1,Factor2:f.Factor2,ParallelSample:f.ParallelSample,technicalN:rr.length};if(indicator==='pH')o.pH=mean(rr.map(x=>x.pH).filter(Number.isFinite));else{o.L=mean(rr.map(x=>x.L).filter(Number.isFinite));o.a=mean(rr.map(x=>x.a).filter(Number.isFinite));o.b=mean(rr.map(x=>x.b).filter(Number.isFinite));o.C=Math.sqrt(o.a**2+o.b**2);o.h=(Math.atan2(o.b,o.a)*180/Math.PI+360)%360}out.push(o)}return out}
function summarize(samples,indicator,design){const groups=groupBy(samples,r=>`${r.Factor1}|${r.Factor2}`),out=[];for(const rr of groups.values()){const f=rr[0],o={Factor1:f.Factor1,Factor2:f.Factor2,n:rr.length};for(const k of indicator==='pH'?['pH']:['L','a','b','C','h'])o[k]=stats(rr.map(x=>x[k]));out.push(o)}
 const order=(v,levels)=>{const i=levels.indexOf(String(v));return i<0?999:i};out.sort((x,y)=>order(x.Factor1,design.factors[0].levels)-order(y.Factor1,design.factors[0].levels)||order(x.Factor2,design.factorCount===2?design.factors[1].levels:[''])-order(y.Factor2,design.factorCount===2?design.factors[1].levels:['']));
 if(indicator==='color'){const byB=groupBy(out,r=>r.Factor2);for(const rr of byB.values()){const base=rr[0];for(const r of rr)r.DeltaE={...stats([]),n:r.n,mean:Math.sqrt((r.L.mean-base.L.mean)**2+(r.a.mean-base.a.mean)**2+(r.b.mean-base.b.mean)**2)}}}return out}
// Numerical Recipes incomplete beta helpers for F/t p-values
function logGamma(z){const c=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.984369578019571e-6,1.5056327351493116e-7];if(z<.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);z-=1;let x=.9999999999998099;for(let i=0;i<c.length;i++)x+=c[i]/(z+i+1);const t=z+c.length-.5;return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x)}
function betacf(a,b,x){const MAX=200,EPS=3e-10,FPMIN=1e-30;let qab=a+b,qap=a+1,qam=a-1,c=1,d=1-qab*x/qap;if(Math.abs(d)<FPMIN)d=FPMIN;d=1/d;let h=d;for(let m=1;m<=MAX;m++){let m2=2*m,aa=m*(b-m)*x/((qam+m2)*(a+m2));d=1+aa*d;if(Math.abs(d)<FPMIN)d=FPMIN;c=1+aa/c;if(Math.abs(c)<FPMIN)c=FPMIN;d=1/d;h*=d*c;aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));d=1+aa*d;if(Math.abs(d)<FPMIN)d=FPMIN;c=1+aa/c;if(Math.abs(c)<FPMIN)c=FPMIN;d=1/d;const del=d*c;h*=del;if(Math.abs(del-1)<EPS)break}return h}
function ibeta(x,a,b){if(x<=0)return 0;if(x>=1)return 1;const bt=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log(1-x));return x<(a+1)/(a+b+2)?bt*betacf(a,b,x)/a:1-bt*betacf(b,a,1-x)/b}
function fPvalue(F,df1,df2){if(!Number.isFinite(F)||F<0)return null;return 1-ibeta((df1*F)/(df1*F+df2),df1/2,df2/2)}
function tPvalue(t,df){if(!Number.isFinite(t)||df<=0)return null;const x=df/(df+t*t);return ibeta(x,df/2,.5)}
function oneWayAnova(samples,metric){const g=groupBy(samples,r=>r.Factor1),all=samples.map(r=>r[metric]).filter(Number.isFinite),grand=mean(all);let ssb=0,ssw=0;for(const rr of g.values()){const vals=rr.map(r=>r[metric]).filter(Number.isFinite),m=mean(vals);ssb+=vals.length*(m-grand)**2;ssw+=vals.reduce((s,v)=>s+(v-m)**2,0)}const dfb=g.size-1,dfw=all.length-g.size,msb=ssb/dfb,msw=ssw/dfw,F=msb/msw;return{groups:g.size,N:all.length,SSbetween:ssb,SSwithin:ssw,dfBetween:dfb,dfWithin:dfw,F,p:fPvalue(F,dfb,dfw),eta2:ssb/(ssb+ssw)}}
function twoWayAnova(samples,metric,design){const A=design.factors[0].levels,B=design.factors[1].levels,cells=new Map();for(const a of A)for(const b of B)cells.set(`${a}|${b}`,samples.filter(r=>String(r.Factor1)===a&&String(r.Factor2)===b).map(r=>r[metric]).filter(Number.isFinite));const ns=[...cells.values()].map(v=>v.length);if(!ns.length||Math.min(...ns)<2||new Set(ns).size!==1)return{error:'双因素 ANOVA 当前要求每个条件组合具有相同且不少于2个独立平行。'};const n=ns[0],all=[...cells.values()].flat(),grand=mean(all),meanA=new Map(A.map(a=>[a,mean(B.flatMap(b=>cells.get(`${a}|${b}`)))])),meanB=new Map(B.map(b=>[b,mean(A.flatMap(a=>cells.get(`${a}|${b}`)))]));let SSA=0,SSB=0,SSAB=0,SSE=0;for(const a of A)SSA+=B.length*n*(meanA.get(a)-grand)**2;for(const b of B)SSB+=A.length*n*(meanB.get(b)-grand)**2;for(const a of A)for(const b of B){const vals=cells.get(`${a}|${b}`),cm=mean(vals);SSAB+=n*(cm-meanA.get(a)-meanB.get(b)+grand)**2;SSE+=vals.reduce((s,v)=>s+(v-cm)**2,0)}const dfA=A.length-1,dfB=B.length-1,dfAB=dfA*dfB,dfE=A.length*B.length*(n-1),MSE=SSE/dfE;const FA=(SSA/dfA)/MSE,FB=(SSB/dfB)/MSE,FAB=(SSAB/dfAB)/MSE;return{A:{SS:SSA,df:dfA,F:FA,p:fPvalue(FA,dfA,dfE),partialEta2:SSA/(SSA+SSE)},B:{SS:SSB,df:dfB,F:FB,p:fPvalue(FB,dfB,dfE),partialEta2:SSB/(SSB+SSE)},interaction:{SS:SSAB,df:dfAB,F:FAB,p:fPvalue(FAB,dfAB,dfE),partialEta2:SSAB/(SSAB+SSE)},error:{SS:SSE,df:dfE,MS:MSE},nPerCell:n}}
function linearRegression(samples,metric){const pts=samples.map(r=>({x:num(r.Factor1),y:r[metric]})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),n=pts.length;if(n<3)return{error:'线性趋势至少需要3个有效观测。'};const mx=mean(pts.map(p=>p.x)),my=mean(pts.map(p=>p.y)),Sxx=pts.reduce((s,p)=>s+(p.x-mx)**2,0),Sxy=pts.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0),slope=Sxy/Sxx,intercept=my-slope*mx;let SSE=0,SST=0;for(const p of pts){SSE+=(p.y-(intercept+slope*p.x))**2;SST+=(p.y-my)**2}const r2=1-SSE/SST,seSlope=Math.sqrt((SSE/(n-2))/Sxx),t=slope/seSlope;return{n,slope,intercept,r2,t,p:tPvalue(t,n-2)}}

function lsdLetters(groupEntries,alpha=.05){
 const groups=groupEntries.map(g=>({key:String(g.key),values:(g.values||[]).filter(Number.isFinite)})).filter(g=>g.values.length);
 const all=groups.flatMap(g=>g.values),k=groups.length,N=all.length;
 if(k<2||N<=k)return{letters:Object.fromEntries(groups.map(g=>[g.key,'a'])),comparisons:[],df:null,mse:null,method:'Fisher LSD'};
 let ssw=0;for(const g of groups){const m=mean(g.values);ssw+=g.values.reduce((sum,v)=>sum+(v-m)**2,0)}
 const df=N-k,mse=ssw/df,means=groups.map(g=>({key:g.key,mean:mean(g.values),n:g.values.length}));
 const sig=new Map(),comparisons=[];
 for(let i=0;i<means.length;i++)for(let j=i+1;j<means.length;j++){
   const a=means[i],b=means[j];let p;
   if(!Number.isFinite(mse)||mse===0)p=Math.abs(a.mean-b.mean)<1e-12?1:0;
   else{const se=Math.sqrt(mse*(1/a.n+1/b.n)),t=Math.abs(a.mean-b.mean)/se;p=tPvalue(t,df)}
   const significant=Number.isFinite(p)?p<alpha:false;sig.set(`${a.key}\u0000${b.key}`,significant);sig.set(`${b.key}\u0000${a.key}`,significant);comparisons.push({a:a.key,b:b.key,p,significant});
 }
 const isSig=(a,b)=>a===b?false:!!sig.get(`${a}\u0000${b}`),sorted=[...means].sort((a,b)=>b.mean-a.mean),letterSets=[];
 for(const g of sorted){
   let joined=false;
   for(const set of letterSets){if([...set].every(h=>!isSig(g.key,h))){set.add(g.key);joined=true}}
   if(!joined){const set=new Set([g.key]);for(const h of sorted){if(h.key===g.key)continue;if([...set].every(x=>!isSig(h.key,x)))set.add(h.key)}letterSets.push(set)}
 }
 for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++){
   const a=sorted[i].key,b=sorted[j].key;if(isSig(a,b))continue;
   if(!letterSets.some(set=>set.has(a)&&set.has(b))){const set=new Set([a,b]);for(const h of sorted){if(set.has(h.key))continue;if([...set].every(x=>!isSig(h.key,x)))set.add(h.key)}letterSets.push(set)}
 }
 for(let i=letterSets.length-1;i>=0;i--)for(let j=0;j<letterSets.length;j++)if(i!==j&&[...letterSets[i]].every(x=>letterSets[j].has(x))){letterSets.splice(i,1);break}
 const letterName=i=>i<26?String.fromCharCode(97+i):`a${i-25}`,letters={};sorted.forEach(g=>letters[g.key]='');letterSets.forEach((set,i)=>set.forEach(k=>letters[k]=(letters[k]||'')+letterName(i)));
 return{letters,comparisons,df,mse,method:'Fisher LSD',alpha};
}
function significanceLetters(samples,metric,design,options={}){
 const alpha=Number(options.alpha)||.05,scope=options.scope==='auto'?(design.factorCount===2?'within-factor1':'overall'):(options.scope||'overall'),out={},details=[];
 const run=(sliceKey,items,groupField,keyBuilder)=>{const grouped=groupBy(items,r=>String(r[groupField]??'')),entries=[...grouped].map(([key,rows])=>({key,values:rows.map(r=>r[metric]).filter(Number.isFinite)})),res=lsdLetters(entries,alpha);for(const [g,l] of Object.entries(res.letters))out[keyBuilder(sliceKey,g)]=l;details.push({slice:sliceKey,...res})};
 if(design.factorCount===1||scope==='overall')run('',samples,'Factor1',(_,g)=>`${g}|`);
 else if(scope==='within-factor2')for(const b of design.factors[1].levels)run(String(b),samples.filter(r=>String(r.Factor2)===String(b)),'Factor1',(slice,g)=>`${g}|${slice}`);
 else for(const a of design.factors[0].levels)run(String(a),samples.filter(r=>String(r.Factor1)===String(a)),'Factor2',(slice,g)=>`${slice}|${g}`);
 return{letters:out,details,method:'Fisher LSD',alpha,scope};
}

function analyze(rows,design,indicator){const validation=validate(rows,design,indicator);if(!validation.valid)return{validation,samples:[],results:[]};const samples=sampleLevel(validation.rows,indicator),results=summarize(samples,indicator,design);return{validation,samples,results}}
function flattenResults(results,indicator){const metrics=indicator==='pH'?['pH']:['L','a','b','C','h','DeltaE'];return results.map(r=>{const o={Factor1:r.Factor1,Factor2:r.Factor2,n:r.n};for(const m of metrics){const s=r[m];o[`${m}_Mean`]=s?.mean??'';o[`${m}_SD`]=s?.sd??'';o[`${m}_SE`]=s?.se??'';o[`${m}_95CI`]=s?.ci??''}return o})}
const api={num,mean,sd,stats,parseLevels,normalizeRows,validate,sampleLevel,summarize,analyze,flattenResults,oneWayAnova,twoWayAnova,linearRegression,groupBy,lsdLetters,significanceLetters};if(typeof module!=='undefined'&&module.exports)module.exports=api;global.SimpleSciPlotCore=api})(typeof globalThis!=='undefined'?globalThis:window);
