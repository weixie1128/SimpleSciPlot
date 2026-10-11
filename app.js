'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));


// v0.8.1 性能层：大数据图表只建立一次索引，避免每次绘图重复进行 O(n²) 查找。
let chartDataVersion=0;
let chartModelCache=null;
let xAxisConfigMemo={key:'',value:null};
let chartEntryJob=0;
function invalidateChartModel(){chartDataVersion++;chartModelCache=null;xAxisConfigMemo={key:'',value:null}}
function getChartModel(){
  if(chartModelCache&&chartModelCache.version===chartDataVersion)return chartModelCache;
  const xvals=[],groups=[],xSeen=new Set(),gSeen=new Set(),byKey=new Map(),byGroup=new Map();
  state.chartData.forEach(row=>{
    const xKey=String(row.x),gKey=String(row.group);
    if(!xSeen.has(xKey)){xSeen.add(xKey);xvals.push(row.x)}
    if(!gSeen.has(gKey)){gSeen.add(gKey);groups.push(row.group);byGroup.set(gKey,[])}
    byKey.set(`${xKey}${gKey}`,row);byGroup.get(gKey).push(row);
  });
  const xIndex=new Map(xvals.map((x,i)=>[String(x),i]));
  chartModelCache={version:chartDataVersion,xvals,groups,xIndex,byKey,byGroup};
  return chartModelCache;
}
function clearHeavyStatisticsDom(){
  const table=$('#descriptiveTable');
  if(table&&table.querySelectorAll('tr').length>350)table.innerHTML='<tbody><tr><td class="empty-row">大数据统计表已从页面内存释放；返回“初步分析”时会重新生成。</td></tr></tbody>';
}
function setChartBusy(active,text='正在建立绘图索引并生成图形…'){
  const stage=$('#chartStage');if(!stage)return;
  stage.classList.toggle('is-rendering',active);
  if(active)stage.innerHTML=`<div class="chart-render-loading"><span class="loading-spinner"></span><b>${esc(text)}</b><small>大数据只在首次进入时建立索引，之后编辑会明显更快。</small></div>`;
}
function scheduleChartEntryRender(){
  const job=++chartEntryJob;clearHeavyStatisticsDom();setChartBusy(true);
  requestAnimationFrame(()=>setTimeout(()=>{
    if(job!==chartEntryJob||state.view!=='chart')return;
    try{
      state.chart.mode=state.workflow.mode;
      if(state.workflow.mode==='experiment')prepareChartData();else{state.gallery.type=state.workflow.chartType;if(state.gallery.type==='radar')state.gallery.selected='radar-grid';analyzeGalleryData()}
      renderChartStudio();
    }catch(err){console.error(err);const stage=$('#chartStage');if(stage)stage.innerHTML=`<div class="gallery-empty"><b>图形生成失败</b><span>${esc(err?.message||'未知错误')}</span></div>`;toast('图形生成失败，请检查数据或刷新页面')}
    finally{setChartBusy(false)}
  },0));
}

const templates = {
  foodchem: {fontEnglish:'Arial',fontChinese:'Microsoft YaHei',axis:1.35,colors:['#2f6b2f','#d98222','#526d70','#4c78a8','#a65d4e','#7b6aa8','#4f8f8b','#b07aa1','#d3a03b','#6d904f','#8c6d5a','#5f7f9e']},
  meatsci:  {fontEnglish:'Arial',fontChinese:'Microsoft YaHei',axis:1.25,colors:['#9fcd84','#70b865','#3e8c54','#83b9db','#1986bd','#546e7a','#c8b07a','#c9826b','#8f74a8','#6aa6a6','#b5a4d6','#8f8f8f']},
  nature:   {fontEnglish:'Arial',fontChinese:'Microsoft YaHei',axis:1.25,colors:['#3C5488','#E64B35','#00A087','#4DBBD5','#F39B7F','#8491B4','#91D1C2','#DC0000','#7E6148','#B09C85','#00A1D5','#6A3D9A']},
  mono:     {fontEnglish:'Times New Roman',fontChinese:'SimSun',axis:1.40,colors:['#111111','#333333','#555555','#777777','#999999','#bbbbbb','#222222','#444444','#666666','#888888','#aaaaaa','#cccccc']}
};

const defaultDesign = {
  experimentName:'肉品储藏品质研究', metricName:'Moisture content', metricUnit:'%', designType:'two',
  factorAName:'Storage time (d)', factorALevels:['0','2','4','6','8','10'], factorALevelMode:'auto',
  factorBName:'Temperature', factorBLevels:['4 °C','-1 °C','-18 °C'],
  parallelSamples:3, technicalRepeats:1, technicalAggregation:'mean', selectedTechnical:1, errorType:'sd'
};

/* ===== v0.18.0 project name =====
 * applyImportedConfig() replaces state.design wholesale from the workbook's
 * 项目配置（勿改） sheet. A workbook generated while the name box still held the
 * built-in default therefore carried 肉品储藏品质研究 and overwrote whatever the
 * user had typed — that is why the name kept snapping back. The built-in names
 * are listed here so a name the user actually wrote is never replaced by them.
 */
const BUILTIN_PROJECT_NAMES=new Set(['','未命名项目','未命名实验',defaultDesign.experimentName]);
function isCustomProjectName(name){return !BUILTIN_PROJECT_NAMES.has(String(name??'').trim())}
function syncProjectNameUi(){
  const input=$('#experimentName'),side=$('#sidebarProjectName');
  const name=(input&&input.value.trim())||state.design.experimentName||'未命名项目';
  if(side)side.textContent=name;
  persistProjectName(name);
}
/* The name is the one piece of project information a user types by hand on
 * every visit, so it is remembered in the browser. Nothing else is persisted —
 * the rest still comes from the imported workbook. */
const PROJECT_NAME_KEY='foodlab-project-name';
function persistProjectName(name){try{localStorage.setItem(PROJECT_NAME_KEY,String(name||''))}catch(_err){}}
function restoreProjectName(){try{const saved=localStorage.getItem(PROJECT_NAME_KEY);if(saved&&String(saved).trim())state.design.experimentName=String(saved)}catch(_err){}}

const defaultChartSettings = {
  title:'Moisture content', titleVisible:true, titleX:490, titleY:39, titleSize:17, titleWeight:600, titleColor:'#14212a',
  subtitle:'', subtitleEnabled:false, subtitleX:490, subtitleY:60, subtitleSize:11, subtitleWeight:400, subtitleColor:'#687783',
  xTitle:'Storage time (d)', xTitleVisible:true, xTitleX:490, xTitleY:626, xTitleSize:15, xTitleWeight:400, xTitleColor:'#20262b',
  yTitle:'Moisture content (%)', yTitleVisible:true, yTitleX:31, yTitleY:332, yTitleSize:15, yTitleWeight:400, yTitleColor:'#20262b',
  fontEnglish:'Arial', fontChinese:'Microsoft YaHei', globalFontWeight:400, legendWeight:400,
  canvasWidth:980, canvasHeight:660, panelPreset:'normal', pngDpi:300, tightExport:true,
  axisColor:'#20262b', axisWidth:1.35, frameMode:'box', frameWidth:1.15, frameColor:'#20262b',
  xTickSize:12, yTickSize:12, xTickWeight:400, yTickWeight:400, xTickColor:'#20262b', yTickColor:'#20262b', tickLength:6, xTickRotation:0, xTickAutoRotate:true, xTickStagger:false, showXTicks:true, showYTicks:true,
  xUnitSource:'auto', xUnitTarget:'auto', xScaleMode:'auto', xAxisMin:null, xAxisMax:null, xAxisSegments:10, xTickDecimals:'auto', xTickRound:true, xScale:'linear', xTickStep:null,
  lineWidth:2.1, markerSize:4.7, markerShape:'circle', markerFill:'white', lineMode:'straight', lineOffset:0,
  barGap:3, categoryWidth:.72, barOpacity:.96, barBorderWidth:.55, barLineMode:false,barLineWidth:1.8,barLineMarker:true,
  errorWidth:1.15, errorCap:10, errorColorMode:'series', errorXOffset:0,
  legendSize:12, legendVisible:true, legendOrientation:'horizontal', legendColumns:3,
  legendFrameStyle:'solid', legendFrameWidth:1, legendFrameColor:'#7d898f', legendFrameRadius:2, legendFrameFill:'#ffffff',
  legendShadow:true, legendShadowX:2, legendShadowY:3, legendShadowBlur:3, legendShadowOpacity:.28,
  letters:true, letterScheme:'within', postHoc:'duncan', letterSize:11, letterWeight:400, letterOffset:10,
  yMin:null, yMax:null, yTickStep:null, yAxisSegments:6, yTickDecimals:'auto', yTickRound:false, yScale:'linear',
  lowerMin:0, lowerMax:20, upperMin:70, upperMax:82, breakGap:12, lowerRatio:.23,
  wfLayerDx:64, wfLayerDy:80, wfFill:true, wfFillOpacity:.55, wfZLabels:true, wfLineEndLabels:false, wfZLabelSize:11, wfZAxisTitle:'', zTitleSize:12, wfWallColor:'#f7f6f1', wfGridColor:'#d9d7ce', wfGridWidth:.8, wfLegend:true, wfLegendSize:11, wfViewDir:'right', wfLegendStyle:'block',
  background:'#ffffff'
};


const defaultGallerySettings = {
  title:'',titleVisible:true,titleX:null,titleY:38,titleSize:17,titleWeight:600,titleColor:'#14212a',
  subtitle:'',subtitleEnabled:false,subtitleX:null,subtitleY:58,subtitleSize:11,subtitleWeight:400,subtitleColor:'#687783',
  xTitle:'',xTitleVisible:true,xTitleX:null,xTitleY:null,xTitleSize:15,xTitleWeight:400,xTitleColor:'#20262b',
  yTitle:'Value',yTitleVisible:true,yTitleX:28,yTitleY:null,yTitleSize:15,yTitleWeight:400,yTitleColor:'#20262b',
  width:980,height:660,dpi:300,panelPreset:'normal',
  fontEnglish:'Arial',fontChinese:'Microsoft YaHei',globalFontWeight:400,xTickSize:12,yTickSize:12,xTickWeight:400,yTickWeight:400,xTickColor:'#20262b',yTickColor:'#20262b',
  axisWidth:1.35,axisColor:'#20262b',tickLength:6,showXTicks:true,showYTicks:true,
  frameMode:'box',frameWidth:1.15,frameColor:'#20262b',background:'#ffffff',
  legend:true,legendX:120,legendY:62,legendFontSize:12,legendWeight:400,legendOrientation:'horizontal',legendColumns:3,
  legendFrameStyle:'none',legendFrameX:108,legendFrameY:50,legendFrameWidthBox:260,legendFrameHeightBox:62,legendFrameAutoSize:true,
  legendFrameWidth:1,legendFrameColor:'#7d898f',legendFrameFill:'#ffffff',legendFrameRadius:3,
  legendShadow:true,legendShadowX:2,legendShadowY:3,legendShadowBlur:3,legendShadowOpacity:.25,
  bins:10,bandwidth:0,opacity:.72,pointSize:4,lineWidth:2,markerShape:'circle',markerFill:'series',annotationSize:12,pieLabelSize:12,radarLabelSize:12,
  showPoints:true,showMean:true,showMedian:true,showOutliers:true,boxWidth:.48,whiskerWidth:1.1,medianWidth:1.5,violinShowBox:true,
  boxQuartileMethod:'linear7',boxWhiskerMethod:'iqr15',boxWhiskerPercentile:5,statMethod:'anovaLsd',correlationMethod:'pearson',methodNoteVisible:true,methodNoteX:null,methodNoteY:null,methodNoteSize:10,methodNoteColor:'#5f6d75',
  significanceEnabled:true,significanceDisplay:'brackets',significancePairMode:'significant',significanceLabelMode:'stars',significanceFontSize:11,significanceLineWidth:1,significanceColor:'#20262b',significanceOffset:10,significanceStep:18,
  orientation:'vertical',donut:false,normalize:false,showRegression:true,showCorrelation:true,
  heatmapPalette:'greenMagenta',heatmapShowValues:true,heatmapCellGap:1,heatmapLowColor:'#CE5FA5',heatmapMidColor:'#D9D4C1',heatmapHighColor:'#58B66D',heatmapDiagonalColor:'#236B51',heatmapValueSize:10,heatmapXLabelSize:11,heatmapYLabelSize:11,heatmapColorBar:true,heatmapColorBarOrientation:'horizontal',heatmapCluster:'none',heatmapShowDendrogram:false,heatmapGridStroke:'#ffffff',heatmapGridStrokeWidth:.8,
  radarGridWidth:1,radarPointSize:3,radarFill:false,radarShowMarkers:true,radarLevels:4,radarMin:'auto',radarMax:'auto',radarLabelOffset:30,radarShowTickLabels:true,radarTickDecimals:0,radarTickLabelSize:11,radarTickLabelPosition:'top',radarTickLabelOffset:10,radarTheme:'rose',radarGradientMode:'radial',radarGridColor:'#c8aebc',radarSpokeColor:'#9e8794',radarGridWidth:.9,radarSpokeWidth:1.15,radarBandMode:'theme-gradient',radarSmartHighlight:true,radarHighlightThreshold:0,radarHighlightStrength:.24,
  stackedShowError:false,stackedShowValue:false,stackedValueSize:12,stackedValueDecimals:1,stackedErrorWidth:1,stackedErrorCapWidth:2.4,stackedErrorColor:'#263238',
  colorScheme:'foodchem'
};

const HEATMAP_PALETTES={
  greenMagenta:{name:'绿–米灰–品红（参考风格）',low:'#CE5FA5',mid:'#D9D4C1',high:'#58B66D',diagonal:'#236B51'},
  blueRed:{name:'蓝–白–红',low:'#3C5488',mid:'#F7F7F7',high:'#B40426',diagonal:'#7A0019'},
  purpleGreen:{name:'紫–白–绿',low:'#7E57C2',mid:'#FAFAFA',high:'#2E8B57',diagonal:'#1F6440'},
  tealOrange:{name:'青蓝–浅灰–橙红',low:'#2B8CBE',mid:'#F2F2F2',high:'#E34A33',diagonal:'#A62F1F'},
  mono:{name:'灰度',low:'#222222',mid:'#F5F5F5',high:'#777777',diagonal:'#111111'},
  custom:{name:'自定义',low:null,mid:null,high:null,diagonal:null}
};

const RADAR_THEMES={
  journal:{name:'Journal gray',grid:'#aeb8bf',spoke:'#7f8b92',inner:'#fbfcfd',outer:'#e6ebee'},
  amber:{name:'Soft amber',grid:'#c5b89d',spoke:'#9f8f70',inner:'#fffaf0',outer:'#f3ddb0'},
  rose:{name:'Soft rose',grid:'#c8aebc',spoke:'#9e8794',inner:'#fff8fb',outer:'#f2c4db'},
  blue:{name:'Soft blue',grid:'#aabcca',spoke:'#7e95a5',inner:'#f8fcff',outer:'#d3e5f2'},
  green:{name:'Soft green',grid:'#adbdad',spoke:'#809680',inner:'#f9fcf9',outer:'#d9ead9'},
  lavender:{name:'Soft lavender',grid:'#b8b0c8',spoke:'#8f86a3',inner:'#fbf9fe',outer:'#e2d9f0'}
};

const EXPERIMENT_CHARTS=['bar','line','curve','waterfall'];
const WORKFLOW_GOAL_DEFAULTS={compare:'bar',trend:'line',dist:'box',relation:'scatter',multi:'radar',composition:'stacked'};
function isExperimentChart(type){return EXPERIMENT_CHARTS.includes(type)}
function setWorkflowChart(type,{keepData=false}={}){
  state.workflow.chartType=type;
  state.workflow.mode=isExperimentChart(type)?'experiment':'gallery';
  state.chart.mode=state.workflow.mode;
  if(state.workflow.mode==='experiment'){state.chart.type=type;if((type==='line'||type==='curve')&&!keepData)state.design.factorALevelMode='auto';}
  else{state.gallery.type=type;resetGallerySettings()}
  if(!keepData){
    if(state.workflow.mode==='experiment'){state.rawData=[];state.analysisRows=[];state.descriptive=[];state.analysis=null}
    else{state.gallery.rows=[];state.gallery.analysis=null;state.gallery.sourceName=''}
  }
  syncWorkflowControls();
}
function workflowChartLabel(type){
  const map={bar:'分组柱状图',line:'带误差棒折线图',curve:'平滑曲线图',waterfall:'光谱瀑布图（3D堆叠）',hist:'直方图',kde:'核密度图 KDE',box:'箱线图',violin:'小提琴图',scatter:'散点图',bubble:'气泡图',stacked:'堆叠条形图',pie:'饼图 / 圆环图',heatmap:'相关性热力图',radar:'雷达图'};
  return map[type]||type;
}
function workflowChartEnglishLabel(type){
  const map={bar:'Grouped bar chart',line:'Line chart with error bars',curve:'Smooth curve chart',waterfall:'Spectra waterfall (3D stacked)',hist:'Histogram',kde:'Kernel density plot',box:'Boxplot',violin:'Violin plot',scatter:'Scatter plot',bubble:'Bubble plot',stacked:'Stacked bar chart',pie:'Pie or donut chart',heatmap:'Correlation heatmap',radar:'Radar chart'};
  return map[type]||String(type||'Chart');
}
function gallerySchemaEnglishName(key){return({univariate:'Univariate data',xy:'XY data',composition:'Composition data',matrix:'Multivariable matrix',radar:'Radar wide table'}[key]||'Chart data')}
function currentWorkflowSchema(){return state.workflow.mode==='experiment'?{name:'中文矩阵表（行=变量1，列=平行）',description:'第一列填变量1（组别/时间/浓度），列名带编号即独立平行（平行1、处理A-1）；同名列重复出现自动合并为重复测定。'}:GALLERY_SCHEMAS[(GALLERY_CHARTS.find(x=>x.id===state.workflow.chartType)||{}).schema]}

const state = {
  view:'plan',
  workflow:{goal:'compare',chartType:'bar',mode:'experiment',search:''},
  design:structuredClone(defaultDesign),
  rawData:[],
  analysisRows:[],
  descriptive:[],
  analysis:null,
  chartData:[],
  chart:{
    mode:'experiment', type:'bar', breakAxis:false, selected:'axis-y', selectedSeries:0, xFactor:'A',
    settings:structuredClone(defaultChartSettings), palette:[...templates.foodchem.colors], legend:{x:132,y:70}, legendFrame:{x:118,y:58,width:260,height:62,autoSize:true}, seriesStyles:{}, annotations:[], selectedAnnotation:null
  },
  gallery:{
    type:'box', rows:[], sourceName:'', analysis:null,
    settings:structuredClone(defaultGallerySettings),
    palette:[...templates.foodchem.colors], goal:'compare', showAll:false, selected:'title', selectedSeries:0, seriesStyles:{}, annotations:[], selectedAnnotation:null
  },
  figureBoard:{
    items:[],columns:2,rows:2,width:1600,height:1200,gap:24,padding:34,dpi:300,background:'#ffffff',trimWhitespace:true,
    labelEnabled:true,labelFont:'Arial',labelSize:32,labelWeight:700,labelColor:'#111111',labelPosition:'top-left',labelInsetX:8,labelInsetY:10,
    panelBorder:false,panelBorderWidth:1,panelBorderColor:'#c9d0d4',selected:0,annotations:[],selectedAnnotation:null
  }
};


function normalizeTextSettings(){
  const c=state.chart.settings,g=state.gallery.settings;
  c.titleVisible=c.titleVisible!==false;c.xTitleVisible=c.xTitleVisible!==false;c.yTitleVisible=c.yTitleVisible!==false;
  c.xTitleWeight=c.xTitleWeight??c.axisTitleWeight??400;c.yTitleWeight=c.yTitleWeight??c.axisTitleWeight??400;c.xTitleColor=c.xTitleColor||c.axisColor;c.yTitleColor=c.yTitleColor||c.axisColor;
  c.xTickSize=c.xTickSize??c.tickSize??12;c.yTickSize=c.yTickSize??c.tickSize??12;c.xTickWeight=c.xTickWeight??c.tickWeight??400;c.yTickWeight=c.yTickWeight??c.tickWeight??400;c.xTickColor=c.xTickColor||c.axisColor;c.yTickColor=c.yTickColor||c.axisColor;c.xTickAutoRotate=c.xTickAutoRotate!==false;c.xUnitSource=c.xUnitSource||'auto';c.xUnitTarget=c.xUnitTarget||'auto';
  g.titleVisible=g.titleVisible!==false;g.xTitleVisible=g.xTitleVisible!==false;g.yTitleVisible=g.yTitleVisible!==false;
  g.xTickSize=g.xTickSize??g.tickSize??12;g.yTickSize=g.yTickSize??g.tickSize??12;g.xTickWeight=g.xTickWeight??g.tickWeight??400;g.yTickWeight=g.yTickWeight??g.tickWeight??400;g.xTickColor=g.xTickColor||g.axisColor;g.yTickColor=g.yTickColor||g.axisColor;
  g.heatmapPalette=g.heatmapPalette||'greenMagenta';g.heatmapDiagonalColor=g.heatmapDiagonalColor||'#236B51';g.heatmapCluster=g.heatmapCluster||'none';g.heatmapGridStroke=g.heatmapGridStroke||'#ffffff';g.heatmapGridStrokeWidth=Number(g.heatmapGridStrokeWidth??.8);
  g.significanceEnabled=g.significanceEnabled!==false;g.significanceDisplay=g.significanceDisplay||'brackets';g.significancePairMode=g.significancePairMode||'significant';g.significanceLabelMode=g.significanceLabelMode||'stars';
  g.boxQuartileMethod=g.boxQuartileMethod||'linear7';g.boxWhiskerMethod=g.boxWhiskerMethod||'iqr15';g.boxWhiskerPercentile=Number(g.boxWhiskerPercentile)||5;g.statMethod=g.statMethod||'anovaLsd';g.correlationMethod=g.correlationMethod||'pearson';g.methodNoteVisible=g.methodNoteVisible!==false;g.methodNoteSize=g.methodNoteSize||10;g.methodNoteColor=g.methodNoteColor||'#5f6d75';
  g.radarFill=false;g.radarShowMarkers=g.radarShowMarkers!==false;g.radarLevels=Math.max(2,Number(g.radarLevels)||4);g.radarLabelOffset=Number(g.radarLabelOffset??30);g.radarShowTickLabels=g.radarShowTickLabels!==false;g.radarTickDecimals=Number.isFinite(Number(g.radarTickDecimals))?Number(g.radarTickDecimals):0;g.radarTickLabelSize=Number(g.radarTickLabelSize??11);g.radarTickLabelPosition=g.radarTickLabelPosition||'top';g.radarTickLabelOffset=Number(g.radarTickLabelOffset??10);g.radarTheme=g.radarTheme||'rose';g.radarGradientMode=g.radarGradientMode||'radial';g.radarGridColor=g.radarGridColor||'#c8aebc';g.radarSpokeColor=g.radarSpokeColor||'#9e8794';g.radarGridWidth=Number(g.radarGridWidth??.9);g.radarSpokeWidth=Number(g.radarSpokeWidth??1.15);g.radarBandMode='theme-gradient';g.radarSmartHighlight=g.radarSmartHighlight!==false;g.radarHighlightThreshold=0;g.radarHighlightStrength=Number(g.radarHighlightStrength??.24);
}

function init(){
  restoreProjectName();
  applyLastPalette();
  normalizeTextSettings();
  bindNavigation();
  bindWorkflow();
  bindDesign();
  bindData();
  bindStatistics();
  bindChartUi();
  setPropertiesPanelCollapsed(false);
  bindGallery();
  bindCompose();
  fillDesignForm();
  renderDesignPreview();
  renderDataPreview();
  showView('plan');
  ensureTourFab();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js?v='+(window.FOODLAB_BUILD||'0.96.0')).catch(()=>{});
}

function bindNavigation(){
  $$('#mainNav .nav-item, #workflowProgress [data-view]').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.view)));
  $$('[data-open]').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.open)));
  $('#nextStepBtn').addEventListener('click',()=>showView(nextViewFor(state.view)));
  $('#saveProjectBtn').addEventListener('click',saveProject);
}

function nextViewFor(view){
  return ({plan:'design',design:'data',data:'statistics',statistics:'chart',chart:'chart',compose:'compose'})[view] || 'plan';
}

function showView(view){
  state.view=view;
  $$('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${view}`));
  $$('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  const map={
    plan:['研究目的与图形','先选择研究问题，再从同一图形库中选择合适的图。','填写基本实验信息'],
    design:['基本实验信息','填写实验名称、指标、因素水平与重复设计。','进入模板与导入'],
    data:['数据模板与导入','下载当前图形匹配的模板，再导入原始数据。','进入初步分析'],
    statistics:['初步分析','查看与当前图形和数据结构匹配的统计摘要。','进入 Chart Studio'],
    chart:['Chart Studio','统一编辑坐标轴、标题、图例、误差棒与图形专属属性。','留在 Chart Studio'],
    compose:['论文拼图','组合多张已完成图，自动添加 A、B、C、D 面板标签。','留在论文拼图']
  };
  const m=map[view]||map.plan;
  $('#pageTitle').textContent=m[0]; $('#pageSubtitle').textContent=m[1]; $('#nextStepBtn').textContent=m[2];
  const stepMap={plan:1,design:2,data:3,statistics:4,chart:5};
  const step=stepMap[view]||null;
  const stepLabel=$('#pageStepLabel');if(stepLabel)stepLabel.textContent=step?`步骤 ${step} / 5`:'论文输出';
  $$('[data-view]').forEach(el=>{if(el.closest('#mainNav')||el.closest('#workflowProgress'))el.classList.toggle('active',el.dataset.view===view)});
  const topChart=$('#topCurrentChart');if(topChart)topChart.textContent=workflowChartLabel(state.workflow.chartType);
  const sideChart=$('#sidebarChartName');if(sideChart)sideChart.textContent=workflowChartLabel(state.workflow.chartType);
  const sideProject=$('#sidebarProjectName');if(sideProject)sideProject.textContent=state.design.experimentName||'未命名项目';
  if(view==='plan'){syncWorkflowControls();renderPlanSelector()}
  if(view==='design'){syncWorkflowControls();renderDesignPreview();syncStepLabels()}
  if(view==='data'){syncWorkflowControls();renderDataPreview()}
  if(view==='statistics') renderStatistics();
  if(view==='chart')scheduleChartEntryRender();
  if(view==='compose')renderComposeWorkspace();
}

function bindWorkflow(){
  const goal=$('#workflowGoal'),chart=$('#workflowChartType');
  goal?.addEventListener('change',()=>{
    state.workflow.goal=goal.value;
    const next=WORKFLOW_GOAL_DEFAULTS[goal.value]||'bar';
    setWorkflowChart(next);
    renderPlanSelector();renderDesignPreview();renderDataPreview();
  });
  chart?.addEventListener('change',()=>{
    setWorkflowChart(chart.value);
    renderPlanSelector();renderDesignPreview();renderDataPreview();
  });
  $('#chartSearch')?.addEventListener('input',e=>{state.workflow.search=e.target.value.trim().toLowerCase();renderPlanSelector()});
  $('#downloadCurrentXlsx')?.addEventListener('click',()=>state.workflow.mode==='experiment'?downloadTemplateXlsx():downloadGalleryXlsx());
  $('#downloadCurrentCsv')?.addEventListener('click',()=>state.workflow.mode==='experiment'?downloadTemplateCsv():downloadGalleryCsv());
  $('#studioChartTypeSelect')?.addEventListener('change',e=>{
    const type=e.target.value;
    const mode=isExperimentChart(type)?'experiment':'gallery';
    const hasData=mode==='experiment'?state.rawData.length:state.gallery.rows.length;
    state.workflow.chartType=type;state.workflow.mode=mode;state.chart.mode=mode;
    if(mode==='experiment')state.chart.type=type;else state.gallery.type=type;
    syncWorkflowControls();
    if(!hasData){toast('当前图形需要对应数据模板，请先在数据导入步骤加载数据。');showView('data');return}
    renderChartStudio();
  });
  $('#openGuideFromStudio')?.addEventListener('click',()=>showView('plan'));
  syncWorkflowControls();
}
function syncWorkflowControls(){
  const goal=$('#workflowGoal'),chart=$('#workflowChartType'),studio=$('#studioChartTypeSelect');
  if(goal)goal.value=state.workflow.goal;
  if(chart)chart.value=state.workflow.chartType;
  if(studio)studio.value=state.workflow.chartType;
  const hint=$('#workflowGoalHint');if(hint){const g=GALLERY_GOALS?.find?.(x=>x.id===state.workflow.goal);hint.textContent=g?.desc||'系统会据此推荐图形和模板。'}
  const chartHint=$('#workflowChartHint');if(chartHint)chartHint.textContent=`${workflowChartLabel(state.workflow.chartType)}将贯穿模板、初步分析和 Chart Studio。`;
  const schema=currentWorkflowSchema();
  const n=$('#currentTemplateName'),d=$('#currentTemplateDescription');if(n)n.textContent=schema?.name||'当前数据模板';if(d)d.textContent=schema?.description||'';
  $$('.experiment-only').forEach(el=>el.classList.toggle('hidden',state.workflow.mode!=='experiment'));toggleFactorB();toggleTechnicalAggregation();syncFactorLevelMode();syncStepLabels();
  const top=$('#topCurrentChart');if(top)top.textContent=workflowChartLabel(state.workflow.chartType);
  const side=$('#sidebarChartName');if(side)side.textContent=workflowChartLabel(state.workflow.chartType);
}


const PLAN_CHART_META={
  bar:{group:'趋势与组间差异',icon:'▥',purpose:'比较不同处理组或不同时间点的均值差异',analysis:'描述统计、单/双因素 ANOVA、显著性字母',advice:'适合 Mean ± SD/SE 的常规食品实验论文图',schema:'中文矩阵表'},
  line:{group:'趋势与组间差异',icon:'⌁',purpose:'展示储藏时间、温度或浓度变化趋势',analysis:'描述统计、ANOVA、误差棒和显著性字母',advice:'食品品质随时间变化的优先图形',schema:'中文矩阵表'},
  waterfall:{group:'3维',icon:'≋',purpose:'多层光谱/曲线沿纵深堆叠，展示随时间或条件的演化',analysis:'每层一条曲线，层间自动错开，无需重复',advice:'紫外/荧光光谱随时间变化的论文常用图：第一列填波长/横轴，其余每列一个时间点',schema:'光谱宽表（第一列波长）'},
  curve:{group:'趋势与组间差异',icon:'∿',purpose:'展示数据点较密集的连续变化趋势',analysis:'趋势摘要与连续数据检查',advice:'仅平滑连线，不擅自修改原始数值；默认不显示误差棒',schema:'中文矩阵表'},
  hist:{group:'单变量分布',icon:'▥',purpose:'查看连续数值的频数分布、偏态和集中区间',analysis:'n、Mean、SD、Median、范围与分箱频数',advice:'适合判断分布形态，可与 KDE 配合',schema:'单变量长表'},
  kde:{group:'单变量分布',icon:'∿',purpose:'平滑展示一组或多组数据的密度形态',analysis:'n、Mean、SD、Median、带宽与密度估计',advice:'用于观察偏态、多峰和组间分布差异',schema:'单变量长表'},
  box:{group:'单变量分布',icon:'▣',purpose:'比较中位数、四分位数、离散程度和异常值',analysis:'n、Mean、SD、Median、Q1、Q3、IQR异常值',advice:'食品实验高频使用，通常优先于只显示均值的柱状图',schema:'单变量长表'},
  violin:{group:'单变量分布',icon:'◖◗',purpose:'同时展示分位数与数据密度分布',analysis:'箱线统计、KDE 密度与异常值摘要',advice:'样本量较多时比箱线图提供更多分布信息',schema:'单变量长表'},
  scatter:{group:'变量关系',icon:'⠿',purpose:'分析两个连续变量之间的相关和回归关系',analysis:'Pearson r、线性回归、斜率、截距与 R²',advice:'两个连续变量关系的首选图',schema:'XY 关系长表'},
  bubble:{group:'变量关系',icon:'◉',purpose:'同时表达 X、Y 和第三个大小变量',analysis:'Pearson r、回归与气泡变量范围',advice:'适合三变量表达，但应避免气泡差异过度夸张',schema:'XY 关系长表'},
  heatmap:{group:'变量关系',icon:'▦',purpose:'查看多个理化指标之间的相关矩阵',analysis:'Pearson 相关矩阵与指标数量摘要',advice:'相关不等于因果，正式论文应结合显著性和样本量',schema:'多指标矩阵'},
  stacked:{group:'组成与综合评价',icon:'▤',purpose:'比较不同类别内部的组分构成',analysis:'类别总量、组分值与百分比',advice:'组分构成优先使用堆叠或百分比堆叠柱状图',schema:'组成数据长表'},
  pie:{group:'组成与综合评价',icon:'◔',purpose:'展示少量类别在总体中的构成占比',analysis:'总量与各组分百分比',advice:'学术论文谨慎使用；精确比较优先选条形图',schema:'组成数据长表'},
  radar:{group:'组成与综合评价',icon:'✦',purpose:'同步比较多个感官或理化指标的综合表现',analysis:'组别、指标数、组均值和可选 0–1 归一化',advice:'不同量纲指标必须先标准化再比较形状',schema:'雷达图长表'}
};
const PLAN_GROUP_ORDER=['趋势与组间差异','3维','单变量分布','变量关系','组成与综合评价'];
function goalRecommendedIds(goal){
  const map={compare:['box','bar','violin','line'],trend:['line','curve','bar'],dist:['box','violin','hist','kde'],relation:['scatter','bubble','heatmap'],multi:['radar','heatmap'],composition:['stacked','pie']};
  return map[goal]||[];
}
function syncStepLabels(){
  const label=workflowChartLabel(state.workflow.chartType),schema=currentWorkflowSchema();
  const a=$('#designCurrentChart');if(a)a.textContent=label;
  const b=$('#designSchemaName');if(b)b.textContent=schema?.name||'当前模板';
  const c=$('#designSchemaDescription');if(c)c.textContent=schema?.description||'';
  const d=$('#studioContextTitle');if(d)d.textContent=`Chart Studio · ${label}`;
}
function renderPlanSelector(){
  const holder=$('#planChartGroups');if(!holder)return;
  const goals=[
    ['compare','比较处理组'],['trend','时间 / 浓度趋势'],['dist','数据分布'],['relation','变量关系'],['multi','综合评价'],['composition','组分构成']
  ];
  const tabs=$('#goalTabs');
  if(tabs){
    tabs.innerHTML=goals.map(([id,name])=>`<button class="goal-tab ${state.workflow.goal===id?'active':''}" data-goal-tab="${id}">${name}</button>`).join('');
    $$('[data-goal-tab]').forEach(btn=>btn.addEventListener('click',()=>{
      state.workflow.goal=btn.dataset.goalTab;
      const next=WORKFLOW_GOAL_DEFAULTS[state.workflow.goal]||'bar';
      setWorkflowChart(next);
      renderPlanSelector();renderDesignPreview();renderDataPreview();
    }));
  }
  const recommended=goalRecommendedIds(state.workflow.goal),q=state.workflow.search||'';
  holder.innerHTML=PLAN_GROUP_ORDER.map(group=>{
    const ids=Object.keys(PLAN_CHART_META).filter(id=>{
      if(PLAN_CHART_META[id].group!==group)return false;
      if(!q)return true;
      const hay=[workflowChartLabel(id),PLAN_CHART_META[id].purpose,PLAN_CHART_META[id].schema,group].join(' ').toLowerCase();
      return hay.includes(q);
    });
    if(!ids.length)return'';
    return `<div class="plan-chart-section"><div class="plan-chart-section-head"><b>${esc(group)}</b><span>${ids.length} 种</span></div><div class="plan-chart-grid">${ids.map(id=>{
      const m=PLAN_CHART_META[id],active=state.workflow.chartType===id,rec=recommended.includes(id);
      return `<button class="plan-chart-card ${active?'active':''}" data-plan-chart="${id}"><span class="chart-card-icon">${m.icon}</span><span class="chart-card-copy"><b>${esc(workflowChartLabel(id))}</b><small>${esc(m.purpose)}</small></span>${rec?'<em>推荐</em>':''}<i>${esc(m.schema)}</i></button>`;
    }).join('')}</div></div>`;
  }).join('')||'<div class="empty-state">没有找到匹配图形</div>';
  $$('[data-plan-chart]').forEach(btn=>btn.addEventListener('click',()=>{
    const type=btn.dataset.planChart;
    setWorkflowChart(type);
    renderPlanSelector();renderDesignPreview();renderDataPreview();syncStepLabels();
  }));
  const meta=PLAN_CHART_META[state.workflow.chartType]||PLAN_CHART_META.bar;
  const set=(id,value)=>{const el=$(id);if(el)el.textContent=value};
  set('#planChartIcon',meta.icon);set('#planChartTitle',workflowChartLabel(state.workflow.chartType));set('#planPurposeText',meta.purpose);set('#planSchemaText',meta.schema);set('#planAnalysisText',meta.analysis);set('#planAdviceText',meta.advice);
  set('#topCurrentChart',workflowChartLabel(state.workflow.chartType));set('#sidebarChartName',workflowChartLabel(state.workflow.chartType));
  const count=$('#planSupportedCount');if(count)count.textContent=`${Object.keys(PLAN_CHART_META).length} 种图`;
  const search=$('#chartSearch');if(search&&document.activeElement!==search)search.value=state.workflow.search||'';
}

function bindDesign(){
  // v0.18.0: 高级实验设计面板已移除，这里只保留步骤 1 的项目名称输入。
  const nameInput=$('#experimentName');
  if(nameInput){
    const apply=()=>{state.design.experimentName=nameInput.value.trim();renderDesignPreview();syncProjectNameUi();};
    nameInput.addEventListener('input',apply);
    nameInput.addEventListener('change',apply);
  }
  $('#applyDesign')?.addEventListener('click',()=>toast('项目名称已保存'));
  $('#loadDesignDemo')?.addEventListener('click',()=>{state.design=structuredClone(defaultDesign);fillDesignForm();renderDesignPreview();toast('已载入示例信息')});
  $('#downloadXlsx')?.addEventListener('click',()=>state.workflow.mode==='experiment'?downloadTemplateXlsx():downloadGalleryXlsx());
  $('#downloadCsv')?.addEventListener('click',()=>state.workflow.mode==='experiment'?downloadTemplateCsv():downloadGalleryCsv());
}

function fillDesignForm(){
  // v0.18.0: 面板已移除，只同步项目名称；因素水平、平行样本数等结构来自默认值或导入识别。
  const input=$('#experimentName');
  if(input&&document.activeElement!==input)input.value=state.design.experimentName||'';
  syncProjectNameUi();
}

function splitLevels(text){ return [...new Set(String(text).split(/[,，;；\n]+/).map(x=>x.trim()).filter(Boolean))]; }

function readDesignForm(showErrors=true){
  // v0.18.0: 面板已移除。实验结构（因素水平、平行样本数、误差棒类型）全部由导入数据
  // 自动识别，因此这里只同步项目名称，不再做表单校验。
  const input=$('#experimentName');
  if(input)state.design.experimentName=input.value.trim();
  return true;
}

function toggleFactorB(){ const typeEl=$('#designType'); const on=state.workflow.mode==='experiment'&&(typeEl?typeEl.value==='two':state.design.designType==='two'); $$('.factor-b').forEach(el=>el.classList.toggle('hidden',!on)); }
function autoXCapable(type=state.workflow.chartType,designType=$('#designType')?.value||state.design.designType){return type==='line'||type==='curve'||(type==='bar'&&designType==='two')}
function usesAutomaticXLevels(d=state.design,type=state.workflow.chartType){return (d.factorALevelMode||'manual')==='auto'&&autoXCapable(type,d.designType)}
function syncFactorLevelMode(){
  const select=$('#factorALevelMode'),manual=$('#factorALevelsField'),auto=$('#factorAAutoField');if(!select)return;
  const capable=autoXCapable(),isAuto=capable&&select.value==='auto';
  if(!capable){select.value='manual';select.disabled=true;if($('#factorALevels')&&!$('#factorALevels').value)$('#factorALevels').value=(state.design.factorALevels||[]).join(', ')}else select.disabled=false;
  manual?.classList.toggle('hidden',isAuto);auto?.classList.toggle('hidden',!isAuto);
  const status=$('#factorAAutoStatus');if(status){const levels=state.design.factorALevels||[];status.textContent=levels.length?`已识别 ${levels.length} 个水平：${levels.slice(0,3).join('、')}${levels.length>3?' … '+levels.at(-1):''}`:'等待导入，第一列可包含任意数量数据点'}
}
function toggleTechnicalAggregation(){ const el=$('#selectedTechnicalField'); if(!el)return; el.classList.toggle('hidden',$('#technicalAggregation')?.value!=='selected'); const max=Math.max(1,Number($('#technicalRepeats')?.value)||1); if($('#selectedTechnical')){$('#selectedTechnical').max=max; if(Number($('#selectedTechnical').value)>max)$('#selectedTechnical').value=max;} }

function aggregationLabel(d=state.design){
  if((d.technicalRepeats||1)<=1)return '无技术重复，直接使用独立平行值';
  if(d.technicalAggregation==='median')return '技术重复取中位数';
  if(d.technicalAggregation==='selected')return `统一使用 T${d.selectedTechnical||1}`;
  return '技术重复取平均值';
}
function parallelLabel(i){return `R${i}`}
function technicalLabel(i){return `T${i}`}
function xlsxColumnName(index){let n=index+1,s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s}

function experimentTemplateSpec(){
  const d=state.design,type=state.workflow.chartType;
  if(type==='waterfall'){const layers=['系列A','系列B','系列C'];const headers=['横轴＼层',...layers];const w=headers.length;const br=Array.from({length:12},()=>Array(w).fill(''));return {mode:'matrix-template',name:'光谱瀑布图 · 矩阵模板',description:'光谱瀑布图矩阵模板：第一列填横轴点（波长/浓度等连续值），后面每一列是一个层（时间点/条件），单元格填数值；列名即右侧 Z 轴层名。想加层就再加列，想多加横轴点就往下粘贴。',groups:layers,xLevels:[],xHeader:'横轴＼层',pCount:1,tCount:1,headerDepth:1,columns:[],width:w,matrix:[headers,...br],merges:[],flatHeaders:headers.slice(),flatRows:Array.from({length:12},()=>Array(w).fill('')),summary:null,autoX:false};}
  const chartLabel=type==='bar'?'柱状图':type==='line'?'折线图':'曲线图';
  const groups=['A组','B组','C组','D组'];
  const headers=['x',...groups];
  const width=headers.length;
  const blankRows=Array.from({length:12},()=>Array(width).fill(''));
  const name=chartLabel+' · 矩阵模板';
  const description=chartLabel+'矩阵模板：第一列 x 填横轴值，后面 A组、B组、C组、D组 是组别列；样品在哪组测定，就在哪列填数值，其他列留空。同一个名字出现多次自动合并为重复测定。';
  return {mode:'matrix-template',name,description,groups,xLevels:[],xHeader:'x',pCount:3,tCount:1,headerDepth:1,columns:[],width,matrix:[headers,...blankRows],merges:[],flatHeaders:headers.slice(),flatRows:Array.from({length:12},()=>Array(width).fill('')),summary:null,autoX:false};
}
function templateRows(){return experimentTemplateSpec().flatRows}

function renderExperimentHeaderHtml(spec){
  let html='<thead><tr>';
  (spec.matrix[0]||[]).forEach((h,i)=>html+='<th'+(i===0||i===spec.width-1?' rowspan="1"':'')+'>'+esc(h)+'</th>');
  return html+'</tr></thead>';
}

function renderDesignPreview(){
  // v0.18.0: 高级实验设计面板已移除；保留此函数，既有补丁仍会调用它（它们都自行判空）。
  if(!$('#designPreviewTable'))return;
  const d=state.design;
  if(state.workflow.mode==='gallery'){
    const schema=currentWorkflowSchema(),rows=galleryTemplateRows(state.workflow.chartType),preview=rows.slice(0,12),headers=schema.columns;
    $('#designSummaryText').textContent=`${workflowChartLabel(state.workflow.chartType)} · ${schema.name} · 按图形模板导入`;
    $('#templateRowCount').textContent=`${schema.name} · ${rows.length} 行示例`;
    let html=`<thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    preview.forEach(r=>html+=`<tr>${headers.map(h=>`<td>${esc(r[h]??'待填写')}</td>`).join('')}</tr>`);
    if(rows.length>preview.length)html+=`<tr><td colspan="${headers.length}" class="empty-row">……其余 ${rows.length-preview.length} 行将在模板中完整生成</td></tr>`;
    $('#designPreviewTable').innerHTML=html+'</tbody>';syncWorkflowControls();return;
  }
  const spec=experimentTemplateSpec(),preview=spec.autoX?['在第一列粘贴第 1 个 X 值','在第一列粘贴第 2 个 X 值','……可继续粘贴至上千行']:spec.xLevels.slice(0,10);
  const independentCount=spec.autoX?'导入后自动统计':spec.xLevels.length*spec.groups.length*spec.pCount;
  $('#designSummaryText').textContent=`${workflowChartLabel(state.workflow.chartType)} · ${spec.name} · 每个条件 ${spec.pCount} 个独立平行${spec.tCount>1?` × ${spec.tCount} 次技术测定`:''}`;
  $('#templateRowCount').textContent=spec.autoX?`${spec.groups.length} 个条件 · X 水平自动识别 · ${aggregationLabel(d)}`:`${spec.groups.length} 个条件 · ${independentCount} 个独立样品 · ${aggregationLabel(d)}`;
  let html=renderExperimentHeaderHtml(spec)+'<tbody>';
  preview.forEach(x=>{html+=`<tr><td>${esc(x)}</td>${spec.columns.map(()=>'<td class="muted-cell">待填写</td>').join('')}<td></td></tr>`});
  if(spec.autoX)html+=`<tr><td colspan="${spec.width}" class="empty-row">模板不限制行数；导入时从第一列自动读取全部 X 水平和顺序</td></tr>`;else if(spec.xLevels.length>preview.length)html+=`<tr><td colspan="${spec.width}" class="empty-row">……其余 ${spec.xLevels.length-preview.length} 行将在模板中完整生成</td></tr>`;
  $('#designPreviewTable').innerHTML=html+'</tbody>';syncWorkflowControls();
}

function designConfigRows(){
  const d=state.design,spec=state.workflow.mode==='experiment'?experimentTemplateSpec():null; return [
    ['Configuration','Value'],['FoodLab Template Version','0.9.5'],['Experiment name',d.experimentName],['Research goal',state.workflow.goal],['Planned chart',workflowChartEnglishLabel(state.workflow.chartType)],['Measured variable',d.metricName],['Unit',d.metricUnit],
    ['Experimental design',d.designType==='two'?'Two-factor':'One-factor'],['Factor A',d.factorAName],['Factor A level source',d.factorALevelMode||'manual'],['Factor A levels',usesAutomaticXLevels(d)?'Read automatically from the first column':d.factorALevels.join('|')],['Factor B',d.factorBName],['Factor B levels',d.factorBLevels.join('|')],
    ['Independent replicates',d.parallelSamples],['Technical measurements per replicate',d.technicalRepeats],['Technical measurement aggregation',d.technicalAggregation||'mean'],['Selected technical measurement',d.selectedTechnical||1],['Error bar',d.errorType],['Data layout','中文矩阵表（行=变量1，列=平行或组名-编号）'],['Data layout description','第一列填变量1（组别/时间），后面列名带编号为独立平行（平行1、处理A-1）；同名列重复出现自动合并为重复测定。']
  ];
}

function setFormulaCell(ws,r,c,formula){const address=XLSX.utils.encode_cell({r,c});if(!ws[address])ws[address]={t:'n'};ws[address].f=formula}
function applyTemplateSheetLayout(ws,spec){
  ws['!merges']=spec.merges;ws['!cols']=Array.from({length:spec.width},(_,i)=>({wch:i===0?Math.max(15,String(spec.xHeader).length+5):i===spec.width-1?18:11}));
  ws['!rows']=Array.from({length:spec.headerDepth},()=>({hpt:23}));
  ws['!freeze']={xSplit:1,ySplit:spec.headerDepth,topLeftCell:`B${spec.headerDepth+1}`,activePane:'bottomRight',state:'frozen'};
}

function downloadTemplateXlsx(){
  if(!readDesignForm(true))return;
  if(!window.XLSX){downloadTemplateCsv();toast('Excel 组件未加载，已改为下载 CSV 模板');return;}
  const wb=XLSX.utils.book_new(),spec=experimentTemplateSpec();
  const ws=XLSX.utils.aoa_to_sheet(spec.matrix);applyTemplateSheetLayout(ws,spec);
  XLSX.utils.book_append_sheet(wb,ws,'Data');
  if(spec.summary){
    const sws=XLSX.utils.aoa_to_sheet(spec.summary.matrix);sws['!merges']=spec.summary.merges;
    sws['!cols']=Array.from({length:spec.summary.width},(_,i)=>({wch:i===0?Math.max(15,String(spec.xHeader).length+5):i===spec.summary.width-1?18:11}));
    sws['!freeze']={xSplit:1,ySplit:2,topLeftCell:'B3',activePane:'bottomRight',state:'frozen'};
    spec.summary.formulaCells.forEach(x=>setFormulaCell(sws,x.r,x.c,x.formula));
    XLSX.utils.book_append_sheet(wb,sws,'Replicate Summary (Auto)');
  }
  const guide=XLSX.utils.aoa_to_sheet([
    ['FoodLab 实验图中文矩阵模板'],
    ['当前格式','中文矩阵表（最常见的表格形式）'],
    ['填写说明',state.workflow.chartType==='waterfall'?'光谱瀑布图：第一列填横轴点（波长/时间等连续值），后面每一列是一个层（时间点/条件），单元格填数值，列名即右侧 Z 轴层名；想加层就再加列，想加点就往下粘。':'第一列填变量1（组别/时间/浓度等），后面每列填变量2的一个测定值'],
    ['平行识别','列名带编号即独立平行：如“平行1、平行2、平行3”是同一指标的3个独立平行；多组时列名写“组名-编号”，如 处理A-1、处理A-2'],
    ['重复识别','同一个列名重复出现（如“处理A-1”出现两次）自动合并为重复测定，不增加样本量'],
    ['示例','第一行：组别 平行1 平行2 平行3；数据行：0天 10 11 10.5 / 5天 14 13.5 14.2'],
    ['缺值处理','留空即可，不要填 0、横线或文字'],
    ['导入','填写完成后直接导入即可，无需修改任何设置']
  ]);guide['!cols']=[{wch:18},{wch:100}];
  XLSX.utils.book_append_sheet(wb,guide,'Instructions');
  XLSX.writeFile(wb,`${safeFile(state.design.experimentName)}_${safeFile(state.workflow.chartType)}_matrix_template.xlsx`);toast(spec.autoX?'自动识别变量1的 Excel 模板已生成':'中文矩阵 Excel 模板已生成');
}

function downloadTemplateCsv(){
  if(!readDesignForm(true))return;
  const spec=experimentTemplateSpec(),csv='\ufeff'+[spec.flatHeaders,...spec.flatRows].map(row=>row.map(csvCell).join(',')).join('\r\n');
  download(new Blob([csv],{type:'text/csv;charset=utf-8'}),`${safeFile(state.design.experimentName)}_${safeFile(state.workflow.chartType)}_matrix_template.csv`);toast(spec.autoX?'CSV 只生成表头；第一列可粘贴任意数量变量1的值':'CSV 使用中文矩阵表头（行=变量1，列=平行/组名-编号）');
}

function bindData(){
  $('#chooseFile').addEventListener('click',()=>$('#fileInput').click());
  $('#fileInput').addEventListener('change',e=>{if(e.target.files[0])handleUnifiedFile(e.target.files[0])});
  const dz=$('#dropZone');
  ['dragenter','dragover'].forEach(name=>dz.addEventListener(name,e=>{e.preventDefault();dz.classList.add('dragover')}));
  ['dragleave','drop'].forEach(name=>dz.addEventListener(name,e=>{e.preventDefault();dz.classList.remove('dragover')}));
  dz.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)handleUnifiedFile(f)});
  $('#loadRawDemo').addEventListener('click',()=>{if(state.workflow.mode==='experiment')loadRawDemo();else{state.gallery.type=state.workflow.chartType;loadGalleryDemo();renderDataPreview();showValidation('success','已载入图形示例数据',`${workflowChartLabel(state.workflow.chartType)} · ${state.gallery.rows.length} 行`)}});
  $('#pasteToggle').addEventListener('click',()=>$('#pasteBox').classList.toggle('hidden'));
  $('#parsePasted').addEventListener('click',()=>{const rows=parseDelimited($('#dataText').value);if(state.workflow.mode==='experiment')processImported(rows,'粘贴数据');else processGalleryImported(rows,'粘贴数据')});
  $('#clearData').addEventListener('click',()=>{state.rawData=[];state.analysisRows=[];state.descriptive=[];state.analysis=null;state.gallery.rows=[];state.gallery.analysis=null;state.gallery.sourceName='';renderDataPreview();showValidation('neutral','数据已清空','请导入当前项目模板。')});
  // v0.21.0: in-page spreadsheet editor.
  $('#inlineEditToggle').addEventListener('click',()=>{const box=$('#inlineEditBox');box.classList.toggle('hidden');if(!box.classList.contains('hidden'))renderInlineEditor()});
  $('#inlineAddRow').addEventListener('click',addInlineEditorRow);
  $('#inlineAddCol').addEventListener('click',addInlineEditorCol);
  $('#inlineApply').addEventListener('click',applyInlineEditor);
  $('#inlineCancel').addEventListener('click',()=>$('#inlineEditBox').classList.add('hidden'));
  bindInlineEditor();
  $('#goStatistics').addEventListener('click',()=>{if(state.workflow.mode==='experiment')analyzeData();else analyzeGalleryData();showView('statistics')});
}

async function handleUnifiedFile(file){
  if(state.workflow.mode==='experiment')return handleFile(file);
  try{
    let rows;
    if(/\.(csv|tsv)$/i.test(file.name))rows=parseDelimited(await file.text());
    else{
      if(!window.XLSX)throw new Error('Excel 组件未加载，请刷新页面或使用 CSV 模板。');
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),name=wb.SheetNames.includes('Data')?'Data':wb.SheetNames[0];
      rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:''});
    }
    processGalleryImported(rows,file.name);
  }catch(err){showValidation('error','导入失败',err.message||'无法读取文件');toast(err.message||'导入失败')}
}
function processGalleryImported(rows,source){
  state.gallery.type=state.workflow.chartType;
  const normalized=normalizeGalleryRows(rows,galleryDef().schema);
  if(!normalized.length){showValidation('error','没有读取到有效数据',`当前需要 ${currentWorkflowSchema().name}。请使用平台生成的模板。`);return}
  state.gallery.rows=normalized;state.gallery.sourceName=source;analyzeGalleryData();renderDataPreview();
  showValidation('success',`导入成功：${normalized.length} 行`,`${workflowChartLabel(state.workflow.chartType)} · ${currentWorkflowSchema().name} · ${source}`);toast('数据已导入并完成初步分析');
}

/* ---------- v0.21.0: in-page spreadsheet editor (no download needed) ---------- */
function inlineEditorHeaders(){
  if(state.inlineCols&&state.inlineCols.length)return state.inlineCols;
  state.inlineCols=inlineEditorColumns();
  return state.inlineCols;
}
function renderInlineEditor(){
  const box=$('#inlineEditTable');if(!box)return;
  try{
    // Reset to the current chart's template columns every time the editor
    // opens, so columns always match the active chart type.
    state.inlineCols=inlineEditorColumns();
    const headers=state.inlineCols;
    let html=`<thead><tr><th class="inline-del-head"></th>${headers.map((h,hi)=>`<th data-col="${esc(h)}">${hi===0?'':`<button type="button" class="inline-col-del" title="删除此列">✕</button>`}<span class="inline-col-name">${esc(h)}</span></th>`).join('')}</tr></thead><tbody>`;
    inlineEditorSeedRows(headers).forEach((row,i)=>{
      html+=`<tr><td class="inline-del"><button type="button" class="inline-del-btn" title="删除此行">✕</button></td>${headers.map(h=>`<td><input class="inline-cell" data-col="${esc(h)}" data-row="${i}" value="${esc(row[h]??'')}" spellcheck="false"></td>`).join('')}</tr>`;
    });
    box.innerHTML=html+'</tbody>';
  }catch(err){console.error('[inline editor]',err)}
}
function inlineEditorSeedRows(headers){
  const rows=state.gallery.rows;
  if(!rows.length)return [Object.fromEntries(headers.map(h=>[h,'']))];
  if(state.workflow.chartType==='stacked'){
    const cats=[...new Set(rows.map(r=>r.Category))];
    return cats.map(c=>{
      const row={Category:c};
      headers.slice(1).forEach(cp=>{const r=rows.find(x=>x.Category===c&&x.Component===cp);row[cp]=r?r.Value:''});
      return row;
    });
  }
  return rows.slice(0,Math.min(rows.length,30)).map(r=>{
    const row={};headers.forEach(h=>{row[h]=r[h]??''});return row;
  });
}
function addInlineEditorRow(){
  const table=$('#inlineEditTable');if(!table)return;
  const headers=inlineEditorHeaders(),tb=table.querySelector('tbody');
  const tr=document.createElement('tr');
  tr.innerHTML=`<td class="inline-del"><button type="button" class="inline-del-btn" title="删除此行">✕</button></td>${headers.map(h=>`<td><input class="inline-cell" data-col="${esc(h)}" data-row="${tb.children.length}" value="" spellcheck="false"></td>`).join('')}`;
  tb.appendChild(tr);
}
// v0.22.1: add a column to the live table. Component charts (stacked/pie)
// auto-name it "Component N", anything else "Column N". The first column is
// the category/group key and can never be deleted or renamed.
function addInlineEditorCol(){
  const table=$('#inlineEditTable');if(!table)return;
  const headers=inlineEditorHeaders(),tb=table.querySelector('tbody');
  let name='Column '+(headers.length);
  const compNums=headers.slice(1).map(c=>{const m=String(c).match(/^Component (\d+)$/);return m?Number(m[1]):null}).filter(n=>n!==null);
  if(compNums.length){let next=1;while(compNums.includes(next))next++;name='Component '+next;}
  if(headers.includes(name)){let n=2;while(headers.includes(name+' ('+n+')'))n++;name=name+' ('+n+')';}
  state.inlineCols=[...headers,name];
  const th=document.createElement('th');
  th.dataset.col=name;
  th.innerHTML=`<button type="button" class="inline-col-del" title="删除此列">✕</button><span class="inline-col-name">${esc(name)}</span>`;
  table.querySelector('thead tr').appendChild(th);
  tb.querySelectorAll('tr').forEach(tr=>{
    const td=document.createElement('td');
    td.innerHTML=`<input class="inline-cell" data-col="${esc(name)}" value="" spellcheck="false">`;
    tr.appendChild(td);
  });
}
function applyInlineEditor(){
  if(state.workflow.mode!=='gallery')return;
  const table=$('#inlineEditTable');if(!table)return;
  const headers=inlineEditorHeaders(),raw=[];
  table.querySelectorAll('tbody tr').forEach(tr=>{
    const row={};tr.querySelectorAll('input.inline-cell').forEach(inp=>{row[inp.dataset.col]=inp.value.trim()});
    if(headers.every(h=>String(row[h]??'')===''))return;
    raw.push(row);
  });
  if(!raw.length){showValidation('error','表格为空','请先填写至少一行数据，再点击"应用数据到图表"。');return}
  const normalized=normalizeGalleryRows(raw,galleryDef().schema);
  if(!normalized.length){showValidation('error','没有读取到有效数据','请检查数值列是否填写了数字。');return}
  state.gallery.rows=normalized;state.gallery.sourceName='在线填写';
  analyzeGalleryData();renderDataPreview();
  try{renderGallery()}catch(_e){}
  showValidation('success',`已应用在线数据：${normalized.length} 行`,`${workflowChartLabel(state.workflow.chartType)} · ${currentWorkflowSchema().name}`);toast('在线数据已应用');
}
/* v0.22.0: spreadsheet-like behaviours — click to select, Excel-style multi
   cell paste, Enter moves down, ✕ removes a row. v0.22.1 adds column add /
   remove and double-click rename. Bound once via delegation so it survives
   re-renders. */
function bindInlineEditor(){
  const table=$('#inlineEditTable');if(!table)return;
  table.addEventListener('click',e=>{
    const del=e.target.closest('.inline-del-btn');
    if(del){const tr=del.closest('tr');if(tr)tr.remove();return;}
    const colDel=e.target.closest('.inline-col-del');
    if(colDel){
      const th=colDel.closest('th');
      const idx=th?[...th.parentElement.children].indexOf(th):-1;
      if(idx<=1){toast('第一列是分类/组别列，不能删除');return;}
      const col=th.dataset.col;
      state.inlineCols=(state.inlineCols||[]).filter(c=>c!==col);
      th.remove();
      table.querySelectorAll('tbody tr').forEach(tr=>{const cell=tr.children[idx];if(cell)cell.remove()});
      return;
    }
    const input=e.target.closest('input.inline-cell');
    if(input){table.querySelectorAll('input.inline-cell.selected').forEach(x=>x.classList.remove('selected'));input.classList.add('selected');}
  });
  table.addEventListener('dblclick',e=>{
    const th=e.target.closest('th');
    if(!th||!th.dataset.col)return;
    const idx=[...th.parentElement.children].indexOf(th);
    if(idx<=1){toast('第一列是分类/组别列，不能改名');return;}
    const old=th.dataset.col;
    const name=(prompt('输入新列名：',old)||'').trim();
    if(!name||name===old)return;
    if((state.inlineCols||[]).includes(name)){toast('该列名已存在');return;}
    state.inlineCols=(state.inlineCols||[]).map(c=>c===old?name:c);
    th.dataset.col=name;
    const label=th.querySelector('.inline-col-name');if(label)label.textContent=name;
    table.querySelectorAll('tbody tr').forEach(tr=>{const cell=tr.children[idx];if(cell){const inp=cell.querySelector('input.inline-cell');if(inp)inp.dataset.col=name;}});
  });
  table.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||!(e.target instanceof HTMLInputElement)||!e.target.classList.contains('inline-cell'))return;
    e.preventDefault();
    const inputs=[...table.querySelectorAll('input.inline-cell')],idx=inputs.indexOf(e.target);
    if(idx<0)return;
    const colCount=inputs.length/Math.max(1,table.querySelectorAll('tbody tr').length);
    const next=idx+colCount;
    if(next>=inputs.length)addInlineEditorRow();
    const target=[...table.querySelectorAll('input.inline-cell')][next]||[...table.querySelectorAll('input.inline-cell')].pop();
    if(target){target.focus();target.select();}
  });
  table.addEventListener('paste',e=>{
    const el=document.activeElement;
    if(!el||!(el instanceof HTMLInputElement)||!el.classList.contains('inline-cell'))return;
    const text=(e.clipboardData||window.clipboardData)?.getData('text');
    if(!text)return;
    e.preventDefault();
    const grid=text.replace(/\r\n/g,'\n').split('\n').map(l=>l.split('\t'));
    const inputs=[...table.querySelectorAll('input.inline-cell')],start=inputs.indexOf(el);
    if(start<0)return;
    const tbody=table.querySelector('tbody'),colCount=Math.max(1,Math.round(inputs.length/tbody.children.length));
    const startRow=Math.floor(start/colCount),startCol=start%colCount;
    while(tbody.children.length<startRow+grid.length)addInlineEditorRow();
    grid.forEach((rowVals,ri)=>{
      rowVals.forEach((val,ci)=>{
        const targetRow=tbody.children[startRow+ri];
        if(!targetRow)return;
        const cellInputs=targetRow.querySelectorAll('input.inline-cell');
        const t=cellInputs[startCol+ci];
        if(t)t.value=val;
      });
    });
  });
}

async function handleFile(file){
  try{
    const lower=file.name.toLowerCase();
    if(lower.endsWith('.csv')||lower.endsWith('.tsv')){processImported(parseDelimited(await file.text()),file.name);return}
    if(!window.XLSX)throw new Error('Excel 组件未加载，请刷新页面或使用 CSV 模板。');
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
    let config=null;
    if(wb.SheetNames.includes('项目配置（勿改）'))config=XLSX.utils.sheet_to_json(wb.Sheets['项目配置（勿改）'],{header:1,defval:''});
    if(config)applyImportedConfig(config);
    const dataName=wb.SheetNames.includes('Data')?'Data':wb.SheetNames[0],ws=wb.Sheets[dataName];
    const matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true,blankrows:false});
    const structured=parseStructuredExperimentMatrix(matrix);
    if(structured&&structured.parsed.length){finalizeImportedExperiment(structured.parsed,structured.errors,file.name,structured.layout,structured.inferred);return}
    const rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:true,blankrows:false});
    processImported(rows,file.name);
  }catch(err){showValidation('error','导入失败',err.message);toast(err.message)}
}

function applyImportedConfig(rows){
  const map={}; rows.slice(1).forEach(r=>{if(r[0])map[String(r[0])]=r[1]});
  if(!map['FoodLab模板版本'])return;
  // v0.18.0: 模板里带着生成当时的名称。若用户已经自己填过名称，导入不得覆盖它，
  // 否则就会出现“改了项目名称、一导入又变回默认值”的问题。
  const templateName0180=String(map['实验名称']||'').trim();
  const keepName0180=isCustomProjectName(state.design?.experimentName)?String(state.design.experimentName).trim():null;
  state.design={
    experimentName:keepName0180||templateName0180||'未命名实验', metricName:String(map['测定指标']||'指标值'), metricUnit:String(map['单位']||''),
    designType:String(map['实验类型']||'one'), factorAName:String(map['因素A名称']||'因素 A'), factorALevelMode:String(map['因素A水平来源']||'auto'), factorALevels:String(map['因素A水平']||'').split('|').filter(Boolean),
    factorBName:String(map['因素B名称']||''), factorBLevels:String(map['因素B水平']||'').split('|'),
    parallelSamples:Number(map['平行样本数']||map['独立平行样本数']||map['重复数']||3),
    technicalRepeats:Number(map['每个平行样本测定重复数']||map['测定重复数']||1), technicalAggregation:String(map['技术重复汇总方式']||'mean'), selectedTechnical:Number(map['固定测定轮次']||1), errorType:String(map['误差棒']||'sd')
  };
  if(state.design.designType==='one')state.design.factorBLevels=[''];
  if(map['计划图形']){state.workflow.goal=String(map['研究目的']||'compare');setWorkflowChart(String(map['计划图形']),{keepData:true})}
  fillDesignForm();renderDesignPreview();
  if(keepName0180&&templateName0180&&templateName0180!==keepName0180)toast(`已保留项目名称「${keepName0180}」；模板里写的是「${templateName0180}」`);
}

function normalizeHeader(h){return String(h??'').trim().toLowerCase().replace(/[\s_()（）%]/g,'')}
function findKey(obj, aliases){const keys=Object.keys(obj);return keys.find(k=>aliases.includes(normalizeHeader(k)))}

function findNamedKey(obj,name){
  const target=normalizeHeader(name);return Object.keys(obj).find(k=>normalizeHeader(k)===target);
}
function metadataKeySet(first){
  return new Set([
    findKey(first,['平行样本编号','平行编号','独立重复编号','parallel','parallelreplicate','biologicalreplicate']),
    findKey(first,['测定重复编号','技术重复编号','测量重复编号','technicalrepeat','measurementrepeat']),
    findKey(first,['备注','note','notes'])
  ].filter(Boolean));
}
function pushParsedValue(parsed,errors,seen,{a,b='',parallel=1,technical=1,value,rowNumber}){
  if(String(value??'').trim()==='')return;
  const n=Number(value);if(!Number.isFinite(n)){errors.push(`第 ${rowNumber} 行“${b||a}”不是数字`);return}
  a=String(a??'').trim();b=String(b??'').trim();parallel=Number(parallel);technical=Number(technical);
  if(!a){errors.push(`第 ${rowNumber} 行缺少因素 A 水平`);return}
  if(!Number.isFinite(parallel)||parallel<1){errors.push(`第 ${rowNumber} 行平行样本编号无效`);return}
  if(!Number.isFinite(technical)||technical<1){errors.push(`第 ${rowNumber} 行测定重复编号无效`);return}
  const key=`${a}\u0001${b}\u0001${parallel}\u0001${technical}`;if(seen.has(key)){errors.push(`第 ${rowNumber} 行与前面存在重复的实验组合、平行编号和技术重复编号`);return}seen.add(key);
  parsed.push({sampleId:`${a}-${b||'G'}-P${parallel}`,a,b,parallel,technical,rep:parallel,value:n});
}
function parseLongExperimentRows(rows){
  const first=rows[0],ka=findKey(first,['因素a水平','factora','a','x']),kb=findKey(first,['因素b水平','factorb','b','group']),
    kp=findKey(first,['平行样本编号','平行编号','独立重复编号','parallel','parallelreplicate','biologicalreplicate']),kt=findKey(first,['测定重复编号','技术重复编号','测量重复编号','technicalrepeat','measurementrepeat']),
    kr=findKey(first,['重复编号','replicate','rep','重复']),kv=findKey(first,['测定值','value','result','数值']),ks=findKey(first,['样品编号','sampleid','sample']);
  if(!ka||!kv)return null;
  const parsed=[],errors=[],seen=new Set();
  rows.forEach((row,i)=>{
    const parallel=Number(kp?row[kp]:(kr?row[kr]:1)),technical=Number(kt?row[kt]:1),a=String(row[ka]??'').trim(),b=kb?String(row[kb]??'').trim():'';
    const before=parsed.length;pushParsedValue(parsed,errors,seen,{a,b,parallel,technical,value:row[kv],rowNumber:i+2});
    if(parsed.length>before&&ks){const sample=String(row[ks]??'').trim();if(sample)parsed.at(-1).sampleId=sample}
  });
  return {parsed,errors,layout:'long'};
}
function parseSampleName(name){
  const s=String(name??'').trim();if(!s)return null;
  const m=s.match(/^(.*?)[-_](\d+)$/);
  if(m&&m[1].trim())return{base:m[1].trim(),num:Number(m[2])};
  return{base:s,num:null};
}
function parseNameBasedRows(rows){
  const first=rows[0],kv=findKey(first,['测定值','数值','值','value','result','measurement','测定结果','数据']),
    ks=findKey(first,['样品名','样品','样品编号','样品id','样本','样本编号','sample','samplename','sampleid','平行样品','生物重复','名称','指标']),
    ka=findKey(first,['组别','组名','条件','处理','处理组','因素a','因素a水平','factora','group','groups','时间','浓度','时间/浓度','水平','x']);
  if(!kv||!ks)return null;
  const baseSet=new Set();
  rows.forEach(row=>{const raw=String(row[ks]??'').trim();const pn=raw?parseSampleName(raw):null;if(pn)baseSet.add(pn.base)});
  const multiBase=baseSet.size>1;
  const parsed=[],errors=[],seen=new Set(),baseSlots=new Map(),numSlots=new Map(),techCount=new Map();let slot=0;
  rows.forEach((row,i)=>{
    const raw=String(row[ks]??'').trim();
    if(!raw)return;
    const pn=parseSampleName(raw);
    if(!pn)return;
    const kaVal=ka?String(row[ka]??'').trim():'';
    let aVal,bVal;
    if(ka&&kaVal&&multiBase){aVal=kaVal;bVal=pn.base;}
    else if(ka&&kaVal){aVal=kaVal;bVal='';}
    else{aVal=pn.base;bVal='';}
    let parallel;
    if(pn.num==null){
      if(!baseSlots.has(pn.base))baseSlots.set(pn.base,++slot);
      parallel=baseSlots.get(pn.base);
    }else{
      const key=pn.base+'#'+pn.num;
      if(!numSlots.has(key))numSlots.set(key,++slot);
      parallel=numSlots.get(key);
    }
    techCount.set(raw,(techCount.get(raw)||0)+1);
    pushParsedValue(parsed,errors,seen,{a:aVal,b:bVal,parallel,technical:techCount.get(raw),value:row[kv],rowNumber:i+2});
  });
  return {parsed,errors,layout:'name-based',inferred:{factorALevelMode:'auto',factorAName:ka?String(first[ka]??'').trim()||'变量1':(multiBase?'组名':'样品名')}};
}
function parseWideExperimentRows(rows){
  const d=state.design,type=state.workflow.chartType,first=rows[0],parsed=[],errors=[],seen=new Set();
  const kp=findKey(first,['平行样本编号','平行编号','独立重复编号','parallel','parallelreplicate','biologicalreplicate','replicate','rep','重复编号']),
    kt=findKey(first,['测定重复编号','技术重复编号','测量重复编号','technicalrepeat','measurementrepeat']),meta=metadataKeySet(first);
  if(!kp)return null;
  if(d.designType==='two'){
    const xKey=findNamedKey(first,d.factorAName)||findKey(first,['因素a水平','factora','a','x']);if(!xKey)return null;
    const seriesKeys=d.factorBLevels.map(level=>[level,findNamedKey(first,level)]).filter(x=>x[1]);if(!seriesKeys.length)return null;
    rows.forEach((row,i)=>seriesKeys.forEach(([level,key])=>pushParsedValue(parsed,errors,seen,{a:row[xKey],b:level,parallel:row[kp],technical:kt?row[kt]:1,value:row[key],rowNumber:i+2})));
    return {parsed,errors,layout:'wide-two'};
  }
  if(type==='bar'){
    const groupKeys=d.factorALevels.map(level=>[level,findNamedKey(first,level)]).filter(x=>x[1]);if(!groupKeys.length)return null;
    rows.forEach((row,i)=>groupKeys.forEach(([level,key])=>pushParsedValue(parsed,errors,seen,{a:level,b:'',parallel:row[kp],technical:kt?row[kt]:1,value:row[key],rowNumber:i+2})));
    return {parsed,errors,layout:'wide-one-bar'};
  }
  const xKey=findNamedKey(first,d.factorAName)||findKey(first,['因素a水平','factora','a','x']);if(!xKey)return null;
  meta.add(xKey);const metricTarget=normalizeHeader(d.metricName),valueKey=Object.keys(first).find(k=>normalizeHeader(k)===metricTarget||normalizeHeader(k).startsWith(metricTarget))||Object.keys(first).find(k=>!meta.has(k));if(!valueKey)return null;
  rows.forEach((row,i)=>pushParsedValue(parsed,errors,seen,{a:row[xKey],b:'',parallel:row[kp],technical:kt?row[kt]:1,value:row[valueKey],rowNumber:i+2}));
  return {parsed,errors,layout:'wide-one-trend'};
}
function parseIndexLabel(value,prefix){
  const s=String(value??'').trim(),m=s.match(new RegExp(`${prefix}\\s*(\\d+)`,'i'))||s.match(/(\d+)/);return m?Number(m[1]):null;
}
function parseStructuredExperimentMatrix(matrix){
  if(!Array.isArray(matrix)||matrix.length<2)return null;
  const top=matrix[0]||[],second=matrix[1]||[],third=matrix[2]||[];
  const noteIndex=top.findIndex(v=>['备注','note','notes'].includes(normalizeHeader(v)));
  const end=noteIndex>0?noteIndex:Math.max(top.length,second.length,third.length);
  const hasTechnical=third.slice(1,end).some(v=>/^t\s*\d+$/i.test(String(v).trim())||/技术|测定/.test(String(v)));
  const headerDepth=hasTechnical?3:2,xHeader=String(top[0]??'').trim()||state.design.factorAName||'X';
  const segments=[];let current=null;
  for(let c=1;c<end;c++){
    const raw=String(top[c]??'').trim();
    if(raw){
      if(!current||normalizeHeader(current.group)!==normalizeHeader(raw)){current={group:raw,start:c,end:c};segments.push(current)}else current.end=c;
    }else if(current)current.end=c;
  }
  if(!segments.length)return null;
  // v0.89.0 单层宽表守卫：第二行若是实验数值（而非每组连续的平行编号/标签），
  // 说明首行即唯一表头、次行即数据（如 x | A-1 A-1 A-1 A-2 ...），不是双层表头，
  // 交回对象路径按列名识别“组 / 平行 / 技术重复”。
  const headerSerial=row=>{const nums=[];for(let c=1;c<end;c++){const cv=(row||[])[c];const cs=String(cv==null?"":cv).trim();if(cs==="")continue;const cm=cs.match(/^[rRtT]?\s*0*(\d+)$/);if(cm)nums.push(Number(cm[1]));else if(Number.isFinite(Number(cs)))return false}if(!nums.length)return true;const set=[...new Set(nums)].sort((p,q)=>p-q);for(let k=0;k<set.length;k++)if(set[k]!==k+1)return false;return true};
  if(!headerSerial(matrix[1])||(hasTechnical&&!headerSerial(matrix[2])))return null;
  const columns=[];
  segments.forEach(seg=>{
    let parallel=0,previousTechnical=0;
    for(let c=seg.start;c<=seg.end;c++){
      if(hasTechnical){
        const secondLabel=String(second[c]??'').trim(),technical=parseIndexLabel(third[c],'T')||((previousTechnical||0)+1);
        if(secondLabel||parallel===0||technical<=previousTechnical)parallel++;
        columns.push({c,group:seg.group,parallel,technical,label:secondLabel||`R${parallel}`});previousTechnical=technical;
      }else{
        parallel++;
        columns.push({c,group:seg.group,parallel,technical:1,label:String(second[c]??'').trim()||`R${parallel}`});
      }
    }
  });
  const dataRows=[];
  for(let r=headerDepth;r<matrix.length;r++){
    const row=matrix[r]||[],x=String(row[0]??'').trim();
    if(!x&&columns.every(col=>String(row[col.c]??'').trim()===''))continue;
    dataRows.push({r,row,x});
  }
  if(!dataRows.length)return null;
  const groups=[...new Set(columns.map(c=>c.group))],xLevels=[...new Set(dataRows.map(x=>x.x).filter(Boolean))],type=state.workflow.chartType;
  const usesX=type==='line'||type==='curve'||(type==='bar'&&(dataRows.length>1||groups.length===1));
  const isTwo=usesX&&groups.length>1,parsed=[],errors=[],seen=new Set();
  dataRows.forEach(item=>columns.forEach(col=>{
    const a=usesX?item.x:col.group,b=isTwo?col.group:'';
    pushParsedValue(parsed,errors,seen,{a,b,parallel:col.parallel,technical:col.technical,value:item.row[col.c],rowNumber:item.r+1});
  }));
  const maxParallel=Math.max(1,...columns.map(c=>c.parallel)),maxTechnical=Math.max(1,...columns.map(c=>c.technical));
  const inferred=usesX?{
    factorALevelMode:'auto',factorAName:xHeader,factorALevels:xLevels,designType:isTwo?'two':'one',
    factorBName:isTwo?(state.design.factorBName||'组别'):'',factorBLevels:isTwo?groups:[''],parallelSamples:maxParallel,technicalRepeats:maxTechnical
  }:{
    factorALevelMode:'manual',factorAName:state.design.factorAName||'处理组',factorALevels:groups,designType:'one',factorBName:'',factorBLevels:[''],parallelSamples:maxParallel,technicalRepeats:maxTechnical
  };
  return {parsed,errors,layout:'grouped-parallel-auto-xlsx',inferred};
}
function parseFlatColumnName(key){
  const s=String(key??'').trim();if(!s)return null;
  let m=s.match(/^(.*?)[-_](\d+)[-_](?:R)?(\d+)$/);
  if(m&&m[1].trim())return{base:m[1].trim(),num:Number(m[2])};
  m=s.match(/^(.*)__(?:R)?(\d+)$/i);
  if(m&&m[1].trim())return{base:m[1].trim(),num:Number(m[2])};
  m=s.match(/^(.*?)[-_](?:R)?(\d+)$/i);
  if(m&&m[1].trim())return{base:m[1].trim(),num:Number(m[2])};
  m=s.match(/^(.*?)(\d+)$/);
  if(m&&m[1].trim()&&!/^\d+$/.test(m[1]))return{base:m[1].trim(),num:Number(m[2])};
  return{base:s,num:1};
}
function parseGroupColumnMatrixRows(rows){
  if(!rows?.length)return null;
  const first=rows[0],keys=Object.keys(first),d=state.design;
  const xKey=findNamedKey(first,d.factorAName)||findKey(first,['样品名','样品','时间','浓度','x','组别','指标'])||keys[0];
  if(!xKey)return null;
  const groupCols=keys.filter(k=>k!==xKey&&!['备注','note','notes'].includes(normalizeHeader(k)));
  if(groupCols.length<2)return null;
  const parsed=[],errors=[],seen=new Set(),techSeen=new Map();
  rows.forEach((row,i)=>{
    const x=String(row[xKey]??'').trim();
    if(!x)return;
    const pn=parseSampleName(x);
    const isLine=state.workflow.chartType==='line'||state.workflow.chartType==='curve';
    groupCols.forEach(col=>{
      const v=row[col];
      if(v===undefined||v===null||v==='')return;
      const key=x+'\u0001'+col;
      const t=(techSeen.get(key)||0)+1;techSeen.set(key,t);
      let aVal,bVal,parallel;
      if(isLine){aVal=x;bVal=col;parallel=1;}
      else{aVal=col;bVal='';parallel=pn.num==null?1:pn.num;}
      pushParsedValue(parsed,errors,seen,{a:aVal,b:bVal,parallel,technical:t,value:v,rowNumber:i+2});
    });
  });
  if(!parsed.length)return null;
  return {parsed,errors,layout:'group-column-matrix',inferred:{factorALevelMode:'auto',factorAName:String(first[xKey]??'').trim()||'样品名'}};
}
function parseFlatParallelWideRows(rows){
  if(!rows?.length)return null;
  const first=rows[0],keys=Object.keys(first),d=state.design;
  const xKey=findNamedKey(first,d.factorAName)||findKey(first,['指标','因素a水平','factora','a','x','组别','组名','时间','浓度','样品','group','groups'])||keys[0];
  if(!xKey)return null;
  const dataKeys=[],seenCol=new Map();
  keys.forEach(key=>{
    if(key===xKey||['备注','note','notes'].includes(normalizeHeader(key)))return;
    const parsed=parseFlatColumnName(key);
    if(!parsed)return;
    const colKey=parsed.base+'\u0002'+parsed.num,t=(seenCol.get(colKey)||0)+1;seenCol.set(colKey,t);
    dataKeys.push({key,base:parsed.base,parallel:parsed.num,technical:t});
  });
  if(!dataKeys.length)return null;
  const bases=[...new Set(dataKeys.map(col=>col.base))],parsed=[],errors=[],seen=new Set();
  rows.forEach((row,i)=>{
    const x=String(row[xKey]??'').trim();
    if(!x)return;
    dataKeys.forEach(col=>{
      const b=bases.length>1?col.base:'';
      pushParsedValue(parsed,errors,seen,{a:x,b,parallel:col.parallel,technical:col.technical,value:row[col.key],rowNumber:i+2});
    });
  });
  return {parsed,errors,layout:'wide-matrix',inferred:{factorALevelMode:'auto',factorAName:String(first[xKey]??'').trim()||'变量1'}};
}

function processImported(rows,source){
  if(!Array.isArray(rows)||!rows.length){showValidation('error','没有识别到数据','文件为空或表头不正确。');return}
  const result=parseLongExperimentRows(rows)||parseNameBasedRows(rows)||parseFlatParallelWideRows(rows)||parseWideExperimentRows(rows);
  if(!result){showValidation('error','未识别到数据','请用“组别+样品名+测定值”长表（同名合并为重复测定，名字带 -1/-2 为独立平行），或使用平台模板 / 旧版宽表格式。');return}
  finalizeImportedExperiment(result.parsed,result.errors,source,result.layout,result.inferred);
}
function finalizeImportedExperiment(parsed,errors,source,layout,inferred=null){
  if(!parsed.length){showValidation('error','没有有效测定值','请在各实验组的数据列中填写原始数字。');return}
  parsed.forEach(r=>{r.a=normalizeName(r.a);r.b=normalizeName(r.b);});
  if(inferred){
    if(Array.isArray(inferred.factorALevels))inferred.factorALevels=[...new Set(inferred.factorALevels.map(normalizeName).filter(x=>String(x).trim()))];
    if(Array.isArray(inferred.factorBLevels))inferred.factorBLevels=[...new Set(inferred.factorBLevels.map(normalizeName))];
  }
  state.rawData=parsed;
  if(inferred){state.design={...state.design,...inferred};}
  const observedA=[...new Set(parsed.map(r=>r.a))],observedB=[...new Set(parsed.map(r=>r.b))];
  if(inferred?.factorAName)state.design.factorAName=inferred.factorAName;
  if(!state.design.factorALevels.length||!observedA.every(x=>state.design.factorALevels.includes(x)))state.design.factorALevels=observedA;
  if((state.workflow.chartType==='line'||state.workflow.chartType==='curve'||state.design.designType==='two'))state.design.factorALevelMode='auto';
  if(observedB.some(Boolean)){state.design.designType='two';state.design.factorBLevels=observedB;if(!state.design.factorBName)state.design.factorBName='因素 B'}else{state.design.designType='one';state.design.factorBLevels=['']}
  const perCell=new Map();parsed.forEach(r=>{const k=`${r.a}\u0001${r.b}`;if(!perCell.has(k))perCell.set(k,new Map());const samples=perCell.get(k);if(!samples.has(r.parallel))samples.set(r.parallel,new Set());samples.get(r.parallel).add(r.technical)});
  const sampleCounts=[...perCell.values()].map(m=>m.size),techCounts=[...perCell.values()].flatMap(m=>[...m.values()].map(v=>v.size));
  if(sampleCounts.length)state.design.parallelSamples=Math.max(...sampleCounts);if(techCounts.length)state.design.technicalRepeats=Math.max(...techCounts);
  fillDesignForm();renderDesignPreview();renderDataPreview();
  const independentCount=collapseTechnicalReplicates(parsed).length,unevenSamples=new Set(sampleCounts).size>1,unevenTechnical=new Set(techCounts).size>1,layoutName=layout.startsWith('grouped-parallel-auto')?'自动识别分组平行表':layout.startsWith('grouped-parallel')?'分组平行表':layout==='wide-matrix'?'中文矩阵表（行=变量1，列=平行/组名-编号）':layout.startsWith('wide')?'旧版宽表':layout.startsWith('name')?'按名称识别（同名=重复测定，-数字=独立平行）':'兼容长表';
  if(errors.length)showValidation('warning',`已导入 ${parsed.length} 个有效值，但发现 ${errors.length} 个问题`,errors.slice(0,3).join('；'));
  else if(unevenSamples||unevenTechnical)showValidation('warning',`已导入 ${parsed.length} 个原始测定值`,`使用${layoutName}；共 ${independentCount} 个独立样品。${unevenSamples?'不同实验组合的平行样本数不一致。':''}${unevenTechnical?'部分样品的技术重复次数不一致。':''}`);
  else showValidation('success',`导入成功：${parsed.length} 个原始测定值`,`${layoutName} · ${independentCount} 个独立平行样本 · ${source} · 已从第一列识别 ${observedA.length} 个因素 A 水平${state.design.designType==='two'?` · ${observedB.length} 个因素 B 水平`:''}`);
  analyzeData();
  const qw=state.dataWarnings||[];
  if(qw.length)showValidation('warning','初步分析完成，但有 '+qw.length+' 条数据提醒',qw.slice(0,3).join('；')+(qw.length>3?' 等':''));
  toast('数据已导入并完成初步分析');
}

function parseDelimited(text){
  const clean=String(text||'').replace(/^\ufeff/,'').trim(); if(!clean)return[];
  const lines=clean.split(/\r?\n/).filter(Boolean), sep=lines[0].includes('\t')?'\t':',';
  const matrix=lines.map(line=>sep==='\t'?line.split('\t'):parseCsvLine(line));
  const headers=matrix[0].map(x=>String(x).trim());
  return matrix.slice(1).map(row=>{const o={};headers.forEach((h,i)=>o[h]=row[i]??'');return o});
}
function parseCsvLine(line){let out=[],cur='',quote=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++}else quote=!quote}else if(c===','&&!quote){out.push(cur);cur=''}else cur+=c}out.push(cur);return out}

function loadRawDemo(){
  // v0.18.0: 载入示例数据不再清掉用户自己填写的项目名称。
  const keepName0180=isCustomProjectName(state.design.experimentName)?state.design.experimentName:null;
  state.design=structuredClone(defaultDesign); if(keepName0180)state.design.experimentName=keepName0180;
  fillDesignForm(); renderDesignPreview();
  const means={
    '0|4 °C':[75.1,.32],'0|-1 °C':[74.8,.30],'0|-18 °C':[74.5,.31],
    '2|4 °C':[75.8,.34],'2|-1 °C':[75.4,.32],'2|-18 °C':[75.0,.30],
    '4|4 °C':[76.6,.31],'4|-1 °C':[76.2,.33],'4|-18 °C':[75.8,.31],
    '6|4 °C':[77.4,.35],'6|-1 °C':[77.0,.32],'6|-18 °C':[76.6,.34],
    '8|4 °C':[78.4,.34],'8|-1 °C':[78.0,.33],'8|-18 °C':[77.5,.32],
    '10|4 °C':[79.6,.36],'10|-1 °C':[79.1,.34],'10|-18 °C':[78.6,.35]
  };
  const raw=[];let n=1;
  state.design.factorALevels.forEach(a=>state.design.factorBLevels.forEach(b=>{
    const [m,sd]=means[`${a}|${b}`],sampleMeans=[m-sd,m,m+sd],tCount=Math.max(1,state.design.technicalRepeats||1);
    sampleMeans.forEach((sampleMean,p)=>{const sampleId=`S${String(n++).padStart(3,'0')}`,noise=sd*.08;for(let t=1;t<=tCount;t++){const delta=tCount===1?0:noise*((t-1)/(tCount-1)*2-1);raw.push({sampleId,a,b,parallel:p+1,technical:t,rep:p+1,value:Number((sampleMean+delta).toFixed(4))})}});
  }));
  state.rawData=raw;renderDataPreview();showValidation('success',`演示数据已载入：${raw.length} 个原始值`,`已按 ${state.design.parallelSamples} 个独立平行${state.design.technicalRepeats>1?` × ${state.design.technicalRepeats} 次技术测定（${aggregationLabel()}）`:''}生成，共 ${collapseTechnicalReplicates(raw).length} 个独立样品。`);analyzeData();toast('已载入完整演示数据');
}

function renderDataPreview(){
  syncWorkflowControls();
  if(state.workflow.mode==='gallery'){
    const rows=state.gallery.rows,schema=currentWorkflowSchema(),headers=schema.columns;
    $('#dataPreviewMeta').textContent=`${rows.length} 行 · ${workflowChartLabel(state.workflow.chartType)} · ${schema.name}`;
    // v0.21.0: stacked bars are entered as a wide table (one row per
    // category), so preview them in the same wide layout even though the
    // internal rows are long-table records.
    if(state.workflow.chartType==='stacked'){
      const comps=[...new Set(rows.map(r=>r.Component))],cats=[...new Set(rows.map(r=>r.Category))];
      const wideHeaders=['Category',...comps];
      let wideHtml=`<thead><tr>${wideHeaders.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
      if(!rows.length)wideHtml+=`<tr><td colspan="${wideHeaders.length}" class="empty-row">尚未导入当前图形的数据模板</td></tr>`;
      else cats.slice(0,250).forEach(c=>{
        const cell={Category:c};comps.forEach(cp=>{const r=rows.find(x=>x.Category===c&&x.Component===cp);cell[cp]=r?r.Value:''});
        wideHtml+=`<tr>${wideHeaders.map(h=>`<td>${typeof cell[h]==='number'?formatNumber(cell[h],4):esc(cell[h]??'')}</td>`).join('')}</tr>`;
      });
      if(cats.length>250)wideHtml+=`<tr><td colspan="${wideHeaders.length}" class="empty-row">仅预览前 250 个类别，共 ${cats.length} 个类别</td></tr>`;
      $('#dataPreviewTable').innerHTML=wideHtml+'</tbody>';
      $('#dataPreviewMeta').textContent=`${rows.length} 行组成记录 · ${cats.length} 个类别`;
      return;
    }
    let html=`<thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    if(!rows.length)html+=`<tr><td colspan="${headers.length}" class="empty-row">尚未导入当前图形的数据模板</td></tr>`;
    rows.slice(0,250).forEach(r=>html+=`<tr>${headers.map(h=>`<td>${typeof r[h]==='number'?formatNumber(r[h],4):esc(r[h]??'')}</td>`).join('')}</tr>`);
    if(rows.length>250)html+=`<tr><td colspan="${headers.length}" class="empty-row">仅预览前 250 行，共 ${rows.length} 行</td></tr>`;
    $('#dataPreviewTable').innerHTML=html+'</tbody>';return;
  }
  const rows=state.rawData,independent=rows.length?collapseTechnicalReplicates(rows).length:0; $('#dataPreviewMeta').textContent=`${rows.length} 行原始数据 · ${independent} 个独立样品`;
  const cols=state.design.designType==='two'?7:6;
  let html='<thead><tr><th>样品编号</th><th>'+esc(state.design.factorAName)+'</th>'+(state.design.designType==='two'?`<th>${esc(state.design.factorBName)}</th>`:'')+'<th>平行样本</th><th>测定重复</th><th>'+esc(state.design.metricName)+(state.design.metricUnit?` (${esc(state.design.metricUnit)})`:'')+'</th></tr></thead><tbody>';
  if(!rows.length)html+=`<tr><td colspan="${cols}" class="empty-row">尚未导入数据</td></tr>`;
  rows.slice(0,250).forEach(r=>{html+=`<tr><td>${esc(r.sampleId)}</td><td>${esc(r.a)}</td>${state.design.designType==='two'?`<td>${esc(r.b)}</td>`:''}<td>${r.parallel??r.rep??1}</td><td>${r.technical??1}</td><td>${formatNumber(r.value,4)}</td></tr>`});
  if(rows.length>250)html+=`<tr><td colspan="${cols}" class="empty-row">仅预览前 250 行，共 ${rows.length} 行</td></tr>`;
  $('#dataPreviewTable').innerHTML=html+'</tbody>';
}

function showValidation(type,title,text){const p=$('#validationPanel');p.className=`validation-panel ${type}`;p.innerHTML=`<b>${esc(title)}</b><p>${esc(text)}</p>`}

function bindStatistics(){
  $('#runAnalysis').addEventListener('click',()=>{if(state.workflow.mode==='experiment')analyzeData();else analyzeGalleryData();renderStatistics();toast('统计结果已更新')});
  $('#goChart').addEventListener('click',()=>{state.chart.mode=state.workflow.mode;showView('chart')});
}

function normalizeName(v){return String(v??'').replace(/[\s\u00A0\u3000]+/g,'').trim()}
function groupQualityLabel(a,b){return b?a+' / '+b:String(a)}
function detectDataWarnings(rows){
  const groups=new Map();
  rows.forEach(r=>{
    const k=String(r.a)+'\u0001'+String(r.b);
    if(!groups.has(k))groups.set(k,{a:r.a,b:r.b,values:[],parallels:new Set()});
    const g=groups.get(k);
    if(Number.isFinite(Number(r.value)))g.values.push(Number(r.value));
    g.parallels.add(Number(r.parallel)||Number(r.rep)||1);
  });
  const notes=[];
  groups.forEach(g=>{
    const ps=[...g.parallels].sort((x,y)=>x-y),label=groupQualityLabel(g.a,g.b);
    if(ps.length>1){for(let k=1;k<=ps.length;k++){if(!ps.includes(k)){notes.push('“'+label+'”平行编号不连续（'+ps.join('、')+'，缺 '+k+'），可能列名编号写错');break;}}}
    const v=g.values;
    if(v.length>=4){
      const q1=quantile(v,0.25),q3=quantile(v,0.75),iqr=q3-q1,lo=q1-1.5*iqr,hi=q3+1.5*iqr;
      v.forEach(x=>{if(x<lo||x>hi)notes.push('“'+label+'”中 '+formatNumber(x,3)+' 疑似离群（参考范围约 '+formatNumber(lo,2)+'~'+formatNumber(hi,2)+'）');});
    }
  });
  const byA=new Map();
  groups.forEach(g=>{if(g.values.length>1){const sd=sampleSd(g.values);if(!byA.has(g.a))byA.set(g.a,[]);byA.get(g.a).push(sd)}});
  byA.forEach((sds,a)=>{const pos=sds.filter(x=>x>0);if(sds.length>=3&&pos.length===sds.length){const mx=Math.max(...pos),mn=Math.min(...pos);if(mn>0&&mx/mn>3)notes.push('“'+a+'”各组标准差差异较大（最大SD/最小SD≈'+(mx/mn).toFixed(0)+'，方差不齐），多重比较建议选 Games-Howell');}});
  return notes;
}
function analyzeData(){
  if(!state.rawData.length){state.analysisRows=[];state.descriptive=[];state.analysis=null;state.dataWarnings=[];return null}
  state.analysisRows=collapseTechnicalReplicates(state.rawData);
  state.descriptive=descriptiveStats(state.analysisRows);
  state.analysis=state.design.designType==='two'?twoWayAnova(state.analysisRows):oneWayAnova(state.analysisRows,'a');
  prepareChartData();
  state.dataWarnings=detectDataWarnings(state.analysisRows);
  return state.analysis;
}

function collapseTechnicalReplicates(rows){
  const map=new Map(),method=state.design.technicalAggregation||'mean',selected=Math.max(1,Number(state.design.selectedTechnical)||1);
  rows.forEach((r,i)=>{
    const parallel=Number.isFinite(Number(r.parallel))?Number(r.parallel):(Number.isFinite(Number(r.rep))?Number(r.rep):i+1);
    const key=`${r.a}\u0001${r.b}\u0001${parallel}`;
    if(!map.has(key))map.set(key,{a:r.a,b:r.b,parallel,sampleId:r.sampleId||`P${parallel}`,entries:[]});
    map.get(key).entries.push({technical:Number(r.technical)||1,value:Number(r.value)});
  });
  return [...map.values()].map(x=>{
    x.entries.sort((a,b)=>a.technical-b.technical);const values=x.entries.map(e=>e.value);
    let value,fallback=false;
    if(method==='median')value=median(values);
    else if(method==='selected'){
      const found=x.entries.find(e=>e.technical===selected);if(found)value=found.value;else{value=mean(values);fallback=true}
    }else value=mean(values);
    return {a:x.a,b:x.b,parallel:x.parallel,rep:x.parallel,sampleId:x.sampleId,value,technicalN:values.length,technicalSd:sampleSd(values),technicalMethod:method,technicalFallback:fallback};
  });
}

function descriptiveStats(rows){
  const map=new Map(); rows.forEach(r=>{const key=`${r.a}\u0001${r.b}`;if(!map.has(key))map.set(key,[]);map.get(key).push(r)});
  return [...map.entries()].map(([key,samples])=>{const [a,b]=key.split('\u0001'),values=samples.map(r=>r.value),n=values.length,m=mean(values),sd=sampleSd(values),se=sd/Math.sqrt(n),ci=se*tCritical975(Math.max(1,n-1)),technicalCounts=samples.map(r=>r.technicalN||1),technicalLabel=new Set(technicalCounts).size===1?String(technicalCounts[0]):`${Math.min(...technicalCounts)}–${Math.max(...technicalCounts)}`;return{a,b,n,mean:m,sd,se,ci,cv:m===0?null:Math.abs(sd/m*100),values,technicalLabel}}).sort((x,y)=>levelIndex(x.a,state.design.factorALevels)-levelIndex(y.a,state.design.factorALevels)||levelIndex(x.b,state.design.factorBLevels)-levelIndex(y.b,state.design.factorBLevels));
}

function oneWayAnova(rows,key='a'){
  const groupsMap=new Map();rows.forEach(r=>{const g=r[key];if(!groupsMap.has(g))groupsMap.set(g,[]);groupsMap.get(g).push(r.value)});
  const groups=[...groupsMap.entries()].map(([label,values])=>({label,values,n:values.length,mean:mean(values)})), all=rows.map(r=>r.value), grand=mean(all);
  const ssBetween=groups.reduce((s,g)=>s+g.n*(g.mean-grand)**2,0), ssWithin=groups.reduce((s,g)=>s+g.values.reduce((q,v)=>q+(v-g.mean)**2,0),0);
  const df1=groups.length-1,df2=all.length-groups.length,ms1=ssBetween/df1,ms2=ssWithin/df2,F=ms1/ms2,p=fSurvival(F,df1,df2);
  return{kind:'one',balanced:new Set(groups.map(g=>g.n)).size===1,groups,grand,rows:[
    {source:state.design.factorAName,ss:ssBetween,df:df1,ms:ms1,F,p},
    {source:'误差',ss:ssWithin,df:df2,ms:ms2,F:null,p:null},
    {source:'总计',ss:ssBetween+ssWithin,df:all.length-1,ms:null,F:null,p:null}
  ],mse:ms2,dfError:df2,pMain:p};
}

function twoWayAnova(rows){
  const A=[...new Set(rows.map(r=>r.a))],B=[...new Set(rows.map(r=>r.b))],cell=new Map();
  if((state.workflow.chartType==='line'||state.workflow.chartType==='curve')&&A.length>250){
    return{kind:'two',balanced:false,continuous:true,rows:[],mse:null,dfError:null,message:`检测到 ${A.length} 个连续 X 水平。为避免把上千个时间点错误地当作分类水平并造成浏览器阻塞，初步分析不自动执行超大双因素 ANOVA；图形仍使用全部数据。需要正式推断时建议使用重复测量、混合效应或时间序列模型。`};
  }
  rows.forEach(r=>{const k=`${r.a}\u0001${r.b}`;if(!cell.has(k))cell.set(k,[]);cell.get(k).push(r.value)});
  const counts=[...cell.values()].map(v=>v.length),balanced=cell.size===A.length*B.length&&new Set(counts).size===1;
  if(!balanced)return{kind:'two',balanced:false,rows:[],mse:null,dfError:null,message:'当前双因素 ANOVA 要求每个因素组合具有相同重复数。描述统计仍可使用。'};
  const n=counts[0],all=rows.map(r=>r.value),grand=mean(all),meanA=new Map(),meanB=new Map(),meanCell=new Map();
  A.forEach(a=>meanA.set(a,mean(rows.filter(r=>r.a===a).map(r=>r.value))));
  B.forEach(b=>meanB.set(b,mean(rows.filter(r=>r.b===b).map(r=>r.value))));
  A.forEach(a=>B.forEach(b=>meanCell.set(`${a}\u0001${b}`,mean(cell.get(`${a}\u0001${b}`)))));
  const ssA=B.length*n*A.reduce((s,a)=>s+(meanA.get(a)-grand)**2,0);
  const ssB=A.length*n*B.reduce((s,b)=>s+(meanB.get(b)-grand)**2,0);
  let ssAB=0,sse=0;A.forEach(a=>B.forEach(b=>{const cm=meanCell.get(`${a}\u0001${b}`);ssAB+=n*(cm-meanA.get(a)-meanB.get(b)+grand)**2;cell.get(`${a}\u0001${b}`).forEach(v=>sse+=(v-cm)**2)}));
  const dfA=A.length-1,dfB=B.length-1,dfAB=dfA*dfB,dfE=A.length*B.length*(n-1),msA=ssA/dfA,msB=ssB/dfB,msAB=ssAB/dfAB,mse=sse/dfE;
  const FA=msA/mse,FB=msB/mse,FAB=msAB/mse,pA=fSurvival(FA,dfA,dfE),pB=fSurvival(FB,dfB,dfE),pAB=fSurvival(FAB,dfAB,dfE);
  return{kind:'two',balanced:true,A,B,n,grand,mse,dfError:dfE,pA,pB,pAB,rows:[
    {source:state.design.factorAName,ss:ssA,df:dfA,ms:msA,F:FA,p:pA},
    {source:state.design.factorBName,ss:ssB,df:dfB,ms:msB,F:FB,p:pB},
    {source:`${state.design.factorAName} × ${state.design.factorBName}`,ss:ssAB,df:dfAB,ms:msAB,F:FAB,p:pAB},
    {source:'误差',ss:sse,df:dfE,ms:mse,F:null,p:null},
    {source:'总计',ss:ssA+ssB+ssAB+sse,df:all.length-1,ms:null,F:null,p:null}
  ]};
}

function renderStatistics(){
  if(state.workflow.mode==='gallery'){renderGalleryWorkflowStatistics();return}
  const d=state.design,a=state.analysis,desc=state.descriptive;
  $('#statsDesignLine').textContent=`${d.experimentName} · ${d.metricName}${d.metricUnit?` (${d.metricUnit})`:''} · ${d.designType==='two'?`${d.factorAName} × ${d.factorBName}`:d.factorAName} · ${d.parallelSamples} 个独立平行${d.technicalRepeats>1?` × ${d.technicalRepeats} 次技术测定（${aggregationLabel(d)}）`:''} · ${workflowChartLabel(state.workflow.chartType)}`;
  const qw=state.dataWarnings||[];
  const warnBanner=qw.length?`<div style="grid-column:1/-1;border:1px solid #e0a800;background:#fff8e6;color:#7a5b00;border-radius:8px;padding:8px 12px;font-size:13px;line-height:1.6"><b>数据提醒（${qw.length}）：</b>${esc(qw.slice(0,8).join('；'))}${qw.length>8?' 等':''}</div>`:'';
  $('#summaryCards').innerHTML=warnBanner+[
    ['原始测定值',state.rawData.length||'—'],['独立平行样本',state.analysisRows.length||'—'],['实验组合',desc.length||'—'],['分析模型',!a?'—':a.continuous?'连续趋势摘要':a.kind==='two'?'双因素 ANOVA':'单因素 ANOVA']
  ].map(([n,v])=>`<div class="summary-card"><span>${n}</span><b>${v}</b></div>`).join('');
  renderDescriptiveTable();renderAnovaTable();renderInterpretation();
}
function renderGalleryWorkflowStatistics(){
  state.gallery.type=state.workflow.chartType;analyzeGalleryData();
  const def=galleryDef(),schema=gallerySchema(),a=state.gallery.analysis;
  $('#statsDesignLine').textContent=`${state.design.experimentName} · ${def.name} · ${schema.name} · 初步分析`;
  const summary=a?.summary||[['数据行',state.gallery.rows.length],['图形',def.name],['模板',schema.name],['状态',state.gallery.rows.length?'已分析':'待导入']];
  $('#summaryCards').innerHTML=summary.slice(0,4).map(([n,v])=>`<div class="summary-card"><span>${esc(n)}</span><b>${esc(v)}</b></div>`).join('');
  let table=a?.table;
  if(a?.kind==='matrix')table=a.vars.map(v=>({Indicator:v,...Object.fromEntries(a.vars.map(w=>[w,a.corr[v][w]]))}));
  if(table?.length){const headers=Object.keys(table[0]);$('#descriptiveTable').innerHTML=`<thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${table.map(r=>`<tr>${headers.map(h=>`<td>${typeof r[h]==='number'?formatNumber(r[h],4):esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody>`}
  else $('#descriptiveTable').innerHTML='<tbody><tr><td class="empty-row">请先导入当前图形模板数据</td></tr></tbody>';
  if(a?.kind==='univariate'&&a.anova){
    $('#anovaMethodText').innerHTML=`当前方法：<b>${esc(a.methodName||statisticalMethodLabel())}</b>。 <label class="inline-method-select">切换方法 <select id="statsMethodSelect"><option value="anovaLsd" ${state.gallery.settings.statMethod==='anovaLsd'?'selected':''}>ANOVA + Fisher LSD</option><option value="welchHolm" ${state.gallery.settings.statMethod==='welchHolm'?'selected':''}>Welch ANOVA + Holm</option><option value="kruskalHolm" ${state.gallery.settings.statMethod==='kruskalHolm'?'selected':''}>Kruskal–Wallis + Holm</option></select></label> 不同假设和校正方式会改变结果。`;
    const rows=a.pairwise||[];
    $('#anovaTable').innerHTML=`<thead><tr><th>两两比较</th><th>差值</th><th>统计量</th><th>原始 p</th><th>报告 p</th><th>标记</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.a)} vs ${esc(r.b)}</td><td>${formatNumber(r.meanDiff,4)}</td><td>${Number.isFinite(r.t)?`t=${formatNumber(r.t,3)}`:Number.isFinite(r.U)?`U=${formatNumber(r.U,2)}`:'—'}</td><td>${formatP(r.pRaw??r.p)}</td><td>${formatP(r.p)}</td><td>${r.stars}</td></tr>`).join('')||'<tr><td colspan="6" class="empty-row">至少需要两个组</td></tr>'}</tbody>`;
  }else{
    const methodRows=galleryMethodRows(def.id);
    const corrControl=['scatter','bubble','heatmap'].includes(def.id)?` <label class="inline-method-select">相关方法 <select id="statsCorrelationMethod"><option value="pearson" ${state.gallery.settings.correlationMethod==='pearson'?'selected':''}>Pearson</option><option value="spearman" ${state.gallery.settings.correlationMethod==='spearman'?'selected':''}>Spearman</option></select></label>`:'';$('#anovaMethodText').innerHTML='当前页面完成与图形对应的初步分析；条件不足时不会自动给出显著性结论。'+corrControl;
    $('#anovaTable').innerHTML=`<thead><tr><th>建议分析</th><th>用途</th><th>当前状态</th></tr></thead><tbody>${methodRows.map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody>`;
  }
  const methodSelect=$('#statsMethodSelect');if(methodSelect)methodSelect.addEventListener('change',e=>{state.gallery.settings.statMethod=e.target.value;renderGalleryWorkflowStatistics()});
  const corrSelect=$('#statsCorrelationMethod');if(corrSelect)corrSelect.addEventListener('change',e=>{state.gallery.settings.correlationMethod=e.target.value;renderGalleryWorkflowStatistics()});
  const box=$('#interpretationText');box.className=a?'interpretation':'interpretation empty';box.innerHTML=a?`<p>${esc(a.text||'已完成初步分析。')}</p><p class="small-note">该结果已与“${def.name}”绑定，下一步进入论文图工作台后继续编辑。</p>`:'暂无可解释结果。';
}
function galleryMethodRows(type){
  if(['box','violin'].includes(type))return[['箱线统计定义','可选 R type 7、Tukey hinges、Excel EXC 与多种须线规则','已接入'],['参数检验','单因素 ANOVA + Fisher LSD；Welch ANOVA + Holm','已接入'],['非参数检验','Kruskal–Wallis + Mann–Whitney U（Holm）','已接入']];
  if(['hist','kde'].includes(type))return[['描述统计','n、均值、标准差、中位数、四分位数和异常值','已接入'],['组间检验','正态性与方差齐性后选择 ANOVA 或非参数检验','可在箱线图/小提琴图中使用']];
  if(['scatter','bubble'].includes(type))return[['Pearson 相关','衡量线性相关程度','已接入'],['Spearman 相关','适合单调关系、非正态或秩数据','已接入'],['线性回归','普通最小二乘斜率、截距和 R²','已接入']];
  if(type==='heatmap')return[['Pearson 相关矩阵','多指标线性相关','已接入'],['Spearman 矩阵','多指标秩相关','已接入'],['色阶与数值','自定义低值、中值、高值与对角线颜色','已接入']];
  if(type==='radar')return[['归一化','不同量纲指标统一尺度','已接入'],['综合评分','权重与综合评价','待后续增强']];
  if(['stacked','pie'].includes(type))return[['构成比例','类别总量和组分百分比','已接入'],['组成差异检验','比较不同类别构成差异','待后续增强']];
  return[['描述统计','基础数据概览','已接入']];
}

function renderDescriptiveTable(){
  const d=state.design,cols=d.designType==='two'?9:8;let html=`<thead><tr><th>${esc(d.factorAName)}</th>${d.designType==='two'?`<th>${esc(d.factorBName)}</th>`:''}<th>n（独立样本）</th><th>每样品测定次数</th><th>Mean</th><th>SD</th><th>SE</th><th>CV (%)</th><th>95% CI</th></tr></thead><tbody>`;
  if(!state.descriptive.length)html+=`<tr><td colspan="${cols}" class="empty-row">请先导入原始数据</td></tr>`;
  const displayLimit=300,displayRows=state.descriptive.slice(0,displayLimit);
  displayRows.forEach(r=>html+=`<tr><td>${esc(r.a)}</td>${d.designType==='two'?`<td>${esc(r.b)}</td>`:''}<td>${r.n}</td><td>${r.technicalLabel}</td><td>${formatNumber(r.mean,4)}</td><td>${formatNumber(r.sd,4)}</td><td>${formatNumber(r.se,4)}</td><td>${r.cv==null?'—':formatNumber(r.cv,2)}</td><td>${formatNumber(r.mean-r.ci,4)}–${formatNumber(r.mean+r.ci,4)}</td></tr>`);
  if(state.descriptive.length>displayLimit)html+=`<tr><td colspan="${cols}" class="empty-row">为保证大数据页面流畅，仅显示前 ${displayLimit} 个实验组合；绘图和计算仍使用全部 ${state.descriptive.length} 个组合。</td></tr>`;
  $('#descriptiveTable').innerHTML=html+'</tbody>';
}

function renderAnovaTable(){
  const a=state.analysis;$('#anovaMethodText').textContent=(state.design.designType==='two'?'平衡设计双因素 ANOVA，含交互作用。':'单因素 ANOVA。')+` 同一样品的技术测定按“${aggregationLabel()}”汇总，R1、R2、R3 等独立平行作为统计单元。`;
  let html='<thead><tr><th>变异来源</th><th>SS</th><th>df</th><th>MS</th><th>F</th><th>p</th></tr></thead><tbody>';
  if(!a)html+='<tr><td colspan="6" class="empty-row">暂无统计结果</td></tr>';
  else if(!a.balanced&&a.kind==='two')html+=`<tr><td colspan="6" class="empty-row">${esc(a.message)}</td></tr>`;
  else a.rows.forEach(r=>html+=`<tr><td>${esc(r.source)}</td><td>${formatNumber(r.ss,5)}</td><td>${r.df}</td><td>${r.ms==null?'—':formatNumber(r.ms,5)}</td><td>${r.F==null?'—':formatNumber(r.F,3)}</td><td>${r.p==null?'—':formatP(r.p)}</td></tr>`);
  $('#anovaTable').innerHTML=html+'</tbody>';
}

function renderInterpretation(){
  const box=$('#interpretationText'),a=state.analysis,d=state.design;if(!a){box.className='interpretation empty';box.textContent='暂无可解释结果。';return}
  const paragraphs=[];
  if(a.kind==='one'){
    const sorted=state.descriptive.slice().sort((x,y)=>levelIndex(x.a,d.factorALevels)-levelIndex(y.a,d.factorALevels)),first=sorted[0],last=sorted[sorted.length-1],change=last.mean-first.mean;
    paragraphs.push(`${d.metricName} 在 ${d.factorAName} 的各水平间${a.pMain<.05?'存在统计学差异':'未检出统计学差异'}（${formatPText(a.pMain)}）。`);
    if(first&&last)paragraphs.push(`从 ${first.a} 到 ${last.a}，均值由 ${formatNumber(first.mean,3)} 变化到 ${formatNumber(last.mean,3)}，总体${change>0?'上升':change<0?'下降':'基本不变'} ${formatNumber(Math.abs(change),3)}${d.metricUnit?` ${d.metricUnit}`:''}。`);
  }else if(!a.balanced)paragraphs.push(a.message);
  else{
    paragraphs.push(`${d.factorAName} 主效应${a.pA<.05?'显著':'不显著'}（${formatPText(a.pA)}），${d.factorBName} 主效应${a.pB<.05?'显著':'不显著'}（${formatPText(a.pB)}）。`);
    paragraphs.push(`两因素交互作用${a.pAB<.05?'显著':'不显著'}（${formatPText(a.pAB)}）${a.pAB<.05?'，说明一个因素的影响会随另一个因素水平而变化，因此应优先比较各组合的简单效应。':'，在当前数据下两因素的变化模式较为一致。'}`);
    d.factorBLevels.forEach(b=>{const series=state.descriptive.filter(r=>r.b===b).sort((x,y)=>levelIndex(x.a,d.factorALevels)-levelIndex(y.a,d.factorALevels));if(series.length>1){const c=series.at(-1).mean-series[0].mean;paragraphs.push(`${b} 条件下，${d.metricName} 从 ${series[0].a} 到 ${series.at(-1).a} 总体${c>0?'增加':c<0?'降低':'保持稳定'} ${formatNumber(Math.abs(c),3)}${d.metricUnit?` ${d.metricUnit}`:''}。`)}});
  }
  box.className='interpretation';box.innerHTML=paragraphs.map(p=>`<p>${esc(p)}</p>`).join('')+'<p class="small-note">以上文字为自动辅助解读。统计 n 指独立平行样本数；同一样品的重复测定仅用于获得该样品均值，不替代独立样本。</p>';
}

function bindChartUi(){
  $$('[data-chart-type]').forEach(btn=>btn.addEventListener('click',()=>{state.chart.type=btn.dataset.chartType;state.workflow.chartType=state.chart.type;state.workflow.mode='experiment';state.chart.mode='experiment';syncWorkflowControls();if(state.chart.type==='curve'&&['error','letters'].includes(state.chart.selected))state.chart.selected='series';autoScaleChart();renderChartStudio()}));
  $('#toggleBreak').addEventListener('click',()=>{state.chart.breakAxis=!state.chart.breakAxis;if(state.chart.breakAxis)autoBreakScale();renderChartStudio()});
  $('#autoScale').addEventListener('click',()=>{autoScaleChart();if(state.chart.breakAxis)autoBreakScale();renderChartStudio();toast('坐标范围已自动优化')});
  $('#journalTemplate').addEventListener('change',e=>{if(state.chart.mode==='gallery'){const t=templates[e.target.value]||templates.foodchem;state.gallery.settings.fontEnglish=t.fontEnglish;state.gallery.settings.fontChinese=t.fontChinese;state.gallery.settings.axisWidth=t.axis;state.gallery.settings.frameWidth=Math.max(1,t.axis-.1);state.gallery.palette=[...t.colors];state.gallery.seriesStyles={}}else applyTemplate(e.target.value);renderChartStudio()});
  $('#xFactorSelect').addEventListener('change',e=>{state.chart.xFactor=e.target.value;prepareChartData();autoScaleChart();renderChartStudio()});
  $('#refreshChart').addEventListener('click',()=>{analyzeData();prepareChartData();autoScaleChart();renderChartStudio();toast('图表已按当前统计结果更新')});
  $('#exportSvg').addEventListener('click',exportSvg);$('#exportPng').addEventListener('click',exportPng);
  $('#addChartText')?.addEventListener('click',()=>addChartAnnotation('text'));
  $('#addChartArrow')?.addEventListener('click',()=>addChartAnnotation('arrow'));
  $('#addPeakLabel')?.addEventListener('click',()=>addChartAnnotation('peak'));
  $('#addGuideLine')?.addEventListener('click',()=>addChartAnnotation('guide'));
  ['togglePropertiesPanel','propertiesPanelDockToggle'].forEach(id=>$('#'+id)?.addEventListener('click',()=>setPropertiesPanelCollapsed(!$('#view-chart').classList.contains('properties-collapsed'))));
  const quickMap={quickEnglishFont:'fontEnglish',quickChineseFont:'fontChinese',quickFontWeight:'globalFontWeight',quickCanvasPreset:'panelPreset',quickDpi:'pngDpi'};
  Object.entries(quickMap).forEach(([id,key])=>{const el=$('#'+id);if(el)el.addEventListener('change',()=>{
    let v=el.value;
    if(state.chart.mode==='gallery'){
      const gs=state.gallery.settings;
      if(key==='fontEnglish')gs.fontEnglish=v;
      else if(key==='fontChinese')gs.fontChinese=v;
      else if(key==='globalFontWeight')gs.globalFontWeight=Number(v);
      else if(key==='pngDpi')gs.dpi=Number(v);
      else if(key==='panelPreset'){gs.panelPreset=v;applyGalleryCanvasPreset(v)}
    }else{
      if(['globalFontWeight','pngDpi'].includes(key))v=Number(v);state.chart.settings[key]=v;if(key==='panelPreset')applyCanvasPreset(v)
    }
    renderChartStudio();
  })});
  [['quickCanvasWidth','canvasWidth'],['quickCanvasHeight','canvasHeight']].forEach(([id,key])=>{const el=$('#'+id);if(el)el.addEventListener('change',()=>{if(state.chart.mode==='gallery'){state.gallery.settings[key==='canvasWidth'?'width':'height']=Number(el.value)}else{const s=state.chart.settings;setCanvasSize(key==='canvasWidth'?Number(el.value):s.canvasWidth,key==='canvasHeight'?Number(el.value):s.canvasHeight);s.panelPreset='custom'}renderChartStudio()})});
  [['quickTitleVisible','titleVisible'],['quickXTitleVisible','xTitleVisible'],['quickYTitleVisible','yTitleVisible']].forEach(([id,key])=>{const el=$('#'+id);if(el)el.addEventListener('change',()=>{const s=state.chart.mode==='gallery'?state.gallery.settings:state.chart.settings;s[key]=el.checked;renderChartStudio()})});
  const radarQuickMap={radarQuickTheme:'radarTheme',radarQuickGradientMode:'radarGradientMode',radarQuickTickSize:'radarTickLabelSize',radarQuickDecimals:'radarTickDecimals',radarQuickTickPosition:'radarTickLabelPosition',radarQuickLabelOffset:'radarLabelOffset'};
  Object.entries(radarQuickMap).forEach(([id,key])=>{const el=$('#'+id);if(el)el.addEventListener('change',()=>{if(state.chart.mode!=='gallery'||state.gallery.type!=='radar')return;let v=el.value;if(['radarTickLabelSize','radarTickDecimals','radarLabelOffset'].includes(key))v=Number(v);state.gallery.settings[key]=v;if(key==='radarTheme')applyRadarTheme(v);state.gallery.selected='radar-grid';renderGalleryStudioCanvas();renderGalleryStudioProperties();syncGalleryQuickControls();})});
  $('#radarQuickHighlight')?.addEventListener('change',e=>{if(state.chart.mode!=='gallery'||state.gallery.type!=='radar')return;state.gallery.settings.radarSmartHighlight=e.target.checked;state.gallery.selected='radar-grid';renderGalleryStudioCanvas();renderGalleryStudioProperties();syncGalleryQuickControls()});

}

function setPropertiesPanelCollapsed(collapsed){
  const view=$('#view-chart');if(!view)return;
  view.classList.toggle('properties-collapsed',collapsed);
  const inner=$('#togglePropertiesPanel'),dock=$('#propertiesPanelDockToggle');
  if(inner)inner.textContent=collapsed?'展开':'收起';
  if(dock){dock.textContent=collapsed?'属性栏：关（点击打开）':'属性栏：开';dock.classList.toggle('properties-panel-toggle-active',!collapsed)}
}


function currentAnnotationState(){return state.chart.mode==='gallery'?state.gallery:state.chart}
function currentAnnotationCanvas(){return state.chart.mode==='gallery'?{W:Number(state.gallery.settings.width)||980,H:Number(state.gallery.settings.height)||660}:chartDimensions()}
function annotationById(id){return currentAnnotationState().annotations.find(a=>a.id===id)}
function makeAnnotationId(){return`ann_${Date.now()}_${Math.random().toString(36).slice(2,7)}`}
function addChartAnnotation(type){
  const store=currentAnnotationState(),{W,H}=currentAnnotationCanvas();let ann={id:makeAnnotationId(),type,color:'#20262b',width:1.2,dash:'',fontSize:13,fontWeight:400,fontFamily:'inherit'};
  if(type==='text')Object.assign(ann,{text:'说明文字',x:W*.56,y:H*.18,anchor:'middle',background:'#ffffff',backgroundOpacity:.9,padding:7,borderColor:'#b8c5c0',borderWidth:1,cornerRadius:4});
  else if(type==='arrow')Object.assign(ann,{x1:W*.36,y1:H*.28,x2:W*.52,y2:H*.42,text:'',arrowEnd:true});
  else if(type==='guide')Object.assign(ann,{orientation:'vertical',x:W*.55,y:H*.45,x1:W*.55,y1:H*.16,x2:W*.55,y2:H*.78,dash:'6 5',text:'',arrowEnd:false});
  else if(type==='peak'){
    if(state.chart.mode==='experiment'&&!isLineLike()){toast('峰值标注适用于折线图或平滑曲线图');return}
    if(state.chart.mode==='gallery'&&!['scatter','bubble','kde'].includes(state.gallery.type)){toast('当前图形暂不支持自动峰值识别，可使用文字和箭头手动标注');return}
    const peak=findCurrentPeak();if(!peak){toast('没有可标注的数据点');return}
    Object.assign(ann,{type:'peak',series:peak.series,dataX:peak.x,dataY:peak.y,label:peak.label,dx:24,dy:-34,showX:true,showY:false,decimals:0,guide:'none',arrowEnd:true});
  }
  store.annotations.push(ann);store.selectedAnnotation=ann.id;store.selected=`annotation:${ann.id}`;
  renderChartStudio();toast(type==='arrow'?'已添加箭头：拖动“起”“终”两个圆点改变方向和长度':type==='peak'?'已添加峰值标注':'已添加标注对象');
}
function findCurrentPeak(){
  if(state.chart.mode==='experiment'){
    const groups=chartGroups(),series=clamp(Number(state.chart.selectedSeries)||0,0,Math.max(0,groups.length-1)),group=groups[series],rows=state.chartData.filter(d=>d.group===group&&Number.isFinite(d.mean));if(!rows.length)return null;
    const p=rows.reduce((a,b)=>b.mean>a.mean?b:a);return{series,x:p.x,y:p.mean,label:formatPeakLabel(p.x,p.mean)};
  }
  const rows=state.gallery.rows,type=state.gallery.type;
  if(type==='kde'){const values=rows.map(r=>r.Value).filter(Number.isFinite);if(!values.length)return null;const min=Math.min(...values),max=Math.max(...values),curve=kdeFor(values,min,max,160,state.gallery.settings.bandwidth),p=curve.reduce((a,b)=>b[1]>a[1]?b:a);return{series:0,x:p[0],y:p[1],label:formatPeakLabel(p[0],p[1])}}
  const usable=rows.filter(r=>Number.isFinite(r.X)&&Number.isFinite(r.Y));if(!usable.length)return null;const p=usable.reduce((a,b)=>b.Y>a.Y?b:a);return{series:Math.max(0,[...new Set(rows.map(r=>r.Group))].indexOf(p.Group)),x:p.X,y:p.Y,label:formatPeakLabel(p.X,p.Y)};
}
function formatPeakLabel(x,y){return Number.isFinite(Number(x))?formatNumber(Number(x),2):String(x)}
function removeSelectedAnnotation(){const store=currentAnnotationState(),id=store.selectedAnnotation;if(!id)return;store.annotations=store.annotations.filter(a=>a.id!==id);store.selectedAnnotation=null;store.selected='title';renderChartStudio();toast('标注已删除')}
function annotationFontStack(ann){if(ann.fontFamily&&ann.fontFamily!=='inherit')return ann.fontFamily;return state.chart.mode==='gallery'?galleryFontStack():fontStack()}
function arrowEndpointHandleMarkup({id,x,y,endpoint,compose=false}){
  const isStart=endpoint==='start',label=isStart?'起':'终',fill=isStart?'#ffffff':'#f28e2b',stroke=isStart?'#0d6b55':'#b65700';
  const handleAttr=compose?`data-compose-arrow-handle="${endpoint}" data-compose-annotation-id="${id}"`:`data-annotation-handle="${endpoint}" data-annotation-id="${id}"`;
  return `<g class="annotation-endpoint-control ${endpoint}" ${handleAttr} transform="translate(${x} ${y})" style="pointer-events:all;cursor:grab;touch-action:none"><title>${isStart?'拖动箭头起点':'拖动箭头终点'}</title><circle class="annotation-handle-halo" r="12" fill="#ffffff" fill-opacity=".92" stroke="#ffffff" stroke-width="4" vector-effect="non-scaling-stroke"/><circle class="annotation-edit-handle ${endpoint}" r="7.5" fill="${fill}" stroke="${stroke}" stroke-width="2.2" vector-effect="non-scaling-stroke"/><text class="annotation-handle-label" x="0" y="3.2" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="${isStart?'#0d6b55':'#ffffff'}" pointer-events="none">${label}</text></g>`;
}
function genericAnnotationSvg(ann,interactive=true){
  const cls=interactive?'chart-object draggable':'',objAttr=state.chart.mode==='gallery'?`data-gobject="annotation:${ann.id}" data-gannotation-id="${ann.id}" data-gdrag="annotation"`:`data-object="annotation" data-annotation-id="${ann.id}" data-drag="annotation"`;
  if(ann.type==='text'){
    const approx=Math.max(24,String(ann.text||'').length*ann.fontSize*.62+(ann.padding||0)*2),h=ann.fontSize*1.35+(ann.padding||0)*2;
    return `<g ${objAttr} class="${cls}" transform="translate(${ann.x} ${ann.y})"><rect x="${-approx/2}" y="${-h+ann.fontSize*.35}" width="${approx}" height="${h}" rx="${ann.cornerRadius??4}" fill="${ann.background||'#fff'}" fill-opacity="${ann.backgroundOpacity??0}" stroke="${ann.borderColor||'none'}" stroke-width="${ann.borderWidth||0}"/><text text-anchor="${ann.anchor||'middle'}" font-family="${escAttr(annotationFontStack(ann))}" font-size="${ann.fontSize}" font-weight="${ann.fontWeight}" fill="${ann.color}">${esc(ann.text||'')}</text></g>`;
  }
  if(ann.type==='arrow'||ann.type==='guide'){
    const marker=ann.arrowEnd!==false?' marker-end="url(#chartAnnotationArrow)"':'';
    const mx=(ann.x1+ann.x2)/2,my=(ann.y1+ann.y2)/2;
    const txt=ann.text?`<text data-ann-label x="${mx}" y="${my-8}" text-anchor="middle" font-family="${escAttr(annotationFontStack(ann))}" font-size="${ann.fontSize}" font-weight="${ann.fontWeight}" fill="${ann.color}">${esc(ann.text)}</text>`:'';
    const handles=interactive?`${arrowEndpointHandleMarkup({id:ann.id,x:ann.x1,y:ann.y1,endpoint:'start'})}${arrowEndpointHandleMarkup({id:ann.id,x:ann.x2,y:ann.y2,endpoint:'end'})}`:'';
    return `<g ${objAttr} class="${cls}"><line class="annotation-hit-line" data-ann-hit x1="${ann.x1}" y1="${ann.y1}" x2="${ann.x2}" y2="${ann.y2}"/><line data-ann-line x1="${ann.x1}" y1="${ann.y1}" x2="${ann.x2}" y2="${ann.y2}" stroke="${ann.color}" stroke-width="${ann.width}" ${ann.dash?`stroke-dasharray="${ann.dash}"`:''}${marker}/>${txt}${handles}</g>`;
  }
  return'';
}
function renderGenericAnnotations(store,interactive=true){return(store.annotations||[]).filter(a=>a.type!=='peak').map(a=>genericAnnotationSvg(a,interactive)).join('')}
function experimentPeakSvg(ann,M,plotW,plotH,xvals,b){
  const idx=xvals.findIndex(v=>String(v)===String(ann.dataX));if(idx<0)return'';const xx=experimentXPosition(ann.dataX,idx,xvals,M,plotW),yy=M.t+(b.max-ann.dataY)/(b.max-b.min||1)*plotH,tx=xx+(ann.dx||24),ty=yy+(ann.dy||-34),label=peakAnnotationLabel(ann),guide=ann.guide==='vertical'?`<line x1="${xx}" y1="${yy}" x2="${xx}" y2="${M.t+plotH}" stroke="${ann.color}" stroke-width="${ann.width}" stroke-dasharray="${ann.dash||'6 5'}"/>`:ann.guide==='horizontal'?`<line x1="${M.l}" y1="${yy}" x2="${xx}" y2="${yy}" stroke="${ann.color}" stroke-width="${ann.width}" stroke-dasharray="${ann.dash||'6 5'}"/>`:'';
  return `<g data-object="annotation" data-annotation-id="${ann.id}" data-drag="annotation" class="chart-object draggable">${guide}<line x1="${tx}" y1="${ty+4}" x2="${xx}" y2="${yy}" stroke="${ann.color}" stroke-width="${ann.width}" marker-end="url(#chartAnnotationArrow)"/><text x="${tx}" y="${ty}" text-anchor="middle" font-family="${escAttr(annotationFontStack(ann))}" font-size="${ann.fontSize}" font-weight="${ann.fontWeight}" fill="${ann.color}">${esc(label)}</text></g>`;
}
function peakAnnotationLabel(ann){const d=ann.decimals==='auto'?2:Number(ann.decimals)||0,parts=[];if(ann.showX!==false)parts.push(Number.isFinite(Number(ann.dataX))?Number(ann.dataX).toFixed(d).replace(/\.0+$/,''):String(ann.dataX));if(ann.showY)parts.push(Number(ann.dataY).toFixed(d).replace(/\.0+$/,''));return ann.customLabel||parts.join(', ')||ann.label||''}
function renderExperimentAnnotations(M,plotW,plotH,xvals,b){return renderGenericAnnotations(state.chart,true)+state.chart.annotations.filter(a=>a.type==='peak').map(a=>experimentPeakSvg(a,M,plotW,plotH,xvals,b)).join('')}
function galleryPeakSvg(ann,W,H){
  const p=galleryPlotBox(W,H),type=state.gallery.type;let xx,yy;
  if(['scatter','bubble'].includes(type)){const ax=galleryScatterAxes(W,H);xx=ax.xMap(ann.dataX);yy=ax.yMap(ann.dataY)}else if(type==='kde'){const vals=state.gallery.rows.map(r=>r.Value).filter(Number.isFinite),pad=(Math.max(...vals)-Math.min(...vals)||1)*.08,min=Math.min(...vals)-pad,max=Math.max(...vals)+pad,curve=kdeFor(vals,min,max,120,state.gallery.settings.bandwidth),ymax=Math.max(...curve.map(q=>q[1])),xMap=scaleLinear(min,max,p.l,p.l+p.w),yMap=scaleLinear(0,ymax,p.t+p.h,p.t);xx=xMap(ann.dataX);yy=yMap(ann.dataY)}else return'';
  const tx=xx+(ann.dx||24),ty=yy+(ann.dy||-34);return `<g data-gobject="annotation:${ann.id}" data-gannotation-id="${ann.id}" data-gdrag="annotation" class="chart-object draggable"><line x1="${tx}" y1="${ty+4}" x2="${xx}" y2="${yy}" stroke="${ann.color}" stroke-width="${ann.width}" marker-end="url(#chartAnnotationArrow)"/><text x="${tx}" y="${ty}" text-anchor="middle" font-size="${ann.fontSize}" font-weight="${ann.fontWeight}" fill="${ann.color}">${esc(peakAnnotationLabel(ann))}</text></g>`;
}
function renderGalleryAnnotations(W,H,interactive=true){return renderGenericAnnotations(state.gallery,interactive)+state.gallery.annotations.filter(a=>a.type==='peak').map(a=>galleryPeakSvg(a,W,H)).join('')}

function prepareChartData(){
  if(!state.descriptive.length&&state.rawData.length)analyzeData();
  const d=state.design,xFactor=state.chart.xFactor,rows=[];
  if(d.designType==='one'){
    const letterInput=state.descriptive.map(r=>({label:r.a,mean:r.mean,n:r.n,sd:r.sd}));
    const letters=((state.chart.type==='curve'||state.chart.type==='waterfall'||state.analysis?.continuous||state.descriptive.length>250))?{}:lettersForComparisons(letterInput,state.analysis?.mse,state.analysis?.dfError,state.chart.settings.postHoc);
    state.descriptive.forEach(r=>rows.push({x:r.a,group:d.metricName,mean:r.mean,error:errorValue(r),letter:letters[r.a]||''}));
  }else{
    const xLevels=xFactor==='A'?d.factorALevels:d.factorBLevels,groupLevels=xFactor==='A'?d.factorBLevels:d.factorALevels;
    const descIndex=new Map(state.descriptive.map(r=>[`${String(r.a)}${String(r.b)}`,r]));
    const useTwoWay=state.chart.settings.letterScheme==='twoWay';
    let upperByX={},lowerByGroup={};
    if(useTwoWay){
      const xKey2=xFactor==='A'?'a':'b',gKey2=xFactor==='A'?'b':'a',marg=new Map();
      let pss=0,pdf=0;
      state.descriptive.forEach(r=>{
        if(Number.isFinite(r.sd)&&r.n>1){pss+=(r.n-1)*r.sd*r.sd;pdf+=r.n-1;}
        [xKey2,gKey2].forEach(k=>{const lv=String(r[k]),mk=k+lv;if(!marg.has(mk))marg.set(mk,{label:lv,sum:0,n:0});const m=marg.get(mk);m.sum+=r.n*r.mean;m.n+=r.n;});
      });
      let pmse=pdf>0?pss/pdf:0;if(pmse<=0)pmse=1e-12;const edf=pdf>0?pdf:1;
      const toItems=(key,levels)=>levels.map(lv=>marg.get(key+String(lv))).filter(Boolean).map(m=>({label:m.label,mean:m.sum/m.n,n:m.n}));
      const upRaw=lettersForComparisons(toItems(xKey2,xLevels),pmse,edf,state.chart.settings.postHoc);
      Object.keys(upRaw).forEach(k=>upperByX[k]=upRaw[k].toUpperCase());
      lowerByGroup=lettersForComparisons(toItems(gKey2,groupLevels),pmse,edf,state.chart.settings.postHoc);
    }
    xLevels.forEach(x=>{
      const comps=[];
      groupLevels.forEach(g=>{
        const r=descIndex.get(xFactor==='A'?`${String(x)}${String(g)}`:`${String(g)}${String(x)}`);
        if(r)comps.push({label:g,mean:r.mean,n:r.n,row:r});
      });
      const skipLetters=(state.chart.type==='curve'||state.chart.type==='waterfall'||state.analysis?.continuous||xLevels.length>250);
      let letters={};
      if(!skipLetters&&!useTwoWay){
        let ss=0,wdf=0;comps.forEach(c=>{const r=c.row;if(r&&r.n>1&&Number.isFinite(r.sd)){ss+=(r.n-1)*r.sd*r.sd;wdf+=r.n-1;}});
        if(wdf>0){let lmse=ss/wdf;if(lmse<=0)lmse=1e-12;letters=lettersForComparisons(comps,lmse,wdf,state.chart.settings.postHoc);}
      }
      comps.forEach(c=>rows.push({x,group:c.label,mean:c.mean,error:errorValue(c.row),letter:useTwoWay?((upperByX[String(x)]||'')+(lowerByGroup[String(c.label)]||'')):(letters[c.label]||'')}));
    });
  }
  const ml=state.chart.manualLetters;if(ml)rows.forEach(r=>{const k=r.x+'\u001f'+r.group;if(k in ml)r.letter=ml[k]});
  state.chartData=rows;invalidateChartModel();syncChartText();
  const ph0=state.chart.settings.postHoc;
  if(ph0==='gameshowell'){state.chart._heteroWarned=null}
  else{const sds0=state.descriptive.filter(r=>r&&r.n>1&&Number.isFinite(r.sd)&&r.sd>0).map(r=>r.sd);
    if(sds0.length>=3){const ratio0=Math.max(...sds0)/Math.min(...sds0);
      if(ratio0>4&&state.chart._heteroWarned!==ph0){state.chart._heteroWarned=ph0;
        toast(`检测到各组标准差相差较大（最大约为最小的 ${Math.round(ratio0)} 倍），方差可能不齐；建议多重比较改用 Games-Howell`,6000)}}}
}

function errorValue(r){const et=state.chart.settings.errorType||state.design.errorType;return et==='se'?r.se:et==='ci'?r.ci:r.sd}

function lettersForComparisons(items,mse,df,method){
  method=method||'duncan';
  const out={};if(!items.length)return out;if(items.length===1){out[items[0].label]='a';return out}
  const gh=method==='gameshowell';
  if(!gh&&(!Number.isFinite(mse)||mse<=0||!Number.isFinite(df))){items.forEach(i=>out[i.label]='a');return out}
  const k=items.length,sorted=items.map((it,i)=>({...it,original:i})).sort((a,b)=>b.mean-a.mean);
  const sig=Array.from({length:k},()=>Array(k).fill(false)),npairs=k*(k-1)/2;
  for(let i=0;i<k;i++)for(let j=i+1;j<k;j++){
    const ni=sorted[i].n,nj=sorted[j].n,diff=Math.abs(sorted[i].mean-sorted[j].mean),span=j-i+1;
    if(diff<1e-6*Math.max(1,Math.abs(sorted[i].mean),Math.abs(sorted[j].mean)))continue;
    let crit;
    if(method==='gameshowell'){
      const sdi=Number(sorted[i].sd ?? sorted[i].row?.sd)||0,sdj=Number(sorted[j].sd ?? sorted[j].row?.sd)||0;
      const vi=sdi*sdi/ni,vj=sdj*sdj/nj,seg=Math.sqrt(vi+vj);
      const dfgRaw=(vi+vj)**2/((vi*vi/Math.max(1,ni-1))+(vj*vj/Math.max(1,nj-1)));
      const dfg=Math.round(dfgRaw*2)/2;
      crit=srQuantile(k,dfg,.95)*seg/Math.SQRT2;
    }else{
    const se=Math.sqrt(mse/2*(1/ni+1/nj));
    if(method==='duncan')crit=srQuantile(span,df,Math.pow(.95,span-1))*se;
    else if(method==='snk')crit=srQuantile(span,df,.95)*se;
    else if(method==='tukey')crit=srQuantile(k,df,.95)*se;
    else if(method==='bonferroni')crit=tQuantile(1-.05/(2*npairs),df)*Math.sqrt(mse*(1/ni+1/nj));
    else crit=tCritical975(df)*Math.sqrt(mse*(1/ni+1/nj));
    }
    sig[i][j]=sig[j][i]=diff>crit}
  const letters=compactLetterDisplay(sorted.map(x=>x.label),sig);Object.assign(out,letters);return out;
}

function compactLetterDisplay(labels,sig){
  let cols=[new Set(labels.map((_,i)=>i))];
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++)if(sig[i][j]){
    const next=[];cols.forEach(set=>{if(set.has(i)&&set.has(j)){const a=new Set(set),b=new Set(set);a.delete(i);b.delete(j);next.push(a,b)}else next.push(set)});cols=absorbSets(next);
  }
  cols.sort((a,b)=>Math.min(...a)-Math.min(...b));const out={};labels.forEach(l=>out[l]='');cols.forEach((set,idx)=>{const letter=indexLetter(idx);set.forEach(i=>out[labels[i]]+=letter)});return out;
}
function absorbSets(sets){
  const uniq=[];sets.filter(s=>s.size).forEach(s=>{if(!uniq.some(u=>sameSet(u,s)))uniq.push(s)});
  return uniq.filter((s,i)=>!uniq.some((u,j)=>i!==j&&isSubset(s,u)));
}
function sameSet(a,b){return a.size===b.size&&[...a].every(x=>b.has(x))}function isSubset(a,b){return a.size<=b.size&&[...a].every(x=>b.has(x))}
function indexLetter(i){let s='';do{s=String.fromCharCode(97+i%26)+s;i=Math.floor(i/26)-1}while(i>=0);return s}

function syncChartText(){
  const isWf=state.chart.type==='waterfall';
  if(isWf)state.chart.xFactor='A';
  const d=state.design,s=state.chart.settings;
  if(!s.title||s.title==='Moisture content')s.title=d.metricName;
  if(isWf){
    if(!s.wfTitlesReady){s.xTitle=d.factorAName||'';s.yTitle=d.metricName+(d.metricUnit?` (${d.metricUnit})`:'');s.wfTitlesReady=true;}
  }else{
    s.xTitle=state.chart.xFactor==='A'?d.factorAName:(d.factorBName||d.factorAName);
    s.yTitle=d.metricName+(d.metricUnit?` (${d.metricUnit})`:'');
  }
}

function autoScaleChart(){
  const s=state.chart.settings,vals=(state.chart.type==='curve'?state.chartData.map(d=>d.mean):state.chartData.flatMap(d=>[d.mean-d.error,d.mean+d.error])).filter(Number.isFinite);if(!vals.length)return;
  const min=Math.min(...vals),max=Math.max(...vals),range=max-min||Math.abs(max)||1,pad=range*.13;
  if(state.chart.type==='bar'&&!state.chart.breakAxis&&min>=0){s.yMin=0;s.yMax=niceCeil(max+pad)}else{s.yMin=niceFloor(min-pad);s.yMax=niceCeil(max+pad)}
  s.yTickStep=null;
}

function autoBreakScale(){
  const s=state.chart.settings,vals=(state.chart.type==='curve'?state.chartData.map(d=>d.mean):state.chartData.flatMap(d=>[d.mean-d.error,d.mean+d.error])).filter(Number.isFinite);if(!vals.length)return;
  const min=Math.min(...vals),max=Math.max(...vals),range=max-min||Math.abs(max)*.08||1;
  const upperStep=niceStep(range/4);
  s.upperMin=Math.floor((min-range*.10)/upperStep)*upperStep;
  s.upperMax=Math.ceil((max+range*.10)/upperStep)*upperStep;
  s.lowerMin=0;
  if(s.upperMin<10){
    const omitted=Math.max(.5,range*1.2);
    s.lowerMax=Math.max(0,Math.floor((s.upperMin-omitted)/upperStep)*upperStep);
  }else{
    s.lowerMax=niceStep(s.upperMin/4);
  }
  if(s.lowerMax>=s.upperMin)s.lowerMax=Math.max(0,s.upperMin-upperStep*2);
}

function applyTemplate(name){const t=templates[name];state.chart.settings.fontEnglish=t.fontEnglish;state.chart.settings.fontChinese=t.fontChinese;state.chart.settings.axisWidth=t.axis;state.chart.settings.frameWidth=Math.max(1,t.axis-.1);state.chart.palette=[...t.colors];state.chart.seriesStyles={}}

function renderChartStudio(){
  const context=$('#studioContextTitle');if(context)context.textContent=`Chart Studio · ${workflowChartLabel(state.workflow.chartType)}`;
  if(state.chart.mode==='gallery'){renderGalleryStudio();return}
  setStudioModeUi('experiment');
  $('#toggleBreak').textContent=`断轴：${state.chart.breakAxis?'开':'关'}`;
  $$('[data-chart-type]').forEach(b=>b.classList.toggle('active',b.dataset.chartType===state.chart.type));
  syncQuickControls();renderMappingSelect();renderLayers();renderChart();renderProperties();
}
function setStudioModeUi(mode){
  if(mode!=='gallery')$('#radarQuickBar')?.classList.add('hidden');
  $('#experimentChartButtons')?.classList.toggle('hidden',mode!=='experiment');
  $('#mappingBox')?.classList.toggle('hidden',mode!=='experiment'||state.chart.type==='waterfall');
  $('#toggleBreak')?.classList.toggle('hidden',mode!=='experiment');
  $('#autoScale')?.classList.toggle('hidden',mode!=='experiment');
  $('#refreshChart')?.classList.toggle('hidden',mode!=='experiment');
  const select=$('#studioChartTypeSelect');if(select)select.value=state.workflow.chartType;
}
function syncGalleryQuickControls(){
  const s=state.gallery.settings,isRadar=state.gallery.type==='radar';
  $('#radarQuickBar')?.classList.toggle('hidden',!isRadar);
  if(isRadar){const radarMap={radarQuickTheme:s.radarTheme,radarQuickGradientMode:s.radarGradientMode,radarQuickTickSize:s.radarTickLabelSize,radarQuickDecimals:String(s.radarTickDecimals),radarQuickTickPosition:s.radarTickLabelPosition,radarQuickLabelOffset:s.radarLabelOffset};Object.entries(radarMap).forEach(([id,v])=>{const el=$('#'+id);if(el&&document.activeElement!==el)el.value=v});const hl=$('#radarQuickHighlight');if(hl)hl.checked=s.radarSmartHighlight!==false;}
  const map={quickEnglishFont:s.fontEnglish,quickChineseFont:s.fontChinese,quickFontWeight:String(s.globalFontWeight),quickCanvasPreset:s.panelPreset||'custom',quickDpi:String(s.dpi),quickCanvasWidth:s.width,quickCanvasHeight:s.height};
  Object.entries(map).forEach(([id,v])=>{const el=$('#'+id);if(el&&document.activeElement!==el)el.value=v});
  [['quickTitleVisible','titleVisible'],['quickXTitleVisible','xTitleVisible'],['quickYTitleVisible','yTitleVisible']].forEach(([id,key])=>{const el=$('#'+id);if(el)el.checked=s[key]!==false});
  const badge=$('#canvasStatus');if(badge)badge.textContent=`${s.width} × ${s.height} px · ${s.dpi} dpi`;
}
function renderGalleryStudio(){
  setStudioModeUi('gallery');state.gallery.type=state.workflow.chartType;ensureGalleryPositions();analyzeGalleryData();syncGalleryQuickControls();renderGalleryStudioLayers();renderGalleryStudioCanvas();renderGalleryStudioProperties();
}
function ensureGalleryPositions(){
  const s=state.gallery.settings;
  if(s.titleX==null)s.titleX=s.width/2;if(s.subtitleX==null)s.subtitleX=s.width/2;
  if(s.xTitleX==null)s.xTitleX=s.width/2;if(s.xTitleY==null)s.xTitleY=s.height-24;
  if(s.yTitleY==null)s.yTitleY=s.height/2;if(s.legendX==null)s.legendX=120;if(s.legendY==null)s.legendY=62;
  if(s.legendFrameX==null)s.legendFrameX=108;if(s.legendFrameY==null)s.legendFrameY=50;if(s.methodNoteX==null)s.methodNoteX=s.width-24;if(s.methodNoteY==null)s.methodNoteY=s.height-10;
}
function galleryHasAxes(type=state.gallery.type){return !['pie','radar','heatmap'].includes(type)}
function galleryHasLegend(type=state.gallery.type){return true}
function gallerySpecificLayerIds(type=state.gallery.type){
  const map={
    hist:[['histogram','柱体与分箱']],kde:[['density','密度曲线']],box:[['box-elements','箱体 / 中位线 / 须线 / 散点'],['significance','显著性比较'],['method-note','方法说明']],violin:[['violin-elements','小提琴 / 箱线 / 散点'],['significance','显著性比较'],['method-note','方法说明']],
    scatter:[['regression','拟合线与相关系数'],['method-note','方法说明']],bubble:[['regression','拟合线与相关系数'],['bubble-size','气泡大小'],['method-note','方法说明']],stacked:[['stack-mode','堆叠方式'],['stacked-error','误差棒与数值标注']],pie:[['pie-label','比例标签']],
    heatmap:[['heatmap-scale','色阶与数值'],['method-note','方法说明']],radar:[['radar-grid','雷达网格']]
  };return map[type]||[];
}
function galleryStudioLayers(){
  const type=state.gallery.type,layers=[['section','基础对象'],['title','图题','base'],['subtitle','副标题','base'],['typography','中英文字体','base'],['canvas','画布与清晰度','base']];
  if(galleryHasLegend(type)){if(type==='heatmap')layers.push(['legend','色带图例','base']);else layers.push(['legend','图例内容','base'],['legend-frame','图例边框','base']);}
  if(galleryHasAxes(type))layers.push(['axis-y','Y 轴与纵标题','base'],['axis-x','X 轴与横标题','base'],['frame','图片边框','base']);
  layers.push(['background','背景','base'],['section','数据对象']);
  galleryStudioSeriesNames().forEach((g,i)=>layers.push([`series:${i}`,`数据系列 · ${g}`,'series']));
  gallerySpecificLayerIds(type).forEach(([id,name])=>layers.push([id,name,'special']));
  if(state.gallery.annotations.length){layers.push(['section','标注对象']);state.gallery.annotations.forEach((a,i)=>layers.push([`annotation:${a.id}`,`${annotationTypeLabel(a.type)} ${i+1}`,'special']))}
  return layers;
}
function renderGalleryStudioLayers(){
  $('#layersList').innerHTML=galleryStudioLayers().map(item=>{
    if(item[0]==='section')return `<div class="layer-section-label">${item[1]}</div>`;
    const [id,name,kind]=item,active=id.startsWith('series:')?state.gallery.selected==='series'&&state.gallery.selectedSeries===Number(id.split(':')[1]):state.gallery.selected===id;
    return `<button class="layer-item ${active?'active':''}" data-glayer="${id}"><span class="layer-dot"></span>${esc(name)}<span class="layer-tag ${kind==='special'?'special':''}">${kind==='special'?'专属':'基础'}</span></button>`;
  }).join('');
  $$('[data-glayer]').forEach(b=>b.addEventListener('click',()=>{
    const id=b.dataset.glayer;if(id.startsWith('series:')){state.gallery.selected='series';state.gallery.selectedSeries=Number(id.split(':')[1])}else if(id.startsWith('annotation:')){state.gallery.selected=id;state.gallery.selectedAnnotation=id.split(':')[1]}else state.gallery.selected=id;
    renderGalleryStudioLayers();renderGalleryStudioProperties();highlightGalleryObject();
  }));
}
function renderGalleryStudioCanvas(){
  const stage=$('#chartStage');if(!state.gallery.rows.length){stage.innerHTML='<div class="gallery-empty"><b>等待当前项目数据</b><span>请回到数据导入步骤，使用当前图形模板导入数据。</span></div>';return}
  stage.innerHTML=gallerySvgMarkup('paperSvg',true);bindGalleryStudioObjects();bindGalleryStudioDraggables();highlightGalleryObject();
}
function highlightGalleryObject(){
  $$('#chartStage [data-gobject]').forEach(el=>{
    const hit=el.dataset.gobject===state.gallery.selected&&(state.gallery.selected!=='series'||Number(el.dataset.gseries||0)===state.gallery.selectedSeries);
    el.classList.toggle('object-selected',hit);
  });
}
function bindGalleryStudioObjects(){
  $$('#chartStage [data-gobject]').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();const id=el.dataset.gobject;state.gallery.selected=id;if(id.startsWith('annotation:'))state.gallery.selectedAnnotation=id.split(':')[1];if(id==='series'&&el.dataset.gseries!=null)state.gallery.selectedSeries=Number(el.dataset.gseries);
    renderGalleryStudioLayers();renderGalleryStudioProperties();highlightGalleryObject();
  }));
}
function bindGalleryStudioDraggables(){
  const svg=$('#paperSvg');if(!svg)return;
  bindAnnotationEndpointHandles(svg,state.gallery,()=>{renderGalleryStudioCanvas();renderGalleryStudioLayers();renderGalleryStudioProperties()});
  $$('[data-gdrag]').forEach(el=>el.addEventListener('pointerdown',e=>{
    if(e.target.closest('[data-annotation-handle]'))return;
    e.preventDefault();e.stopPropagation();const key=el.dataset.gdrag,start=svgPoint(svg,e),snap=galleryDragSnapshot(key,el);el.setPointerCapture(e.pointerId);
    state.gallery.selected=key==='annotation'?`annotation:${el.dataset.gannotationId}`:key==='xTitle'?'axis-x':key==='yTitle'?'axis-y':key==='legendFrame'?'legend-frame':key==='methodNote'?'method-note':key;if(key==='annotation')state.gallery.selectedAnnotation=el.dataset.gannotationId;
    const move=ev=>{const p=svgPoint(svg,ev),dx=p.x-start.x,dy=p.y-start.y;if(key==='annotation')galleryApplyAnnotationDrag(el,snap,dx,dy);else galleryApplyDrag(key,snap.x+dx,snap.y+dy,el)};
    const up=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);renderGalleryStudioCanvas();renderGalleryStudioLayers();renderGalleryStudioProperties()};
    el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);
  }));
}
function galleryDragSnapshot(key,el=null){
  const s=state.gallery.settings;if(key==='annotation'){const ann=state.gallery.annotations.find(a=>a.id===el?.dataset.gannotationId);return ann?structuredClone(ann):{}}
  if(key==='title')return{x:s.titleX??s.width/2,y:s.titleY??38};if(key==='subtitle')return{x:s.subtitleX??s.width/2,y:s.subtitleY??58};
  if(key==='legend')return{x:s.legendX??120,y:s.legendY??62};if(key==='legendFrame')return{x:s.legendFrameX??108,y:s.legendFrameY??50};if(key==='methodNote')return{x:s.methodNoteX??s.width-24,y:s.methodNoteY??s.height-10};
  if(key==='xTitle')return{x:s.xTitleX??s.width/2,y:s.xTitleY??s.height-24};return{x:s.yTitleX??28,y:s.yTitleY??s.height/2};
}
function galleryApplyAnnotationDrag(el,snap,dx,dy){
  const ann=state.gallery.annotations.find(a=>a.id===el.dataset.gannotationId);if(!ann)return;
  if(ann.type==='text'){ann.x=snap.x+dx;ann.y=snap.y+dy;el.setAttribute('transform',`translate(${ann.x} ${ann.y})`)}
  else if(ann.type==='peak'){ann.dx=snap.dx+dx;ann.dy=snap.dy+dy;el.setAttribute('transform',`translate(${dx} ${dy})`)}
  else{ann.x1=snap.x1+dx;ann.y1=snap.y1+dy;ann.x2=snap.x2+dx;ann.y2=snap.y2+dy;el.setAttribute('transform',`translate(${dx} ${dy})`)}
}
function galleryApplyDrag(key,x,y,el){
  const s=state.gallery.settings;
  if(key==='title'){s.titleX=x;s.titleY=y;el.setAttribute('x',x);el.setAttribute('y',y)}
  else if(key==='subtitle'){s.subtitleX=x;s.subtitleY=y;el.setAttribute('x',x);el.setAttribute('y',y)}
  else if(key==='legend'){s.legendX=x;s.legendY=y;el.setAttribute('transform',`translate(${x} ${y})`)}
  else if(key==='legendFrame'){s.legendFrameX=x;s.legendFrameY=y;el.setAttribute('transform',`translate(${x} ${y})`)}
  else if(key==='methodNote'){s.methodNoteX=x;s.methodNoteY=y;el.setAttribute('x',x);el.setAttribute('y',y)}
  else if(key==='xTitle'){
    if(state.chart.type==='waterfall'){s.wfXTitleX=x;s.wfXTitleY=y;el.setAttribute('x',x);el.setAttribute('y',y)}
    else{s.xTitleX=x;s.xTitleY=y;el.setAttribute('x',x);el.setAttribute('y',y)}
  }
  else if(state.chart.type==='waterfall'){s.wfYTitleX=x;s.wfYTitleY=y;const wr=state.chart.settings.wfViewDir==='left'?90:-90;el.setAttribute('transform',`translate(${x} ${y}) rotate(${wr})`)}
  else{s.yTitleX=x;s.yTitleY=y;el.setAttribute('transform',`translate(${x} ${y}) rotate(-90)`)}
}
function galleryBasePropertyHtml(id){
  const s=state.gallery.settings;
  if(id==='title')return gallerySection('图题文字',[gCheck('titleVisible','显示图题'),gText('title','图题文字'),gNumber('titleX','水平位置',0,1800,1),gNumber('titleY','垂直位置',0,1200,1),gRange('titleSize','字号',9,40,1),gSelect('titleWeight','字重',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗'],[700,'粗体']]),gColor('titleColor','颜色')])+galleryDragHint('图题');
  if(id==='subtitle')return gallerySection('副标题',[gCheck('subtitleEnabled','显示副标题'),gText('subtitle','副标题文字'),gNumber('subtitleX','水平位置',0,1800,1),gNumber('subtitleY','垂直位置',0,1200,1),gRange('subtitleSize','字号',8,28,1),gSelect('subtitleWeight','字重',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗']]),gColor('subtitleColor','颜色')])+galleryDragHint('副标题');
  if(id==='typography')return gallerySection('字体族',[gSelect('fontEnglish','英文字体',[['Arial','Arial'],['Times New Roman','Times New Roman'],['Calibri','Calibri'],['Helvetica','Helvetica'],['Georgia','Georgia']]),gSelect('fontChinese','中文字体',[['Microsoft YaHei','微软雅黑'],['SimSun','宋体'],['SimHei','黑体'],['KaiTi','楷体'],['FangSong','仿宋']])])+gallerySection('基础字重',[gSelect('globalFontWeight','全局文字粗细',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗'],[700,'粗体']]),gSelect('xTickWeight','X轴数字粗细',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗']]),gSelect('yTickWeight','Y轴数字粗细',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗']]),gSelect('legendWeight','图例文字粗细',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗']])]);
  if(id==='canvas')return gallerySection('画布',[gSelect('panelPreset','图幅比例',[['normal','常规 980×660'],['small','拼图小图 760×540'],['square','正方图 700×700'],['wide','宽图 1080×620'],['tall','高图 820×760'],['custom','自定义']]),gNumber('width','画布宽度',500,1800,10),gNumber('height','画布高度',400,1200,10),gSelect('dpi','PNG 清晰度',[[96,'96 dpi'],[150,'150 dpi'],[300,'300 dpi（论文）'],[600,'600 dpi（高精度）']])]);
  if(id==='axis-x')return gallerySection('横坐标标题',[gCheck('xTitleVisible','显示横坐标标题'),gText('xTitle','标题文字'),gNumber('xTitleX','水平位置',0,1800,1),gNumber('xTitleY','垂直位置',0,1200,1),gRange('xTitleSize','标题字号',9,30,1),gSelect('xTitleWeight','标题字重',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗'],[700,'粗体']]),gColor('xTitleColor','标题颜色')])+gallerySection('X 轴与刻度',[gRange('axisWidth','坐标轴粗细',.5,5,.1),gColor('axisColor','坐标轴颜色'),gRange('xTickSize','X轴数字字号',8,28,1),gSelect('xTickWeight','X轴数字字重',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗'],[700,'粗体']]),gColor('xTickColor','X轴数字颜色'),gRange('tickLength','刻度线长度',0,18,1),gCheck('xTickAutoRotate','标签拥挤时自动倾斜'),gRange('xTickRotation','手动旋转角度',-90,90,5),gCheck('xTickStagger','关闭自动倾斜后交错换行'),gCheck('showXTicks','显示刻度线')])+galleryDragHint('横坐标标题');
  if(id==='axis-y')return gallerySection('纵坐标标题',[gCheck('yTitleVisible','显示纵坐标标题'),gText('yTitle','标题文字'),gNumber('yTitleX','水平位置',0,1800,1),gNumber('yTitleY','垂直位置',0,1200,1),gRange('yTitleSize','标题字号',9,30,1),gSelect('yTitleWeight','标题字重',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗'],[700,'粗体']]),gColor('yTitleColor','标题颜色')])+gallerySection('Y 轴与刻度',[gRange('axisWidth','坐标轴粗细',.5,5,.1),gColor('axisColor','坐标轴颜色'),gRange('yTickSize','Y轴数字字号',8,28,1),gSelect('yTickWeight','Y轴数字字重',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗'],[700,'粗体']]),gColor('yTickColor','Y轴数字颜色'),gRange('tickLength','刻度线长度',0,18,1),gCheck('showYTicks','显示刻度线')])+gallerySection('真实断轴',[gCheck('breakAxis','启用断轴'),gNumber('lowerMin','下段最小值',-100000000,100000000,.01),gNumber('lowerMax','下段最大值',-100000000,100000000,.01),gNumber('upperMin','上段最小值',-100000000,100000000,.01),gNumber('upperMax','上段最大值',-100000000,100000000,.01),gRange('breakGap','两条断裂线间距',6,28,1),gRange('lowerRatio','下段高度比例',.12,.42,.01)])+`<div class="hint">应满足：下段最小值 &lt; 下段最大值 &lt; 上段最小值 &lt; 上段最大值。启用后 Y 轴分为两段压缩显示，断裂线画在坐标轴两端。</div>`+galleryDragHint('纵坐标标题');
  if(id==='frame')return gallerySection('图片边框',[gSelect('frameMode','边框形式',[['lb','仅左、下轴'],['lbr','左、下、右三边'],['box','完整四边框'],['none','不显示边框']]),gRange('frameWidth','边框粗细',.5,6,.1),gColor('frameColor','边框颜色')]);
  if(id==='legend'){if(state.gallery.type==='heatmap')return gallerySection('色带图例',[gCheck('heatmapColorBar','显示色带图例'),gNumber('legendX','水平位置',0,1800,1),gNumber('legendY','垂直位置',0,1200,1),gRange('legendFontSize','数字字号',8,30,1),gOrientationButtons('heatmapColorBarOrientation','排列方向')])+galleryDragHint('色带图例');return gallerySection('图例内容',[gCheck('legend','显示图例'),gNumber('legendX','水平位置',0,1800,1),gNumber('legendY','垂直位置',0,1200,1),gRange('legendFontSize','字号',8,36,1),gSelect('legendWeight','字重',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗']]),gOrientationButtons('legendOrientation','排列方向'),gRange('legendColumns','横向列数',1,6,1)])+galleryDragHint('图例内容');}
  if(id==='legend-frame')return gallerySection('图例边框',[gSelect('legendFrameStyle','边框样式',[['none','无边框'],['solid','实线'],['dashed','虚线'],['dotted','点线'],['double','双线']]),gNumber('legendFrameX','水平位置',0,1800,1),gNumber('legendFrameY','垂直位置',0,1200,1),gCheck('legendFrameAutoSize','自动适应图例大小'),gNumber('legendFrameWidthBox','边框宽度',20,900,1),gNumber('legendFrameHeightBox','边框高度',20,600,1),gRange('legendFrameWidth','线条粗细',.5,5,.1),gColor('legendFrameColor','边框颜色'),gColor('legendFrameFill','底色'),gRange('legendFrameRadius','圆角',0,20,1)])+gallerySection('阴影',[gCheck('legendShadow','显示阴影'),gRange('legendShadowX','水平偏移',-10,14,1),gRange('legendShadowY','垂直偏移',-10,14,1),gRange('legendShadowBlur','模糊程度',0,12,.5),gRange('legendShadowOpacity','透明度',0,.7,.05)])+galleryDragHint('图例边框');
  if(id==='background')return gallerySection('背景',[gColor('background','背景颜色')]);
  return'';
}
function renderGalleryStudioProperties(){
  const def=galleryDef(),id=state.gallery.selected;let name='',html='',scope='基础';
  const baseNames={title:'图题',subtitle:'副标题',typography:'中英文字体',canvas:'画布与清晰度','axis-x':'X 轴与横标题','axis-y':'Y 轴与纵标题',frame:'图片边框',legend:'图例内容','legend-frame':'图例边框',background:'背景'};
  if(baseNames[id]){name=baseNames[id];html=galleryBasePropertyHtml(id)}
  else if(id.startsWith('annotation:')){const ann=annotationById(id.split(':')[1]);name=ann?`标注 · ${annotationTypeLabel(ann.type)}`:'标注';html=ann?annotationPropertyHtml(ann):'';scope='图形专属'}
  else if(id==='series'){const names=galleryStudioSeriesNames(),idx=clamp(state.gallery.selectedSeries,0,Math.max(0,names.length-1));name=`数据系列 · ${names[idx]||'Series'}`;html=gallerySeriesPropertyHtml(def.id,idx);scope='图形专属'}
  else{name=gallerySpecificLayerIds(def.id).find(x=>x[0]===id)?.[1]||'图形专属属性';html=gallerySpecificPropertyHtml(def.id,id);scope='图形专属'}
  $('#selectedObjectName').textContent=name||'未选择对象';$('#propertyEditor').innerHTML=html||'<div class="empty-state">在图中点击一个对象</div>';
  const badge=$('#propertyScopeBadge');if(badge){badge.textContent=scope;badge.classList.toggle('chart-specific',scope!=='基础')}
  bindGalleryStudioPropertyInputs();bindCurrentAnnotationInputs();
}
function gallerySpecificPropertyHtml(type,id){
  if(id==='histogram')return gallerySection('直方图',[gRange('bins','分箱数量',4,40,1),gRange('opacity','柱透明度',.15,1,.05),gRange('lineWidth','柱边框粗细',0,4,.1)]);
  if(id==='density')return gallerySection('核密度曲线',[gNumber('bandwidth','带宽（0=自动）',0,100,.01),gRange('lineWidth','曲线粗细',.5,6,.1),gRange('opacity','填充透明度',0,1,.05)]);
  if(['box-elements','violin-elements'].includes(id))return gallerySection('箱线 / 小提琴的统计口径',[
    gSelect('boxQuartileMethod','四分位数怎么算',[['linear7','常规算法，和 Excel 的 INC 一致（推荐）'],['tukey','Tukey 铰链法，和手画箱线图一致'],['exclusive','排除端点算法，和 Excel 的 EXC 一致']]),
    gSelect('boxWhiskerMethod','须线画到哪里',[['iqr15','箱体上下 1.5 倍箱高（常规）'],['iqr30','箱体上下 3 倍箱高（更宽，异常点更少）'],['minmax','一直画到最小值和最大值'],['percentile','画到下面设定的百分位范围']]),
    gRange('boxWhiskerPercentile','百分位范围（选上一项“百分位”时生效）',1,20,1)
  ])+gallerySection('图上画哪些元素',[
    gRange('boxWidth','箱体 / 小提琴宽度',.2,.9,.01),
    ...(id==='violin-elements'?[gCheck('violinShowBox','在小提琴内叠加箱线（Violin + Box 合体）')]:[]),
    gCheck('showMean','显示平均值（空心圆点）'),
    gCheck('showMedian','显示中位数（横线）'),
    gCheck('showOutliers','显示异常点'),
    gCheck('showPoints','叠加原始数据点'),
    gRange('pointSize','原始点大小',1,10,.5),
    gRange('whiskerWidth','须线粗细',.5,4,.1),
    gRange('medianWidth','中位线粗细',.5,5,.1),
    gRange('opacity','填充透明度',.1,1,.05)
  ])+`<div class="method-badge"><b>当前口径：</b>四分位数＝${esc(boxMethodLabels().quartile)}；须线＝${esc(boxMethodLabels().whisker)}。论文方法部分照这一行写即可。</div>`;
  if(id==='regression')return gallerySection('关系分析',[
    gSelect('correlationMethod','相关怎么算',[['pearson','Pearson：两个变量大致成直线关系时用（最常用）'],['spearman','Spearman：有异常值、或不是直线关系时用（按大小排队后算）']]),
    gCheck('showRegression','画出拟合直线（最小二乘）'),
    gCheck('showCorrelation','在图上写出相关系数'),
    gRange('annotationSize','相关系数文字字号',8,28,1),
    gRange('lineWidth','拟合线粗细',.5,5,.1)
  ])+`<div class="method-badge"><b>当前：</b>${esc(correlationMethodLabel())}；拟合线为普通最小二乘直线。论文方法部分可以照这一行写。</div>`;
  if(id==='bubble-size')return gallerySection('气泡大小',[gRange('pointSize','基础点大小',1,12,.5),gRange('opacity','透明度',.1,1,.05)]);
  if(id==='stack-mode')return gallerySection('堆叠方式',[gCheck('normalize','百分比堆叠'),gSelect('orientation','方向',[['vertical','纵向'],['horizontal','横向']])]);
  if(id==='stacked-error')return gallerySection('误差棒与数值标注',[gCheck('stackedShowError','显示误差棒（读取 Error 列）'),gRange('stackedErrorWidth','误差棒粗细',.5,4,.1),gRange('stackedErrorCapWidth','误差棒端线宽',1,10,.5),gColor('stackedErrorColor','误差棒颜色'),gCheck('stackedShowValue','在每段内标注数值'),gRange('stackedValueSize','数值字号',8,24,1),gRange('stackedValueDecimals','数值小数位',0,4,1)])+`<div class="method-badge">误差棒按整柱合计（各段误差平方和开根）画在柱顶；数值标注在每段中心。</div>`;
  if(id==='pie-label')return gallerySection('饼图标签',[gCheck('donut','圆环图'),gCheck('showCorrelation','显示百分比标签'),gRange('pieLabelSize','百分比字号',8,28,1)]);
  if(id==='significance')return gallerySection('差异显著性',[
    gSelect('statMethod','用哪种检验',[['anovaLsd','常规：单因素方差分析 + Fisher LSD 两两比较'],['welchHolm','方差不齐时：Welch 方差分析 + Holm 校正'],['kruskalHolm','数据不正态时：Kruskal–Wallis + Mann–Whitney（Holm 校正）']]),
    gCheck('significanceEnabled','在图上标出显著性'),
    gSelect('significanceDisplay','怎么标',[['brackets','连线括号 + 标记'],['letters','字母分组（a、b、c）'],['none','不显示']]),
    gSelect('significancePairMode','标哪些比较',[['significant','只标有显著差异的'],['control','只和第一组比'],['all','所有两两组合都标']]),
    gSelect('significanceLabelMode','括号上写什么',[['stars','星号（* / ** / ***）'],['pvalue','具体 p 值'],['letters','字母分组']]),
    gRange('significanceFontSize','标记字号',8,26,1),
    gRange('significanceLineWidth','括号线宽',.5,4,.1),
    gColor('significanceColor','括号与文字颜色'),
    gRange('significanceOffset','距数据顶部',2,30,1),
    gRange('significanceStep','多层括号之间的间距',8,40,1)
  ])+`<div class="stat-method-note"><b>当前：</b>${esc(statisticalMethodLabel())}。不同检验的假设和多重比较校正不同，p 值与标记可能因此变化。</div>`;
  if(id==='heatmap-scale')return gallerySection('相关计算方法',[gSelect('correlationMethod','相关方法',[['pearson','Pearson 线性相关'],['spearman','Spearman 秩相关']]),gSelect('heatmapCluster','聚类排序',[['none','不聚类'],['rows','仅行聚类'],['cols','仅列聚类'],['both','行列都聚类']]),gCheck('heatmapShowDendrogram','显示聚类树')])+gallerySection('热图色阶',[gSelect('heatmapPalette','色阶方案',Object.entries(HEATMAP_PALETTES).map(([k,v])=>[k,v.name])),heatmapPalettePreview(),gHeatColor('heatmapLowColor','负相关 / 低值颜色'),gHeatColor('heatmapMidColor','零值 / 中间颜色'),gHeatColor('heatmapHighColor','正相关 / 高值颜色'),gHeatColor('heatmapDiagonalColor','对角线颜色'),gCheck('heatmapShowValues','显示数值'),gRange('heatmapValueSize','格内数字字号',7,24,1),gRange('heatmapXLabelSize','顶部标签字号',8,28,1),gRange('heatmapYLabelSize','左侧标签字号',8,28,1),gRange('heatmapCellGap','格子间距',0,6,.5),gColor('heatmapGridStroke','格子边线颜色'),gRange('heatmapGridStrokeWidth','格子边线粗细',0,3,.1)])+gallerySection('色带图例',[gCheck('heatmapColorBar','显示色带图例'),gOrientationButtons('heatmapColorBarOrientation','色带方向'),gNumber('legendX','水平位置',0,1800,1),gNumber('legendY','垂直位置',0,1200,1)])+`<div class="method-badge"><b>当前矩阵：</b>${esc(correlationMethodLabel())}</div>`;
  if(id==='method-note')return gallerySection('方法说明',[gCheck('methodNoteVisible','在图中显示方法说明'),gNumber('methodNoteX','水平位置',0,1800,1),gNumber('methodNoteY','垂直位置',0,1200,1),gRange('methodNoteSize','字号',7,20,1),gColor('methodNoteColor','颜色')])+`<div class="method-badge">${esc(galleryMethodNoteText())}</div>`+galleryDragHint('方法说明');
  if(id==='radar-grid')return gallerySection('雷达坐标与网格',[`<div class="field"><button type="button" id="radarTransposeBtn" style="width:100%;padding:8px;border:1px solid #c9d0d4;border-radius:7px;background:#f7f9f8;cursor:pointer;font-size:13px">切换数据方向：组 ↔ 指标</button><div class="small-note" style="color:#8a969c;font-size:11px;margin-top:5px;line-height:1.5">自动识别方向不对时，点一下交换行列。</div></div>`,gCheck('normalize','按指标 0–1 归一化'),gText('radarMin','起始刻度（留空=自动）'),gText('radarMax','结束刻度（留空=自动）'),gRange('radarLevels','分段数',2,8,1),gCheck('radarShowTickLabels','显示同心刻度数值'),gRange('radarTickLabelSize','刻度数字字号',7,24,1),gRange('radarTickDecimals','刻度小数位',0,4,1),gSelect('radarTickLabelPosition','刻度数值位置',[['top','顶部轴旁'],['left','左侧'],['right','右侧']]),gRange('radarTickLabelOffset','刻度数值偏移',0,30,1),gRange('radarLabelSize','轴标签字号',8,28,1),gRange('radarLabelOffset','轴标签与网格距离',8,70,1),gRange('radarGridWidth','同心网格粗细',.4,3,.1),gRange('radarSpokeWidth','放射线粗细',.4,3,.1)])+gallerySection('自动论文背景',[gSelect('radarTheme','渐变色系',Object.entries(RADAR_THEMES).map(([k,v])=>[k,v.name])),gSelect('radarGradientMode','渐变方向',[['radial','中心 → 外圈'],['left-right','左 → 右'],['right-left','右 → 左'],['top-bottom','上 → 下'],['bottom-top','下 → 上'],['diag-down','左上 → 右下'],['diag-up','左下 → 右上']]),gCheck('radarSmartHighlight','显示整张雷达图渐变背景')])+gallerySection('系列呈现',[gCheck('radarShowMarkers','显示形状标记'),gRange('radarPointSize','节点大小',0,10,.5)])+`<div class="method-badge"><b>默认论文模式：</b>数据多边形不填充；所选色系可生成中心向外或单方向完整渐变背景，并自动匹配网格与放射线。</div>`;
  return gallerySeriesPropertyHtml(type,state.gallery.selectedSeries);
}
function gallerySeriesPropertyHtml(type,index=0){
  const names=galleryStudioSeriesNames(),name=names[index]||`Series ${index+1}`,style=getGallerySeriesStyle(index);
  let html=`<div class="series-picker">${names.map((n,i)=>`<button class="${i===index?'active':''}" data-gseries-select="${i}">${esc(n)}</button>`).join('')}</div>`;
  html+=gallerySection(`系列样式 · ${name}`,[gSeriesColor(index,'颜色'),gSeriesRange(index,'opacity','透明度',.1,1,.05)]);
  if(['kde','box','violin','scatter','bubble','radar'].includes(type))html+=gallerySection('线与点',[gSeriesRange(index,'lineWidth','线宽',.5,7,.1),gSeriesRange(index,'pointSize','点大小',1,16,.5),gSeriesSelect(index,'markerShape','标记形状',[['circle','圆形'],['square','方形'],['triangle','上三角'],['triangleDown','下三角'],['diamond','菱形'],['star','五角星'],['pentagon','五边形'],['hexagon','六边形'],['plus','加号'],['cross','叉号']]),gSeriesSelect(index,'markerFill','标记填充',[['series','同系列颜色'],['white','白色空心']])]);
  if(['box','violin','hist','stacked','pie'].includes(type))html+=gallerySection('填充与边框',[gSeriesRange(index,'lineWidth','边框粗细',0,5,.1)]);
  html+=gallerySection('全部系列配色',[galleryPaletteBlock()]);return html;
}
function gallerySection(title,items){return `<div class="object-property-section"><h3>${title}</h3>${items.join('')}</div>`}
function galleryDragHint(name){return `<div class="hint">${name}可在图中直接拖动，也可以输入精确坐标。</div>`}
function getGallerySeriesStyle(index){
  if(!state.gallery.seriesStyles[index]){const radarMarkers=['circle','square','triangle','diamond','pentagon','star','hexagon','triangleDown'];state.gallery.seriesStyles[index]={color:state.gallery.palette[index%state.gallery.palette.length],opacity:state.gallery.settings.opacity,lineWidth:state.gallery.settings.lineWidth,pointSize:state.gallery.settings.pointSize,markerShape:state.gallery.type==='radar'?radarMarkers[index%radarMarkers.length]:'circle',markerFill:state.gallery.type==='radar'?'white':'series'}};
  return state.gallery.seriesStyles[index];
}
function gSeriesWrap(index,key,label,input){const v=getGallerySeriesStyle(index)[key];return `<div class="field"><label><span>${label}</span><output data-gseries-out="${index}:${key}">${esc(v)}</output></label>${input}</div>`}
function gSeriesColor(index,label){return gSeriesWrap(index,'color',label,`<input data-gseries-setting="${index}:color" type="color" value="${getGallerySeriesStyle(index).color}">`)}
function gSeriesRange(index,key,label,min,max,step){return gSeriesWrap(index,key,label,`<input data-gseries-setting="${index}:${key}" type="range" min="${min}" max="${max}" step="${step}" value="${getGallerySeriesStyle(index)[key]}">`)}
function gSeriesSelect(index,key,label,opts){return gSeriesWrap(index,key,label,`<select data-gseries-setting="${index}:${key}">${opts.map(([v,n])=>`<option value="${v}" ${String(getGallerySeriesStyle(index)[key])===String(v)?'selected':''}>${n}</option>`).join('')}</select>`)}
function galleryPaletteBlock(){
  const groups=galleryStudioSeriesNames();if(!groups.length)return'';
  return `<div class="palette-list">${groups.slice(0,12).map((g,i)=>`<label class="palette-item"><input type="color" data-gpalette="${i}" value="${getGallerySeriesStyle(i).color}"><span>${esc(g)}</span></label>`).join('')}</div>`;
}
function galleryStudioSeriesNames(){
  const rows=state.gallery.rows,type=state.gallery.type;
  if(['hist','kde','box','violin','scatter','bubble','radar'].includes(type))return [...new Set(rows.map(r=>r.Group||'Series'))];
  if(['stacked','pie'].includes(type))return [...new Set(rows.map(r=>r.Component||'Component'))];
  if(type==='heatmap')return [];return [];
}
function galleryPropGroup(items){return items.join('')}
function gColor(k,l){return gWrap(l,k,`<input data-gsetting="${k}" type="color" value="${state.gallery.settings[k]}">`)}
function gHeatColor(k,l){const v=state.gallery.settings[k];return `<div class="field heat-color-field"><label><span>${l}</span><output data-gout="${k}">${esc(v)}</output></label><div class="color-pair"><input data-gsetting="${k}" type="color" value="${v}"><input data-gsetting="${k}" data-color-text="${k}" type="text" value="${v}" maxlength="7" spellcheck="false"></div></div>`}
function heatmapPalettePreview(){const s=state.gallery.settings;return `<div class="heatmap-palette-preview"><span style="background:${s.heatmapLowColor}">−1</span><span style="background:${s.heatmapMidColor};color:#333">0</span><span style="background:${s.heatmapHighColor}">+1</span><span style="background:${s.heatmapDiagonalColor}">对角</span></div>`}
function applyHeatmapPalette(name){const preset=HEATMAP_PALETTES[name];if(!preset||name==='custom')return;const s=state.gallery.settings;s.heatmapLowColor=preset.low;s.heatmapMidColor=preset.mid;s.heatmapHighColor=preset.high;s.heatmapDiagonalColor=preset.diagonal}
function applyRadarTheme(name){const preset=RADAR_THEMES[name]||RADAR_THEMES.rose,s=state.gallery.settings;s.radarTheme=name in RADAR_THEMES?name:'rose';s.radarGridColor=preset.grid;s.radarSpokeColor=preset.spoke;s.radarBandMode='theme-gradient'}

function bindGalleryStudioPropertyInputs(){
  const applySetting=el=>{
    const key=el.dataset.gsetting;if(!key)return;
    let v=el.type==='checkbox'?el.checked:el.value;if(['range','number'].includes(el.type))v=Number(v);
    // v0.19.0: KDE 的这几个开关是“是/否”下拉，需要把字符串转成真正的布尔值。
    if(['kdeFillEnabled','kdeShowRug','kdeHistAutoBins'].includes(key))v=(v===true||v==='true'||v==='1');
    if(el.dataset.colorText&& !/^#[0-9a-f]{6}$/i.test(String(v)))return;
    state.gallery.settings[key]=v;
    if(key==='colorScheme'){state.gallery.palette=[...(templates[v]?.colors||templates.foodchem.colors)];state.gallery.seriesStyles={}}
    if(key==='heatmapPalette')applyHeatmapPalette(v);
    if(key==='radarTheme')applyRadarTheme(v);
    if(['heatmapLowColor','heatmapMidColor','heatmapHighColor','heatmapDiagonalColor'].includes(key))state.gallery.settings.heatmapPalette='custom';
    if(key==='panelPreset')applyGalleryCanvasPreset(v);
    if(key==='legendOrientation')state.gallery.settings.legendColumns=v==='vertical'?1:Math.max(2,Math.min(galleryStudioSeriesNames().length||3,3));
    // v0.19.0: 图形专属面板（核密度曲线 / 直方图 / 箱线图…）里的线宽、透明度、
    // 点大小，渲染时读的是“每系列”的值。如果只改全局设置，控件看起来就是没反应，
    // 所以这里一次性同步到全部系列。
    if(['lineWidth','opacity','pointSize'].includes(key)){const n=galleryStudioSeriesNames().length;for(let i=0;i<n;i++){const st=getGallerySeriesStyle(i);st[key]=v}}
    analyzeGalleryData();renderGalleryStudioCanvas();syncGalleryQuickControls();
    $$(`[data-gsetting="${key}"]`).forEach(peer=>{if(peer!==el&&peer.type!=='checkbox')peer.value=state.gallery.settings[key]});
    $$(`[data-gout="${key}"]`).forEach(out=>out.textContent=state.gallery.settings[key]);
    if(['heatmapPalette','statMethod','boxQuartileMethod','boxWhiskerMethod','boxWhiskerPercentile','correlationMethod','kdeDisplayMode','kdeBandwidthMode','kdeFillEnabled','kdeShowRug','kdeHistAutoBins'].includes(key))renderGalleryStudioProperties();
  };
  $$('[data-gsetting]').forEach(el=>{el.addEventListener('input',()=>applySetting(el));el.addEventListener('change',()=>applySetting(el))});
  $('#radarTransposeBtn')?.addEventListener('click',()=>{if(state.gallery.type!=='radar')return;state.gallery.rows=state.gallery.rows.map(r=>({Group:r.Indicator,Indicator:r.Group,Value:r.Value}));renderGalleryStudioCanvas();renderGalleryStudioProperties();syncGalleryQuickControls()});
  $$('[data-gorientation]').forEach(btn=>btn.addEventListener('click',()=>{
    const key=btn.dataset.gorientation,value=btn.dataset.orientationValue;state.gallery.settings[key]=value;if(key==='legendOrientation')state.gallery.settings.legendColumns=value==='vertical'?1:Math.max(2,Math.min(galleryStudioSeriesNames().length||3,3));renderGalleryStudioProperties();renderGalleryStudioCanvas();
  }));
  $$('[data-gseries-setting]').forEach(el=>{
    const applySeriesSetting=()=>{const [idx,key]=el.dataset.gseriesSetting.split(':'),style=getGallerySeriesStyle(Number(idx));let v=el.value;if(el.type==='range')v=Number(v);style[key]=v;if(key==='color')state.gallery.palette[Number(idx)]=v;renderGalleryStudioCanvas();const out=$(`[data-gseries-out="${idx}:${key}"]`);if(out)out.textContent=v;};
    el.addEventListener('input',applySeriesSetting);el.addEventListener('change',applySeriesSetting);
  });
  $$('[data-gpalette]').forEach(el=>el.addEventListener('input',()=>{const i=Number(el.dataset.gpalette);state.gallery.palette[i]=el.value;getGallerySeriesStyle(i).color=el.value;renderGalleryStudioCanvas()}));
  $$('[data-gseries-select]').forEach(el=>el.addEventListener('click',()=>{state.gallery.selected='series';state.gallery.selectedSeries=Number(el.dataset.gseriesSelect);renderGalleryStudioLayers();renderGalleryStudioProperties();highlightGalleryObject()}));
}
function applyGalleryCanvasPreset(value){
  const s=state.gallery.settings,map={normal:[980,660],small:[760,540],square:[700,700],wide:[1080,620],tall:[820,760]};if(!map[value])return;
  const [nw,nh]=map[value],rx=nw/s.width,ry=nh/s.height;s.titleX*=rx;s.titleY*=ry;s.subtitleX*=rx;s.subtitleY*=ry;s.xTitleX*=rx;s.xTitleY*=ry;s.yTitleX*=rx;s.yTitleY*=ry;s.legendX*=rx;s.legendY*=ry;s.legendFrameX*=rx;s.legendFrameY*=ry;s.methodNoteX*=rx;s.methodNoteY*=ry;s.width=nw;s.height=nh;
}

function syncQuickControls(){
  const s=state.chart.settings,ids={quickEnglishFont:s.fontEnglish,quickChineseFont:s.fontChinese,quickFontWeight:String(s.globalFontWeight),quickCanvasPreset:s.panelPreset,quickDpi:String(s.pngDpi),quickCanvasWidth:s.canvasWidth,quickCanvasHeight:s.canvasHeight};
  Object.entries(ids).forEach(([id,v])=>{const el=$('#'+id);if(el&&document.activeElement!==el)el.value=v});
  [['quickTitleVisible','titleVisible'],['quickXTitleVisible','xTitleVisible'],['quickYTitleVisible','yTitleVisible']].forEach(([id,key])=>{const el=$('#'+id);if(el)el.checked=s[key]!==false});
  const badge=$('#canvasStatus');if(badge)badge.textContent=`${s.canvasWidth} × ${s.canvasHeight} px · ${s.pngDpi} dpi`;
}

function renderMappingSelect(){
  const select=$('#xFactorSelect'),d=state.design;
  select.innerHTML=`<option value="A">${esc(d.factorAName||'因素 A')}</option>`+(d.designType==='two'?`<option value="B">${esc(d.factorBName||'因素 B')}</option>`:'');
  if(d.designType==='one')state.chart.xFactor='A';select.value=state.chart.xFactor;
}

function chartGroups(){return getChartModel().groups}
function chartXs(){return getChartModel().xvals}

function chartDimensions(){
  const s=state.chart.settings;
  let W=Number(s.canvasWidth)||980,H=Number(s.canvasHeight)||660;
  if(s.panelPreset==='small'){W=760;H=540}
  else if(s.panelPreset==='square'){W=700;H=700}
  else if(s.panelPreset==='wide'){W=1080;H=620}
  else if(s.panelPreset==='tall'){W=820;H=760}
  return {W,H};
}
function xBaseAt(i,xStep,M){ return M.l+(i+.5)*xStep; }
function seriesOffset(gi,groupCount){
  const span=Number(state.chart.settings.lineOffset)||0;
  if(groupCount<=1||span===0) return 0;
  return ((gi-(groupCount-1)/2)/(groupCount-1||1))*span;
}
function smoothPath(coords){
  if(coords.length<3) return coords.map((p,i)=>(i?'L':'M')+p[0]+','+p[1]).join(' ');
  let d=`M${coords[0][0]},${coords[0][1]}`;
  for(let i=0;i<coords.length-1;i++){
    const p0=coords[i-1]||coords[i], p1=coords[i], p2=coords[i+1], p3=coords[i+2]||p2;
    const cp1x=p1[0]+(p2[0]-p0[0])/6, cp1y=p1[1]+(p2[1]-p0[1])/6;
    const cp2x=p2[0]-(p3[0]-p1[0])/6, cp2y=p2[1]-(p3[1]-p1[1])/6;
    d+=` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}
const TIME_UNIT_SECONDS={s:1,min:60,h:3600};
function timeUnitLabel(unit){return unit==='s'?'s':unit==='min'?'min':unit==='h'?'h':''}
function detectTimeUnitFromText(text){
  const t=String(text||'').trim();
  if(/(?:\(|（|\[)\s*(?:min|mins|minute|minutes|分钟)\s*(?:\)|）|\])/i.test(t)||/\b(?:min|mins|minute|minutes)\b/i.test(t)||/分钟/.test(t))return'min';
  if(/(?:\(|（|\[)\s*(?:h|hr|hrs|hour|hours|小时)\s*(?:\)|）|\])/i.test(t)||/\b(?:h|hr|hrs|hour|hours)\b/i.test(t)||/小时/.test(t))return'h';
  if(/(?:\(|（|\[)\s*(?:s|sec|secs|second|seconds|秒)\s*(?:\)|）|\])/i.test(t)||/\b(?:sec|secs|second|seconds)\b/i.test(t)||/秒/.test(t))return's';
  return null;
}
function xSourceUnit(){
  const s=state.chart.settings;
  if(['s','min','h'].includes(s.xUnitSource))return s.xUnitSource;
  return detectTimeUnitFromText(s.xTitle)||detectTimeUnitFromText(state.design.factorAName);
}
function numericChartXs(){return chartXs().map(Number).filter(Number.isFinite)}
function xTargetUnit(){
  const s=state.chart.settings,source=xSourceUnit();if(!source)return null;
  if(['s','min','h'].includes(s.xUnitTarget))return s.xUnitTarget;
  if(s.xUnitTarget!=='auto')return source;
  const vals=numericChartXs();if(!vals.length)return source;
  const maxSeconds=Math.max(...vals.map(v=>Math.abs(v)))*TIME_UNIT_SECONDS[source];
  if(maxSeconds>=7200)return'h';
  if(maxSeconds>=120)return'min';
  return's';
}
function convertXValue(raw){
  const n=Number(raw),source=xSourceUnit(),target=xTargetUnit();
  if(!Number.isFinite(n)||!source||!target||source===target)return raw;
  return n*TIME_UNIT_SECONDS[source]/TIME_UNIT_SECONDS[target];
}
function formatXTick(raw){const source=xSourceUnit(),target=xTargetUnit();if(!source||!target||source===target)return String(raw);const v=convertXValue(raw);return Number.isFinite(Number(v))?formatNumber(Number(v),2):String(v)}
function niceAxisStep(span,segments=6){const raw=Math.abs(span)/(Math.max(1,segments)||1);if(!Number.isFinite(raw)||raw===0)return 1;const power=Math.pow(10,Math.floor(Math.log10(raw))),n=raw/power;const nice=n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10;return nice*power}
function axisDecimalsForStep(step){if(!Number.isFinite(step)||step===0)return 0;return Math.max(0,Math.min(6,-Math.floor(Math.log10(Math.abs(step)))+(Math.abs(step/Math.pow(10,Math.floor(Math.log10(Math.abs(step))))-2.5)<1e-9?1:0)))}
function formatAxisNumber(v,mode='auto',step=null,round=false){if(!Number.isFinite(Number(v)))return String(v);let d=mode==='auto'?axisDecimalsForStep(step||1):Number(mode);if(round)d=0;return Number(v).toFixed(clamp(d,0,6)).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1')}
function experimentXAxisConfig(xvals,M,plotW){
  const s=state.chart.settings,key=[chartDataVersion,M.l,plotW,s.xScaleMode,s.xAxisMin,s.xAxisMax,s.xAxisSegments,s.xTickRound,s.xUnitSource,s.xUnitTarget,s.xTitle,s.xScale,s.xTickStep].join('|');
  if(xAxisConfigMemo.key===key)return xAxisConfigMemo.value;
  const nums=xvals.map(v=>Number(convertXValue(v))),numeric=isLineLike()&&nums.every(Number.isFinite)&&nums.length>1;
  if(!numeric){xAxisConfigMemo={key,value:null};return null}
  let dataMin=Infinity,dataMax=-Infinity;for(const n of nums){if(n<dataMin)dataMin=n;if(n>dataMax)dataMax=n}
  let segments=clamp(Math.round(Number(s.xAxisSegments)||10),1,40),min=s.xScaleMode==='manual'&&Number.isFinite(Number(s.xAxisMin))?Number(s.xAxisMin):dataMin,max=s.xScaleMode==='manual'&&Number.isFinite(Number(s.xAxisMax))?Number(s.xAxisMax):dataMax;
  // v0.17.0: log10 X axis for line/curve (time courses that span decades).
  if(s.xScale==='log'&&!state.chart.breakAxis&&!axisLogUnusableValues(nums).length){
    const ext=axisLogExtent(nums,s.xScaleMode==='manual'?s.xAxisMin:null,s.xScaleMode==='manual'?s.xAxisMax:null);
    if(ext){
      const lo=Math.log10(ext.min),hi=Math.log10(ext.max),span=(hi-lo)||1;
      const pos=v=>M.l+(Math.log10(Math.max(Number(v),ext.min*1e-6))-lo)/span*plotW;
      let ticks=logTicksWithin(ext.min,ext.max);
      const tickStep=axisStepFromSetting(s.xTickStep);
      if(tickStep&&isPowerOfTen(tickStep)){const k=Math.max(1,Math.round(Math.log10(tickStep)));ticks=ticks.filter((_,i)=>i%k===0)}
      const value={min:ext.min,max:ext.max,segments,step:null,pos,ticks,nums,log:true};
      xAxisConfigMemo={key,value};return value;
    }
  }
  if(max<=min)max=min+1;let step=(max-min)/segments;
  if(s.xTickRound){step=niceAxisStep(max-min,segments);if(s.xScaleMode!=='manual'){min=Math.floor(min/step)*step;max=Math.ceil(max/step)*step;segments=Math.max(1,Math.round((max-min)/step))}else step=(max-min)/segments}
  const pos=v=>M.l+(Number(v)-min)/(max-min||1)*plotW,ticks=Array.from({length:segments+1},(_,i)=>min+(max-min)*i/segments),value={min,max,segments,step,pos,ticks,nums};
  xAxisConfigMemo={key,value};return value;
}
function experimentXPosition(raw,index,xvals,M,plotW){const cfg=experimentXAxisConfig(xvals,M,plotW);return cfg?cfg.pos(Number(convertXValue(raw))):xBaseAt(index,plotW/xvals.length,M)}
function experimentXAxisTickObjects(xvals,M,plotW){const cfg=experimentXAxisConfig(xvals,M,plotW),s=state.chart.settings;if(cfg){const logX=!!cfg.log;return cfg.ticks.map((v,i)=>({x:cfg.pos(v),label:logX?formatLogTick(v):formatAxisNumber(v,s.xTickDecimals,cfg.step,s.xTickRound),i}))}const xStep=plotW/xvals.length;return visibleXTickIndices(xvals).map((idx,j)=>({x:M.l+(idx+.5)*xStep,label:formatXTick(xvals[idx]),i:j,index:idx}))}
function convertedXTitle(){
  const s=state.chart.settings,source=xSourceUnit(),target=xTargetUnit(),title=String(s.xTitle||'');
  if(!source||!target||source===target)return title;
  const label=timeUnitLabel(target);
  const parenthetical={s:/(\(|（|\[)\s*(?:s|sec|secs|second|seconds|秒)\s*(\)|）|\])/i,min:/(\(|（|\[)\s*(?:min|mins|minute|minutes|分钟)\s*(\)|）|\])/i,h:/(\(|（|\[)\s*(?:h|hr|hrs|hour|hours|小时)\s*(\)|）|\])/i}[source];
  if(parenthetical.test(title))return title.replace(parenthetical,(_,a,b)=>`${a}${label}${b}`);
  const plain={s:/\b(?:sec|secs|second|seconds)\b|秒/i,min:/\b(?:min|mins|minute|minutes)\b|分钟/i,h:/\b(?:h|hr|hrs|hour|hours)\b|小时/i}[source];
  return plain.test(title)?title.replace(plain,label):`${title} (${label})`;
}
function xUnitStatusText(){const source=xSourceUnit(),target=xTargetUnit();if(!source)return'未识别到时间单位；可手动指定原单位。';return source===target?`当前保持 ${timeUnitLabel(source)}。`:`当前显示换算：${timeUnitLabel(source)} → ${timeUnitLabel(target)}（仅改变坐标显示，不改原始数据）。`}
function automaticXTickRotation(labels){
  const s=state.chart.settings;if(!s.xTickAutoRotate)return Number(s.xTickRotation)||0;
  const {W}=chartDimensions(),plotW=W-106-80,count=Math.max(1,labels.length),spacing=plotW/Math.max(1,count-1),font=Number(s.xTickSize)||12;
  const maxWidth=Math.max(...labels.map(t=>String(t).length*font*.58),0);
  if(count>=9&&(maxWidth>spacing*.5||Math.max(...labels.map(t=>String(t).length),0)>=6))return maxWidth>spacing*1.05?-60:-45;
  if(maxWidth>spacing*.9)return-45;
  return 0;
}
function xTickLayout(text,i){
  const s=state.chart.settings,labels=visibleXTickIndices(chartXs()).map(idx=>formatXTick(chartXs()[idx]));
  const rotate=automaticXTickRotation(labels);
  const autoStagger=!s.xTickAutoRotate&&(s.xTickStagger||String(text).length>8||chartXs().length>8);
  const dy=autoStagger&&rotate===0?((i%2)*14):0;
  const anchor=rotate<0?'end':rotate>0?'start':'middle';
  return {rotate,dy,anchor};
}
function visibleXTickIndices(xvals,maxTicks=12){
  const n=xvals.length;if(n<=maxTicks)return xvals.map((_,i)=>i);
  const step=Math.max(1,Math.ceil((n-1)/(maxTicks-1))),indices=[];
  for(let i=0;i<n;i+=step)indices.push(i);if(indices.at(-1)!==n-1)indices.push(n-1);return indices;
}

function fontStack(){
  const s=state.chart.settings;
  const en=String(s.fontEnglish||'Arial').replace(/'/g,"\'");
  const zh=String(s.fontChinese||'Microsoft YaHei').replace(/'/g,"\'");
  return `'${en}','${zh}',sans-serif`;
}
function ensurePalette(count){
  while(state.chart.palette.length<count){
    const i=state.chart.palette.length;
    const hue=(i*137.508+28)%360;
    state.chart.palette.push(hslToHex(hue,52,48));
  }
}
function hslToHex(h,s,l){
  s/=100;l/=100;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;let r=0,g=0,b=0;
  if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}
  return '#'+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
}
function setCanvasSize(newW,newH){
  const s=state.chart.settings,oldW=Number(s.canvasWidth)||980,oldH=Number(s.canvasHeight)||660;
  newW=clamp(Number(newW)||oldW,500,1800);newH=clamp(Number(newH)||oldH,400,1200);
  const rx=newW/oldW,ry=newH/oldH;
  ['titleX','subtitleX','xTitleX','yTitleX'].forEach(k=>s[k]*=rx);['titleY','subtitleY','xTitleY','yTitleY'].forEach(k=>s[k]*=ry);
  state.chart.legend.x*=rx;state.chart.legend.y*=ry;state.chart.legendFrame.x*=rx;state.chart.legendFrame.y*=ry;
  if(!state.chart.legendFrame.autoSize){state.chart.legendFrame.width*=rx;state.chart.legendFrame.height*=ry}
  s.canvasWidth=Math.round(newW);s.canvasHeight=Math.round(newH);
}
function applyCanvasPreset(value){
  const map={normal:[980,660],small:[760,540],square:[700,700],wide:[1080,620],tall:[820,760]};
  if(map[value])setCanvasSize(map[value][0],map[value][1]);
}

function renderLayers(){
  const isWf=state.chart.type==='waterfall';const gs=chartGroups();const layers=[['section','基础对象'],['title','图题','base'],['subtitle','副标题','base'],['typography','中英文字体','base'],['canvas','画布与清晰度','base'],['legend','图例内容','base'],['legend-frame','图例边框','base'],['axis-y','Y 轴与纵标题','base'],['axis-x','X 轴与横标题','base'],['frame','图片边框','base'],['background','背景','base'],['palette','配色参数','base'],['style','图片参数','base'],['methodnote','方法说明','base'],['section','数据对象']];
  gs.forEach((g,i)=>layers.push([`series:${i}`,`数据系列 · ${g}`,'series']));
  if(state.chart.type!=='curve'&&!isWf){layers.push(['error','误差棒','special']);if(!state.analysis?.continuous)layers.push(['letters','显著性字母','special'])}
  if(state.chart.annotations.length){layers.push(['section','标注对象']);state.chart.annotations.forEach((a,i)=>layers.push([`annotation:${a.id}`,`${annotationTypeLabel(a.type)} ${i+1}`,'special']))}
  if(isWf)layers.push(['section','图形专属'],['waterfall3d','3D 瀑布图','special']);
  $('#layersList').innerHTML=layers.map(item=>{if(item[0]==='section')return`<div class="layer-section-label">${item[1]}</div>`;const[id,name,kind]=item;return`<button class="layer-item ${selectedMatches(id)?'active':''}" data-layer="${esc(id)}"><span class="layer-dot"></span>${esc(name)}<span class="layer-tag ${kind==='special'?'special':''}">${kind==='special'?'专属':'基础'}</span></button>`}).join('');
  $$('[data-layer]').forEach(b=>b.addEventListener('click',()=>selectObject(b.dataset.layer)));
}
function selectedMatches(id){if(id.startsWith('series:'))return state.chart.selected==='series'&&Number(id.split(':')[1])===state.chart.selectedSeries;if(id.startsWith('annotation:'))return state.chart.selected===id;return state.chart.selected===id}
function annotationTypeLabel(type){return type==='text'?'文字框':type==='arrow'?'箭头':type==='guide'?'辅助线':type==='peak'?'峰值':'标注'}
function selectObject(id,seriesIndex=null){
  if(id.startsWith('series:')){state.chart.selected='series';state.chart.selectedSeries=Number(id.split(':')[1])}
  else if(id.startsWith('annotation:')){state.chart.selected=id;state.chart.selectedAnnotation=id.split(':')[1]}
  else{state.chart.selected=id;if(seriesIndex!=null)state.chart.selectedSeries=Number(seriesIndex)}
  renderLayers();renderProperties();
  $$('#chartStage .chart-object').forEach(el=>el.classList.toggle('object-selected',el.dataset.object===state.chart.selected&&(state.chart.selected!=='series'||Number(el.dataset.series)===state.chart.selectedSeries)));
}

const SERIES_MARKERS=['circle','square','triangle','triangleDown','diamond','star','pentagon','hexagon','plus','cross'];
function seriesStyleKey(index){
  const groups=chartGroups();
  return String(groups[index]??`Series ${index+1}`);
}
function defaultSeriesStyle(index){
  const s=state.chart.settings;
  return {lineWidth:s.lineWidth,markerSize:s.markerSize,markerShape:SERIES_MARKERS[index%SERIES_MARKERS.length],markerFill:s.markerFill,barLine:true};
}
function getSeriesStyle(index){
  if(!state.chart.seriesStyles||typeof state.chart.seriesStyles!=='object')state.chart.seriesStyles={};
  const key=seriesStyleKey(index);
  if(!state.chart.seriesStyles[key])state.chart.seriesStyles[key]=defaultSeriesStyle(index);
  return state.chart.seriesStyles[key];
}
function getSeriesSetting(index,key){return getSeriesStyle(index)[key]}
function setSeriesSetting(index,key,value){getSeriesStyle(index)[key]=value}
function ensureSeriesStyles(){const groups=chartGroups();ensurePalette(groups.length);groups.forEach((_,i)=>getSeriesStyle(i))}

function chartBounds(){
  const s=state.chart.settings,vals=(state.chart.type==='curve'?state.chartData.map(d=>d.mean):state.chartData.flatMap(d=>[d.mean-d.error,d.mean+d.error])).filter(Number.isFinite);let min=Math.min(...vals),max=Math.max(...vals);if(!Number.isFinite(min)){min=0;max=1}
  // v0.17.0: log10 Y axis. The extent is snapped to whole decades so the ticks
  // land on 1 / 10 / 100 ..., and it is only used when every value is positive.
  if(s.yScale==='log'&&!state.chart.breakAxis&&!axisLogUnusableValues(vals).length){
    const ext=axisLogExtent(vals,s.yMin,s.yMax);
    if(ext)return{min:ext.min,max:ext.max,log:true};
  }
  const pad=(max-min||1)*.12;min=s.yMin??(min-pad);max=s.yMax??(max+pad);if(max<=min)max=min+1;
  // v0.23.0: grouped bar columns must sit on the x axis. The automatic 12%
  // headroom often pushes min below zero for all-positive data, which left the
  // column bottoms floating above the axis (base = y(max(0,min))). Snap min
  // back to 0 for bar charts when the raw data never goes negative and the
  // user has not set a manual minimum.
  if(state.chart.type==='bar'&&s.yMin==null&&Math.min(...vals)>=0&&min<0)min=0;
  if(state.chart.type==='waterfall'&&s.yMin==null&&Math.min(...vals)>=0&&min<0)min=0;
  if(s.yTickRound&&s.yMin==null&&s.yMax==null){const step=niceAxisStep(max-min,s.yAxisSegments||6);min=Math.floor(min/step)*step;max=Math.ceil(max/step)*step}
  return{min,max};
}
function chartYTicks(b){
  const s=state.chart.settings;
  // v0.17.0: on a log axis the ticks are decades (1, 10, 100 ...). The 刻度间隔
  // field is read as "one tick every N decades" so it still means something.
  if(s.yScale==='log'&&!state.chart.breakAxis){
    const ticks=logTicksWithin(b.min,b.max),step=axisStepFromSetting(s.yTickStep);
    if(step&&isPowerOfTen(step)){const k=Math.max(1,Math.round(Math.log10(step)));return ticks.filter((_,i)=>i%k===0)}
    return ticks;
  }
  if(Number.isFinite(s.yTickStep)&&s.yTickStep>0)return makeTicks(b.min,b.max,s.yTickStep,6);
  const n=clamp(Math.round(Number(s.yAxisSegments)||6),1,30);return Array.from({length:n+1},(_,i)=>b.min+(b.max-b.min)*i/n)
}

function renderChart(){
  const {W,H}=chartDimensions(),M={l:106,r:80,t:82,b:105},plotW=W-M.l-M.r,plotH=H-M.t-M.b,s=state.chart.settings,colors=state.chart.palette;
  let svg=`<svg id="paperSvg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="FoodLab figure" style="font-family:${esc(fontStack())};font-weight:${s.globalFontWeight||400};background:${s.background}"><defs><filter id="legendShadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="${s.legendShadowX||0}" dy="${s.legendShadowY||0}" stdDeviation="${s.legendShadowBlur||0}" flood-color="#263238" flood-opacity="${s.legendShadowOpacity??.28}"/></filter><marker id="chartAnnotationArrow" markerWidth="9" markerHeight="9" refX="7.2" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,7 L8,3.5 z" fill="context-stroke"/></marker></defs><rect data-object="background" class="chart-object" width="${W}" height="${H}" fill="${s.background}"/>`;
  if(s.titleVisible&&s.title)svg+=`<text data-object="title" data-drag="title" class="chart-object draggable" x="${s.titleX}" y="${s.titleY}" text-anchor="middle" font-size="${s.titleSize}" font-weight="${s.titleWeight}" fill="${s.titleColor}">${esc(s.title)}</text>`;if(s.subtitleEnabled&&s.subtitle)svg+=`<text data-object="subtitle" data-drag="subtitle" class="chart-object draggable" x="${s.subtitleX}" y="${s.subtitleY}" text-anchor="middle" font-size="${s.subtitleSize}" font-weight="${s.subtitleWeight}" fill="${s.subtitleColor}">${esc(s.subtitle)}</text>`;
  if(!state.chartData.length){svg+=`<text x="${W/2}" y="${H/2}" text-anchor="middle" fill="#87939c">请先导入原始数据并完成统计分析</text></svg>`;$('#chartStage').innerHTML=svg;return}
  const xvals=chartXs(),gs=chartGroups(),bounds=chartBounds();ensureSeriesStyles();
  const isWf=state.chart.type==='waterfall';
  if(isWf){const WfM=wfLayout(gs.length,W,H);const WfPW=W-WfM.l-WfM.r,WfPH=H-WfM.t-WfM.b;svg+=renderWaterfall(W,H,WfM,WfPW,WfPH,xvals,gs,colors,bounds);}
  else{svg+=state.chart.breakAxis?renderBrokenPlot(W,H,M,plotW,plotH,xvals,gs,colors):renderNormalPlot(W,H,M,plotW,plotH,xvals,gs,colors,bounds);svg+=renderExperimentAnnotations(M,plotW,plotH,xvals,bounds);svg+=renderLegendFrame(gs,colors);svg+=renderLegend(gs,colors);}
  svg+='</svg>';$('#chartStage').innerHTML=svg;bindChartObjects();bindDraggables();
}

function isLineChart(){return state.chart.type==='line'}
function isCurveChart(){return state.chart.type==='curve'}
function isLineLike(){return isLineChart()||isCurveChart()}
function seriesMarkersVisible(){return isLineLike()&&chartXs().length<=120}
function seriesPath(coords){
  return isCurveChart()||state.chart.settings.lineMode==='smooth'
    ? smoothPath(coords)
    : coords.map((p,i)=>(i?'L':'M')+p[0]+','+p[1]).join(' ');
}
function renderXAxisTopOverlay(M,plotW,axisY,xvals,xStep){
  const s=state.chart.settings;
  const under=Number(s.axisWidth);
  let out=`<g data-object="axis-x" class="chart-object axis-top-overlay" fill="none" stroke-linecap="butt" pointer-events="all"><path d="M${M.l},${axisY} H${M.l+plotW}" stroke="${s.background}" stroke-width="${under}"/><path d="M${M.l},${axisY} H${M.l+plotW}" stroke="${s.axisColor}" stroke-width="${s.axisWidth}"/>`;
  if(s.showXTicks)experimentXAxisTickObjects(xvals,M,plotW).forEach(t=>{out+=`<line x1="${t.x}" x2="${t.x}" y1="${axisY}" y2="${axisY+s.tickLength}" stroke="${s.axisColor}" stroke-width="${s.axisWidth}"/>`});
  return out+'</g>';
}

function isLogAxisY(){const s=state.chart.settings;return s.yScale==='log'&&!state.chart.breakAxis}
function isLogAxisX(){const s=state.chart.settings;return s.xScale==='log'&&!state.chart.breakAxis}
// v0.17.0: one place that turns a value into a pixel row, so every caller of
// the Y axis (bars, error bars, letters, peak labels, annotations) follows the
// log scale automatically instead of each one needing its own tweak.
function yValueMap(b,plotH,top){
  if(b&&b.log){
    const lo=Math.log10(b.min),hi=Math.log10(b.max),span=(hi-lo)||1;
    return v=>top+(hi-Math.log10(Math.max(Number(v),b.min*1e-6)))/span*plotH;
  }
  return v=>top+(b.max-Number(v))/((b.max-b.min)||1)*plotH;
}
/* ===== v0.89.0 光谱瀑布图（真 3D 坐标盒，Matlab/Origin 风格）=====
 * 三维 (x=波长, y=强度, z=层/时间) 斜投影：
 *   P(nx,ny,k) = 前层矩形 + k*(dx,-dy)
 * 绘制 后墙(淡黄) → 左墙(淡青) → 底面(网格) → 各层片(后→前,实色遮挡) → 三条前棱与刻度。
 */
/* ===== 3D 光谱瀑布图（真 3D 坐标盒，Matlab/Origin 风格）=====
 * X = 前底边（波长/波数/时间）；Y = 前竖边（强度）；Z = 纵深斜边（层）。
 * wfViewDir：right 层向右后（默认）；left 层向左后。
 */
function wfLayout(n,W,H){
  const s=state.chart.settings,K=Math.max(0,n-1);
  let dx=clamp(Number(s.wfLayerDx)||0,0,200),dy=clamp(Number(s.wfLayerDy)||0,0,200);
  const l0=98,r0=108,t0=62,b0=94;
  dx=Math.min(dx,Math.max(0,(W-l0-r0-200))/Math.max(1,K));
  dy=Math.min(dy,Math.max(0,(H-t0-b0-170))/Math.max(1,K));
  const left=s.wfViewDir==='left'?l0+K*dx:l0;
  const right=s.wfViewDir==='left'?r0:r0+K*dx;
  return {l:left,t:t0+K*dy,b:b0,r:right,dx,dy};
}
function wfXScale(xvals){
  const s=state.chart.settings;
  const nums=xvals.map(Number),numeric=nums.length>1&&nums.every(Number.isFinite);
  if(numeric){
    const dLo=Math.min(...nums),dHi=Math.max(...nums);
    let lo=s.xScaleMode==='manual'&&Number.isFinite(+s.xAxisMin)?+s.xAxisMin:dLo;
    let hi=s.xScaleMode==='manual'&&Number.isFinite(+s.xAxisMax)?+s.xAxisMax:dHi;
    if(hi<=lo)hi=lo+1;
    const norm=v=>(Number(v)-lo)/((hi-lo)||1);
    const seg=clamp(Math.round(+s.xAxisSegments)||8,2,20),step=niceAxisStep(hi-lo,seg);
    const ticks=[];
    const start=Math.abs(lo)<step*1e-9?0:Math.ceil(lo/step)*step;
    for(let v=start;v<=hi+step*.5;v+=step)ticks.push({n:clamp(norm(v),0,1),label:formatAxisNumber(v,s.xTickDecimals,step,s.xTickRound)});
    return {norm,ticks};
  }
  const idx={};xvals.forEach((v,i)=>idx[String(v)]=i);
  return {norm:v=>((idx[String(v)]??0)+.5)/xvals.length,ticks:xvals.map((v,i)=>({n:(i+.5)/xvals.length,label:formatXTick(v)}))};
}
function wfLine(a,b,c,w,extra=''){return `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${c}" stroke-width="${w}"${extra?' '+extra:''}/>`;}
function wfPoly(pts,attrs){return `<polygon points="${pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" ${attrs}/>`;}
function renderWaterfall(W,H,M,plotW,plotH,xvals,gs,colors,b){
  const s=state.chart.settings;
  const allPos=state.chartData.every(d=>d.mean>=0);
  let bmin=(s.yMin!=null&&Number.isFinite(+s.yMin))?+s.yMin:(allPos?0:b.min);
  let bmax=(s.yMax!=null&&Number.isFinite(+s.yMax))?+s.yMax:b.max;
  if(!(s.yMax!=null&&Number.isFinite(+s.yMax))){const st=niceAxisStep(bmax-bmin,6);bmax=Math.ceil(bmax/st)*st;}
  if(bmax<=bmin)bmax=bmin+1;
  const yStepN=niceAxisStep(bmax-bmin,6),yTicksNice=[];
  for(let v=bmin;v<=bmax+yStepN*.5;v+=yStepN)yTicksNice.push(v);
  const model=getChartModel(),xs=wfXScale(xvals),K=gs.length-1;
  const axisY=M.t+plotH,dx=M.dx,dy=M.dy;
  const dir=s.wfViewDir==='left'?-1:1;
  const sideNx=dir>0?0:1,zEdgeNx=dir>0?1:0;
  const yN=v=>(Number(v)-bmin)/((bmax-bmin)||1);
  const P=(nx,ny,k)=>[M.l+nx*plotW+dir*k*dx,axisY-ny*plotH-k*dy];
  const gc=s.wfGridColor,gw=s.wfGridWidth,wc=s.wfWallColor;
  let out='';
  // 1) 后墙 k=K
  out+=wfPoly([P(0,0,K),P(1,0,K),P(1,1,K),P(0,1,K)],`fill="${wc}" stroke="none"`);
  xs.ticks.forEach(t=>out+=wfLine(P(t.n,0,K),P(t.n,1,K),gc,gw));
  yTicksNice.forEach(v=>{const ny=yN(v);if(ny>=0&&ny<=1)out+=wfLine(P(0,ny,K),P(1,ny,K),gc,gw);});
  // 2) 侧墙 sideNx
  out+=wfPoly([P(sideNx,0,0),P(sideNx,0,K),P(sideNx,1,K),P(sideNx,1,0)],`fill="${wc}" stroke="none"`);
  yTicksNice.forEach(v=>{const ny=yN(v);if(ny>=0&&ny<=1)out+=wfLine(P(sideNx,ny,0),P(sideNx,ny,K),gc,gw);});
  for(let k=0;k<=K;k++)out+=wfLine(P(sideNx,0,k),P(sideNx,1,k),gc,gw);
  // 3) 底面 ny=0
  out+=wfPoly([P(0,0,0),P(1,0,0),P(1,0,K),P(0,0,K)],`fill="${wc}" stroke="none"`);
  xs.ticks.forEach(t=>out+=wfLine(P(t.n,0,0),P(t.n,0,K),gc,gw));
  for(let k=0;k<=K;k++)out+=wfLine(P(0,0,k),P(1,0,k),gc,gw);
  // 4) 层片（后→前）
  for(let k=K;k>=0;k--){
    const g=gs[k],pts=model.byGroup.get(String(g))||[],c=colors[k%colors.length];
    const coords=pts.map(d=>{const nx=xs.norm(d.x),ny=yN(d.mean);return P(nx,ny,k);}).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
    if(coords.length<2)continue;
    const x1=coords[coords.length-1][0],bl=P(0,0,k),br=P(1,0,k);
    if(s.wfFill)out+=wfPoly([bl,...coords,br],`fill="${c}" fill-opacity="${s.wfFillOpacity}" stroke="none"`);
    const lw=getSeriesStyle(k).lineWidth||1.4;
    out+=`<path data-object="series" data-series="${k}" class="chart-object" d="${coords.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" fill="none" stroke="${darken(c,.18)}" stroke-width="${lw}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if(s.wfLineEndLabels)out+=`<text data-object="z-label" x="${(x1+6).toFixed(1)}" y="${(coords[coords.length-1][1]+4).toFixed(1)}" font-size="${s.wfZLabelSize}" fill="${darken(c,.2)}">${esc(g)}</text>`;
  }
  // 5) 棱线：前轴粗，后轮廓细
  const ac=s.axisColor,aw=s.axisWidth;
  out+=`<g data-object="axis-box" class="chart-object" stroke="${ac}" stroke-width="${aw}" fill="none" stroke-linecap="square">`
    +`<path d="M${P(0,0,0)[0].toFixed(1)},${P(0,0,0)[1].toFixed(1)} L${P(1,0,0)[0].toFixed(1)},${P(1,0,0)[1].toFixed(1)}"/>`
    +`<path d="M${P(zEdgeNx,0,0)[0].toFixed(1)},${P(zEdgeNx,0,0)[1].toFixed(1)} L${P(zEdgeNx,0,K)[0].toFixed(1)},${P(zEdgeNx,0,K)[1].toFixed(1)}"/>`
    +`<path d="M${P(sideNx,0,0)[0].toFixed(1)},${P(sideNx,0,0)[1].toFixed(1)} L${P(sideNx,1,0)[0].toFixed(1)},${P(sideNx,1,0)[1].toFixed(1)}"/>`
    +`</g>`;
  out+=`<g stroke="#c9c9c9" stroke-width=".6" fill="none">`
    +`<path d="M${P(zEdgeNx,0,K)[0].toFixed(1)},${P(zEdgeNx,0,K)[1].toFixed(1)} L${P(zEdgeNx,1,K)[0].toFixed(1)},${P(zEdgeNx,1,K)[1].toFixed(1)} L${P(sideNx,1,K)[0].toFixed(1)},${P(sideNx,1,K)[1].toFixed(1)} L${P(sideNx,1,0)[0].toFixed(1)},${P(sideNx,1,0)[1].toFixed(1)}"/>`
    +`</g>`;
  // 6) X 刻度（前底边）
  const rot=automaticXTickRotation(xs.ticks.map(t=>t.label));
  out+=`<g data-object="axis-x" class="chart-object" stroke="${ac}" stroke-width="${aw}" fill="none">`;
  if(s.showXTicks)xs.ticks.forEach(t=>{const p=P(t.n,0,0);out+=wfLine(p,[p[0],p[1]+s.tickLength],ac,aw);});
  out+='</g>';
  xs.ticks.forEach(t=>{const p=P(t.n,0,0);const yy=p[1]+s.tickLength+18;out+=`<text data-object="axis-x" class="chart-object" x="${p[0].toFixed(1)}" y="${yy}" text-anchor="${rot<0?'end':'middle'}" font-size="${s.xTickSize}" fill="${s.xTickColor}" transform="rotate(${rot} ${p[0].toFixed(1)} ${yy})">${esc(t.label)}</text>`;});
  // 7) Y 刻度（前竖边 sideNx）
  const yStep=yTicksNice.length>1?(yTicksNice[1]-yTicksNice[0]):1;
  out+=`<g data-object="axis-y" class="chart-object" stroke="${ac}" stroke-width="${aw}" fill="none">`;
  if(s.showYTicks)yTicksNice.forEach(v=>{const ny=yN(v);if(ny<0||ny>1)return;const p=P(sideNx,ny,0);const tx=dir>0?p[0]-s.tickLength:p[0]+s.tickLength;out+=wfLine(p,[tx,p[1]],ac,aw);});
  out+='</g>';
  yTicksNice.forEach(v=>{const ny=yN(v);if(ny<0||ny>1)return;const p=P(sideNx,ny,0);
    const tx=dir>0?p[0]-s.tickLength-6:p[0]+s.tickLength+6,anchor=dir>0?'end':'start';
    out+=`<text data-object="axis-y" class="chart-object" x="${tx.toFixed(1)}" y="${(p[1]+4).toFixed(1)}" text-anchor="${anchor}" font-size="${s.yTickSize}" fill="${s.yTickColor}">${formatAxisNumber(v,s.yTickDecimals,yStep,false)}</text>`;});
  // 8) Z 标签（zEdgeNx 斜边）
  if(K>=1&&s.wfZLabels){
    for(let k=0;k<=K;k++){const p=P(zEdgeNx,0,k);
      const ox=dir>0?(11+((k%2)*18)):-(11+((k%2)*18));
      const anchor=dir>0?'start':'end',lx=p[0]+ox,ly=p[1]+4,tickX=dir>0?p[0]+7:p[0]-7;
      out+=wfLine(p,[tickX,p[1]],ac,aw);
      out+=`<text data-object="axis-z" class="chart-object" x="${lx.toFixed(1)}" y="${ly}" text-anchor="${anchor}" font-size="${s.wfZLabelSize}" fill="${ac}">${esc(gs[k])}</text>`;}
    if(s.wfZAxisTitle){
      const mid=P(zEdgeNx,0,K/2),ang=Math.atan2(-dy,dir*dx)*180/Math.PI,L=Math.hypot(dx,dy)||1,nxO=dir*dy/L,nyO=dx/L;
      const tx=mid[0]+nxO*30,ty=mid[1]+nyO*30-6;
      out+=`<text data-object="axis-z" class="chart-object" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="${s.zTitleSize||s.yTickSize}" font-style="italic" fill="${ac}" transform="rotate(${ang.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})">${esc(s.wfZAxisTitle)}</text>`;
    }
  }
  // 9) 轴标题
  if(s.xTitleVisible&&s.xTitle){const dp=P(.5,0,0);const xt=s.wfXTitleX!=null?s.wfXTitleX:dp[0],yt=s.wfXTitleY!=null?s.wfXTitleY:dp[1]+64;out+=`<text data-object="axis-x" data-drag="xTitle" class="chart-object draggable" x="${xt.toFixed(1)}" y="${yt.toFixed(1)}" text-anchor="middle" font-size="${s.xTitleSize}" font-weight="${s.xTitleWeight||s.globalFontWeight||400}" fill="${s.xTitleColor}">${esc(convertedXTitle())}</text>`;}
  if(s.yTitleVisible&&s.yTitle){const dp=P(sideNx,.5,0);const rotY=dir>0?-90:90;const ytx=s.wfYTitleX!=null?s.wfYTitleX:dp[0],yty=s.wfYTitleY!=null?s.wfYTitleY:dp[1];
    out+=`<text data-object="axis-y" data-drag="yTitle" class="chart-object draggable" transform="translate(${ytx.toFixed(1)} ${yty.toFixed(1)}) rotate(${rotY})" text-anchor="middle" font-size="${s.yTitleSize}" font-weight="${s.yTitleWeight||s.globalFontWeight||400}" fill="${s.yTitleColor}">${esc(s.yTitle)}</text>`;}
  // 10) 图例
  if(s.wfLegend&&K>=1){
    const lx0=P(zEdgeNx,1,K)[0]+(dir>0?14:-14),ly0=P(zEdgeNx,1,K)[1]+8;
    const anchor=dir>0?'start':'end';
    out+=`<g data-object="legend" class="chart-object" font-size="${s.wfLegendSize||11}">`;
    for(let k=0;k<=K;k++){const cc=colors[k%colors.length],yy=ly0+k*17;
      if(s.wfLegendStyle==='line'){
        const xa=dir>0?lx0:lx0-22,xb=dir>0?lx0+22:lx0;
        out+=`<line x1="${xa.toFixed(1)}" y1="${(yy+5).toFixed(1)}" x2="${xb.toFixed(1)}" y2="${(yy+5).toFixed(1)}" stroke="${cc}" stroke-width="2.4"/>`;
        out+=`<text x="${(dir>0?lx0+28:lx0-28).toFixed(1)}" y="${(yy+9).toFixed(1)}" text-anchor="${anchor}" fill="#333">${esc(gs[k])}</text>`;
      }else{
        out+=`<rect x="${(dir>0?lx0:lx0-11).toFixed(1)}" y="${yy.toFixed(1)}" width="11" height="11" fill="${cc}" stroke="${darken(cc,.2)}" stroke-width=".6"/>`;
        out+=`<text x="${(dir>0?lx0+15:lx0-15).toFixed(1)}" y="${(yy+10).toFixed(1)}" text-anchor="${anchor}" fill="#333">${esc(gs[k])}</text>`;
      }}
    out+=`</g>`;
  }
  return out;
}
function renderNormalPlot(W,H,M,plotW,plotH,xvals,gs,colors,b){
  const s=state.chart.settings,model=getChartModel(),xCfg=experimentXAxisConfig(xvals,M,plotW),y=yValueMap(b,plotH,M.t),xStep=plotW/xvals.length,axisY=M.t+plotH;let out='';
  if(s.plotBgVisible)out+='<rect x="'+M.l+'" y="'+M.t+'" width="'+plotW+'" height="'+plotH+'" fill="'+(s.plotBg||'#f5f7f8')+'"/>';
  const yTicks=chartYTicks(b),axes=renderNormalAxes(W,H,M,plotW,plotH,xvals,xStep,yTicks,y,axisY);
  if(isLineLike()){
    gs.forEach((g,gi)=>{
      const pts=model.byGroup.get(String(g))||[],c=colors[gi%colors.length],positions=pts.map(d=>{const idx=model.xIndex.get(String(d.x))??0;return{d,xx:xCfg?xCfg.pos(Number(convertXValue(d.x))):xBaseAt(idx,xStep,M),yy:y(d.mean)}}),coords=positions.map(p=>[p.xx,p.yy]);
      if(coords.length>1)out+=`<path data-object="series" data-series="${gi}" class="chart-object" d="${seriesPath(coords)}" fill="none" stroke="${c}" stroke-width="${getSeriesStyle(gi).lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
      if(isLineChart()&&positions.length){let errorPath='';positions.forEach(p=>{const e=Math.abs(y(p.d.mean+p.d.error)-p.yy),cap=s.errorCap/2;errorPath+=`M${p.xx},${p.yy-e}V${p.yy+e}M${p.xx-cap},${p.yy-e}H${p.xx+cap}M${p.xx-cap},${p.yy+e}H${p.xx+cap}`});const errorColor=s.errorColorMode==='black'?s.axisColor:c;out+=`<path data-object="error" data-series="${gi}" class="chart-object" d="${errorPath}" fill="none" stroke="${errorColor}" stroke-width="${s.errorWidth}"/>`}
      if(seriesMarkersVisible())positions.forEach(p=>out+=markerSvg(p.xx,p.yy,c,gi));
      if(isLineChart()&&s.letters)positions.forEach(p=>{if(p.d.letter){const e=Math.abs(y(p.d.mean+p.d.error)-p.yy);out+=letterSvg(p.xx,p.yy-e-s.letterOffset,p.d.letter,p.d.x,p.d.group)}});
    });
  }else{
    const groupW=xStep*s.categoryWidth,barW=groupW/gs.length;
    xvals.forEach((x,i)=>gs.forEach((g,gi)=>{const d=model.byKey.get(`${String(x)}${String(g)}`);if(!d)return;const w=Math.max(1,barW-s.barGap),xx=M.l+(i+.5)*xStep-groupW/2+gi*barW+s.barGap/2,yy=y(d.mean),base=y(Math.max(b.min,0)),barBottom=base,h=Math.max(0,barBottom-yy),c=colors[gi%colors.length];
      out+=`<rect data-object="series" data-series="${gi}" class="chart-object" x="${xx}" y="${yy}" width="${w}" height="${h}" fill="${c}" fill-opacity="${s.barOpacity}" stroke="${darken(c,.25)}" stroke-width="${s.barBorderWidth}"/>`;
      const cx=xx+w/2,e=Math.abs(y(d.mean+d.error)-yy);out+=errorSvg(cx,yy,e,c,gi);if(s.letters&&d.letter)out+=letterSvg(cx,yy-e-s.letterOffset,d.letter,d.x,d.group);
    }));
    if(s.barLineMode){gs.forEach((g,gi)=>{if(getSeriesStyle(gi).barLine===false)return;const c=colors[gi%colors.length],pts=[];xvals.forEach((x,i)=>{const d=model.byKey.get(`${String(x)}\u0001${String(g)}`);if(!d)return;const w=Math.max(1,barW-s.barGap),xx=M.l+(i+.5)*xStep-groupW/2+gi*barW+s.barGap/2;pts.push([xx+w/2,y(d.mean)])});if(pts.length>1)out+=`<path data-object="series" data-series="${gi}" class="chart-object" d="${pts.map((p,i)=>(i?'L':'M')+p[0]+','+p[1]).join(' ')}" fill="none" stroke="${c}" stroke-width="${s.barLineWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;if(s.barLineMarker)pts.forEach(p=>out+=markerSvg(p[0],p[1],c,gi))})}
  }
  out+=axes;out+=renderXAxisTopOverlay(M,plotW,axisY,xvals,xStep);return out;
}

function renderNormalAxes(W,H,M,plotW,plotH,xvals,xStep,yTicks,y,axisY){
  const s=state.chart.settings;let out='';
  out+=`<g data-object="axis-y" class="chart-object" stroke="${s.axisColor}" stroke-width="${s.axisWidth}" fill="none"><path d="M${M.l},${M.t} V${axisY}"/>`;
  if(s.showYTicks)yTicks.forEach(v=>{const yy=y(v);out+=`<line x1="${M.l-s.tickLength}" x2="${M.l}" y1="${yy}" y2="${yy}"/>`});out+='</g>';
  if(s.gridEnabled)out+='<g stroke="'+(s.gridColor||'#e3e7eb')+'" stroke-width="'+(s.gridWidth||1)+'">'+yTicks.map(v=>{const yy=y(v);return '<line x1="'+M.l+'" x2="'+(M.l+plotW)+'" y1="'+yy+'" y2="'+yy+'"/>'}).join('')+'</g>';
  const yStep=yTicks.length>1?yTicks[1]-yTicks[0]:1;
  yTicks.forEach(v=>out+=`<text data-object="axis-y" class="chart-object" x="${M.l-s.tickLength-6}" y="${y(v)+4}" text-anchor="end" font-size="${s.yTickSize}" font-weight="${s.yTickWeight||s.globalFontWeight||400}" fill="${s.yTickColor}">${isLogAxisY()?formatLogTick(v):formatAxisNumber(v,s.yTickDecimals,yStep,s.yTickRound)}</text>`);
  out+=`<g data-object="axis-x" class="chart-object" stroke="${s.axisColor}" stroke-width="${s.axisWidth}" fill="none"><path d="M${M.l},${axisY} H${M.l+plotW}"/>`;
  const tickObjects=experimentXAxisTickObjects(xvals,M,plotW);
  if(s.showXTicks)tickObjects.forEach(t=>{out+=`<line x1="${t.x}" x2="${t.x}" y1="${axisY}" y2="${axisY+s.tickLength}"/>`});out+='</g>';
  if(s.gridVertical)out+='<g stroke="'+(s.gridColor||'#e3e7eb')+'" stroke-width="'+(s.gridWidth||1)+'">'+tickObjects.map(t=>'<line x1="'+t.x+'" x2="'+t.x+'" y1="'+M.t+'" y2="'+axisY+'"/>').join('')+'</g>';
  const labels=tickObjects.map(t=>t.label),rotation=automaticXTickRotation(labels);
  tickObjects.forEach((t,j)=>{const layout={rotate:rotation,dy:(!s.xTickAutoRotate&&s.xTickStagger&&rotation===0?(j%2)*14:0),anchor:rotation<0?'end':rotation>0?'start':'middle'},yy=axisY+s.tickLength+18+layout.dy;out+=`<text data-object="axis-x" class="chart-object" x="${t.x}" y="${yy}" text-anchor="${layout.anchor}" font-size="${s.xTickSize}" font-weight="${s.xTickWeight||s.globalFontWeight||400}" fill="${s.xTickColor}" transform="rotate(${layout.rotate} ${t.x} ${yy})">${esc(t.label)}</text>`});
  out+=renderFrame(M,plotW,plotH,false);
  out+=axisTitles();return out;
}

function renderBrokenPlot(W,H,M,plotW,plotH,xvals,gs,colors){
  const s=state.chart.settings,model=getChartModel(),xCfg=experimentXAxisConfig(xvals,M,plotW),gap=clamp(s.breakGap,8,28),usable=plotH-gap,lowerH=usable*clamp(s.lowerRatio,.12,.42),upperH=usable-lowerH,upperBottom=M.t+upperH,lowerTop=upperBottom+gap,axisY=M.t+plotH;
  const loMin=s.lowerMin,loMax=s.lowerMax,hiMin=s.upperMin,hiMax=s.upperMax;
  if(!(loMax>loMin&&hiMax>hiMin&&hiMin>loMax)){return `<text x="490" y="320" text-anchor="middle" fill="#b33b3b">断轴范围无效：应满足 下段最小值 &lt; 下段最大值 &lt; 上段最小值 &lt; 上段最大值</text>`}
  const yLower=v=>lowerTop+(loMax-v)/(loMax-loMin)*lowerH,yUpper=v=>M.t+(hiMax-v)/(hiMax-hiMin)*upperH,xStep=plotW/xvals.length;let out='';
  out+=`<defs><clipPath id="clipUpper"><rect x="${M.l}" y="${M.t}" width="${plotW}" height="${upperH}"/></clipPath><clipPath id="clipLower"><rect x="${M.l}" y="${lowerTop}" width="${plotW}" height="${lowerH}"/></clipPath></defs>`;
  const axes=renderBrokenAxes(W,H,M,plotW,plotH,xvals,xStep,yLower,yUpper,upperBottom,lowerTop,axisY);
  if(state.chart.type==='bar'){
    const groupW=xStep*s.categoryWidth,barW=groupW/gs.length;
    xvals.forEach((x,i)=>gs.forEach((g,gi)=>{const d=model.byKey.get(`${String(x)}\u0001${String(g)}`);if(!d)return;const c=colors[gi%colors.length],w=Math.max(1,barW-s.barGap),xx=M.l+(i+.5)*xStep-groupW/2+gi*barW+s.barGap/2,cx=xx+w/2;
      if(d.mean>loMin){const topVal=Math.min(d.mean,loMax),ly=yLower(topVal),lh=Math.max(0,axisY-Math.max(.5,s.axisWidth/2)-ly);out+=`<rect data-object="series" data-series="${gi}" class="chart-object" x="${xx}" y="${ly}" width="${w}" height="${lh}" fill="${c}" fill-opacity="${s.barOpacity}" stroke="${darken(c,.25)}" stroke-width="${s.barBorderWidth}" clip-path="url(#clipLower)"/>`}
      if(d.mean>=hiMin){const uy=yUpper(d.mean),uh=upperBottom-uy;out+=`<rect data-object="series" data-series="${gi}" class="chart-object" x="${xx}" y="${uy}" width="${w}" height="${uh}" fill="${c}" fill-opacity="${s.barOpacity}" stroke="${darken(c,.25)}" stroke-width="${s.barBorderWidth}" clip-path="url(#clipUpper)"/>`;const e=Math.abs(yUpper(d.mean+d.error)-uy);out+=errorSvg(cx,uy,e,c,gi,'clipUpper');if(s.letters&&d.letter)out+=letterSvg(cx,uy-e-s.letterOffset,d.letter,d.x,d.group)}
    }));
    if(s.barLineMode){gs.forEach((g,gi)=>{if(getSeriesStyle(gi).barLine===false)return;const c=colors[gi%colors.length],upper=[],lower=[];xvals.forEach((x,i)=>{const d=model.byKey.get(`${String(x)}\u0001${String(g)}`);if(!d)return;const w=Math.max(1,barW-s.barGap),xx=M.l+(i+.5)*xStep-groupW/2+gi*barW+s.barGap/2,cx=xx+w/2;if(d.mean>=hiMin)upper.push([cx,yUpper(d.mean)]);else if(d.mean<=loMax)lower.push([cx,yLower(d.mean)])});if(upper.length>1)out+=`<path data-object="series" data-series="${gi}" class="chart-object" d="${upper.map((p,i)=>(i?'L':'M')+p[0]+','+p[1]).join(' ')}" fill="none" stroke="${c}" stroke-width="${s.barLineWidth}" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#clipUpper)"/>`;if(lower.length>1)out+=`<path data-object="series" data-series="${gi}" class="chart-object" d="${lower.map((p,i)=>(i?'L':'M')+p[0]+','+p[1]).join(' ')}" fill="none" stroke="${c}" stroke-width="${s.barLineWidth}" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#clipLower)"/>`;if(s.barLineMarker){upper.forEach(p=>out+=markerSvg(p[0],p[1],c,gi));lower.forEach(p=>out+=markerSvg(p[0],p[1],c,gi))}})}
  }else{
    gs.forEach((g,gi)=>{const c=colors[gi%colors.length],pts=model.byGroup.get(String(g))||[];
      ['upper','lower'].forEach(region=>{const mapped=pts.map(d=>({d,xx:xCfg?xCfg.pos(Number(convertXValue(d.x))):xBaseAt(model.xIndex.get(String(d.x))??0,xStep,M),region:d.mean>=hiMin?'upper':d.mean<=loMax?'lower':'gap'})).filter(p=>p.region===region);if(mapped.length>1){const yy=p=>region==='upper'?yUpper(p.d.mean):yLower(p.d.mean);const coords=mapped.map(p=>[p.xx,yy(p)]);out+=`<path data-object="series" data-series="${gi}" class="chart-object" d="${seriesPath(coords)}" fill="none" stroke="${c}" stroke-width="${getSeriesStyle(gi).lineWidth}" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#clip${region==='upper'?'Upper':'Lower'})"/>`}}
      );
      pts.forEach(d=>{const region=d.mean>=hiMin?'upper':d.mean<=loMax?'lower':null;if(!region)return;const idx=model.xIndex.get(String(d.x))??0,xx=xCfg?xCfg.pos(Number(convertXValue(d.x))):xBaseAt(idx,xStep,M),yy=region==='upper'?yUpper(d.mean):yLower(d.mean),map=region==='upper'?yUpper:yLower,e=Math.abs(map(d.mean+d.error)-yy);if(isLineChart())out+=errorSvg(xx,yy,e,c,gi,region==='upper'?'clipUpper':'clipLower');if(seriesMarkersVisible())out+=markerSvg(xx,yy,c,gi);if(isLineChart()&&s.letters&&d.letter)out+=letterSvg(xx,yy-e-s.letterOffset,d.letter,d.x,d.group)});
    });
  }
  out+=axes;
  out+=renderXAxisTopOverlay(M,plotW,axisY,xvals,xStep);
  return out;
}

function renderBrokenAxes(W,H,M,plotW,plotH,xvals,xStep,yLower,yUpper,upperBottom,lowerTop,axisY){
  const s=state.chart.settings,lowerTicks=makeTicks(s.lowerMin,s.lowerMax,null,3),upperTicks=makeTicks(s.upperMin,s.upperMax,null,4);let out='';
  out+=brokenVerticalGroup(M.l,M.t,axisY,upperBottom,lowerTop,'axis-y',s.axisColor,s.axisWidth);
  if(s.showYTicks){
    lowerTicks.forEach(v=>{const yy=yLower(v);out+=`<line data-object="axis-y" class="chart-object" x1="${M.l-s.tickLength}" x2="${M.l}" y1="${yy}" y2="${yy}" stroke="${s.axisColor}" stroke-width="${s.axisWidth}"/>`});
    upperTicks.forEach(v=>{const yy=yUpper(v);out+=`<line data-object="axis-y" class="chart-object" x1="${M.l-s.tickLength}" x2="${M.l}" y1="${yy}" y2="${yy}" stroke="${s.axisColor}" stroke-width="${s.axisWidth}"/>`})
  }
  lowerTicks.forEach(v=>out+=`<text data-object="axis-y" class="chart-object" x="${M.l-s.tickLength-6}" y="${yLower(v)+4}" text-anchor="end" font-size="${s.yTickSize}" font-weight="${s.yTickWeight||s.globalFontWeight||400}" fill="${s.yTickColor}">${formatTick(v)}</text>`);
  upperTicks.forEach(v=>out+=`<text data-object="axis-y" class="chart-object" x="${M.l-s.tickLength-6}" y="${yUpper(v)+4}" text-anchor="end" font-size="${s.yTickSize}" font-weight="${s.yTickWeight||s.globalFontWeight||400}" fill="${s.yTickColor}">${formatTick(v)}</text>`);
  out+=`<g data-object="axis-x" class="chart-object" stroke="${s.axisColor}" stroke-width="${s.axisWidth}" fill="none"><path d="M${M.l},${axisY} H${M.l+plotW}"/>`;
  const tickObjects=experimentXAxisTickObjects(xvals,M,plotW);
  if(s.showXTicks)tickObjects.forEach(t=>{out+=`<line x1="${t.x}" x2="${t.x}" y1="${axisY}" y2="${axisY+s.tickLength}"/>`});out+='</g>';
  if(s.gridVertical)out+='<g stroke="'+(s.gridColor||'#e3e7eb')+'" stroke-width="'+(s.gridWidth||1)+'">'+tickObjects.map(t=>'<line x1="'+t.x+'" x2="'+t.x+'" y1="'+M.t+'" y2="'+axisY+'"/>').join('')+'</g>';
  const labels=tickObjects.map(t=>t.label),rotation=automaticXTickRotation(labels);
  tickObjects.forEach((t,j)=>{const layout={rotate:rotation,dy:(!s.xTickAutoRotate&&s.xTickStagger&&rotation===0?(j%2)*14:0),anchor:rotation<0?'end':rotation>0?'start':'middle'},yy=axisY+s.tickLength+18+layout.dy;out+=`<text data-object="axis-x" class="chart-object" x="${t.x}" y="${yy}" text-anchor="${layout.anchor}" font-size="${s.xTickSize}" font-weight="${s.xTickWeight||s.globalFontWeight||400}" fill="${s.xTickColor}" transform="rotate(${layout.rotate} ${t.x} ${yy})">${esc(t.label)}</text>`});
  out+=renderFrame(M,plotW,plotH,true,upperBottom,lowerTop,axisY);out+=axisTitles();return out;
}

function brokenVerticalGroup(x,top,bottom,upperBottom,lowerTop,obj,color,width){
  const half=7,dy=5;
  const c1=upperBottom,c2=lowerTop;
  return `<g data-object="${obj}" class="chart-object" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="square" stroke-linejoin="miter"><path d="M${x},${top} V${c1} M${x},${c2} V${bottom}"/><path d="M${x-half},${c1-dy} L${x+half},${c1+dy} M${x-half},${c2-dy} L${x+half},${c2+dy}"/></g>`;
}

function renderFrame(M,plotW,plotH,broken=false,upperBottom=null,lowerTop=null,axisY=null){
  const s=state.chart.settings,mode=s.frameMode;if(mode==='none'||mode==='lb')return'';const right=M.l+plotW,bottom=M.t+plotH;let out=`<g data-object="frame" class="chart-object" stroke="${s.frameColor}" stroke-width="${s.frameWidth}" fill="none">`;
  if(mode==='box')out+=`<path d="M${M.l},${M.t} H${right}"/>`;
  if(mode==='box'||mode==='lbr')out+=broken?brokenVerticalGroup(right,M.t,axisY,upperBottom,lowerTop,'frame',s.frameColor,s.frameWidth).replace(/^<g[^>]*>|<\/g>$/g,''):`<path d="M${right},${M.t} V${bottom}"/>`;
  return out+'</g>';
}

function axisTitles(){
  const s=state.chart.settings;let out='';if(s.xTitleVisible&&s.xTitle)out+=`<text data-object="axis-x" data-drag="xTitle" class="chart-object draggable" x="${s.xTitleX}" y="${s.xTitleY}" text-anchor="middle" font-size="${s.xTitleSize}" font-weight="${s.xTitleWeight||s.globalFontWeight||400}" fill="${s.xTitleColor}">${esc(convertedXTitle())}</text>`;if(s.yTitleVisible&&s.yTitle)out+=`<text data-object="axis-y" data-drag="yTitle" class="chart-object draggable" transform="translate(${s.yTitleX} ${s.yTitleY}) rotate(-90)" text-anchor="middle" font-size="${s.yTitleSize}" font-weight="${s.yTitleWeight||s.globalFontWeight||400}" fill="${s.yTitleColor}">${esc(s.yTitle)}</text>`;return out;
}

function regularPolygonPoints(x,y,r,n,rotation=-Math.PI/2){
  return Array.from({length:n},(_,i)=>{const a=rotation+i*Math.PI*2/n;return `${x+Math.cos(a)*r},${y+Math.sin(a)*r}`}).join(' ');
}
function starPoints(x,y,r){
  return Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,rr=i%2===0?r:r*.45;return `${x+Math.cos(a)*rr},${y+Math.sin(a)*rr}`}).join(' ');
}
function markerShapeSvg(shape,x,y,r,attrs){
  if(shape==='square')return`<rect ${attrs} x="${x-r}" y="${y-r}" width="${2*r}" height="${2*r}"/>`;
  if(shape==='triangle')return`<path ${attrs} d="M${x},${y-r*1.25} L${x+r*1.15},${y+r} L${x-r*1.15},${y+r} Z"/>`;
  if(shape==='triangleDown')return`<path ${attrs} d="M${x-r*1.15},${y-r} L${x+r*1.15},${y-r} L${x},${y+r*1.25} Z"/>`;
  if(shape==='diamond')return`<path ${attrs} d="M${x},${y-r*1.25} L${x+r*1.1},${y} L${x},${y+r*1.25} L${x-r*1.1},${y} Z"/>`;
  if(shape==='star')return`<polygon ${attrs} points="${starPoints(x,y,r*1.25)}"/>`;
  if(shape==='pentagon')return`<polygon ${attrs} points="${regularPolygonPoints(x,y,r*1.2,5)}"/>`;
  if(shape==='hexagon')return`<polygon ${attrs} points="${regularPolygonPoints(x,y,r*1.15,6)}"/>`;
  if(shape==='plus')return`<path ${attrs} fill="none" stroke-linecap="round" d="M${x-r*1.2},${y} H${x+r*1.2} M${x},${y-r*1.2} V${y+r*1.2}"/>`;
  if(shape==='cross')return`<path ${attrs} fill="none" stroke-linecap="round" d="M${x-r},${y-r} L${x+r},${y+r} M${x+r},${y-r} L${x-r},${y+r}"/>`;
  return`<circle ${attrs} cx="${x}" cy="${y}" r="${r}"/>`;
}
function markerSvg(x,y,c,series){
  const st=getSeriesStyle(series),fill=st.markerFill==='series'?c:st.markerFill,r=st.markerSize;
  const common=`data-object="series" data-series="${series}" class="chart-object" fill="${fill}" stroke="${c}" stroke-width="${Math.max(1.5,st.lineWidth*.72)}"`;
  return markerShapeSvg(st.markerShape,x,y,r,common);
}

function errorSvg(x,y,e,c,series,clipId=''){
  const s=state.chart.settings,color=s.errorColorMode==='black'?s.axisColor:c,clip=clipId?` clip-path="url(#${clipId})"`:'';
  return `<g data-object="error" data-series="${series}" class="chart-object" stroke="${color}" stroke-width="${s.errorWidth}"${clip}><line x1="${x}" x2="${x}" y1="${y-e}" y2="${y+e}"/><line x1="${x-s.errorCap/2}" x2="${x+s.errorCap/2}" y1="${y-e}" y2="${y-e}"/><line x1="${x-s.errorCap/2}" x2="${x+s.errorCap/2}" y1="${y+e}" y2="${y+e}"/></g>`;
}
function letterSvg(x,y,text,lx,lg){const s=state.chart.settings;return`<text data-object="letters" data-letter-x="${esc(lx)}" data-letter-g="${esc(lg)}" class="chart-object" x="${x}" y="${y}" text-anchor="middle" font-size="${s.letterSize}" font-weight="${s.letterWeight||400}" style="cursor:pointer">${esc(text)}</text>`}

function legendLayout(gs,colors){
  const s=state.chart.settings,font=s.legendSize,rowH=Math.max(25,font*1.55),symbolW=Math.max(18,font*1.15),textGap=Math.max(9,font*.55),itemGap=Math.max(18,font*.9),colGap=Math.max(18,font*1.1);
  const horizontal=s.legendOrientation!=='vertical';
  const requested=Math.max(1,Math.round(Number(s.legendColumns)||1));
  const cols=horizontal?Math.min(gs.length,requested===1?gs.length:requested):1;
  const rows=Math.ceil(gs.length/cols);
  const labelWidths=gs.map(g=>Math.max(20,String(g).length*font*.62));
  const itemWidths=gs.map((g,i)=>symbolW+textGap+labelWidths[i]);
  const colWidths=Array(cols).fill(0);
  itemWidths.forEach((w,i)=>{colWidths[i%cols]=Math.max(colWidths[i%cols],w)});
  const colX=[];let cursor=0;for(let c=0;c<cols;c++){colX[c]=cursor;cursor+=colWidths[c]+(c<cols-1?colGap:0)}
  let content='';
  gs.forEach((g,i)=>{
    const col=horizontal?i%cols:0,row=horizontal?Math.floor(i/cols):i,ox=colX[col],oy=row*rowH+rowH*.52,c=colors[i%colors.length],st=getSeriesStyle(i);
    if(state.chart.type==='bar')content+=`<rect data-object="legend" x="${ox}" y="${oy-font*.42}" width="${symbolW}" height="${Math.max(12,font*.82)}" fill="${c}" stroke="${darken(c,.25)}" stroke-width="${s.barBorderWidth}"/><text data-object="legend" x="${ox+symbolW+textGap}" y="${oy+font*.18}" dominant-baseline="middle" font-size="${font}" font-weight="${s.legendWeight||s.globalFontWeight||400}">${esc(g)}</text>`;
    else content+=`<line data-object="legend" x1="${ox}" x2="${ox+symbolW}" y1="${oy}" y2="${oy}" stroke="${c}" stroke-width="${st.lineWidth}"/>${seriesMarkersVisible()?markerLegend(ox+symbolW/2,oy,c,i):''}<text data-object="legend" x="${ox+symbolW+textGap}" y="${oy+font*.12}" dominant-baseline="middle" font-size="${font}" font-weight="${s.legendWeight||s.globalFontWeight||400}">${esc(g)}</text>`;
  });
  return {content,width:cursor,height:Math.max(rowH,rows*rowH),padX:14,padY:10};
}
function legendFrameSvg(width,height){
  const s=state.chart.settings,style=s.legendFrameStyle;
  if(style==='none')return'';
  const x=0,y=0,w=width,h=height,r=s.legendFrameRadius??2,stroke=s.legendFrameColor||'#7d898f',sw=s.legendFrameWidth||1;
  const dash=style==='dashed'?'8 5':style==='dotted'?'2 4':'';
  if(style==='double')return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${s.legendFrameFill||'#ffffff'}" stroke="${stroke}" stroke-width="${sw}"/><rect x="${x+4}" y="${y+4}" width="${Math.max(1,w-8)}" height="${Math.max(1,h-8)}" rx="${Math.max(0,r-1)}" fill="none" stroke="${stroke}" stroke-width="${Math.max(.6,sw*.75)}"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${s.legendFrameFill||'#ffffff'}" stroke="${stroke}" stroke-width="${sw}" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
}
function renderLegendFrame(gs,colors){
  const s=state.chart.settings;if(!s.legendVisible||gs.length<=1||s.legendFrameStyle==='none')return'';
  const layout=legendLayout(gs,colors),lf=state.chart.legendFrame;
  const autoW=layout.width+layout.padX*2,autoH=layout.height+layout.padY*2;
  const w=lf.autoSize?autoW:Math.max(20,Number(lf.width)||autoW),h=lf.autoSize?autoH:Math.max(20,Number(lf.height)||autoH);
  const shadow=s.legendShadow?' filter="url(#legendShadow)"':'';
  return `<g id="legendFrameGroup" data-object="legend-frame" data-drag="legendFrame" class="chart-object draggable" transform="translate(${lf.x} ${lf.y})"${shadow}>${legendFrameSvg(w,h)}</g>`;
}
function renderLegend(gs,colors){
  const s=state.chart.settings;if(!s.legendVisible||gs.length<=1)return'';
  ensureSeriesStyles();const layout=legendLayout(gs,colors),x=state.chart.legend.x,y=state.chart.legend.y;
  return `<g id="legendGroup" data-object="legend" data-drag="legend" class="chart-object draggable" transform="translate(${x} ${y})"><g transform="translate(${layout.padX} ${layout.padY})">${layout.content}</g></g>`;
}
function markerLegend(x,y,c,series){
  const st=getSeriesStyle(series),r=Math.min(st.markerSize,Math.max(4.6,state.chart.settings.legendSize*.34)),fill=st.markerFill==='series'?c:st.markerFill;
  return markerShapeSvg(st.markerShape,x,y,r,`fill="${fill}" stroke="${c}" stroke-width="${Math.max(1.2,st.lineWidth*.68)}"`);
}

function bindChartObjects(){
  const stage=$('#chartStage');if(!stage)return;
  stage.onclick=e=>{const le=e.target.closest('[data-letter-x]');if(le&&stage.contains(le)){e.stopPropagation();openLetterEditor(le);return}const el=e.target.closest('.chart-object');if(!el||!stage.contains(el))return;e.stopPropagation();if(el.dataset.annotationId)selectObject(`annotation:${el.dataset.annotationId}`);else selectObject(el.dataset.object==='axis-z'?'waterfall3d':el.dataset.object,el.dataset.series)};
}

function openLetterEditor(t){ensureLetterEditor().open(t)}
function ensureLetterEditor(){
  if(ensureLetterEditor._)return ensureLetterEditor._;
  var inp=document.createElement('input');inp.type='text';var st=inp.style;
  st.position='fixed';st.display='none';st.zIndex='9999';st.padding='1px 4px';st.margin='0';st.border='1.5px solid #2b6cb0';st.borderRadius='4px';st.background='#fff';st.textAlign='center';st.boxShadow='0 2px 10px rgba(0,0,0,.2)';st.fontFamily='inherit';
  document.body.appendChild(inp);var activeKey=null;
  function commit(save){if(inp.style.display==='none')return;inp.style.display='none';var key=activeKey;activeKey=null;
    if(save&&key!=null){state.chart.manualLetters=state.chart.manualLetters||{};var v=inp.value.trim();if(v==='')delete state.chart.manualLetters[key];else state.chart.manualLetters[key]=v;setTimeout(function(){renderChart()},0)}}
  inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();commit(true)}else if(e.key==='Escape'){e.preventDefault();commit(false)}});
  inp.addEventListener('blur',function(){commit(true)});
  ensureLetterEditor._={open:function(t){activeKey=t.dataset.letterX+'\u001f'+t.dataset.letterG;var r=t.getBoundingClientRect();var fs=parseFloat(t.getAttribute('font-size'))||16;var w=Math.max(48,r.width+24);
    inp.style.fontSize=Math.max(12,fs*.82)+'px';inp.style.width=w+'px';inp.value=t.textContent;
    inp.style.left=(r.left+r.width/2-w/2)+'px';inp.style.top=(r.top-3)+'px';inp.style.display='block';inp.focus();inp.select()}};
  return ensureLetterEditor._;
}

function updateArrowAnnotationDom(group,ann){
  if(!group||!ann)return;
  group.querySelectorAll('[data-ann-line],[data-ann-hit]').forEach(line=>{line.setAttribute('x1',ann.x1);line.setAttribute('y1',ann.y1);line.setAttribute('x2',ann.x2);line.setAttribute('y2',ann.y2)});
  const start=group.querySelector('[data-annotation-handle="start"]'),end=group.querySelector('[data-annotation-handle="end"]');
  if(start)start.setAttribute('transform',`translate(${ann.x1} ${ann.y1})`);if(end)end.setAttribute('transform',`translate(${ann.x2} ${ann.y2})`);
  const label=group.querySelector('[data-ann-label]');if(label){label.setAttribute('x',(ann.x1+ann.x2)/2);label.setAttribute('y',(ann.y1+ann.y2)/2-8)}
}
function bindAnnotationEndpointHandles(svg,store,finish){
  svg.querySelectorAll('[data-annotation-handle]').forEach(handle=>handle.addEventListener('pointerdown',e=>{
    e.preventDefault();e.stopPropagation();const id=handle.dataset.annotationId,ann=store.annotations.find(a=>a.id===id);if(!ann)return;
    store.selectedAnnotation=id;store.selected=`annotation:${id}`;
    const endpoint=handle.dataset.annotationHandle,group=handle.closest('[data-annotation-id],[data-gannotation-id]');handle.setPointerCapture(e.pointerId);handle.classList.add('is-dragging');
    const move=ev=>{const p=svgPoint(svg,ev);if(endpoint==='start'){ann.x1=p.x;ann.y1=p.y}else{ann.x2=p.x;ann.y2=p.y}updateArrowAnnotationDom(group,ann)};
    const endDrag=()=>{handle.classList.remove('is-dragging');handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',endDrag);handle.removeEventListener('pointercancel',endDrag);finish?.()};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',endDrag);handle.addEventListener('pointercancel',endDrag);
  }));
}

function bindDraggables(){
  const svg=$('#paperSvg');if(!svg)return;
  bindAnnotationEndpointHandles(svg,state.chart,()=>{renderChart();renderLayers();renderProperties()});
  $$('[data-drag]').forEach(el=>{
    el.addEventListener('pointerdown',e=>{
      if(e.target.closest('[data-annotation-handle]'))return;
      e.preventDefault();e.stopPropagation();
      const key=el.dataset.drag,start=svgPoint(svg,e),snapshot=dragSnapshot(key,el);
      el.setPointerCapture(e.pointerId);el.classList.add('dragging');
      const target=key==='annotation'?`annotation:${el.dataset.annotationId}`:key==='legend'?'legend':key==='legendFrame'?'legend-frame':key==='title'?'title':key==='subtitle'?'subtitle':key==='xTitle'?'axis-x':'axis-y';
      selectObject(target);
      const move=ev=>{const p=svgPoint(svg,ev),dx=p.x-start.x,dy=p.y-start.y;applyDrag(key,snapshot,dx,dy,el)};
      const up=()=>{el.classList.remove('dragging');el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);renderChart();renderProperties()};
      el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);
    });
  });
}
function svgPoint(svg,e){const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(svg.getScreenCTM().inverse())}
function dragSnapshot(key,el=null){
  const s=state.chart.settings;if(key==='annotation'){const ann=state.chart.annotations.find(a=>a.id===el?.dataset.annotationId);return ann?structuredClone(ann):{}}
  if(key==='legend')return{x:state.chart.legend.x,y:state.chart.legend.y};
  if(key==='legendFrame')return{x:state.chart.legendFrame.x,y:state.chart.legendFrame.y};
  if(key==='title')return{x:s.titleX,y:s.titleY};if(key==='subtitle')return{x:s.subtitleX,y:s.subtitleY};
  if(key==='xTitle'){
    if(state.chart.type==='waterfall'&&el){const x=parseFloat(el.getAttribute('x')),y=parseFloat(el.getAttribute('y'));return{x:Number.isFinite(x)?x:0,y:Number.isFinite(y)?y:0};}
    return{x:s.xTitleX,y:s.xTitleY};
  }
  if(state.chart.type==='waterfall'&&el){const mm=(el.getAttribute('transform')||'').match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/);return{x:mm?parseFloat(mm[1]):0,y:mm?parseFloat(mm[2]):0};}
  return{x:s.yTitleX,y:s.yTitleY};
}
function applyDrag(key,snap,dx,dy,el){
  if(key==='annotation'){
    const ann=state.chart.annotations.find(a=>a.id===el.dataset.annotationId);if(!ann)return;
    if(ann.type==='text'){ann.x=snap.x+dx;ann.y=snap.y+dy;el.setAttribute('transform',`translate(${ann.x} ${ann.y})`)}
    else if(ann.type==='peak'){ann.dx=snap.dx+dx;ann.dy=snap.dy+dy;el.setAttribute('transform',`translate(${dx} ${dy})`)}
    else{ann.x1=snap.x1+dx;ann.y1=snap.y1+dy;ann.x2=snap.x2+dx;ann.y2=snap.y2+dy;el.setAttribute('transform',`translate(${dx} ${dy})`)}
    return;
  }
  const x=snap.x+dx,y=snap.y+dy,s=state.chart.settings;
  if(key==='legend'){state.chart.legend.x=x;state.chart.legend.y=y;el.setAttribute('transform',`translate(${x} ${y})`)}
  else if(key==='legendFrame'){state.chart.legendFrame.x=x;state.chart.legendFrame.y=y;el.setAttribute('transform',`translate(${x} ${y})`)}
  else if(key==='title'){s.titleX=x;s.titleY=y;el.setAttribute('x',x);el.setAttribute('y',y)}else if(key==='subtitle'){s.subtitleX=x;s.subtitleY=y;el.setAttribute('x',x);el.setAttribute('y',y)}
  else if(key==='xTitle'){
    if(state.chart.type==='waterfall'){s.wfXTitleX=x;s.wfXTitleY=y;el.setAttribute('x',x);el.setAttribute('y',y)}
    else{s.xTitleX=x;s.xTitleY=y;el.setAttribute('x',x);el.setAttribute('y',y)}
  }
  else if(state.chart.type==='waterfall'){s.wfYTitleX=x;s.wfYTitleY=y;const wr=state.chart.settings.wfViewDir==='left'?90:-90;el.setAttribute('transform',`translate(${x} ${y}) rotate(${wr})`)}
  else{s.yTitleX=x;s.yTitleY=y;el.setAttribute('transform',`translate(${x} ${y}) rotate(-90)`)}
}

function renderProperties(){
  const id=state.chart.selected,s=state.chart.settings,gs=chartGroups();let name='',html='';
  if(id==='title'){name='图题';html=fieldGroup([
    checkField('titleVisible','显示图题'),textField('title','图题文字'),numberField('titleX','水平位置',0,1600,1),numberField('titleY','垂直位置',0,1000,1),rangeField('titleSize','字号',9,36,1),selectField('titleWeight','字重',[['300','细体'],['400','常规'],['500','中等'],['600','半粗'],['700','粗体']]),colorField('titleColor','颜色')
  ]);}
  else if(id==='subtitle'){name='副标题';html=fieldGroup([checkField('subtitleEnabled','显示副标题'),textField('subtitle','副标题文字'),numberField('subtitleX','水平位置',0,1600,1),numberField('subtitleY','垂直位置',0,1000,1),rangeField('subtitleSize','字号',8,28,1),selectField('subtitleWeight','字重',[['300','细体'],['400','常规'],['500','中等'],['600','半粗']]),colorField('subtitleColor','颜色')])+`<div class="hint">副标题可直接拖动；留空或关闭时不显示。</div>`;}
  else if(id==='typography'){name='中英文字体与字重';html=fieldGroup([
    selectField('fontEnglish','英文字体',[['Arial','Arial'],['Times New Roman','Times New Roman'],['Calibri','Calibri'],['Helvetica','Helvetica'],['Georgia','Georgia']]),
    selectField('fontChinese','中文字体',[['Microsoft YaHei','微软雅黑'],['SimSun','宋体'],['SimHei','黑体'],['KaiTi','楷体'],['FangSong','仿宋']]),
    selectField('globalFontWeight','全局文字粗细',[['300','细体'],['400','常规'],['500','中等'],['600','半粗'],['700','粗体']]),
    selectField('xTitleWeight','X轴标题粗细',[['300','细体'],['400','常规'],['500','中等'],['600','半粗'],['700','粗体']]),
    selectField('yTitleWeight','Y轴标题粗细',[['300','细体'],['400','常规'],['500','中等'],['600','半粗'],['700','粗体']]),
    selectField('xTickWeight','X轴数字粗细',[['300','细体'],['400','常规'],['500','中等'],['600','半粗']]),
    selectField('yTickWeight','Y轴数字粗细',[['300','细体'],['400','常规'],['500','中等'],['600','半粗']]),
    selectField('legendWeight','图例文字粗细',[['300','细体'],['400','常规'],['500','中等'],['600','半粗']])
  ])+`<div class="hint">字体与字重已放到图表上方的快捷栏，同时也可以在这里精细设置。</div>`;}
  else if(id==='canvas'){name='画布与导出清晰度';html=fieldGroup([
    selectField('panelPreset','图幅比例',[['normal','常规 980×660'],['small','拼图小图 760×540'],['square','正方图 700×700'],['wide','宽图 1080×620'],['tall','高图 820×760'],['custom','自定义']]),
    numberField('canvasWidth','画布宽度',500,1800,10),numberField('canvasHeight','画布高度',400,1200,10),
    selectField('pngDpi','PNG 清晰度',[['96','96 dpi（屏幕）'],['150','150 dpi'],['300','300 dpi（论文）'],['600','600 dpi（高精度）']]),checkField('tightExport','紧凑导出（裁掉四周白边）')
  ])+`<div class="hint">SVG 为矢量图，不受分辨率限制；PNG 会按画布尺寸与所选 dpi 输出。</div>`;}
  else if(id==='axis-x'){name='X 轴与横坐标标题';html=fieldGroup([
    checkField('xTitleVisible','显示横坐标标题'),textField('xTitle','横坐标标题'),numberField('xTitleX','标题水平位置',0,1600,1),numberField('xTitleY','标题垂直位置',0,1200,1),rangeField('xTitleSize','标题字号',9,36,1),selectField('xTitleWeight','标题字重',[['300','细体'],['400','常规'],['500','中等'],['600','半粗'],['700','粗体']]),colorField('xTitleColor','标题颜色'),
    selectField('xUnitSource','原始时间单位',[['auto','从标题自动识别'],['s','秒 s'],['min','分钟 min'],['h','小时 h']]),selectField('xUnitTarget','显示时间单位',[['original','保持原单位'],['auto','自动选择合适单位'],['s','秒 s'],['min','分钟 min'],['h','小时 h']]),
    selectField('xScaleMode','坐标范围',[['auto','自动读取数据范围'],['manual','手动指定起止值']]),numberField('xAxisMin','起始值',null,null,.01,true),numberField('xAxisMax','结束值',null,null,.01,true),rangeField('xAxisSegments','分段数量',1,30,1),checkField('xTickRound','刻度取整/使用整洁间隔'),selectField('xTickDecimals','数字小数位',[['auto','自动'],['0','整数'],['1','1 位'],['2','2 位'],['3','3 位']]),
    ...(isLineLike()?[selectField('xScale','X 轴坐标类型',[['linear','线性（等距数值）'],['log','对数 log₁₀（适合跨数量级）']]),numberField('xTickStep','X 轴刻度间隔（留空＝按分段）',null,null,.01,true),'<div class="hint">对数轴：刻度按 10 的幂分布，“刻度间隔”填 10 或 100 表示每隔 1 个或 2 个数量级放一个刻度；若 X 数据含 0 或负数，会自动退回线性轴。</div>']:[]),
    rangeField('axisWidth','坐标轴粗细',.5,5,.1),colorField('axisColor','坐标轴颜色'),rangeField('xTickSize','X轴数字字号',8,30,1),selectField('xTickWeight','X轴数字字重',[['300','细体'],['400','常规'],['500','中等'],['600','半粗'],['700','粗体']]),colorField('xTickColor','X轴数字颜色'),rangeField('tickLength','刻度线长度',0,18,1),checkField('xTickAutoRotate','标签放不下时自动倾斜'),rangeField('xTickRotation','手动旋转角度',-90,90,5),checkField('xTickStagger','关闭自动倾斜后交错换行'),checkField('showXTicks','显示横坐标刻度线')
  ])+`<div class="hint">${esc(xUnitStatusText())} 自动倾斜开启时，标签拥挤会使用 −45° 或 −60°；关闭后才使用手动角度和交错换行。</div>`;}
  else if(id==='axis-y'){name='Y 轴与纵坐标标题';html=fieldGroup([
    checkField('yTitleVisible','显示纵坐标标题'),textField('yTitle','纵坐标标题'),numberField('yTitleX','标题水平位置',0,300,1),numberField('yTitleY','标题垂直位置',0,1200,1),rangeField('yTitleSize','标题字号',9,36,1),selectField('yTitleWeight','标题字重',[['300','细体'],['400','常规'],['500','中等'],['600','半粗'],['700','粗体']]),colorField('yTitleColor','标题颜色'),
    numberField('yMin','最小值',null,null,.01,true),numberField('yMax','最大值',null,null,.01,true),numberField('yTickStep','刻度间隔（留空按分段）',null,null,.01,true),rangeField('yAxisSegments','分段数量',1,20,1),checkField('yTickRound','刻度取整/整洁范围'),selectField('yTickDecimals','数字小数位',[['auto','自动'],['0','整数'],['1','1 位'],['2','2 位'],['3','3 位']]),
    ...(isLineLike()?[selectField('yScale','Y 轴坐标类型',[['linear','线性（等距数值）'],['log','对数 log₁₀（适合跨数量级）']]),'<div class="hint">对数轴：Y 轴按 10 的幂分布，“刻度间隔”填 10 或 100 表示每隔 1 个或 2 个数量级放一个刻度；若数据（含误差棒端点）出现 0 或负数，会自动退回线性轴。断轴模式下不使用对数轴。</div>']:[]),
    rangeField('axisWidth','坐标轴粗细',.5,5,.1),colorField('axisColor','坐标轴颜色'),rangeField('yTickSize','Y轴数字字号',8,30,1),selectField('yTickWeight','Y轴数字字重',[['300','细体'],['400','常规'],['500','中等'],['600','半粗'],['700','粗体']]),colorField('yTickColor','Y轴数字颜色'),rangeField('tickLength','刻度线长度',0,18,1),checkField('showYTicks','显示纵坐标刻度线')
  ])+breakPropertyBlock();}
  else if(id==='frame'){name='图片边框';html=fieldGroup([
    selectField('frameMode','边框形式',[['lb','仅左、下轴'],['lbr','左、下、右三边'],['box','完整四边框'],['none','不显示边框']]),rangeField('frameWidth','边框粗细',.5,6,.1),colorField('frameColor','边框颜色')
  ]);}
  else if(id==='waterfall3d'){name='3D 瀑布图';html=
'<div class="object-property-section"><h3>三维坐标与纵深</h3></div>'+fieldGroup([
    selectField('wfViewDir','纵深方向',[['right','向右后方（默认）'],['left','向左后方']]),
    rangeField('wfLayerDx','层间水平错开（向右纵深）',0,220,1),
    rangeField('wfLayerDy','层间垂直错开（向上纵深）',0,220,1),
    checkField('wfZLabels','右侧 Z 轴与层标签')])
+'<div class="object-property-section"><h3>层曲线与填充</h3></div>'+fieldGroup([
    checkField('wfFill','每层填充到基线'),
    rangeField('wfFillOpacity','填充不透明度',0,1,.05),
    checkField('wfLineEndLabels','线尾标注层名')])
+'<div class="object-property-section"><h3>Z 轴（层 / 时间 / 温度）</h3></div>'+fieldGroup([
    textField('wfZAxisTitle','Z 轴标题'),
    rangeField('wfZLabelSize','Z 轴标签字号',8,20,1)])
+'<div class="object-property-section"><h3>墙面、网格与图例</h3></div>'+fieldGroup([
    colorField('wfWallColor','墙面底色'),
    colorField('wfGridColor','网格线颜色'),
    rangeField('wfGridWidth','网格线粗细',.2,2,.1),
    checkField('wfLegend','显示图例'),
    selectField('wfLegendStyle','图例样式',[['block','色块'],['line','线条']]),
    rangeField('wfLegendSize','图例字号',8,18,1)])
+'<div class="method-badge">X ＝ 横轴点（波长/时间），在“X 轴与横标题”里改；Y ＝ 数值（前左竖边），在“Y 轴与纵标题”里改；Z ＝ 层（右斜边，每列一个时间点/温度），相关设置都在这里。</div>';
  }
  else if(id==='series'){const idx=clamp(state.chart.selectedSeries,0,Math.max(0,gs.length-1));name=`数据系列 · ${gs[idx]||'Series'}`;html='<div class="object-property-section"><h3>全系列样式</h3></div>'+fieldGroup([
    rangeField('lineWidth','全系列折线粗细',.5,7,.1),rangeField('markerSize','全系列标记大小',1,16,.2)
  ])+fieldGroup([
    colorField(`palette:${idx}`,'当前系列颜色'),rangeField(`series:${idx}:lineWidth`,'本系列折线粗细',.5,7,.1),rangeField(`series:${idx}:markerSize`,'本系列标记大小',1,16,.2),
    markerShapeGrid(idx),
    selectField(`series:${idx}:markerFill`,'本系列标记填充',[['white','白色空心'],['series','同系列颜色']]),
    selectField('lineMode','折线连接方式',[['straight','直线连接'],['smooth','平滑连接']]),
    rangeField('barGap','柱间距',0,16,1),rangeField('categoryWidth','组宽度',.35,.95,.01),rangeField('barOpacity','柱填充透明度',.25,1,.05),rangeField('barBorderWidth','柱边框粗细',0,3,.1),
    ...(state.chart.type==='bar'?[checkField('barLineMode','柱线组合（柱顶叠加均值趋势线）'),checkField(`series:${idx}:barLine`,'本系列趋势折线'),rangeField('barLineWidth','趋势线粗细',.8,5,.1),checkField('barLineMarker','趋势线数据点')]:[])
  ])+`<div class="hint">每条系列的颜色、线宽、标记形状和填充均独立保存。曲线图固定采用平滑连接，且不绘制误差棒和显著性字母。</div>`+paletteBlock();}
  else if(id==='error'){name='误差棒';html=fieldGroup([selectField('errorType','误差棒类型',[['sd','Mean ± SD'],['se','Mean ± SEM'],['ci','Mean ± 95% CI']]),rangeField('errorWidth','线条粗细',.5,4,.1),rangeField('errorCap','端帽宽度',2,28,1),selectField('errorColorMode','颜色',[['series','跟随系列颜色'],['black','统一黑色']])]);}
  else if(id==='legend'){name='图例内容';html=fieldGroup([checkField('legendVisible','显示图例'),numberLegendField('x','水平位置'),numberLegendField('y','垂直位置'),rangeField('legendSize','字号',8,48,1),orientationButtonField('legendOrientation','排列方向'),rangeField('legendColumns','横向图例列数',1,6,1)])+`<div class="hint">图例内容可以直接拖动。多系列时可以使用多列排版；图例边框在独立图层中单独移动。</div>`;}
  else if(id==='legend-frame'){name='图例边框';html=fieldGroup([
    selectField('legendFrameStyle','边框样式',[['none','无边框'],['solid','实线'],['dashed','虚线'],['dotted','点线'],['double','双线']]),
    numberLegendFrameField('x','水平位置'),numberLegendFrameField('y','垂直位置'),checkLegendFrameField('autoSize','自动适应图例大小'),numberLegendFrameField('width','边框宽度'),numberLegendFrameField('height','边框高度'),
    rangeField('legendFrameWidth','边框粗细',.5,5,.1),colorField('legendFrameColor','边框颜色'),colorField('legendFrameFill','边框底色'),rangeField('legendFrameRadius','圆角',0,18,1),
    checkField('legendShadow','显示阴影'),rangeField('legendShadowX','阴影水平偏移',-10,14,1),rangeField('legendShadowY','阴影垂直偏移',-10,14,1),rangeField('legendShadowBlur','阴影模糊',0,12,.5),rangeField('legendShadowOpacity','阴影透明度',0,.7,.05)
  ])+`<div class="hint">图例边框可独立拖动；阴影只作用于边框，不会锁住图例内容。</div>`;}
  else if(id==='letters'){name='显著性字母';html=fieldGroup([checkField('letters','显示显著性字母'),selectField('letterScheme','字母标记方式',[['within','组内比较（每个横轴分组内 a/b/c）'],['twoWay','双因素主效应组合（大写=横轴因素，小写=系列因素，如 Aa）']]),selectField('postHoc','多重比较方法',[['duncan','Duncan'],['tukey','Tukey HSD'],['snk','S-N-K'],['lsd','LSD'],['bonferroni','Bonferroni'],['gameshowell','Games-Howell']]),rangeField('letterSize','字母字号',8,22,1),selectField('letterWeight','字重',[['400','常规（与刻度接近）'],['500','中等'],['600','半粗']]),rangeField('letterOffset','与误差棒间距',3,28,1)])+`<div class="hint">「组内比较」在每个横轴分组内比较各系列；「双因素主效应组合」用边际均值分别给两因素分组再组合（如 Aa、Bb），大写对应横轴因素、小写对应系列因素；若两因素交互作用显著，主效应字母需谨慎解释；组内比较默认 Duncan 法、误差取当天各组的合并方差，与 SPSS「按天拆分做单因素 ANOVA」一致。</div>`;}
  else if(id.startsWith('annotation:')){const ann=annotationById(id.split(':')[1]);name=ann?`标注 · ${annotationTypeLabel(ann.type)}`:'标注';html=ann?annotationPropertyHtml(ann):'';}
  else if(id==='background'){name='背景';html=fieldGroup([colorField('background','整体背景颜色'),checkField('plotBgVisible','显示绘图区底色'),colorField('plotBg','绘图区底色'),checkField('gridEnabled','显示横网格线'),checkField('gridVertical','显示纵网格线'),colorField('gridColor','网格线颜色'),rangeField('gridWidth','网格线粗细',.3,3,.1)])+`<div class="hint">整体背景作用于整张图；绘图区底色与网格线只在 X/Y 轴围成的框内。</div>`;}
  else if(id==='palette'){name='配色参数';html=paletteBlock()+paletteButtons();}
  else if(id==='style'){name='图片参数';html=styleButtons();}
  else if(id==='methodnote'){name='方法说明';const note=s.methodNote||buildMethodNote();html='<div class="subhead">方法说明（可编辑、可复制到论文）</div><textarea id="methodNoteArea" style="width:100%;min-height:220px;font-size:13px;line-height:1.7;padding:10px;border:1px solid #c9d2d8;border-radius:6px;resize:vertical;box-sizing:border-box" placeholder="自动生成方法说明...">'+esc(note)+'</textarea><div style="display:flex;gap:6px;margin-top:8px"><button type="button" id="regenMethodNote" class="ghost" style="padding:6px 12px;border:1px solid #c9d2d8;border-radius:5px;background:#f4f7f9;cursor:pointer;font-size:12px">重新自动生成</button><button type="button" id="copyMethodNote" class="ghost" style="padding:6px 12px;border:1px solid #c9d2d8;border-radius:5px;background:#f4f7f9;cursor:pointer;font-size:12px">复制全部</button></div><div class="hint">这段文字不画到图上，供你复制进论文「材料与方法」；直接在框里改字，点空白处自动保存。</div>';}
  $('#selectedObjectName').textContent=name||'未选择对象';$('#propertyEditor').innerHTML=html||'<div class="empty-state">在图中点击一个对象</div>';const badge=$('#propertyScopeBadge');if(badge){const special=['series','error','letters','waterfall3d','palette','style'].includes(id)||id.startsWith('annotation:');badge.textContent=special?'图形专属':'基础';badge.classList.toggle('chart-specific',special)}bindPropertyInputs();
  const mna=$('#methodNoteArea');if(mna)mna.oninput=()=>{state.chart.settings.methodNote=mna.value};
  const rg=$('#regenMethodNote');if(rg)rg.onclick=()=>{delete state.chart.settings.methodNote;renderProperties()};
  const cp=$('#copyMethodNote');if(cp)cp.onclick=()=>{const a=$('#methodNoteArea');if(a&&navigator.clipboard)navigator.clipboard.writeText(a.value).then(()=>toast('已复制方法说明')).catch(()=>{})};
}

function markerShapeGrid(index){
  const shapes=[['circle','圆'],['square','方'],['triangle','上三角'],['triangleDown','下三角'],['diamond','菱形'],['star','五角星'],['pentagon','五边形'],['hexagon','六边形'],['plus','加号'],['cross','叉号']];
  const current=getSeriesSetting(index,'markerShape');
  return `<div class="field marker-field"><label><span>本系列标记形状</span><output>${shapes.find(x=>x[0]===current)?.[1]||current}</output></label><div class="marker-grid">${shapes.map(([v,l])=>`<button type="button" class="marker-choice ${current===v?'active':''}" data-marker-series="${index}" data-marker-shape="${v}" title="${l}"><span class="marker-icon marker-${v}"></span><small>${l}</small></button>`).join('')}</div></div>`;
}

function annotationPropertyHtml(ann){
  const fonts=[['inherit','跟随图表字体'],['Arial','Arial'],['Times New Roman','Times New Roman'],['Calibri','Calibri'],['Georgia','Georgia'],['Microsoft YaHei','微软雅黑'],['SimSun','宋体'],['SimHei','黑体']];
  let fields='',tip='可直接在图中拖动标注。';
  if(ann.type==='text')fields=annTextField('text','文字内容')+annNumberField('x','水平位置',0,2000,1)+annNumberField('y','垂直位置',0,1400,1)+annSelectField('fontFamily','字体',fonts)+annRangeField('fontSize','字号',8,60,1)+annSelectField('fontWeight','字重',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗'],[700,'粗体']])+annColorField('color','文字颜色')+annColorField('background','文字框底色')+annRangeField('backgroundOpacity','底色透明度',0,1,.05)+annRangeField('padding','内边距',0,30,1)+annColorField('borderColor','边框颜色')+annRangeField('borderWidth','边框粗细',0,6,.1)+annRangeField('cornerRadius','圆角',0,20,1);
  else if(ann.type==='peak')fields=annTextField('customLabel','自定义文字（留空自动）')+annCheckField('showX','显示 X 值')+annCheckField('showY','同时显示 Y 值')+annSelectField('decimals','小数位',[['0','整数'],['1','1 位'],['2','2 位'],['3','3 位']])+annSelectField('guide','辅助虚线',[['none','不显示'],['vertical','垂直到 X 轴'],['horizontal','水平到 Y 轴']])+annNumberField('dx','文字水平偏移',-300,300,1)+annNumberField('dy','文字垂直偏移',-300,300,1)+annSelectField('fontFamily','字体',fonts)+annRangeField('fontSize','字号',8,48,1)+annSelectField('fontWeight','字重',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗'],[700,'粗体']])+annColorField('color','颜色')+annRangeField('width','线宽',.5,5,.1);
  else{fields=annTextField('text','线上文字')+annSelectField('fontFamily','字体',fonts)+annColorField('color','颜色')+annRangeField('width','线宽',.5,6,.1)+annSelectField('dash','线型',[['','实线'],['6 5','虚线'],['2 4','点线'],['10 4 2 4','点划线']])+annCheckField('arrowEnd','显示箭头')+annRangeField('fontSize','文字字号',8,40,1);tip='拖动箭头本体可整体移动；拖动两端圆形手柄可任意改变方向和长度。';}
  return `<div class="object-property-section"><h3>${annotationTypeLabel(ann.type)}设置</h3>${fields}<button id="deleteAnnotation" class="ghost danger wide" type="button">删除此标注</button></div><div class="annotation-drag-tip">${tip}</div>`;
}
function annWrap(k,l,input){const ann=annotationById(currentAnnotationState().selectedAnnotation),v=ann?.[k]??'';return `<div class="field"><label><span>${l}</span><output data-ann-out="${k}">${esc(v)}</output></label>${input}</div>`}
function annTextField(k,l){const ann=annotationById(currentAnnotationState().selectedAnnotation);return annWrap(k,l,`<input data-ann-setting="${k}" type="text" value="${escAttr(ann?.[k]??'')}">`)}
function annNumberField(k,l,min,max,step){const ann=annotationById(currentAnnotationState().selectedAnnotation);return annWrap(k,l,`<input data-ann-setting="${k}" type="number" min="${min}" max="${max}" step="${step}" value="${ann?.[k]??''}">`)}
function annRangeField(k,l,min,max,step){const ann=annotationById(currentAnnotationState().selectedAnnotation);return annWrap(k,l,`<input data-ann-setting="${k}" type="range" min="${min}" max="${max}" step="${step}" value="${ann?.[k]??0}">`)}
function annColorField(k,l){const ann=annotationById(currentAnnotationState().selectedAnnotation);return annWrap(k,l,`<input data-ann-setting="${k}" type="color" value="${ann?.[k]||'#20262b'}">`)}
function annSelectField(k,l,opts){const ann=annotationById(currentAnnotationState().selectedAnnotation),v=ann?.[k]??'';return annWrap(k,l,`<select data-ann-setting="${k}">${opts.map(([x,n])=>`<option value="${x}" ${String(v)===String(x)?'selected':''}>${n}</option>`).join('')}</select>`)}
function annCheckField(k,l){const ann=annotationById(currentAnnotationState().selectedAnnotation);return `<label class="check-row"><input data-ann-setting="${k}" type="checkbox" ${ann?.[k]?'checked':''}>${l}</label>`}

function fieldGroup(items){return items.join('')}
function fieldWrap(label,key,input){return`<div class="field"><label><span>${label}</span><output data-out="${key}">${displaySetting(key)}</output></label>${input}</div>`}
function getSettingValue(k){
  if(k.startsWith('palette:'))return state.chart.palette[Number(k.split(':')[1])];
  if(k.startsWith('legend:'))return state.chart.legend[k.split(':')[1]];
  if(k.startsWith('legendFrame:'))return state.chart.legendFrame[k.split(':')[1]];
  if(k.startsWith('series:')){const [,idx,key]=k.split(':');return getSeriesSetting(Number(idx),key)}
  return state.chart.settings[k]??'';
}
function textField(k,n){return fieldWrap(n,k,`<input data-setting="${k}" type="text" value="${escAttr(getSettingValue(k)??'')}">`)}
function numberField(k,n,min,max,step=1,nullable=false){const v=getSettingValue(k);return fieldWrap(n,k,`<input data-setting="${k}" type="number" ${min!=null?`min="${min}"`:''} ${max!=null?`max="${max}"`:''} step="${step}" value="${v==null&&nullable?'':v??''}" placeholder="自动">`)}
function rangeField(k,n,min,max,step){return fieldWrap(n,k,`<input data-setting="${k}" type="range" min="${min}" max="${max}" step="${step}" value="${getSettingValue(k)}">`)}
function colorField(k,n){const v=getSettingValue(k);return fieldWrap(n,k,`<input data-setting="${k}" type="color" value="${v}">`)}
function selectField(k,n,options){const current=getSettingValue(k);return fieldWrap(n,k,`<select data-setting="${k}">${options.map(([v,l])=>`<option value="${v}" ${String(current)===String(v)?'selected':''}>${l}</option>`).join('')}</select>`)}
function orientationButtonField(k,n){const current=getSettingValue(k)||'horizontal';return `<div class="field"><label><span>${n}</span><output data-out="${k}">${current==='vertical'?'纵向':'横向'}</output></label><div class="orientation-buttons"><button type="button" data-orientation-setting="${k}" data-orientation-value="horizontal" class="${current==='horizontal'?'active':''}">横向</button><button type="button" data-orientation-setting="${k}" data-orientation-value="vertical" class="${current==='vertical'?'active':''}">纵向</button></div></div>`}
function gOrientationButtons(k,l){const current=state.gallery.settings[k]||'horizontal';return `<div class="field"><label><span>${l}</span><output data-gout="${k}">${current==='vertical'?'纵向':'横向'}</output></label><div class="orientation-buttons"><button type="button" data-gorientation="${k}" data-orientation-value="horizontal" class="${current==='horizontal'?'active':''}">横向</button><button type="button" data-gorientation="${k}" data-orientation-value="vertical" class="${current==='vertical'?'active':''}">纵向</button></div></div>`}
function checkField(k,n){return`<label class="check-row"><input data-setting="${k}" type="checkbox" ${getSettingValue(k)?'checked':''}>${n}</label>`}
function numberLegendField(k,n){return fieldWrap(`图例${n}`,`legend:${k}`,`<input data-setting="legend:${k}" type="number" step="1" value="${state.chart.legend[k]}">`)}
function numberLegendFrameField(k,n){return fieldWrap(`边框${n}`,`legendFrame:${k}`,`<input data-setting="legendFrame:${k}" type="number" step="1" value="${state.chart.legendFrame[k]??''}">`)}
function checkLegendFrameField(k,n){return`<label class="check-row"><input data-setting="legendFrame:${k}" type="checkbox" ${state.chart.legendFrame[k]?'checked':''}>${n}</label>`}
function displaySetting(k){return getSettingValue(k)}
function breakPropertyBlock(){const s=state.chart.settings;return `<div class="subhead">真实断轴</div><label class="check-row"><input id="breakFromProp" type="checkbox" ${state.chart.breakAxis?'checked':''}>启用断轴</label><div class="two-col">${numberField('lowerMin','下段最小值',null,null,.01)}${numberField('lowerMax','下段最大值',null,null,.01)}${numberField('upperMin','上段最小值',null,null,.01)}${numberField('upperMax','上段最大值',null,null,.01)}</div>${rangeField('breakGap','两条断裂线间距',6,28,1)}${rangeField('lowerRatio','下段高度比例',.12,.42,.01)}<div class="hint">柱体空白断口与两条平行断裂线中心之间的距离完全一致；断裂线中心直接落在坐标轴端点上。</div>`}
function paletteBlock(){ensurePalette(chartGroups().length);const count=Math.max(6,chartGroups().length);return`<div class="subhead">全部系列配色</div><div class="palette-grid">${state.chart.palette.slice(0,count).map((c,i)=>`<input type="color" data-palette="${i}" value="${c}" title="系列 ${i+1}">`).join('')}</div>`}

function bindPropertyInputs(){
  const applyPropertyInput=el=>{
    const k=el.dataset.setting;let value=el.type==='checkbox'?el.checked:el.value;
    if(el.type==='range'||el.type==='number')value=el.value===''?null:Number(el.value);
    if(k.startsWith('palette:'))state.chart.palette[Number(k.split(':')[1])]=value;
    else if(k.startsWith('legend:'))state.chart.legend[k.split(':')[1]]=value;
    else if(k.startsWith('legendFrame:'))state.chart.legendFrame[k.split(':')[1]]=value;
    else if(k.startsWith('series:')){const [,idx,key]=k.split(':');setSeriesSetting(Number(idx),key,value)}
    else{
      if(k==='canvasWidth'||k==='canvasHeight'){
        const s=state.chart.settings;setCanvasSize(k==='canvasWidth'?value:s.canvasWidth,k==='canvasHeight'?value:s.canvasHeight);s.panelPreset='custom';
      }else{
        state.chart.settings[k]=value;
        if(k==='lineWidth'||k==='markerSize')chartGroups().forEach((_,i)=>setSeriesSetting(i,k,value));
        if(k==='panelPreset')applyCanvasPreset(value);
      }
    }
    if(k==='legendOrientation'){
      state.chart.settings.legendColumns=value==='vertical'?1:Math.max(2,Math.min(chartGroups().length||3,3));
      renderProperties();
    }
    const o=$(`[data-out="${cssEscape(k)}"]`);if(o)o.textContent=value??'';if(k==='letterScheme'||k==='errorType'||k==='postHoc')prepareChartData();renderChart();
  };
  $$('[data-setting]').forEach(el=>{el.addEventListener('input',()=>applyPropertyInput(el));el.addEventListener('change',()=>applyPropertyInput(el))});
  $$('[data-orientation-setting]').forEach(btn=>btn.addEventListener('click',()=>{
    const key=btn.dataset.orientationSetting,value=btn.dataset.orientationValue;state.chart.settings[key]=value;state.chart.settings.legendColumns=value==='vertical'?1:Math.max(2,Math.min(chartGroups().length||3,3));renderProperties();renderChart();
  }));
  $$('[data-palette]').forEach(el=>el.addEventListener('input',()=>{state.chart.palette[Number(el.dataset.palette)]=el.value;renderChart()}));
  $$('[data-marker-shape]').forEach(btn=>btn.addEventListener('click',()=>{setSeriesSetting(Number(btn.dataset.markerSeries),'markerShape',btn.dataset.markerShape);renderChartStudio()}));
  bindCurrentAnnotationInputs();
  const br=$('#breakFromProp');if(br)br.addEventListener('change',()=>{state.chart.breakAxis=br.checked;if(br.checked)autoBreakScale();renderChartStudio()});
  $$('[data-action]').forEach(el=>el.addEventListener('click',()=>{
    const act=el.dataset.action;
    if(act==='save-palette')exportPalette();
    else if(act==='load-palette')$('#paletteFile').click();
    else if(act==='paste-hex')applyHexString(prompt('粘贴一行 HEX（逗号分隔，例：#7B95C6,#49C2D9）：')||'');
    else if(act==='save-style')exportStyle();
    else if(act==='load-style')$('#styleFile').click();
  }));
  $('#paletteFile')?.addEventListener('change',async e=>{const f=e.target.files[0];if(f)await importPalette(f);e.target.value=''});
  $('#styleFile')?.addEventListener('change',async e=>{const f=e.target.files[0];if(f)await importStyle(f);e.target.value=''});
}

function bindCurrentAnnotationInputs(){
  $$('[data-ann-setting]').forEach(el=>{const fn=()=>{const store=currentAnnotationState(),ann=store.annotations.find(a=>a.id===store.selectedAnnotation);if(!ann)return;let v=el.type==='checkbox'?el.checked:el.value;if(['number','range'].includes(el.type))v=Number(v);ann[el.dataset.annSetting]=v;const out=$(`[data-ann-out="${el.dataset.annSetting}"]`);if(out)out.textContent=v;renderChartStudio()};el.addEventListener('input',fn);el.addEventListener('change',fn)});
  $('#deleteAnnotation')?.addEventListener('click',removeSelectedAnnotation);
}

function cleanAnnotationEditorArtifacts(root){root.querySelectorAll('.annotation-endpoint-control,.annotation-edit-handle,.annotation-hit-line').forEach(el=>el.remove());return root}
function exportSvg(){const svg=$('#paperSvg');if(!svg)return;const copy=cleanAnnotationEditorArtifacts(svg.cloneNode(true));copy.setAttribute('xmlns','http://www.w3.org/2000/svg');if(state.chart.settings.tightExport){try{const br=svg.querySelector('rect[data-object="background"]');const prev=br?br.getAttribute('display'):null;if(br)br.setAttribute('display','none');const bb=svg.getBBox();if(br)br.setAttribute('display',prev||'');const pad=8;copy.setAttribute('viewBox',(bb.x-pad)+' '+(bb.y-pad)+' '+(bb.width+2*pad)+' '+(bb.height+2*pad))}catch(_e){}}const name=state.chart.mode==='gallery'?workflowChartLabel(state.workflow.chartType):state.design.metricName;download(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml;charset=utf-8'}),`${safeFile(state.design.experimentName)}_${safeFile(name)}.svg`)}
function exportPng(){
  const svg=$('#paperSvg');if(!svg)return;
  const galleryMode=state.chart.mode==='gallery',W=galleryMode?Number(state.gallery.settings.width):chartDimensions().W,H=galleryMode?Number(state.gallery.settings.height):chartDimensions().H,dpi=galleryMode?Number(state.gallery.settings.dpi||300):Number(state.chart.settings.pngDpi||300),scale=dpi/96;
  let cw=W,ch=H;const copy=cleanAnnotationEditorArtifacts(svg.cloneNode(true));
  if(!galleryMode&&state.chart.settings.tightExport){try{const br=svg.querySelector('rect[data-object="background"]');const prev=br?br.getAttribute('display'):null;if(br)br.setAttribute('display','none');const bb=svg.getBBox();if(br)br.setAttribute('display',prev||'');const pad=8;cw=bb.width+2*pad;ch=bb.height+2*pad;copy.setAttribute('viewBox',(bb.x-pad)+' '+(bb.y-pad)+' '+cw+' '+ch)}catch(_e){}}
  copy.setAttribute('width',cw);copy.setAttribute('height',ch);
  const xml=new XMLSerializer().serializeToString(copy),blob=new Blob([xml],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob),img=new Image();
  img.onload=()=>{const canvas=document.createElement('canvas');canvas.width=Math.round(cw*scale);canvas.height=Math.round(ch*scale);const ctx=canvas.getContext('2d');ctx.fillStyle=galleryMode?state.gallery.settings.background:state.chart.settings.background;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);const name=galleryMode?workflowChartLabel(state.workflow.chartType):state.design.metricName;canvas.toBlob(b=>download(b,`${safeFile(state.design.experimentName)}_${safeFile(name)}_${dpi}dpi.png`),'image/png');URL.revokeObjectURL(url)};img.src=url;
}

function saveProject(){
  const payload={version:'0.9.5',savedAt:new Date().toISOString(),workflow:state.workflow,design:state.design,rawData:state.rawData,gallery:state.gallery,chart:state.chart,figureBoard:state.figureBoard};
  localStorage.setItem('foodlab-project',JSON.stringify(payload));download(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`${safeFile(state.design.experimentName)}_FoodLab项目.json`);toast('项目已保存为 JSON，并同步保存在当前浏览器')
}
function paletteTools(){var st='padding:4px 10px;font-size:12px;cursor:pointer;border:1px solid #c9d2d8;border-radius:4px;background:#f4f7f9';
  return '<div class="subhead">配色与参数管理</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0">'
  +'<button type="button" data-action="save-palette" style="'+st+'">保存配色</button>'
  +'<button type="button" data-action="load-palette" style="'+st+'">导入配色</button>'
  +'<button type="button" data-action="paste-hex" style="'+st+'">粘贴HEX</button>'
  +'<button type="button" data-action="save-style" style="'+st+'">保存此图参数</button>'
  +'<button type="button" data-action="load-style" style="'+st+'">导入图参数</button>'
  +'<input type="file" id="paletteFile" accept=".json" style="display:none"><input type="file" id="styleFile" accept=".json" style="display:none"></div>'}
function paletteButtons(){var st='padding:4px 10px;font-size:12px;cursor:pointer;border:1px solid #c9d2d8;border-radius:4px;background:#f4f7f9';
  return '<div class="subhead">配色管理</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0">'
  +'<button type="button" data-action="save-palette" style="'+st+'">保存配色</button>'
  +'<button type="button" data-action="load-palette" style="'+st+'">导入配色</button>'
  +'<button type="button" data-action="paste-hex" style="'+st+'">粘贴HEX</button>'
  +'<input type="file" id="paletteFile" accept=".json" style="display:none"></div>'
  +'<div class="hint">配色保存后会自动记住，下次打开自动套用；粘贴HEX 支持逗号、空格或换行分隔的 #RRGGBB。</div>'}
function styleButtons(){var st='padding:4px 10px;font-size:12px;cursor:pointer;border:1px solid #c9d2d8;border-radius:4px;background:#f4f7f9';
  return '<div class="subhead">图参数管理</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0">'
  +'<button type="button" data-action="save-style" style="'+st+'">保存此图参数</button>'
  +'<button type="button" data-action="load-style" style="'+st+'">导入图参数</button>'
  +'<input type="file" id="styleFile" accept=".json" style="display:none"></div>'
  +'<div class="hint">把当前图的颜色、坐标、字体、误差棒等参数存成 JSON，下次画同类图直接导入，不用逐个重调。</div>'}
function buildMethodNote(){const s=state.chart.settings;const et=s.errorType||'sd';
  const etxt=et==='se'?'标准误（SEM）':et==='ci'?'95% 置信区间（CI）':'标准差（SD）';
  const pm={duncan:'Duncan',tukey:'Tukey HSD',snk:'S-N-K',lsd:'LSD',bonferroni:'Bonferroni',gameshowell:'Games-Howell'}[s.postHoc]||'Duncan';
  const ltx=s.letterScheme==='twoWay'?'双因素主效应比较（大写字母对应横轴因素、小写对应分组因素，如 Aa、Bb）':'单因素组内比较（每个横轴分组内比较各系列）';
  return '数据以平均值±'+etxt+'表示。采用方差分析（ANOVA）进行多组比较，事后多重比较采用 '+pm+' 法，显著性水平 α=0.05。柱（点）上不同字母表示组间差异显著（P<0.05），相同字母表示差异不显著。本图显著性分析方式：'+ltx+'。';}
function rememberPalette(colors){try{localStorage.setItem('foodlab-last-palette',JSON.stringify(colors))}catch(_e){}}
function exportPalette(){var colors=state.chart.palette.filter(function(c){return typeof c==='string'&&/^#/.test(c)});if(!colors.length){toast('当前没有可用颜色');return}
  var name=prompt('给这套配色起个名字：','我的配色')||'我的配色';rememberPalette(colors);
  download(new Blob([JSON.stringify({type:'foodlab-palette',name:name,colors:colors},null,2)],{type:'application/json'}),safeFile(name)+'_配色.json');toast('配色已保存，并记住为下次默认')}
async function importPalette(file){try{var obj=JSON.parse(await readAsText(file));var colors=Array.isArray(obj)?obj:obj.colors;if(!Array.isArray(colors)||!colors.length)throw new Error('格式不对');
    colors=colors.filter(function(c){return typeof c==='string'}).map(function(c){return /^#/.test(c)?c:'#'+c});if(!colors.length)throw new Error('没有颜色');
    state.chart.palette=colors;ensurePalette(chartGroups().length);rememberPalette(colors);renderProperties();renderChart();toast('配色已导入')}
  catch(err){toast('导入失败：'+(err.message||'格式错误'))}}
function applyHexString(txt){if(!txt||!txt.trim())return;var m=txt.match(/#[0-9a-fA-F]{3,8}/g)||[];var colors=m.map(function(h){h=h.toLowerCase();return h.length===4?'#'+h[1]+h[1]+h[2]+h[2]+h[3]+h[3]:h});
  if(colors.length<2){toast('没识别到颜色，示例：#7B95C6,#49C2D9');return}
  state.chart.palette=colors;ensurePalette(chartGroups().length);rememberPalette(colors);renderProperties();renderChart();toast('已应用 '+colors.length+' 个颜色')}
function exportStyle(){var s=state.chart.settings||{};var payload={type:'foodlab-style',version:1,palette:state.chart.palette.filter(function(c){return typeof c==='string'&&/^#/.test(c)}),settings:Object.assign({},s),legend:Object.assign({},state.chart.legend||{}),legendFrame:Object.assign({},state.chart.legendFrame||{})};
  download(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),'FoodLab_图参数.json');toast('图参数已导出（风格类设置，不含数据）')}
async function importStyle(file){try{var obj=JSON.parse(await readAsText(file));if(obj.type!=='foodlab-style'||!obj.settings)throw new Error('不是图参数文件');
    Object.assign(state.chart.settings,obj.settings);if(Array.isArray(obj.palette)&&obj.palette.length){state.chart.palette=obj.palette;ensurePalette(chartGroups().length)}
    if(obj.legend)Object.assign(state.chart.legend,obj.legend);if(obj.legendFrame)Object.assign(state.chart.legendFrame,obj.legendFrame);
    renderProperties();renderChart();toast('图参数已套用')}
  catch(err){toast('导入失败：'+(err.message||''))}}
function applyLastPalette(){try{var raw=localStorage.getItem('foodlab-last-palette');if(!raw)return;var colors=JSON.parse(raw);if(!Array.isArray(colors)||!colors.length)return;
  state.chart.palette=colors;}catch(_e){}}

function mean(a){return a.reduce((s,v)=>s+v,0)/a.length}function sampleSd(a){if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1))}
function levelIndex(v,arr){const i=arr.indexOf(v);return i<0?999:i}
function logGamma(z){const c=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];if(z<.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);z-=1;let x=.99999999999980993;for(let i=0;i<c.length;i++)x+=c[i]/(z+i+1);const t=z+c.length-.5;return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x)}
function betaCf(a,b,x){const MAX=200,EPS=3e-10,FPMIN=1e-30;let qab=a+b,qap=a+1,qam=a-1,c=1,d=1-qab*x/qap;if(Math.abs(d)<FPMIN)d=FPMIN;d=1/d;let h=d;for(let m=1;m<=MAX;m++){let m2=2*m,aa=m*(b-m)*x/((qam+m2)*(a+m2));d=1+aa*d;if(Math.abs(d)<FPMIN)d=FPMIN;c=1+aa/c;if(Math.abs(c)<FPMIN)c=FPMIN;d=1/d;h*=d*c;aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));d=1+aa*d;if(Math.abs(d)<FPMIN)d=FPMIN;c=1+aa/c;if(Math.abs(c)<FPMIN)c=FPMIN;d=1/d;const del=d*c;h*=del;if(Math.abs(del-1)<EPS)break}return h}
function regIncompleteBeta(x,a,b){if(x<=0)return 0;if(x>=1)return 1;const bt=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log(1-x));return x<(a+1)/(a+b+2)?bt*betaCf(a,b,x)/a:1-bt*betaCf(b,a,1-x)/b}
function fSurvival(F,df1,df2){if(!Number.isFinite(F)||F<0)return NaN;const x=df2/(df2+df1*F);return clamp(regIncompleteBeta(x,df2/2,df1/2),0,1)}
function tCdf(t,df){if(t===0)return .5;const x=df/(df+t*t),ib=regIncompleteBeta(x,df/2,.5);return t>0?1-.5*ib:.5*ib}
function tQuantile(target,df){let lo=-12,hi=12;for(let i=0;i<44;i++){const m=(lo+hi)/2;if(tCdf(m,df)<target)lo=m;else hi=m}return(lo+hi)/2}
function srTrap(x0,x1,N,f){const h=(x1-x0)/N;let z=.5*(f(x0)+f(x1));for(let i=1;i<N;i++)z+=f(x0+i*h);return z*h}
function srNcdf(x){const sg=x<0?-1:1,a=Math.abs(x)/Math.SQRT2,t=1/(1+0.3275911*a);
 const p=(((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t);
 return .5*(1+sg*(1-p*Math.exp(-a*a)))}
function srRangeProb(k,r){if(r<=0)return 0;return srTrap(-6,6,150,x=>{const pdf=Math.exp(-x*x/2)/2.50662827463;return k*pdf*Math.pow(srNcdf(x+r)-srNcdf(x),k-1)})}
const SR_QCACHE=new Map();
function srQuantile(k,df,target){
 const key=k+'|'+df+'|'+(+target.toFixed(5));if(SR_QCACHE.has(key))return SR_QCACHE.get(key);
 const cdf=q=>{if(!isFinite(df)||df>2000)return srRangeProb(k,q);
  const C=Math.pow(df,df/2)/(Math.pow(2,df/2-1)*Math.exp(logGamma(df/2))),B2=df<6?9:6,N=df<6?110:80;
  return srTrap(1e-4,B2,N,u=>C*Math.pow(u,df-1)*Math.exp(-df*u*u/2)*srRangeProb(k,q*u))};
 let lo=0,hi=12;for(let i=0;i<26;i++){const m=(lo+hi)/2;if(cdf(m)<target)lo=m;else hi=m}
 const q=(lo+hi)/2;SR_QCACHE.set(key,q);return q}
function tCritical975(df){if(!Number.isFinite(df)||df<=0)return 1.96;let lo=0,hi=20;for(let i=0;i<70;i++){const mid=(lo+hi)/2;if(tCdf(mid,df)<.975)lo=mid;else hi=mid}return(lo+hi)/2}
function erfApprox(x){const sign=x<0?-1:1,a=Math.abs(x),t=1/(1+.3275911*a),y=1-(((((1.061405429*t-1.453152027)*t+1.421413741)*t-.284496736)*t+.254829592)*t)*Math.exp(-a*a);return sign*y}
function normalCdf(x){return .5*(1+erfApprox(x/Math.SQRT2))}
function gammaSeries(a,x){let sum=1/a,del=sum,ap=a;for(let n=1;n<=200;n++){ap++;del*=x/ap;sum+=del;if(Math.abs(del)<Math.abs(sum)*3e-10)break}return sum*Math.exp(-x+a*Math.log(x)-logGamma(a))}
function gammaContinuedFraction(a,x){const FPMIN=1e-30;let b=x+1-a,c=1/FPMIN,d=1/b,h=d;for(let i=1;i<=200;i++){const an=-i*(i-a);b+=2;d=an*d+b;if(Math.abs(d)<FPMIN)d=FPMIN;c=b+an/c;if(Math.abs(c)<FPMIN)c=FPMIN;d=1/d;const del=d*c;h*=del;if(Math.abs(del-1)<3e-10)break}return Math.exp(-x+a*Math.log(x)-logGamma(a))*h}
function chiSquareSurvival(x,df){if(!(x>=0)||!(df>0))return NaN;const a=df/2,z=x/2;return clamp(z<a+1?1-gammaSeries(a,z):gammaContinuedFraction(a,z),0,1)}
function averageRanks(values){const indexed=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),ranks=Array(values.length),ties=[];for(let i=0;i<indexed.length;){let j=i+1;while(j<indexed.length&&indexed[j].v===indexed[i].v)j++;const rank=(i+1+j)/2;for(let k=i;k<j;k++)ranks[indexed[k].i]=rank;if(j-i>1)ties.push(j-i);i=j}return{ranks,ties}}
function holmAdjust(items){const sorted=items.map((x,i)=>({i,p:clamp(Number(x.pRaw??x.p),0,1)})).sort((a,b)=>a.p-b.p);let prev=0;sorted.forEach((x,rank)=>{const adj=Math.max(prev,Math.min(1,(sorted.length-rank)*x.p));items[x.i].pAdjusted=adj;items[x.i].p=adj;prev=adj});return items}
function starsForP(p){return p<.001?'***':p<.01?'**':p<.05?'*':'ns'}
function welchAnova(groups){
  const usable=groups.filter(g=>g.n>1),k=usable.length;if(k<2)return null;
  const weighted=usable.map(g=>{const variance=sampleSd(g.values)**2;return{...g,variance,w:g.n/Math.max(variance,1e-12)}}),W=weighted.reduce((s,g)=>s+g.w,0),mw=weighted.reduce((s,g)=>s+g.w*g.mean,0)/W;
  const A=weighted.reduce((s,g)=>s+g.w*(g.mean-mw)**2,0)/(k-1),term=weighted.reduce((s,g)=>s+((1-g.w/W)**2)/(g.n-1),0),den=1+2*(k-2)/(k*k-1)*term,F=A/den,df1=k-1,df2=(k*k-1)/(3*term),p=fSurvival(F,df1,df2);
  return{kind:'welch',methodName:'Welch ANOVA',groups:weighted,pMain:p,statistic:F,statName:'F',df1,df2,rows:[{source:'组间（Welch）',ss:null,df:df1,ms:null,F,p},{source:'近似误差自由度',ss:null,df:df2,ms:null,F:null,p:null}]};
}
function welchPairwise(groups){const out=[];for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){const a=groups[i],b=groups[j],va=sampleSd(a.values)**2,vb=sampleSd(b.values)**2,se=Math.sqrt(va/a.n+vb/b.n),t=se?Math.abs(a.mean-b.mean)/se:Infinity,df=(va/a.n+vb/b.n)**2/(((va/a.n)**2)/(a.n-1||1)+((vb/b.n)**2)/(b.n-1||1)),pRaw=Number.isFinite(t)?clamp(2*(1-tCdf(t,df)),0,1):0;out.push({i,j,a:a.label,b:b.label,meanDiff:a.mean-b.mean,t,df,pRaw,p:pRaw})}holmAdjust(out);out.forEach(x=>x.stars=starsForP(x.p));return out}
function kruskalWallis(groups){
  const values=[],owners=[];groups.forEach((g,gi)=>g.values.forEach(v=>{values.push(v);owners.push(gi)}));const N=values.length,k=groups.length;if(k<2||N<3)return null;const {ranks,ties}=averageRanks(values),rankSums=Array(k).fill(0);ranks.forEach((r,i)=>rankSums[owners[i]]+=r);let H=12/(N*(N+1))*groups.reduce((s,g,i)=>s+rankSums[i]**2/g.n,0)-3*(N+1);const tieC=1-ties.reduce((s,t)=>s+(t**3-t),0)/(N**3-N||1);H/=Math.max(tieC,1e-12);const df1=k-1,p=chiSquareSurvival(H,df1);return{kind:'kruskal',methodName:'Kruskal–Wallis',groups,pMain:p,statistic:H,statName:'H',df1,df2:null,rows:[{source:'Kruskal–Wallis',ss:null,df:df1,ms:null,F:H,p}]};
}
function mannWhitneyPairwise(groups){const out=[];for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){const a=groups[i],b=groups[j],values=[...a.values,...b.values],{ranks,ties}=averageRanks(values),R1=ranks.slice(0,a.n).reduce((s,v)=>s+v,0),U1=R1-a.n*(a.n+1)/2,U2=a.n*b.n-U1,U=Math.min(U1,U2),N=a.n+b.n,meanU=a.n*b.n/2,tieTerm=ties.reduce((s,t)=>s+t**3-t,0),variance=a.n*b.n/12*((N+1)-tieTerm/(N*(N-1)||1)),z=variance>0?(Math.abs(U-meanU)-.5)/Math.sqrt(variance):0,pRaw=clamp(2*(1-normalCdf(Math.abs(z))),0,1);out.push({i,j,a:a.label,b:b.label,meanDiff:a.mean-b.mean,U,z,pRaw,p:pRaw})}holmAdjust(out);out.forEach(x=>x.stars=starsForP(x.p));return out}
function lettersFromPairwise(groups,pairs){const labels=groups.map(g=>g.label),sig=Array.from({length:labels.length},()=>Array(labels.length).fill(false));pairs.forEach(r=>{if(r.p<.05)sig[r.i][r.j]=sig[r.j][r.i]=true});const sorted=groups.map((g,i)=>({...g,original:i})).sort((a,b)=>b.mean-a.mean),sortedSig=sorted.map(a=>sorted.map(b=>sig[a.original][b.original]));return compactLetterDisplay(sorted.map(g=>g.label),sortedSig)}
function runUnivariateInference(rows){
  const mapped=rows.map(r=>({a:r.Group,value:r.Value})),base=oneWayAnova(mapped,'a'),groups=base.groups,method=state.gallery.settings.statMethod;
  if(method==='welchHolm'){const omnibus=welchAnova(groups),pairwise=welchPairwise(groups);return{anova:omnibus,pairwise,letters:lettersFromPairwise(groups,pairwise),methodName:statisticalMethodLabel(method)}}
  if(method==='kruskalHolm'){const omnibus=kruskalWallis(groups),pairwise=mannWhitneyPairwise(groups);return{anova:omnibus,pairwise,letters:lettersFromPairwise(groups,pairwise),methodName:statisticalMethodLabel(method)}}
  const pairwise=fisherLsdPairwise(base.groups,base.mse,base.dfError);return{anova:base,pairwise,letters:lettersForComparisons(base.groups.map(g=>({label:g.label,mean:g.mean,n:g.n})),base.mse,base.dfError),methodName:statisticalMethodLabel('anovaLsd')};
}


function makeTicks(min,max,step,count=6){
  if(!(max>min))return[min];let st=Number(step);if(!(st>0))st=niceStep((max-min)/(count-1));const start=Math.ceil((min-1e-10)/st)*st,end=Math.floor((max+1e-10)/st)*st,t=[];for(let v=start,n=0;v<=end+st*1e-8&&n<30;v+=st,n++)t.push(Number(v.toPrecision(12)));if(t.length<2)return[min,max];return t;
}
function niceStep(raw){const exp=Math.floor(Math.log10(Math.abs(raw)||1)),f=raw/10**exp,n=f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10;return n*10**exp}
function niceFloor(v){const st=niceStep(Math.abs(v||1)/5);return Math.floor(v/st)*st}function niceCeil(v){const st=niceStep(Math.abs(v||1)/5);return Math.ceil(v/st)*st}
function formatTick(v){const a=Math.abs(v);return a>=100?formatNumber(v,0):a>=10?formatNumber(v,1):a>=1?formatNumber(v,2):formatNumber(v,3)}

/* ===== v0.17.0 axis scales: linear / log10 =====
 * A log axis only changes how value becomes pixel position:
 *   linear: (v-min)/(max-min)
 *   log:    (log v - log min)/(log max - log min)
 * Statistics, error bars and exported numbers keep working on raw values.
 */
const SUP_DIGITS='⁰¹²³⁴⁵⁶⁷⁸⁹';
function superscriptNumber(n){return String(n).split('').map(c=>c==='-'?'⁻':(SUP_DIGITS[Number(c)]??c)).join('')}
function formatLogTick(v){const n=Number(v);if(!Number.isFinite(n)||n<=0)return String(v);const e=Math.round(Math.log10(n));if(Math.abs(10**e-n)<=Math.abs(n)*1e-9){if(e<=-4||e>=4)return `10${superscriptNumber(e)}`;return String(Number(n.toPrecision(12)))}return formatTick(n)}
function isPowerOfTen(v){const n=Number(v);if(!Number.isFinite(n)||n<=0)return false;const e=Math.round(Math.log10(n));return Math.abs(10**e-n)<=Math.abs(n)*1e-9}
// Decade ticks spanning [min,max], thinned out when the span is very wide.
function logTicksWithin(min,max,maxTicks=9){const lo=Number(min),hi=Number(max);if(!(hi>lo&&lo>0))return[lo];const e0=Math.floor(Math.log10(lo)),e1=Math.ceil(Math.log10(hi)),all=[];for(let e=e0;e<=e1;e++)all.push(10**e);const stride=Math.max(1,Math.ceil(all.length/Math.max(2,maxTicks)));return stride>1?all.filter((_,i)=>i%stride===0):all}
// Log axes cannot show 0 or negatives: log(0) is -Infinity.
function axisLogUnusableValues(values){return(values||[]).filter(v=>{const n=Number(v);return !Number.isFinite(n)||n<=0})}
function axisLogBlockReason(values){
  if(!values||!values.length)return '当前没有可用于判断的数据';
  const bad=axisLogUnusableValues(values);if(!bad.length)return '';
  if(bad.some(v=>Number(v)===0))return '数据中包含 0，对数轴无法显示（log 0 无定义）';
  return '数据中包含负数或空值，对数轴无法显示';
}
function axisLogExtent(values,minOverride,maxOverride){
  const positive=(values||[]).map(Number).filter(v=>Number.isFinite(v)&&v>0);
  if(!positive.length)return null;
  const dmin=Math.min(...positive),dmax=Math.max(...positive);
  let lo=Number.isFinite(Number(minOverride))&&Number(minOverride)>0?Number(minOverride):10**Math.floor(Math.log10(dmin));
  let hi=Number.isFinite(Number(maxOverride))&&Number(maxOverride)>0?Number(maxOverride):10**Math.ceil(Math.log10(dmax));
  if(!(hi>lo))hi=lo*10;
  return{min:lo,max:hi};
}
// Read a "刻度间隔" field that may be empty (= automatic) or a string.
function axisStepFromSetting(raw){if(raw===null||raw===undefined||String(raw).trim()==='')return null;const n=Number(raw);return Number.isFinite(n)&&n>0?n:null}
function formatNumber(v,d=3){const n=Number(v);if(!Number.isFinite(n))return'—';if(Number(d)<=0)return Math.round(n).toString();return n.toFixed(d).replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1')}
function formatP(p){if(!Number.isFinite(p))return'—';if(p<.001)return'<0.001';return p.toFixed(3)}function formatPText(p){return`p ${p<.001?'< 0.001':`= ${p.toFixed(3)}`}`}
function darken(hex,amount=.2){const h=hex.replace('#','');if(h.length!==6)return hex;const n=parseInt(h,16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;return'#'+[r,g,b].map(v=>Math.round(v*(1-amount)).toString(16).padStart(2,'0')).join('')}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1200)}
function csvCell(v){const s=String(v??'');return/[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function safeFile(s){return String(s||'FoodLab').replace(/[\\/:*?"<>|]/g,'_').trim()||'FoodLab'}
function toast(text,duration){const el=$('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),duration||1900)}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function escAttr(s){return esc(s)}
function cssEscape(s){return String(s).replace(/([:\.])/g,'\\$1')}

// ===== v0.5.0 通用图表库：模板、初步分析与首批通用图形 =====
const GALLERY_SCHEMAS={
  univariate:{name:'单变量长表',columns:['Group','Value'],description:'每行一个原始观测值。Group 可用于多组叠加或比较；只有一组时也保留 Group 列。'},
  xy:{name:'XY 关系长表',columns:['Group','X','Y','Size'],description:'X、Y 为两个连续变量；Size 仅气泡图使用，普通散点图可以留空。'},
  composition:{name:'组成数据长表',columns:['Category','Component','Value','Error'],description:'Category 为横坐标类别，Component 为类别内部组成；Error 为误差（SD/SE），用于堆叠图的误差棒，可留空；饼图可将 Category 全部填写为 Overall。'},
  matrix:{name:'多指标矩阵',columns:['Group','Moisture','pH','TBARS','Color_a','Texture'],description:'每行一个样本，每个数值指标占一列。用于相关性热图，并为后续 PCA、HCA 共用。'},
  radar:{name:'雷达图宽表',columns:['Group','Indicator 1','Indicator 2','Indicator 3','…'],description:'第一列始终是分组名 / 样品名，第一行其余列都是测得指标。导入时会自动把宽表转为雷达图数据；也兼容旧版 Group-Indicator-Value 长表。'}
};

const GALLERY_CHARTS=[
  {id:'hist',category:'数据分布',name:'直方图',schema:'univariate',desc:'观察连续数据的频数或概率密度分布，可按组叠加。'},
  {id:'kde',category:'数据分布',name:'核密度图 KDE',schema:'univariate',desc:'以平滑密度曲线显示分布形态、偏态和多峰特征。'},
  {id:'box',category:'数据分布',name:'箱线图',schema:'univariate',desc:'展示中位数、四分位数、须线与异常值，可叠加原始散点。'},
  {id:'violin',category:'数据分布',name:'小提琴图',schema:'univariate',desc:'结合核密度和箱线统计，同时观察分布形状与分位数。'},
  {id:'scatter',category:'变量关系',name:'散点图',schema:'xy',desc:'分析两个连续变量的关系，可显示 Pearson 相关与线性回归。'},
  {id:'bubble',category:'变量关系',name:'气泡图',schema:'xy',desc:'用 X、Y 和气泡大小同时表达三个变量。'},
  {id:'stacked',category:'组间比较',name:'堆叠条形图',schema:'composition',desc:'展示各类别内部组分构成，可切换原始值或百分比。'},
  {id:'pie',category:'组成比例',name:'饼图 / 圆环图',schema:'composition',desc:'展示少量组分占比。学术论文中应谨慎使用。'},
  {id:'heatmap',category:'多指标关系',name:'相关性热力图',schema:'matrix',desc:'计算数值指标的 Pearson 相关矩阵，并用色阶展示。'},
  {id:'radar',category:'综合评价',name:'雷达图',schema:'radar',desc:'同步比较多项感官或理化指标，可进行组内归一化。'}
];
const GALLERY_GOALS=[
  {id:'dist',name:'看一组数据的分布',desc:'查看偏态、多峰、离群值或分布宽窄。',recommend:[{kind:'gallery',id:'box',reason:'最适合查看中位数、四分位数和异常值。'},{kind:'gallery',id:'violin',reason:'样本量较多时同时展示密度与分位数。'},{kind:'gallery',id:'hist',reason:'需要看频数分布和分箱时使用。'},{kind:'gallery',id:'kde',reason:'需要更平滑地观察分布形态时使用。'}]},
  {id:'compare',name:'比较不同处理组',desc:'看组间差异、离散程度和均值比较。',recommend:[{kind:'gallery',id:'box',reason:'优先推荐，信息量比柱状图更高。'},{kind:'gallery',id:'violin',reason:'适合样本量较多或想看分布形态时使用。'},{kind:'route',id:'bar',name:'分组柱状图',schema:'3平行×技术重复模板',reason:'均值±SD/SE 与显著性字母的常规论文图。'}]},
  {id:'trend',name:'看时间/浓度变化趋势',desc:'适用于储藏时间、处理浓度、温度变化等连续趋势。',recommend:[{kind:'route',id:'line',name:'折线图 / 误差棒折线图',schema:'3平行×技术重复模板',reason:'食品论文中最常见的动态变化图。'},{kind:'route',id:'curve',name:'平滑曲线图',schema:'连续趋势数据',reason:'数据点较密时用平滑曲线表达整体趋势。'},{kind:'route',id:'bar',name:'分组柱状图',schema:'3平行×技术重复模板',reason:'如果更想强调离散时点比较，也可用柱状图。'}]},
  {id:'relation',name:'分析变量之间的关系',desc:'看两个或多个指标是否相关。',recommend:[{kind:'gallery',id:'scatter',reason:'两个连续变量关系的首选图。'},{kind:'gallery',id:'bubble',reason:'需要同时表达第三个变量时使用。'},{kind:'gallery',id:'heatmap',reason:'要同时查看多个指标相关性矩阵时使用。'}]},
  {id:'multi',name:'做综合评价或样本区分',desc:'多个指标共同分析样本差异与综合表现。',recommend:[{kind:'gallery',id:'radar',reason:'多指标综合展示，适合感官或理化综合评价。'},{kind:'gallery',id:'heatmap',reason:'多个指标的高低模式与相关关系。'},{kind:'view',id:'multivar',name:'PCA / PLS-DA',schema:'多指标矩阵',reason:'需要更正式的多元统计区分样本时进入高级分析。'},{kind:'view',id:'cluster',name:'HCA / 热图',schema:'多指标矩阵',reason:'查看样品或指标的聚类关系。'}]},
  {id:'composition',name:'看组分构成或占比',desc:'比较配方、组分或构成比例。',recommend:[{kind:'gallery',id:'stacked',reason:'论文中优先使用堆叠条形图展示组分构成。'},{kind:'gallery',id:'pie',reason:'仅类别较少时可用，学术论文谨慎使用。'}]}
];

function bindGallery(){
  $('#galleryDownloadXlsx')?.addEventListener('click',downloadGalleryXlsx);
  $('#galleryDownloadCsv')?.addEventListener('click',downloadGalleryCsv);
  $('#galleryLoadDemo')?.addEventListener('click',loadGalleryDemo);
  $('#galleryChooseFile')?.addEventListener('click',()=>$('#galleryFileInput').click());
  $('#galleryFileInput')?.addEventListener('change',e=>{if(e.target.files[0])handleGalleryFile(e.target.files[0])});
  $('#galleryClearData')?.addEventListener('click',()=>{state.gallery.rows=[];state.gallery.analysis=null;state.gallery.sourceName='';renderGallery()});
  $('#galleryExportSvg')?.addEventListener('click',exportGallerySvg);
  $('#galleryExportPng')?.addEventListener('click',exportGalleryPng);
  $('#galleryShowAll')?.addEventListener('click',()=>{state.gallery.showAll=!state.gallery.showAll;renderGallery()});
  $('#galleryOpenStudio')?.addEventListener('click',()=>{state.workflow.goal=state.gallery.goal;setWorkflowChart(state.gallery.type,{keepData:true});state.chart.mode='gallery';showView('chart')});
}

function galleryDef(){return GALLERY_CHARTS.find(x=>x.id===state.gallery.type)||GALLERY_CHARTS[2]}
function gallerySchema(){return GALLERY_SCHEMAS[galleryDef().schema]}
// v0.21.0: stacked bar templates, the inline editor and the preview table all
// use this wide layout (one row per category). v0.22.0 dropped the Total
// helper column per user request; a Total column in imported data is still
// recognised and never parsed into a component segment.
function compositionWideHeaders(){
  return ['Category','Component 1','Component 2','Component 3','Component 4','Component 5'];
}
function inlineEditorColumns(){
  if(galleryDef().id!=='stacked')return gallerySchema().columns;
  const comps=[...new Set(state.gallery.rows.map(r=>r.Component))].filter(Boolean);
  // Wide layout: reuse the real component names when data already exists,
  // otherwise fall back to the template's Component 1..N headers. No Total.
  return comps.length?['Category',...comps]:compositionWideHeaders();
}
function galleryGoal(){return GALLERY_GOALS.find(x=>x.id===state.gallery.goal)||GALLERY_GOALS[1]}
function galleryRecommendations(){return galleryGoal().recommend}
function matchesGoal(chartId){return galleryRecommendations().some(x=>x.kind==='gallery'&&x.id===chartId)}

function renderGallery(){
  if(!$('#galleryChartList'))return;
  const goal=galleryGoal();
  $('#galleryShowAll').textContent=state.gallery.showAll?'只看推荐图形':'显示全部图形';
  $('#galleryGoalChips').innerHTML=GALLERY_GOALS.map(g=>`<button class="goal-chip ${state.gallery.goal===g.id?'active':''}" data-gallery-goal="${g.id}"><b>${esc(g.name)}</b><span>${esc(g.desc)}</span></button>`).join('');
  $$('[data-gallery-goal]').forEach(btn=>btn.addEventListener('click',()=>{state.gallery.goal=btn.dataset.galleryGoal;state.gallery.showAll=false;const rec=galleryRecommendations().find(x=>x.kind==='gallery'); if(rec){state.gallery.type=rec.id; resetGallerySettings();} renderGallery()}));
  $('#galleryRecommendList').innerHTML=galleryRecommendations().map(item=>{
    const name=item.kind==='gallery'?(GALLERY_CHARTS.find(x=>x.id===item.id)?.name||item.id):item.name;
    const schema=item.kind==='gallery'?(GALLERY_SCHEMAS[(GALLERY_CHARTS.find(x=>x.id===item.id)||{}).schema]?.name||''):(item.schema||'');
    const badge=item.kind==='gallery'?'推荐图形':item.kind==='route'?'已有实验图':'高级分析';
    return `<div class="recommend-card ${item.kind}"><span class="recommend-badge">${badge}</span><h3>${esc(name)}</h3><p>${esc(item.reason)}</p><small>${esc(schema)}</small><div class="recommend-actions">${item.kind==='gallery'?`<button class="primary" data-gallery-type="${item.id}">选择此图</button>`:item.kind==='route'?`<button class="primary" data-route-chart="${item.id}">进入绘图</button>`:`<button class="secondary" data-route-view="${item.id}">打开模块</button>`}</div></div>`;
  }).join('');
  const categories=[...new Set(GALLERY_CHARTS.map(x=>x.category))];
  const filtered=state.gallery.showAll?GALLERY_CHARTS:GALLERY_CHARTS.filter(x=>matchesGoal(x.id));
  $('#galleryChartList').innerHTML=categories.map(cat=>{
    const items=filtered.filter(x=>x.category===cat);
    if(!items.length)return '';
    return `<div class="gallery-category"><b>${esc(cat)}</b>${items.map(x=>`<button data-gallery-type="${x.id}" class="gallery-chart-button ${state.gallery.type===x.id?'active':''}"><span>${esc(x.name)}</span><small>${esc(GALLERY_SCHEMAS[x.schema].name)}</small></button>`).join('')}</div>`;
  }).join('')+`<div class="gallery-category"><b>已有实验图</b><button data-route-chart="line" class="gallery-chart-button"><span>折线图 / 误差线图</span><small>3平行×技术重复模板</small></button><button data-route-chart="curve" class="gallery-chart-button"><span>平滑曲线图</span><small>连续趋势数据</small></button><button data-route-chart="bar" class="gallery-chart-button"><span>分组柱状图</span><small>ANOVA 与显著性字母</small></button></div>`;
  $$('[data-gallery-type]').forEach(btn=>btn.addEventListener('click',()=>{state.gallery.type=btn.dataset.galleryType;state.workflow.goal=state.gallery.goal;setWorkflowChart(btn.dataset.galleryType);resetGallerySettings();renderGallery()}));
  $$('[data-route-chart]').forEach(btn=>btn.addEventListener('click',()=>{state.workflow.goal=state.gallery.goal;setWorkflowChart(btn.dataset.routeChart,{keepData:true});const has=state.rawData.length;if(has)showView('chart');else{toast('请先在数据导入步骤加载当前项目模板。');showView('data')}}));
  $$('[data-route-view]').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.routeView)));
  const def=galleryDef(),schema=gallerySchema();
  $('#galleryCategory').textContent=def.category;
  $('#galleryTitle').textContent=def.name;
  $('#galleryDescription').textContent=def.desc;
  $('#gallerySchemaBadge').textContent=schema.name;
  $('#galleryTemplateDescription').textContent=schema.description;
  $('#galleryColumnChips').innerHTML=schema.columns.map(c=>`<span>${esc(c)}</span>`).join('');
  $('#galleryDataStatus').textContent=state.gallery.rows.length?`${state.gallery.sourceName||'数据'} · ${state.gallery.rows.length} 行`:'尚未导入数据';
  analyzeGalleryData();
  renderGalleryAnalysis();
  renderGallerySettings();
  renderGalleryChart();
}

function resetGallerySettings(){
  const def=galleryDef(),s=state.gallery.settings;
  s.title=def.name;s.titleVisible=true;s.subtitle='';s.subtitleEnabled=false;s.xTitle=def.schema==='xy'?'X':def.schema==='composition'?'Category':'';s.yTitle=def.schema==='xy'?'Y':def.schema==='univariate'?'Value':def.id==='stacked'?'Value':'';
  s.normalize=false;s.donut=false;s.orientation='vertical';s.showRegression=true;s.showCorrelation=true;s.heatmapShowValues=true;if(def.id==='radar'){s.title='Radar chart';s.titleVisible=false;s.legendOrientation='horizontal';s.legendColumns=3;s.legendX=78;s.legendY=45;s.radarFill=false;s.radarShowMarkers=true;s.radarLevels=4;s.radarMin='auto';s.radarMax='auto';s.radarLabelOffset=32;s.radarShowTickLabels=true;s.radarTickDecimals=0;s.radarTickLabelSize=11;s.radarTickLabelPosition='top';s.radarTickLabelOffset=10;s.radarTheme='rose';s.radarGradientMode='radial';s.radarGridColor='#c8aebc';s.radarSpokeColor='#9e8794';s.radarGridWidth=.9;s.radarSpokeWidth=1.15;s.radarBandMode='theme-gradient';s.radarSmartHighlight=true;s.radarHighlightThreshold=0;s.radarHighlightStrength=.24;}s.heatmapCluster='none';s.heatmapShowDendrogram=false;state.gallery.seriesStyles={};state.gallery.selected=def.id==='radar'?'radar-grid':'title';state.gallery.selectedSeries=0;
}

function galleryTemplateRows(type=state.gallery.type){
  if(['hist','kde','box','violin'].includes(type))return [
    {Group:'Control',Value:5.42},{Group:'Control',Value:5.55},{Group:'Control',Value:5.61},
    {Group:'Treatment A',Value:5.74},{Group:'Treatment A',Value:5.81},{Group:'Treatment A',Value:5.88},
    {Group:'Treatment B',Value:5.63},{Group:'Treatment B',Value:5.70},{Group:'Treatment B',Value:5.76}
  ];
  if(['scatter','bubble'].includes(type))return Array.from({length:15},(_,i)=>({Group:i<8?'Control':'Treatment',X:Number((1+i*.45).toFixed(2)),Y:Number((2.1+i*.34+(i%3-.8)*.18).toFixed(2)),Size:type==='bubble'?20+(i%5)*12:''}));
  if(type==='stacked')return [
    {Category:'0 d',Component:'Protein',Value:22,Error:1.4},{Category:'0 d',Component:'Fat',Value:12,Error:1.1},{Category:'0 d',Component:'Moisture',Value:66,Error:2.2},
    {Category:'5 d',Component:'Protein',Value:23,Error:1.6},{Category:'5 d',Component:'Fat',Value:13,Error:1.2},{Category:'5 d',Component:'Moisture',Value:64,Error:2.5},
    {Category:'10 d',Component:'Protein',Value:24,Error:1.5},{Category:'10 d',Component:'Fat',Value:14,Error:1.3},{Category:'10 d',Component:'Moisture',Value:62,Error:2.0}
  ];
  if(type==='pie')return [{Category:'Overall',Component:'Protein',Value:22},{Category:'Overall',Component:'Fat',Value:14},{Category:'Overall',Component:'Moisture',Value:60},{Category:'Overall',Component:'Ash',Value:4}];
  if(type==='heatmap')return Array.from({length:12},(_,i)=>({Group:i<6?'Control':'Treatment',Moisture:Number((72-i*.35+(i%2)*.2).toFixed(2)),pH:Number((5.55+i*.035).toFixed(2)),TBARS:Number((.21+i*.045).toFixed(3)),Color_a:Number((12.2-i*.25).toFixed(2)),Texture:Number((34+i*1.8).toFixed(2))}));
  if(type==='radar')return [
    {Group:'Control',Color:6.2,Aroma:6.5,Taste:5.8,Tenderness:6.7,Juiciness:6.1,'Overall acceptability':6.3},
    {Group:'Treatment A',Color:7.5,Aroma:7.2,Taste:7.0,Tenderness:7.8,Juiciness:7.4,'Overall acceptability':7.6},
    {Group:'Treatment B',Color:8.1,Aroma:7.9,Taste:7.7,Tenderness:8.3,Juiciness:8.0,'Overall acceptability':8.2}
  ];
  return [];
}

function downloadGalleryXlsx(){
  if(!window.XLSX){downloadGalleryCsv();toast('Excel 组件未加载，已下载 CSV 模板');return}
  const def=galleryDef(),schema=gallerySchema(),wb=XLSX.utils.book_new();
  let ws,guide;
  if(def.id==='radar'){
    const rows=galleryTemplateRows();
    const headers=Object.keys(rows[0]||{Group:'Sample','Indicator 1':'','Indicator 2':''});
    ws=XLSX.utils.json_to_sheet(rows,{header:headers});
    ws['!cols']=headers.map(c=>({wch:Math.max(14,String(c).length+4)}));
    guide=XLSX.utils.aoa_to_sheet([
      ['FoodLab Studio Chart Template'],['Chart type','Radar chart'],['Template structure','The first column contains group or sample names. Every remaining header in the first row is a measured variable.'],['Entry rule','Enter values directly in the wide table. FoodLab automatically treats the first column as Group and converts every numeric column into a radar dimension.'],
      ['Compatibility','Legacy Group / Indicator / Value long tables are still supported.'],['Numeric columns','Use numeric values only; missing values may be left blank.'],['Group column','Keep group names consistent and avoid extra spaces.']
    ]);
  }else{
    const empty=galleryTemplateRows().map(r=>Object.fromEntries(schema.columns.map(c=>[c,r[c]??''])));
    ws=XLSX.utils.json_to_sheet(empty,{header:schema.columns});
    ws['!cols']=schema.columns.map(c=>({wch:Math.max(13,c.length+4)}));
    guide=XLSX.utils.aoa_to_sheet([
      ['FoodLab Studio Chart Template'],['Chart type',workflowChartEnglishLabel(def.id)],['Template structure',gallerySchemaEnglishName(def.schema)],['Entry rule','Enter raw observations. FoodLab also accepts common wide-table layouts when the first column identifies the group, category, sample, or X variable.'],['Error bars','Stacked bars read the Error column (long table) or a wide-table Error total column.'],
      ['Important','Do not place mean ± SD in a single numeric cell.'],['Numeric columns','Use numeric values only; missing values may be left blank.'],['Grouping','Keep group names consistent and avoid extra spaces.']
    ]);
  }
  // v0.21.0: stacked bars are exported as a wide table; this replaces the
  // generic long-table template generated above.
  if(def.id==='stacked'){
    const headers=compositionWideHeaders();
    ws=XLSX.utils.aoa_to_sheet([headers,headers.map(()=>'')]);
    ws['!cols']=headers.map(c=>({wch:Math.max(13,c.length+4)}));
    guide=XLSX.utils.aoa_to_sheet([
      ['FoodLab Studio Chart Template'],['Chart type','Stacked bar chart'],['Template structure','Composition wide table'],['Entry rule','One row per category. Component 1–5 columns hold the raw value of each component.'],
      ['Compatibility','Legacy Category / Component / Value long tables are still supported; a helper Total column is never plotted.'],['Numeric columns','Use numeric values only; missing values may be left blank.'],['Category column','Keep category names consistent and avoid extra spaces.']
    ]);
  }
  guide['!cols']=[{wch:18},{wch:85}];
  XLSX.utils.book_append_sheet(wb,ws,'Data');XLSX.utils.book_append_sheet(wb,guide,'Instructions');
  XLSX.writeFile(wb,`FoodLab_${safeFile(workflowChartEnglishLabel(def.id))}_${safeFile(gallerySchemaEnglishName(def.schema))}.xlsx`);toast('图表模板已生成');
}
function downloadGalleryCsv(){
  const def=galleryDef(),schema=gallerySchema(),rows=galleryTemplateRows(),headers=def.id==='radar'?Object.keys(rows[0]||{Group:'Sample'}):(def.id==='stacked'?compositionWideHeaders():schema.columns);
  // v0.21.0: the stacked template is wide (one row per category); rows here are
  // long-table sample data, so only the header (plus one empty row) is written.
  const body=def.id==='stacked'?[headers.map(()=>'')]:rows.map(r=>headers.map(c=>r[c]??''));
  const csv='\ufeff'+[headers,...body].map(row=>row.map(csvCell).join(',')).join('\r\n');
  download(new Blob([csv],{type:'text/csv;charset=utf-8'}),`FoodLab_${safeFile(workflowChartEnglishLabel(def.id))}_template.csv`);toast('CSV 模板已生成');
}
function loadGalleryDemo(){state.gallery.rows=galleryTemplateRows();state.gallery.sourceName='内置示例';renderGallery();toast('已载入示例数据')}

async function handleGalleryFile(file){
  try{
    let rows;if(/\.(csv|tsv)$/i.test(file.name))rows=parseDelimited(await file.text());else{
      if(!window.XLSX)throw new Error('Excel 组件未加载');const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
    }
    const normalized=normalizeGalleryRows(rows,galleryDef().schema);if(!normalized.length)throw new Error('没有读取到符合模板的有效数据');
    state.gallery.rows=normalized;state.gallery.sourceName=file.name;renderGallery();toast(`已导入 ${normalized.length} 行数据`);
  }catch(err){toast(err.message||'数据导入失败')}
}
function pickAlias(row,aliases){const keys=Object.keys(row);for(const a of aliases){const key=keys.find(k=>String(k).trim().toLowerCase()===a.toLowerCase());if(key!=null)return row[key]}return''}
function numOrNull(v){if(v==null||String(v).trim()==='')return null;const n=Number(String(v).trim());return Number.isFinite(n)?n:null}
function normalizeGalleryRows(rows,schema){
  const textKey=(k)=>String(k??'').trim();
  const firstKey=(r)=>Object.keys(r||{})[0];
  if(schema==='radar'){
    const out=[];
    rows.forEach((r,i)=>{
      const group=String(pickAlias(r,['Group','Sample','Sample name','Treatment','Condition','组别','处理','分组','样品','样品名','样本','样本名'])||'').trim();
      const indicator=String(pickAlias(r,['Indicator','Variable','Metric','指标','变量'])||'').trim();
      const longValue=numOrNull(pickAlias(r,['Value','Score','Measurement','数值','评分','值']));
      if(group&&indicator&&longValue!=null){out.push({Group:group,Indicator:indicator,Value:longValue});return;}
    });
    if(out.length)return out.filter(r=>r.Group&&r.Indicator&&r.Value!=null);
    const keys=Object.keys(rows[0]||{});
    if(rows.length>keys.length){
      const indCol=keys[0],groups=keys.slice(1);
      rows.forEach(r=>{const ind=String(r[indCol]??'').trim();groups.forEach(g=>{const v=numOrNull(r[g]);if(ind&&v!=null)out.push({Group:textKey(g),Indicator:ind,Value:v})})});
    }else{
      rows.forEach((r,i)=>{const gKey=keys.find(k=>['group','sample','sample name','treatment','condition','组别','处理','分组','样品','样品名','样本','样本名'].includes(textKey(k).toLowerCase()))||firstKey(r);const gName=String(r[gKey]??`Group ${i+1}`).trim();keys.forEach(k=>{if(k===gKey)return;const v=numOrNull(r[k]);if(v!=null)out.push({Group:gName,Indicator:textKey(k),Value:v})})});
    }
    return out.filter(r=>r.Group&&r.Indicator&&r.Value!=null);
  }
  if(schema==='univariate'){
    const out=[];
    rows.forEach((r,i)=>{
      const val=numOrNull(pickAlias(r,['Value','Measurement','Result','数值','测定值','值']));
      if(val!=null){out.push({SampleID:String(pickAlias(r,['SampleID','Sample','ID','样品编号','样本编号'])||`S${i+1}`),Group:String(pickAlias(r,['Group','Treatment','Condition','组别','分组','处理'])||'All'),Value:val});return;}
      const keys=Object.keys(r||{}),gKey=keys.find(k=>['group','treatment','condition','sample','sample name','组别','分组','处理','样品','样本'].includes(textKey(k).toLowerCase()))||firstKey(r),g=String(r[gKey]??`Group ${i+1}`).trim();
      keys.forEach(k=>{if(k===gKey)return;const v=numOrNull(r[k]);if(v!=null)out.push({SampleID:`${g}-${textKey(k)}`,Group:g,Value:v})});
    });return out;
  }
  if(schema==='composition'){
    const out=[];
    rows.forEach((r,i)=>{
      const v=numOrNull(pickAlias(r,['Value','Amount','Percent','数值','含量','比例'])),comp=String(pickAlias(r,['Component','Composition','组分','成分','系列'])||'').trim();
      if(comp&&v!=null){out.push({Category:String(pickAlias(r,['Category','Sample','Time','Condition','类别','时间','横坐标'])||'Overall'),Component:comp,Value:v,Error:numOrNull(pickAlias(r,['Error','SD','SE','Std','StdDev','误差','标准差','标准误']))});return;}
      const keys=Object.keys(r||{}),cKey=keys.find(k=>['category','sample','time','condition','类别','时间','横坐标'].includes(textKey(k).toLowerCase()))||firstKey(r),cat=String(r[cKey]??`Category ${i+1}`).trim();
      // v0.21.0: wide-table composition data (Category + Component 1..N + Total).
      // Every numeric column becomes a component except the Category column and
      // the Total column (合计/总量/总计/sum) which is a helper sum, never a
      // segment. Blank header columns are ignored too.
      const errorKey=keys.find(k=>['error','sd','se','std','stddev','误差','标准差','标准误'].includes(textKey(k).toLowerCase())),rowError=errorKey?numOrNull(r[errorKey]):null;
      keys.forEach(k=>{if(k===cKey||k===errorKey)return;const kk=textKey(k);if(!kk)return;if(['total','合计','总量','总和','总计','sum'].includes(kk.toLowerCase()))return;const n=numOrNull(r[k]);if(n!=null)out.push({Category:cat,Component:kk,Value:n,totalError:rowError})});
    });return out;
  }
  if(schema==='xy'){
    const out=[];
    rows.forEach((r,i)=>{
      const x=numOrNull(pickAlias(r,['X','Time','Wavelength','Concentration','Temperature','x','变量X','横坐标'])),y=numOrNull(pickAlias(r,['Y','Value','Response','y','变量Y','纵坐标']));
      if(x!=null&&y!=null){out.push({SampleID:String(pickAlias(r,['SampleID','Sample','ID','样品编号','样本编号'])||`S${i+1}`),Group:String(pickAlias(r,['Group','Treatment','Condition','组别','分组','处理'])||'All'),X:x,Y:y,Size:numOrNull(pickAlias(r,['Size','Bubble size','气泡大小','大小']))});return;}
      const keys=Object.keys(r||{}),xKey=keys.find(k=>['x','time','wavelength','concentration','temperature','变量x','横坐标'].includes(textKey(k).toLowerCase()))||firstKey(r),xv=numOrNull(r[xKey]);if(xv==null)return;
      keys.forEach(k=>{if(k===xKey)return;const yv=numOrNull(r[k]);if(yv!=null)out.push({SampleID:`S${i+1}-${textKey(k)}`,Group:textKey(k),X:xv,Y:yv,Size:null})});
    });return out;
  }
  return rows.map((r,i)=>{
    const out={SampleID:String(pickAlias(r,['SampleID','Sample','ID','样品编号','样本编号'])||`S${i+1}`),Group:String(pickAlias(r,['Group','Treatment','Condition','组别','分组','处理'])||'All')};Object.keys(r).forEach(k=>{if(!['sampleid','sample','id','样品编号','样本编号','group','treatment','condition','组别','分组','处理'].includes(textKey(k).toLowerCase())){const n=numOrNull(r[k]);if(n!=null)out[textKey(k)]=n}});return out;
  }).filter(r=>Object.keys(r).some(k=>!['SampleID','Group'].includes(k)&&Number.isFinite(r[k])));
}

function analyzeGalleryData(){
  const rows=state.gallery.rows,def=galleryDef();if(!rows.length){state.gallery.analysis=null;return}
  if(def.schema==='univariate')state.gallery.analysis=analyzeUnivariate(rows);
  else if(def.schema==='xy')state.gallery.analysis=analyzeXY(rows);
  else if(def.schema==='composition')state.gallery.analysis=analyzeComposition(rows);
  else if(def.schema==='matrix')state.gallery.analysis=analyzeMatrix(rows);
  else state.gallery.analysis=analyzeRadar(rows);
}
function groupValues(rows,key='Group'){const map=new Map();rows.forEach(r=>{const k=String(r[key]||'All');if(!map.has(k))map.set(k,[]);map.get(k).push(r)});return map}
function quantile(values,p){return quantileByMethod(values,p,'linear7')}
function quantileByMethod(values,p,method='linear7'){
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y),n=a.length;if(!n)return NaN;if(n===1)return a[0];
  if(method==='exclusive'){
    const h=(n+1)*p;if(h<=1)return a[0];if(h>=n)return a[n-1];const i=Math.floor(h)-1,f=h-Math.floor(h);return a[i]+(a[i+1]-a[i])*f;
  }
  if(method==='tukey'){
    if(p===.5)return medianBySorted(a);const mid=Math.floor(n/2),lower=a.slice(0,mid),upper=a.slice(n%2?mid+1:mid);return p<.5?medianBySorted(lower):medianBySorted(upper);
  }
  const h=(n-1)*p,i=Math.floor(h),f=h-i;return a[i]+(a[Math.min(i+1,n-1)]-a[i])*f;
}
function medianBySorted(a){const n=a.length;if(!n)return NaN;const m=Math.floor(n/2);return n%2?a[m]:(a[m-1]+a[m])/2}
function median(values){return quantileByMethod(values,.5,'linear7')}
function boxMethodLabels(){
  const s=state.gallery.settings;
  const q={linear7:'线性插值（R type 7 / Excel QUARTILE.INC）',tukey:'Tukey hinges（上下半区中位数）',exclusive:'排除端点插值（Excel QUARTILE.EXC）'}[s.boxQuartileMethod]||s.boxQuartileMethod;
  const w={iqr15:'1.5×IQR',iqr30:'3×IQR',minmax:'最小值–最大值',percentile:`${s.boxWhiskerPercentile||5}–${100-(s.boxWhiskerPercentile||5)}百分位`}[s.boxWhiskerMethod]||s.boxWhiskerMethod;
  return{quartile:q,whisker:w};
}
function statisticalMethodLabel(method=state.gallery.settings.statMethod){return({anovaLsd:'单因素 ANOVA + Fisher LSD',welchHolm:'Welch ANOVA + Welch t 检验（Holm校正）',kruskalHolm:'Kruskal–Wallis + Mann–Whitney U（Holm校正）'}[method]||method)}
function correlationMethodLabel(method=state.gallery.settings.correlationMethod){return method==='spearman'?'Spearman 秩相关':'Pearson 线性相关'}
function analyzeUnivariate(rows){
  const s=state.gallery.settings,groups=groupValues(rows),table=[];
  groups.forEach((rs,g)=>{
    const v=rs.map(r=>r.Value),st=boxStats(v);
    table.push({Group:g,n:v.length,Mean:mean(v),SD:sampleSd(v),Median:st.q2,Q1:st.q1,Q3:st.q3,WhiskerLow:st.low,WhiskerHigh:st.high,Min:Math.min(...v),Max:Math.max(...v),Outliers:st.out.length});
  });
  const all=rows.map(r=>r.Value),highest=table.reduce((a,b)=>a.Mean>b.Mean?a:b),lowest=table.reduce((a,b)=>a.Mean<b.Mean?a:b);
  let anova=null,pairwise=[],letters={},methodName='—';
  if(groups.size>1){const result=runUnivariateInference(rows);anova=result.anova;pairwise=result.pairwise;letters=result.letters;methodName=result.methodName}
  const sigCount=pairwise.filter(x=>x.p<.05).length,method=boxMethodLabels(),omnibus=anova?`${anova.methodName||methodName} ${anova.pMain<.05?'检出':'未检出'}总体组间差异（${formatPText(anova.pMain)}）`:'未执行组间检验',pairText=pairwise.length?`；${methodName} 中有 ${sigCount} 组两两比较达到校正后 p<0.05` : '';
  return {kind:'univariate',table,anova,pairwise,letters,methodName,boxMethod:method,summary:[['有效观测',all.length],['组别数',table.length],['总体均值',formatNumber(mean(all),3)],['总体检验 p',anova?formatP(anova.pMain):'—']],text:`共分析 ${all.length} 个原始观测，包含 ${table.length} 个组。${table.length>1?`${highest.Group} 的均值最高，${lowest.Group} 的均值最低。`:''} ${omnibus}${pairText}。箱线图四分位数采用“${method.quartile}”，须线采用“${method.whisker}”。`};
}

function fisherLsdPairwise(groups,mse,df){
  if(!Number.isFinite(mse)||mse<0||!Number.isFinite(df)||df<=0)return[];const out=[];
  for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
    const a=groups[i],b=groups[j],se=Math.sqrt(mse*(1/a.n+1/b.n)),t=se?Math.abs(a.mean-b.mean)/se:Infinity,p=Number.isFinite(t)?clamp(2*(1-tCdf(t,df)),0,1):0;
    out.push({i,j,a:a.label,b:b.label,meanDiff:a.mean-b.mean,t,p,stars:p<.001?'***':p<.01?'**':p<.05?'*':'ns'});
  }
  return out;
}
function pearson(x,y){const mx=mean(x),my=mean(y),num=x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0),dx=Math.sqrt(x.reduce((s,v)=>s+(v-mx)**2,0)),dy=Math.sqrt(y.reduce((s,v)=>s+(v-my)**2,0));return dx&&dy?num/(dx*dy):NaN}
function spearman(x,y){const rx=averageRanks(x).ranks,ry=averageRanks(y).ranks;return pearson(rx,ry)}
function regression(x,y){const mx=mean(x),my=mean(y),ssx=x.reduce((s,v)=>s+(v-mx)**2,0),sxy=x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0),slope=ssx?sxy/ssx:0,intercept=my-slope*mx,r=pearson(x,y);return{slope,intercept,r,r2:r*r}}
function analyzeXY(rows){
  const method=state.gallery.settings.correlationMethod||'pearson',corrFn=method==='spearman'?spearman:pearson,label=correlationMethodLabel(method),table=[];
  groupValues(rows).forEach((rs,g)=>{const x=rs.map(r=>r.X),y=rs.map(r=>r.Y),m=regression(x,y),r=corrFn(x,y);table.push({Group:g,n:rs.length,Correlation:r,Method:label,Slope:m.slope,Intercept:m.intercept,R2:m.r2})});
  const x=rows.map(r=>r.X),y=rows.map(r=>r.Y),m=regression(x,y),association=corrFn(x,y);return{kind:'xy',table,overall:{...m,association,method,label},summary:[['有效样本',rows.length],['组别数',table.length],[`总体 ${method==='spearman'?'Spearman ρ':'Pearson r'}`,formatNumber(association,3)],['线性回归 R²',formatNumber(m.r2,3)]],text:`总体${label}系数为 ${formatNumber(association,3)}；线性拟合模型 R² 为 ${formatNumber(m.r2,3)}。相关方法和回归模型是两个不同设置，相关不等同于因果关系。`}
}

function analyzeComposition(rows){
  const cats=groupValues(rows,'Category'),table=[];cats.forEach((rs,c)=>{const total=rs.reduce((s,r)=>s+r.Value,0);rs.forEach(r=>table.push({Category:c,Component:r.Component,Value:r.Value,Percent:total?r.Value/total*100:0}));});return{kind:'composition',table,summary:[['类别数',cats.size],['组分数',new Set(rows.map(r=>r.Component)).size],['数据行',rows.length],['总量',formatNumber(rows.reduce((s,r)=>s+r.Value,0),3)]],text:'已按每个类别计算组分总量与百分比。百分比堆叠图和饼图会自动使用类别内部占比。'}}
function analyzeMatrix(rows){
  const method=state.gallery.settings.correlationMethod||'pearson',corrFn=method==='spearman'?spearman:pearson,label=correlationMethodLabel(method),vars=[...new Set(rows.flatMap(r=>Object.keys(r).filter(k=>!['SampleID','Group'].includes(k)&&Number.isFinite(r[k]))))],corr={};
  vars.forEach(a=>{corr[a]={};vars.forEach(b=>{const pairs=rows.filter(r=>Number.isFinite(r[a])&&Number.isFinite(r[b]));corr[a][b]=pairs.length>1?corrFn(pairs.map(r=>r[a]),pairs.map(r=>r[b])):NaN})});return{kind:'matrix',vars,corr,method,label,summary:[['样本数',rows.length],['数值指标',vars.length],['组别数',new Set(rows.map(r=>r.Group)).size],['相关方法',label]],text:`已对 ${vars.length} 个数值指标计算${label}矩阵。强相关并不自动代表指标之间存在直接机制关系。`}
}

function analyzeRadar(rows){
  const groups=[...new Set(rows.map(r=>r.Group))],indicators=[...new Set(rows.map(r=>r.Indicator))];
  const table=groups.map(g=>({Group:g,Indicators:rows.filter(r=>r.Group===g).length,Mean:mean(rows.filter(r=>r.Group===g).map(r=>r.Value))}));
  const ranges=Object.fromEntries(indicators.map(ind=>{const vals=rows.filter(r=>r.Indicator===ind).map(r=>r.Value).filter(Number.isFinite);return[ind,{min:Math.min(...vals),max:Math.max(...vals)}]}));
  const leaders=indicators.map(ind=>{
    const vals=groups.map(g=>({group:g,value:(rows.find(r=>r.Group===g&&r.Indicator===ind)||{}).Value})).filter(x=>Number.isFinite(x.value)).sort((a,b)=>b.value-a.value);
    const top=vals[0],second=vals[1];
    return {Indicator:ind,Leader:top?.group||'—',Top:top?.value??NaN,Gap:(top&&second)?top.value-second.value:NaN};
  });
  return{kind:'radar',summary:[['组别数',groups.length],['指标数',indicators.length],['数据行',rows.length],['归一化',state.gallery.settings.normalize?'已开启':'未开启']],table,leaders,ranges,text:'雷达图适合综合展示多个指标。当前模板默认第一列为分组名、第一行为各测得指标；导入时会自动识别宽表。若各指标单位或量纲不同，应开启归一化后再比较形状。'}
}

function renderGalleryAnalysis(){
  const a=state.gallery.analysis;if(!a){$('#gallerySummaryCards').innerHTML='';$('#galleryAnalysisTable').innerHTML='<tbody><tr><td class="empty-row">导入模板数据后显示初步分析</td></tr></tbody>';$('#galleryInterpretation').className='interpretation empty';$('#galleryInterpretation').textContent='暂无可解释结果。';return}
  $('#gallerySummaryCards').innerHTML=a.summary.map(([k,v])=>`<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  let table=a.table;if(a.kind==='matrix')table=a.vars.map(v=>({Indicator:v,...Object.fromEntries(a.vars.map(w=>[w,a.corr[v][w]]))}));
  if(table?.length){const headers=Object.keys(table[0]);$('#galleryAnalysisTable').innerHTML=`<thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${table.map(r=>`<tr>${headers.map(h=>`<td>${typeof r[h]==='number'?formatNumber(r[h],3):esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody>`}else $('#galleryAnalysisTable').innerHTML='';
  $('#galleryInterpretation').className='interpretation';$('#galleryInterpretation').textContent=a.text;
}

function renderGallerySettings(){
  const s=state.gallery.settings,def=galleryDef();
  const common=`<div class="subhead">图题与字体</div>${gText('title','图题')}${gText('xTitle','X轴标题')}${gText('yTitle','Y轴标题')}${gSelect('font','字体',[['Arial','Arial'],['Times New Roman','Times New Roman'],['Microsoft YaHei','微软雅黑'],['SimSun','宋体']])}${gRange('fontSize','字号',9,24,1)}${gSelect('fontWeight','字重',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗'],[700,'粗体']])}<div class="subhead">坐标与画布</div>${gRange('axisWidth','坐标轴粗细',.6,3,.1)}${gCheck('frame','显示完整边框')}${gNumber('width','画布宽度',500,1400,10)}${gNumber('height','画布高度',400,1000,10)}${gSelect('dpi','PNG清晰度',[[96,'96 dpi'],[150,'150 dpi'],[300,'300 dpi'],[600,'600 dpi']])}<div class="subhead">配色与图例</div>${gSelect('colorScheme','配色',[['foodchem','Food Chemistry'],['meatsci','Meat Science'],['nature','Nature-style'],['mono','黑白打印']])}${gCheck('legend','显示图例')}`;
  let specific='';
  if(def.id==='hist')specific=gRange('bins','分箱数量',4,30,1)+gRange('opacity','柱透明度',.2,1,.05);
  if(def.id==='kde')specific=gNumber('bandwidth','带宽（0=自动）',0,100,.01)+gRange('lineWidth','曲线粗细',.8,5,.1)+gRange('opacity','填充透明度',0,1,.05);
  if(['box','violin'].includes(def.id))specific=gCheck('showPoints','叠加原始散点')+gCheck('showMean','显示均值')+gRange('pointSize','散点大小',1,9,.5)+gRange('opacity','填充透明度',.2,1,.05);
  if(['scatter','bubble'].includes(def.id))specific=gRange('pointSize','点大小',1,10,.5)+gRange('opacity','点透明度',.2,1,.05)+gCheck('showRegression','显示线性拟合')+gCheck('showCorrelation','显示相关系数');
  if(def.id==='stacked')specific=gCheck('normalize','百分比堆叠')+gSelect('orientation','方向',[['vertical','纵向'],['horizontal','横向']])+gCheck('stackedShowError','显示误差棒（Error 列）')+gCheck('stackedShowValue','在每段内标注数值')+gRange('stackedValueSize','数值字号',8,24,1)+gRange('stackedValueDecimals','数值小数位',0,4,1)+gRange('stackedErrorWidth','误差棒粗细',.5,4,.1)+gRange('stackedErrorCapWidth','误差棒端线宽',1,10,.5);
  if(def.id==='pie')specific=gCheck('donut','圆环图');
  if(def.id==='heatmap')specific=gCheck('showCorrelation','显示相关系数数字');
  if(def.id==='radar')specific=gCheck('normalize','按指标0–1归一化')+gCheck('radarShowMarkers','显示节点')+gSelect('radarTheme','雷达色系',Object.entries(RADAR_THEMES).map(([k,v])=>[k,v.name]))+gSelect('radarGradientMode','渐变方向',[['radial','中心→外圈'],['left-right','左→右'],['right-left','右→左'],['top-bottom','上→下'],['bottom-top','下→上'],['diag-down','左上→右下'],['diag-up','左下→右上']])+gRange('radarLabelOffset','标签距离',8,70,1);
  $('#gallerySettings').innerHTML=common+`<div class="subhead">当前图形</div>`+specific;
  $$('[data-gsetting]').forEach(el=>el.addEventListener('input',()=>{let v=el.type==='checkbox'?el.checked:el.value;if(['range','number'].includes(el.type))v=Number(v);state.gallery.settings[el.dataset.gsetting]=v;if(el.dataset.gsetting==='colorScheme')state.gallery.palette=[...(templates[v]?.colors||templates.foodchem.colors)];if(el.dataset.gsetting==='radarTheme')applyRadarTheme(v);analyzeGalleryData();renderGalleryAnalysis();renderGalleryChart();const out=$(`[data-gout="${el.dataset.gsetting}"]`);if(out)out.textContent=v}));
}
function gWrap(label,key,input){return`<div class="field"><label><span>${label}</span><output data-gout="${key}">${esc(state.gallery.settings[key])}</output></label>${input}</div>`}
function gText(k,l){return gWrap(l,k,`<input data-gsetting="${k}" type="text" value="${escAttr(state.gallery.settings[k])}">`)}
function gNumber(k,l,min,max,step){return gWrap(l,k,`<input data-gsetting="${k}" type="number" min="${min}" max="${max}" step="${step}" value="${state.gallery.settings[k]}">`)}
function gRange(k,l,min,max,step){return gWrap(l,k,`<input data-gsetting="${k}" type="range" min="${min}" max="${max}" step="${step}" value="${state.gallery.settings[k]}">`)}
function gSelect(k,l,opts){return gWrap(l,k,`<select data-gsetting="${k}">${opts.map(([v,n])=>`<option value="${v}" ${String(state.gallery.settings[k])===String(v)?'selected':''}>${n}</option>`).join('')}</select>`)}
function gCheck(k,l){return`<label class="check-row"><input data-gsetting="${k}" type="checkbox" ${state.gallery.settings[k]?'checked':''}>${l}</label>`}

function galleryFontStack(){
  const s=state.gallery.settings,en=String(s.fontEnglish||'Arial').replace(/'/g,"\\'"),zh=String(s.fontChinese||'Microsoft YaHei').replace(/'/g,"\\'");return `'${en}','${zh}',sans-serif`;
}
function gallerySvgMarkup(svgId='gallerySvg',interactive=false){
  const s=state.gallery.settings,def=galleryDef(),W=clamp(Number(s.width)||980,500,1800),H=clamp(Number(s.height)||660,400,1200),font=galleryFontStack();
  const titleX=s.titleX??W/2,titleY=s.titleY??38,subtitleX=s.subtitleX??W/2,subtitleY=s.subtitleY??58;
  let body='';
  if(def.id==='hist')body=galleryHistogram(W,H);else if(def.id==='kde')body=galleryKde(W,H);else if(def.id==='box')body=galleryBox(W,H,false);else if(def.id==='violin')body=galleryBox(W,H,true);
  else if(def.id==='scatter'||def.id==='bubble')body=galleryScatter(W,H,def.id==='bubble');else if(def.id==='stacked')body=galleryStacked(W,H);else if(def.id==='pie')body=galleryPie(W,H);
  else if(def.id==='heatmap')body=galleryHeatmap(W,H);else if(def.id==='radar')body=galleryRadar(W,H);
  const cls=interactive?'chart-object':'';
  const shadow=`<filter id="galleryLegendShadow" x="-40%" y="-40%" width="190%" height="200%"><feDropShadow dx="${s.legendShadowX}" dy="${s.legendShadowY}" stdDeviation="${s.legendShadowBlur}" flood-color="#263238" flood-opacity="${s.legendShadowOpacity}"/></filter><marker id="chartAnnotationArrow" markerWidth="9" markerHeight="9" refX="7.2" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,7 L8,3.5 z" fill="context-stroke"/></marker>`;
  const title=s.titleVisible&&s.title?`<text data-gobject="title" data-gdrag="title" class="${cls} draggable" x="${titleX}" y="${titleY}" text-anchor="middle" font-size="${s.titleSize}" font-weight="${s.titleWeight}" fill="${s.titleColor}">${esc(s.title)}</text>`:'';
  const subtitle=s.subtitleEnabled&&s.subtitle?`<text data-gobject="subtitle" data-gdrag="subtitle" class="${cls} draggable" x="${subtitleX}" y="${subtitleY}" text-anchor="middle" font-size="${s.subtitleSize}" font-weight="${s.subtitleWeight}" fill="${s.subtitleColor}">${esc(s.subtitle)}</text>`:'';
  const methodNote=galleryMethodNoteSvg(W,H,interactive);
  const annotations=renderGalleryAnnotations(W,H,interactive);
  return `<svg id="${svgId}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="font-family:${escAttr(font)};background:${s.background}"><defs>${shadow}</defs><rect data-gobject="background" class="${cls}" width="${W}" height="${H}" fill="${s.background}"/>${title}${subtitle}${body}${methodNote}${annotations}</svg>`;
}
function galleryMethodNoteText(){
  const type=state.gallery.type,s=state.gallery.settings;
  if(['box','violin'].includes(type)){const m=boxMethodLabels();return `四分位：${m.quartile}；须线：${m.whisker}；检验：${statisticalMethodLabel(s.statMethod)}`}
  if(['scatter','bubble'].includes(type))return `相关：${correlationMethodLabel(s.correlationMethod)}；拟合：普通最小二乘线性回归`;
  if(type==='heatmap')return `相关矩阵：${correlationMethodLabel(s.correlationMethod)}`;
  return '';
}
function galleryMethodNoteSvg(W,H,interactive=false){
  const s=state.gallery.settings,text=galleryMethodNoteText();if(!s.methodNoteVisible||!text)return'';const x=s.methodNoteX??(W-24),y=s.methodNoteY??(H-10),cls=interactive?'chart-object method-note draggable':'method-note';return `<text data-gobject="method-note" data-gdrag="methodNote" class="${cls}" x="${x}" y="${y}" text-anchor="end" font-size="${s.methodNoteSize}" fill="${s.methodNoteColor}">${esc(text)}</text>`;
}
function renderGalleryChart(){
  const stage=$('#galleryStage'),s=state.gallery.settings;if(!state.gallery.rows.length){stage.innerHTML='<div class="gallery-empty"><b>等待数据</b><span>下载匹配模板，填写并导入后即可绘图。</span></div>';$('#galleryChartMeta').textContent='';return}
  stage.innerHTML=gallerySvgMarkup('gallerySvg',false);$('#galleryChartMeta').textContent=`${s.width} × ${s.height} px · ${s.dpi} dpi`;
}
function galleryPlotBox(W,H){const top=state.gallery.settings.subtitleEnabled&&state.gallery.settings.subtitle?82:68;return{l:88,r:48,t:top,b:88,w:W-136,h:H-top-88}}
// v0.23.0: x tick label rotation, shared by every gallery chart with a
// category/numeric x axis (commonAxes and the stacked renderers). Auto mode
// tilts labels to −45° when the category slots get too narrow for the font;
// turning it off makes the manual angle and the staggered rows take effect.
function galleryXTickRotation(s,count,width){
  const manual=Number(s.xTickRotation)||0;
  if(manual!==0)return manual;
  if(s.xTickAutoRotate!==false){
    const slot=width/Math.max(1,count),need=Math.max(46,(Number(s.xTickSize)||12)*3);
    if(count>3&&slot<need)return -45;
  }
  return 0;
}
function scaleLinear(a,b,c,d){return v=>c+(v-a)/(b-a||1)*(d-c)}
// v0.23.0: broken Y axis for every gallery chart that uses a numeric Y.
// Returns {map,ticks} when 真实断轴 is on and the four bounds are valid,
// otherwise null. Renderers keep using the returned map for bars, points,
// error bars and letters, so everything follows the break automatically.
function galleryBrokenY(min,max,p){
  const s=state.gallery.settings;
  if(!s.breakAxis)return null;
  const loMin=Number(s.lowerMin),loMax=Number(s.lowerMax),hiMin=Number(s.upperMin),hiMax=Number(s.upperMax);
  if(![loMin,loMax,hiMin,hiMax].every(Number.isFinite))return null;
  if(!(loMax>loMin&&hiMax>hiMin&&hiMin>loMax))return null;
  const gap=Math.max(2,Number(s.breakGap)||10),ratio=clamp(Number(s.lowerRatio)||.3,.12,.42);
  const usable=Math.max(10,p.h-gap),loH=usable*ratio,hiH=usable*(1-ratio);
  const map=v=>{
    const n=Number(v);
    if(n<=loMax)return p.t+p.h-(n-loMin)/(loMax-loMin)*loH;
    if(n>=hiMin)return p.t+hiH-(n-hiMin)/(hiMax-hiMin)*hiH;
    return p.t+loH+gap/2;
  };
  return{map,ticks:[...makeTicks(loMin,loMax,null,5),...makeTicks(hiMin,hiMax,null,5)]};
}
function commonAxes(W,H,p,xTicks,yTicks,xMap,yMap,axisLog){
  const s=state.gallery.settings,axis=s.axisColor||'#20262b',frame=s.frameColor||axis,sw=s.axisWidth||1.2,fw=s.frameWidth||sw;
  const xTitleX=s.xTitleX??(p.l+p.w/2),xTitleY=s.xTitleY??(H-24),yTitleX=s.yTitleX??28,yTitleY=s.yTitleY??(p.t+p.h/2),xTick=s.xTickSize||12,yTick=s.yTickSize||12;
  let out='';
  if(s.frameMode!=='none'){
    out+=`<g data-gobject="axis-y" class="chart-object" fill="none" stroke="${axis}" stroke-width="${sw}"><path d="M${p.l},${p.t} V${p.t+p.h}"/></g><g data-gobject="axis-x" class="chart-object" fill="none" stroke="${axis}" stroke-width="${sw}"><path d="M${p.l},${p.t+p.h} H${p.l+p.w}"/></g>`;
    if(s.frameMode==='lbr'||s.frameMode==='box')out+=`<g data-gobject="frame" class="chart-object" fill="none" stroke="${frame}" stroke-width="${fw}"><path d="M${p.l+p.w},${p.t} V${p.t+p.h}"/></g>`;
    if(s.frameMode==='box')out+=`<g data-gobject="frame" class="chart-object" fill="none" stroke="${frame}" stroke-width="${fw}"><path d="M${p.l},${p.t} H${p.l+p.w}"/></g>`;
  }
  yTicks.forEach(v=>{const y=yMap(v);out+=`<g data-gobject="axis-y" class="chart-object">${s.showYTicks?`<line x1="${p.l-s.tickLength}" x2="${p.l}" y1="${y}" y2="${y}" stroke="${axis}" stroke-width="${sw}"/>`:''}<text x="${p.l-s.tickLength-4}" y="${y+4}" text-anchor="end" font-size="${yTick}" font-weight="${s.yTickWeight}" fill="${s.yTickColor}">${axisLog&&axisLog.y?formatLogTick(v):formatTick(v)}</text></g>`});
  // v0.23.0: broken-axis notch on both ends of the Y axis (and the right frame
  // when present). The break line is centred on the gap between the two halves.
  if(s.breakAxis&&Number.isFinite(Number(s.lowerMax))&&Number.isFinite(Number(s.upperMin))&&Number(s.upperMin)>Number(s.lowerMax)){
    const gap=Math.max(2,Number(s.breakGap)||10),ratio=clamp(Number(s.lowerRatio)||.3,.12,.42);
    const yc=p.t+(p.h-gap)*ratio+gap/2;
    out+=`<g data-gobject="axis-break" class="chart-object" stroke="${axis}" stroke-width="${sw}" fill="none"><path d="M${p.l-8},${yc-4} l8,8 M${p.l+p.w-8},${yc-4} l8,8"/></g>`;
  }
  xTicks.forEach((v,i)=>{
    const x=xMap(v,i);
    const rot=galleryXTickRotation(s,xTicks.length,p.w);
    const dy=(!s.xTickAutoRotate&&s.xTickStagger&&rot===0?(i%2)*14:0);
    const anchor=rot<0?'end':rot>0?'start':'middle';
    const yy=p.t+p.h+s.tickLength+16+dy;
    out+=`<g data-gobject="axis-x" class="chart-object">${s.showXTicks?`<line x1="${x}" x2="${x}" y1="${p.t+p.h}" y2="${p.t+p.h+s.tickLength}" stroke="${axis}" stroke-width="${sw}"/>`:''}<text x="${x}" y="${yy}" text-anchor="${anchor}" font-size="${xTick}" font-weight="${s.xTickWeight}" fill="${s.xTickColor}" transform="rotate(${rot} ${x} ${yy})">${axisLog&&axisLog.x?formatLogTick(v):esc(v)}</text></g>`});
  if(s.xTitleVisible&&s.xTitle)out+=`<text data-gobject="axis-x" data-gdrag="xTitle" class="chart-object draggable" x="${xTitleX}" y="${xTitleY}" text-anchor="middle" font-size="${s.xTitleSize}" font-weight="${s.xTitleWeight}" fill="${s.xTitleColor}">${esc(s.xTitle)}</text>`;if(s.yTitleVisible&&s.yTitle)out+=`<text data-gobject="axis-y" data-gdrag="yTitle" class="chart-object draggable" transform="translate(${yTitleX} ${yTitleY}) rotate(-90)" text-anchor="middle" font-size="${s.yTitleSize}" font-weight="${s.yTitleWeight}" fill="${s.yTitleColor}">${esc(s.yTitle)}</text>`;return out;
}
/* ===== v0.19.0 legend layout =====
 * The old version sized every entry from `label.length * font * 0.62` and then
 * placed all entries on one uniform grid. A short label therefore ended up with
 * a visibly larger gap after it than a long one. Labels are now measured for
 * real and entries are spaced with a constant gap instead.
 */
let legendMeasureCanvas=null;
function measureLegendText(text,fontPx,weight){
  const value=String(text??'');
  try{
    if(!legendMeasureCanvas)legendMeasureCanvas=document.createElement('canvas');
    const ctx=legendMeasureCanvas.getContext('2d');
    if(ctx){
      const family=state.gallery?.settings?.fontEnglish||'Arial';
      ctx.font=`${weight||400} ${fontPx}px "${family}", "Microsoft YaHei", "Segoe UI", sans-serif`;
      const w=ctx.measureText(value).width;
      if(Number.isFinite(w)&&w>0)return w;
    }
  }catch(_err){}
  return value.length*fontPx*.62;
}
function legendUsesLineSymbol(){
  const t=state.gallery.type,s=state.gallery.settings;
  if(t==='radar')return true;
  if(t==='kde')return !s.kdeFillEnabled;
  if(t==='hist'){
    const requested=s.histDisplayMode||'smart';
    if(requested==='outline')return true;
    if(requested==='smart')return galleryStudioSeriesNames().length>1;
  }
  return false;
}
function galleryLegendLayout(groups){
  const s=state.gallery.settings,font=s.legendFontSize||12,orientation=s.legendOrientation||'horizontal',cols=Math.max(1,Number(s.legendColumns)||1),isRadar=state.gallery.type==='radar',symbol=isRadar?34:20,rowH=Math.max(isRadar?26:24,font+12),pad=10,gap=isRadar?22:18;
  const items=groups.map((g,i)=>{
    const textW=measureLegendText(g,font,s.legendWeight);
    return{name:String(g),color:getGallerySeriesStyle(i).color,textW,w:symbol+8+textW};
  });
  const positions=[];let width=0,height=0;
  if(orientation==='vertical'){
    items.forEach((it,i)=>positions.push({x:pad,y:pad+i*rowH,item:it,index:i}));
    width=pad*2+Math.max(...items.map(it=>it.w));
    height=pad*2+items.length*rowH;
  }else{
    const useCols=Math.max(1,Math.min(isRadar?items.length:cols,items.length));
    for(let start=0;start<items.length;start+=useCols){
      const rowItems=items.slice(start,start+useCols),rowIndex=start/useCols;
      let x=pad;
      rowItems.forEach((it,k)=>{
        positions.push({x,y:pad+rowIndex*rowH,item:it,index:start+k});
        x+=it.w+(k<rowItems.length-1?gap:0);
      });
      width=Math.max(width,x);
    }
    height=pad*2+Math.ceil(items.length/useCols)*rowH;
  }
  return{positions,width:Math.max(48,width),height:Math.max(30,height),symbol,font};
}
function galleryLegend(groups){
  const s=state.gallery.settings;if(!s.legend||!groups.length)return'';const l=galleryLegendLayout(groups),fx=s.legendFrameX??108,fy=s.legendFrameY??50,lx=s.legendX??120,ly=s.legendY??62;
  const fw=s.legendFrameAutoSize?l.width:s.legendFrameWidthBox,fh=s.legendFrameAutoSize?l.height:s.legendFrameHeightBox,style=s.legendFrameStyle||'none',dash=style==='dashed'?'8 5':style==='dotted'?'2 4':'',dbl=style==='double';
  let frame='';if(style!=='none'){frame=`<g data-gobject="legend-frame" data-gdrag="legendFrame" class="chart-object draggable" transform="translate(${fx} ${fy})"><rect width="${fw}" height="${fh}" rx="${s.legendFrameRadius}" fill="${s.legendFrameFill}" stroke="${s.legendFrameColor}" stroke-width="${s.legendFrameWidth}" ${dash?`stroke-dasharray="${dash}"`:''} ${s.legendShadow?'filter="url(#galleryLegendShadow)"':''}/>${dbl?`<rect x="4" y="4" width="${Math.max(0,fw-8)}" height="${Math.max(0,fh-8)}" rx="${Math.max(0,s.legendFrameRadius-2)}" fill="none" stroke="${s.legendFrameColor}" stroke-width="${Math.max(.5,s.legendFrameWidth*.7)}"/>`:''}</g>`}
  const isRadar=state.gallery.type==='radar';
  const content=l.positions.map(({x,y,item,index})=>{
    const useLine=legendUsesLineSymbol(),st=getGallerySeriesStyle(index),symbol=isRadar?`<line x1="${x}" y1="${y+10}" x2="${x+l.symbol}" y2="${y+10}" stroke="${item.color}" stroke-width="${Math.max(1.4,st.lineWidth)}"/>${state.gallery.settings.radarShowMarkers?markerShapeSvg(st.markerShape,x+l.symbol/2,y+10,Math.max(2.4,state.gallery.settings.radarPointSize||st.pointSize),`fill="${st.markerFill==='series'?item.color:'white'}" stroke="${item.color}" stroke-width="1.4"`):''}`:(useLine?`<line x1="${x}" y1="${y+l.font*.55}" x2="${x+l.symbol}" y2="${y+l.font*.55}" stroke="${item.color}" stroke-width="${Math.max(1.4,Number(st.lineWidth)||2)}"/>`:`<rect x="${x}" y="${y+4}" width="${l.symbol}" height="${Math.max(10,l.font*.72)}" fill="${item.color}"/>`);
    return `<g data-gobject="series" data-gseries="${index}" class="chart-object">${symbol}<text x="${x+l.symbol+8}" y="${y+l.font}" font-size="${l.font}" font-weight="${s.legendWeight}" fill="#263238">${esc(item.name)}</text></g>`
  }).join('');
  return `${frame}<g data-gobject="legend" data-gdrag="legend" class="chart-object draggable" transform="translate(${lx} ${ly})">${content}</g>`;
}

function galleryHistogram(W,H){
  const s=state.gallery.settings,p=galleryPlotBox(W,H),rows=state.gallery.rows,groups=[...new Set(rows.map(r=>r.Group))],vals=rows.map(r=>r.Value),min=Math.min(...vals),max=Math.max(...vals),bins=Math.max(4,Math.round(s.bins)),step=(max-min||1)/bins,counts=groups.map(g=>Array(bins).fill(0));
  rows.forEach(r=>{const gi=groups.indexOf(r.Group),bi=Math.min(bins-1,Math.max(0,Math.floor((r.Value-min)/(step||1))));counts[gi][bi]++});
  const ymax=Math.max(1,...counts.flat()),xMap=scaleLinear(min,max,p.l,p.l+p.w),yb=galleryBrokenY(0,ymax,p),yMap=yb?yb.map:scaleLinear(0,ymax,p.t+p.h,p.t),yTicks=yb?yb.ticks:makeTicks(0,ymax,null,5),xTicks=makeTicks(min,max,null,6);let out=commonAxes(W,H,p,xTicks,yTicks,v=>xMap(v),yMap)+galleryLegend(groups);
  counts.forEach((arr,gi)=>{const st=getGallerySeriesStyle(gi);let body='';arr.forEach((n,i)=>{const x=xMap(min+i*step),w=Math.max(1,xMap(min+(i+1)*step)-x-1);body+=`<rect x="${x}" y="${yMap(n)}" width="${w}" height="${p.t+p.h-yMap(n)}" fill="${st.color}" fill-opacity="${st.opacity}" stroke="${st.color}" stroke-width="${st.lineWidth}"/>`});out+=`<g data-gobject="series" data-gseries="${gi}" class="chart-object">${body}</g>`});return out;
}
function kdeFor(values,min,max,points=100,bw=0){const n=values.length,sd=sampleSd(values),h=bw>0?bw:Math.max(1e-9,1.06*(sd||((max-min)/6)||1)*Math.pow(n,-.2)),arr=[];for(let i=0;i<points;i++){const x=min+(max-min)*i/(points-1),d=values.reduce((sum,v)=>sum+Math.exp(-.5*((x-v)/h)**2),0)/(n*h*Math.sqrt(2*Math.PI));arr.push([x,d])}return arr}
function galleryKde(W,H){
  const s=state.gallery.settings,p=galleryPlotBox(W,H),groups=[...new Set(state.gallery.rows.map(r=>r.Group))],all=state.gallery.rows.map(r=>r.Value),pad=(Math.max(...all)-Math.min(...all)||1)*.08,min=Math.min(...all)-pad,max=Math.max(...all)+pad,curves=groups.map(g=>kdeFor(state.gallery.rows.filter(r=>r.Group===g).map(r=>r.Value),min,max,120,s.bandwidth)),ymax=Math.max(...curves.flatMap(c=>c.map(p=>p[1]))),xMap=scaleLinear(min,max,p.l,p.l+p.w),yb=galleryBrokenY(0,ymax,p),yMap=yb?yb.map:scaleLinear(0,ymax,p.t+p.h,p.t),yTicks=yb?yb.ticks:makeTicks(0,ymax,null,5);let out=commonAxes(W,H,p,makeTicks(min,max,null,6),yTicks,v=>xMap(v),yMap)+galleryLegend(groups);
  curves.forEach((curve,i)=>{const st=getGallerySeriesStyle(i),d=curve.map((q,j)=>(j?'L':'M')+xMap(q[0])+','+yMap(q[1])).join(' ');out+=`<g data-gobject="series" data-gseries="${i}" class="chart-object">${st.opacity>0?`<path d="${d} L${xMap(max)},${p.t+p.h} L${xMap(min)},${p.t+p.h} Z" fill="${st.color}" fill-opacity="${st.opacity*.32}"/>`:''}<path d="${d}" fill="none" stroke="${st.color}" stroke-width="${st.lineWidth}"/></g>`});return out;
}
function boxStats(v){
  const s=state.gallery.settings,method=s.boxQuartileMethod||'linear7',a=v.filter(Number.isFinite).sort((x,y)=>x-y),q1=quantileByMethod(a,.25,method),q2=quantileByMethod(a,.5,method),q3=quantileByMethod(a,.75,method),iqr=q3-q1;let low,high;
  if(s.boxWhiskerMethod==='minmax'){low=a[0];high=a[a.length-1]}
  else if(s.boxWhiskerMethod==='percentile'){const p=clamp(Number(s.boxWhiskerPercentile)||5,0,49)/100;low=quantileByMethod(a,p,'linear7');high=quantileByMethod(a,1-p,'linear7')}
  else{const factor=s.boxWhiskerMethod==='iqr30'?3:1.5,loFence=q1-factor*iqr,hiFence=q3+factor*iqr;low=a.find(x=>x>=loFence);high=[...a].reverse().find(x=>x<=hiFence);if(low==null)low=a[0];if(high==null)high=a[a.length-1]}
  return{q1,q2,q3,low,high,mean:mean(a),out:a.filter(x=>x<low||x>high)};
}
function significancePairsForGroups(groups){
  const s=state.gallery.settings,a=state.gallery.analysis;if(!s.significanceEnabled||s.significanceDisplay==='none'||!a?.pairwise?.length)return[];
  let pairs=a.pairwise.map(r=>({...r,i:groups.indexOf(r.a),j:groups.indexOf(r.b)})).filter(r=>r.i>=0&&r.j>=0);
  if(s.significancePairMode==='significant')pairs=pairs.filter(r=>r.p<.05);
  else if(s.significancePairMode==='control')pairs=pairs.filter(r=>r.i===0||r.j===0);
  pairs.sort((a,b)=>(a.j-a.i)-(b.j-b.i)||a.i-b.i);
  const levels=[];pairs.forEach(pair=>{let level=0;while(levels[level]?.some(q=>!(pair.j<q.i||pair.i>q.j)))level++;(levels[level]||(levels[level]=[])).push(pair);pair.level=level});
  return pairs;
}
function significanceLabel(pair){const s=state.gallery.settings;if(s.significanceLabelMode==='pvalue')return pair.p<.001?'p < 0.001':`p = ${formatNumber(pair.p,3)}`;return pair.stars}
// v0.20.0: 多层括号之间的间距 now really controls the vertical gap between
// bracket levels. The old code hard-coded 0.09 of the data range per level and
// only used significanceStep for the tiny end caps, so the control appeared to
// do nothing. Factor is significanceStep/200 — default 18 → 0.09 (identical to
// the previous fixed spacing), range 8–40 → 0.04–0.20.
function significanceStepFactor(){
  const s=state.gallery.settings;
  return clamp(Number(s.significanceStep)||18,8,40)/200;
}
function significanceBracketsSvg(groups,pairs,xAt,yMap,dataMax,range){
  const s=state.gallery.settings;if(!pairs.length)return'';let out='<g data-gobject="significance" class="chart-object">';
  const step=significanceStepFactor(),cap=Math.max(5,s.significanceLineWidth*5);
  pairs.forEach(pair=>{const x1=xAt(pair.i),x2=xAt(pair.j),value=dataMax+range*(.08+pair.level*step)+s.significanceOffset*range/220,y=yMap(value),label=significanceLabel(pair);out+=`<path d="M${x1},${y+cap} V${y} H${x2} V${y+cap}" fill="none" stroke="${s.significanceColor}" stroke-width="${s.significanceLineWidth}"/><text x="${(x1+x2)/2}" y="${y-4}" text-anchor="middle" font-size="${s.significanceFontSize}" font-weight="500" fill="${s.significanceColor}">${esc(label)}</text>`});
  return out+'</g>';
}
function significanceLettersSvg(groups,xAt,yMap,dataMax,range){
  const s=state.gallery.settings,a=state.gallery.analysis;if(!s.significanceEnabled||s.significanceDisplay!=='letters'||!a?.letters)return'';let out='<g data-gobject="significance" class="chart-object">';groups.forEach((g,i)=>{const label=a.letters[g]||'',y=yMap(dataMax+range*.09);if(label)out+=`<text x="${xAt(i)}" y="${y}" text-anchor="middle" font-size="${s.significanceFontSize}" font-weight="600" fill="${s.significanceColor}">${esc(label)}</text>`});return out+'</g>';
}
function galleryBox(W,H,violin){
  const s=state.gallery.settings,p=galleryPlotBox(W,H),groups=[...new Set(state.gallery.rows.map(r=>r.Group))],all=state.gallery.rows.map(r=>r.Value),dataMin=Math.min(...all),dataMax=Math.max(...all),range=(dataMax-dataMin)||1,pairs=significancePairsForGroups(groups),maxLevel=pairs.length?Math.max(...pairs.map(x=>x.level))+1:0;
  const step=significanceStepFactor(),showBrackets=s.significanceEnabled&&s.significanceDisplay==='brackets'&&pairs.length>0,extraTop=showBrackets?range*(.18+maxLevel*step):s.significanceDisplay==='letters'?range*.18:range*.12,min=dataMin-range*.12,max=dataMax+extraTop,yb=galleryBrokenY(min,max,p),yMap=yb?yb.map:scaleLinear(min,max,p.t+p.h,p.t),yTicks=yb?yb.ticks:makeTicks(min,max,null,6),xStep=p.w/groups.length,xAt=i=>p.l+(i+.5)*xStep;
  let out=commonAxes(W,H,p,groups,yTicks,(v,i)=>xAt(i),yMap)+galleryLegend(groups);
  groups.forEach((g,i)=>{const vals=state.gallery.rows.filter(r=>r.Group===g).map(r=>r.Value),stt=boxStats(vals),x=xAt(i),st=getGallerySeriesStyle(i),bw=Math.min(84,xStep*(s.boxWidth||.48));let body='';
    if(violin){const curve=kdeFor(vals,dataMin-range*.08,dataMax+range*.08,80,s.bandwidth),mx=Math.max(...curve.map(q=>q[1]))||1,right=curve.map(q=>[x+(q[1]/mx)*bw/2,yMap(q[0])]),left=[...curve].reverse().map(q=>[x-(q[1]/mx)*bw/2,yMap(q[0])]);body+=`<path d="M${right[0][0]},${right[0][1]} ${right.slice(1).map(q=>'L'+q[0]+','+q[1]).join(' ')} ${left.map(q=>'L'+q[0]+','+q[1]).join(' ')} Z" fill="${st.color}" fill-opacity="${st.opacity}" stroke="${st.color}" stroke-width="${st.lineWidth}"/>`;
      // v0.24.0: 合体——小提琴内部叠加箱线（默认开），即论文常见的 Violin + Box plot。
      // 白色半透明盒体画在小提琴内，须线/中位线/均值/散点共用下方代码，与图2 样式一致。
      if(s.violinShowBox!==false){const bw2=Math.max(2,bw*.5);body+=`<rect x="${x-bw2/2}" y="${yMap(stt.q3)}" width="${bw2}" height="${Math.max(0,yMap(stt.q1)-yMap(stt.q3))}" fill="rgba(255,255,255,.72)" stroke="#222" stroke-width="1.1"/>`}}
    else body+=`<rect x="${x-bw/2}" y="${yMap(stt.q3)}" width="${bw}" height="${yMap(stt.q1)-yMap(stt.q3)}" fill="${st.color}" fill-opacity="${st.opacity}" stroke="${st.color}" stroke-width="${st.lineWidth}"/>`;
    body+=`<line x1="${x}" x2="${x}" y1="${yMap(stt.low)}" y2="${yMap(stt.high)}" stroke="#222" stroke-width="${s.whiskerWidth}"/><line x1="${x-bw*.25}" x2="${x+bw*.25}" y1="${yMap(stt.low)}" y2="${yMap(stt.low)}" stroke="#222" stroke-width="${s.whiskerWidth}"/><line x1="${x-bw*.25}" x2="${x+bw*.25}" y1="${yMap(stt.high)}" y2="${yMap(stt.high)}" stroke="#222" stroke-width="${s.whiskerWidth}"/>`;
    if(s.showMedian)body+=`<line x1="${x-bw/2}" x2="${x+bw/2}" y1="${yMap(stt.q2)}" y2="${yMap(stt.q2)}" stroke="#111" stroke-width="${s.medianWidth}"/>`;
    if(s.showMean)body+=`<circle cx="${x}" cy="${yMap(stt.mean)}" r="3.5" fill="white" stroke="#111"/>`;
    if(s.showPoints)vals.forEach((v,j)=>{if(!s.showOutliers&&(v<stt.low||v>stt.high))return;const jitter=((j*37)%17-8)/8*bw*.36,attrs=`fill="${st.markerFill==='white'?'white':st.color}" stroke="${st.color}" stroke-width="1.2"`;body+=markerShapeSvg(st.markerShape,x+jitter,yMap(v),st.pointSize,attrs)});
    out+=`<g data-gobject="series" data-gseries="${i}" class="chart-object">${body}</g>`;
  });
  if(s.significanceDisplay==='letters')out+=significanceLettersSvg(groups,xAt,yMap,dataMax,range);else out+=significanceBracketsSvg(groups,pairs,xAt,yMap,dataMax,range);
  return out;
}
/* ===== v0.17.0 scatter/bubble axes =====
 * One setup used by the plot itself, the draggable annotation anchors and the
 * regression line, so all three always agree on the mapping. With both scales
 * linear and both interval fields empty this returns exactly what the previous
 * inline code produced.
 */
// Linear and log are the same call for the linear case, so a chart that never
// turns log on produces byte-identical output.
function galleryRangeMap(range,c,d){
  if(range&&range.log&&Number(range.min)>0){
    const lo=Math.log10(range.min),span=(Math.log10(range.max)-lo)||1;
    return v=>c+(Math.log10(Math.max(Number(v),range.min*1e-6))-lo)/span*(d-c);
  }
  if(range&&Number.isFinite(range.min)&&Number.isFinite(range.max))return scaleLinear(range.min,range.max,c,d);
  return scaleLinear(0,1,c,d);
}
function galleryScatterAxes(W,H){
  const p=galleryPlotBox(W,H),rows=state.gallery.rows,xs=rows.map(r=>r.X),ys=rows.map(r=>r.Y);
  // The v0.11.5 range/interval controls already own the X/Y ranges for scatter
  // and bubble, so the log option is layered on top of that section instead of
  // being a second, competing set of fields.
  const resolve=(axis,values,pad)=>{
    if(typeof resolveGalleryNumericRange==='function'){
      try{const r=resolveGalleryNumericRange(axis,values,{pad});if(r&&Number.isFinite(r.min)&&Number.isFinite(r.max))return r}
      catch(_err){}
    }
    const a=values.map(Number).filter(Number.isFinite);
    if(!a.length)return{min:0,max:1,ticks:[0,1],mode:'auto',log:false};
    const lo=Math.min(...a),hi=Math.max(...a),d=(hi-lo||Math.abs(hi)*.12||1);
    return{min:lo-d*pad,max:hi+d*pad,ticks:makeTicks(lo-d*pad,hi+d*pad,null,6),mode:'auto',log:false};
  };
  const xr=resolve('x',xs,.08),yr=resolve('y',ys,.10);
  return{p,xmin:xr.min,xmax:xr.max,ymin:yr.min,ymax:yr.max,
    xMap:galleryRangeMap(xr,p.l,p.l+p.w),yMap:galleryRangeMap(yr,p.t+p.h,p.t),
    xTicks:xr.ticks,yTicks:yr.ticks,logX:!!xr.log,logY:!!yr.log,xr,yr};
}
/* The fitted line y = a + b·x is only a straight segment when both axes are
 * linear. On a log axis it becomes a curve, so it is sampled and drawn as a
 * polyline. The fit itself is unchanged — it still comes from the analysis on
 * raw values. */
function galleryRegressionSvg(m,xmin,xmax,xMap,yMap,s,axisLog){
  if(!m||!Number.isFinite(Number(m.slope)))return '';
  const log=axisLog||{};
  if(!log.x&&!log.y){
    const y1=m.intercept+m.slope*xmin,y2=m.intercept+m.slope*xmax;
    return `<g data-gobject="regression" class="chart-object"><line x1="${xMap(xmin)}" y1="${yMap(y1)}" x2="${xMap(xmax)}" y2="${yMap(y2)}" stroke="#222" stroke-width="${s.lineWidth}" stroke-dasharray="6 4"/></g>`;
  }
  const N=48;let d='';
  for(let i=0;i<=N;i++){
    const t=i/N,x=log.x?xmin*Math.pow(xmax/xmin,t):xmin+(xmax-xmin)*t,yv=m.intercept+m.slope*x;
    if(!Number.isFinite(yv))continue;
    d+=(d?'L':'M')+xMap(x)+','+yMap(yv);
  }
  return d?`<g data-gobject="regression" class="chart-object"><path d="${d}" fill="none" stroke="#222" stroke-width="${s.lineWidth}" stroke-dasharray="6 4"/></g>`:'';
}
function galleryScatter(W,H,bubble){
  const s=state.gallery.settings,rows=state.gallery.rows,groups=[...new Set(rows.map(r=>r.Group))],ax=galleryScatterAxes(W,H),p=ax.p,xmin=ax.xmin,xmax=ax.xmax,xMap=ax.xMap,yMap=ax.yMap;let out=commonAxes(W,H,p,ax.xTicks,ax.yTicks,v=>xMap(v),yMap,{x:ax.logX,y:ax.logY})+galleryLegend(groups);const sizes=rows.map(r=>r.Size).filter(Number.isFinite),smin=Math.min(...sizes),smax=Math.max(...sizes);
  groups.forEach((g,gi)=>{const st=getGallerySeriesStyle(gi),body=rows.filter(r=>r.Group===g).map(r=>{const radius=bubble&&Number.isFinite(r.Size)?st.pointSize+(r.Size-smin)/(smax-smin||1)*Math.max(5,st.pointSize*2):st.pointSize,attrs=`fill="${st.markerFill==='white'?'white':st.color}" fill-opacity="${st.opacity}" stroke="${st.color}" stroke-width="1.1"`;return markerShapeSvg(st.markerShape,xMap(r.X),yMap(r.Y),radius,attrs)}).join('');out+=`<g data-gobject="series" data-gseries="${gi}" class="chart-object">${body}</g>`});
  if(s.showRegression){out+=galleryRegressionSvg(state.gallery.analysis.overall,xmin,xmax,xMap,yMap,s,{x:ax.logX,y:ax.logY})}if(s.showCorrelation){const m=state.gallery.analysis.overall,symbol=m.method==='spearman'?'ρ':'r';out+=`<text data-gobject="regression" class="chart-object" x="${p.l+p.w-8}" y="${p.t+20}" text-anchor="end" font-size="${s.annotationSize}" font-style="italic">${symbol} = ${formatNumber(m.association,3)}, R² = ${formatNumber(m.r2,3)}</text>`}return out;
}
function galleryStacked(W,H){
  const s=state.gallery.settings,p=galleryPlotBox(W,H),cats=[...new Set(state.gallery.rows.map(r=>r.Category))],comps=[...new Set(state.gallery.rows.map(r=>r.Component))],totals=Object.fromEntries(cats.map(c=>[c,state.gallery.rows.filter(r=>r.Category===c).reduce((a,b)=>a+b.Value,0)])),max=s.normalize?100:Math.max(...Object.values(totals)),yMap=scaleLinear(0,max,p.t+p.h,p.t),xStep=p.w/cats.length;let out=commonAxes(W,H,p,cats,makeTicks(0,max,null,6),(v,i)=>p.l+(i+.5)*xStep,yMap)+galleryLegend(comps);
  comps.forEach((comp,j)=>{const st=getGallerySeriesStyle(j);let body='';cats.forEach((cat,i)=>{const previous=comps.slice(0,j).reduce((sum,c)=>{const r=state.gallery.rows.find(x=>x.Category===cat&&x.Component===c);const v=r?r.Value:0;return sum+(s.normalize?(totals[cat]?v/totals[cat]*100:0):v)},0),row=state.gallery.rows.find(r=>r.Category===cat&&r.Component===comp),value=row?row.Value:0,v=s.normalize?(totals[cat]?value/totals[cat]*100:0):value,y1=yMap(previous+v),y0=yMap(previous),w=Math.min(78,xStep*.68),x=p.l+(i+.5)*xStep-w/2;body+=`<rect x="${x}" y="${y1}" width="${w}" height="${Math.max(0,y0-y1)}" fill="${st.color}" fill-opacity="${st.opacity}" stroke="${st.color}" stroke-width="${st.lineWidth}"/>`;
    if(s.stackedShowValue&&(y0-y1)>=9){const lum=hexLuminance(st.color),val=s.normalize?v:value;body+=`<text x="${x+w/2}" y="${(y0+y1)/2+Number(s.stackedValueSize||12)/3.2}" text-anchor="middle" font-size="${s.stackedValueSize||12}" font-weight="600" fill="${lum>.55?'#111111':'#ffffff'}">${formatNumber(val,s.stackedValueDecimals??1)}</text>`}
  });out+=`<g data-gobject="series" data-gseries="${j}" class="chart-object">${body}</g>`});
  if(s.stackedShowError){let eb='';cats.forEach((cat,i)=>{const x=p.l+(i+.5)*xStep,catRows=state.gallery.rows.filter(r=>r.Category===cat);
    const totalErr=(()=>{const te=Number(catRows.find(r=>r.totalError!=null)?.totalError)||0;if(te)return te;const segErr=comps.map(c=>{const r=catRows.find(x=>x.Component===c),e=Math.abs(Number(r?.Error)||0);return s.normalize?(totals[cat]?e/totals[cat]*100:0):e}).filter(Number.isFinite);return Math.sqrt(segErr.reduce((a,b)=>a+b*b,0))})();
    if(totalErr>0){const yT=yMap((s.normalize?100:totals[cat])+totalErr),yB=yMap(s.normalize?100:totals[cat]),ew=Number(s.stackedErrorWidth)||1,cap=Number(s.stackedErrorCapWidth)||ew*2.4,c=s.stackedErrorColor||'#263238';eb+=`<line data-gobject="error-bars" x1="${x}" y1="${yB}" x2="${x}" y2="${Math.min(yT,yB)}" stroke="${c}" stroke-width="${ew}"/><line data-gobject="error-bars" x1="${x-cap/2}" y1="${Math.min(yT,yB)}" x2="${x+cap/2}" y2="${Math.min(yT,yB)}" stroke="${c}" stroke-width="${ew}"/>`}
  });out+=`<g data-gobject="error-bars" class="chart-object">${eb}</g>`}
  return out;
}
function hexLuminance(hex){const h=hexRgb(hex).map(v=>v/255);return .2126*h[0]+.7152*h[1]+.0722*h[2]}
function galleryPie(W,H){
  const s=state.gallery.settings,first=state.gallery.rows[0].Category,rows=state.gallery.rows.filter(r=>r.Category===first),total=rows.reduce((a,b)=>a+b.Value,0),cx=W*.42,cy=H*.54,R=Math.min(W,H)*.3,r0=s.donut?R*.52:0;let a=-Math.PI/2,out='';
  rows.forEach((r,i)=>{const st=getGallerySeriesStyle(i),da=total?r.Value/total*Math.PI*2:0,a2=a+da,p1=[cx+R*Math.cos(a),cy+R*Math.sin(a)],p2=[cx+R*Math.cos(a2),cy+R*Math.sin(a2)],q1=[cx+r0*Math.cos(a2),cy+r0*Math.sin(a2)],q2=[cx+r0*Math.cos(a),cy+r0*Math.sin(a)],large=da>Math.PI?1:0,d=r0?`M${p1} A${R},${R} 0 ${large} 1 ${p2} L${q1} A${r0},${r0} 0 ${large} 0 ${q2} Z`:`M${cx},${cy} L${p1} A${R},${R} 0 ${large} 1 ${p2} Z`;let body=`<path d="${d}" fill="${st.color}" fill-opacity="${st.opacity}" stroke="white" stroke-width="${Math.max(1,st.lineWidth)}"/>`;const mid=a+da/2,tx=cx+R*.72*Math.cos(mid),ty=cy+R*.72*Math.sin(mid);if(s.showCorrelation&&da>.12)body+=`<text x="${tx}" y="${ty}" text-anchor="middle" font-size="${s.pieLabelSize}" fill="white" font-weight="600">${formatNumber(r.Value/total*100,1)}%</text>`;out+=`<g data-gobject="series" data-gseries="${i}" class="chart-object">${body}</g>`;a=a2});out+=galleryLegend(rows.map(r=>r.Component));return out;
}
function hexRgb(hex){const h=String(hex||'#000000').replace('#','');if(!/^[0-9a-f]{6}$/i.test(h))return[0,0,0];const n=parseInt(h,16);return[(n>>16)&255,(n>>8)&255,n&255]}
function rgbHex(rgb){return'#'+rgb.map(v=>clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join('')}
function blendHex(a,b,t){const A=hexRgb(a),B=hexRgb(b);return rgbHex(A.map((v,i)=>v+(B[i]-v)*clamp(t,0,1)))}
function heatColor(v,diagonal=false){const s=state.gallery.settings;if(diagonal)return s.heatmapDiagonalColor||s.heatmapHighColor;const t=clamp((v+1)/2,0,1);return t<=.5?blendHex(s.heatmapLowColor,s.heatmapMidColor,t*2):blendHex(s.heatmapMidColor,s.heatmapHighColor,(t-.5)*2)}
function heatmapColorBar(W,H){const s=state.gallery.settings;if(!s.heatmapColorBar)return'';const x=s.legendX??120,y=s.legendY??62,horizontal=s.heatmapColorBarOrientation!=='vertical',steps=80;let out=`<g data-gobject="legend" data-gdrag="legend" class="chart-object draggable" transform="translate(${x} ${y})">`;if(horizontal){const w=180,h=14;for(let i=0;i<steps;i++){const v=-1+2*i/(steps-1);out+=`<rect x="${i*w/steps}" y="0" width="${w/steps+0.5}" height="${h}" fill="${heatColor(v)}"/>`}out+=`<rect width="${w}" height="${h}" fill="none" stroke="#58666d" stroke-width=".7"/><text x="0" y="${h+14}" font-size="${Math.max(9,s.legendFontSize-1)}">−1</text><text x="${w/2}" y="${h+14}" text-anchor="middle" font-size="${Math.max(9,s.legendFontSize-1)}">0</text><text x="${w}" y="${h+14}" text-anchor="end" font-size="${Math.max(9,s.legendFontSize-1)}">1</text>`}else{const w=14,h=160;for(let i=0;i<steps;i++){const v=1-2*i/(steps-1);out+=`<rect x="0" y="${i*h/steps}" width="${w}" height="${h/steps+0.5}" fill="${heatColor(v)}"/>`}out+=`<rect width="${w}" height="${h}" fill="none" stroke="#58666d" stroke-width=".7"/><text x="${w+7}" y="9" font-size="${Math.max(9,s.legendFontSize-1)}">1</text><text x="${w+7}" y="${h/2+4}" font-size="${Math.max(9,s.legendFontSize-1)}">0</text><text x="${w+7}" y="${h}" font-size="${Math.max(9,s.legendFontSize-1)}">−1</text>`}return out+'</g>'}
function clusterVarOrder(corr,vars){
  const dist=(a,b)=>1-Number(corr[a]?.[b]??0),mergeDist=(A,B)=>{let s=0,n=0;A.items.forEach(i=>B.items.forEach(j=>{s+=dist(i,j);n++}));return n?s/n:0};
  let clusters=vars.map(v=>({items:[v],name:v,tree:{name:v}}));
  if(clusters.length<2)return{order:vars,tree:null};
  while(clusters.length>1){let best=[0,1,Infinity];for(let i=0;i<clusters.length;i++)for(let j=i+1;j<clusters.length;j++){const d=mergeDist(clusters[i],clusters[j]);if(d<best[2])best=[i,j,d]}const [i,j,d]=best,a=clusters[i],b=clusters[j];const merged={items:[...a.items,...b.items],name:a.name+'+'+b.name,tree:{left:a.tree,right:b.tree,d}};clusters=clusters.filter((_,idx)=>idx!==i&&idx!==j);clusters.push(merged)}
  const tree=clusters[0].tree;const order=[];(function walk(node){if(!node)return;if(node.name){order.push(node.name);return}walk(node.left);walk(node.right)})(tree);return{order,tree};
}
function dendrogramSegments(node,start,end,base,scale,horizontal=true,lines=[]){if(!node||node.name)return lines;const leftCount=(function count(n){return n.name?1:count(n.left)+count(n.right)})(node.left),rightCount=(function count(n){return n.name?1:count(n.left)+count(n.right)})(node.right),total=leftCount+rightCount;const split=start+(end-start)*(leftCount/total);const y=base-node.d*scale;const yL=node.left?.name?base:base-(node.left.d||0)*scale;const yR=node.right?.name?base:base-(node.right.d||0)*scale;const xL=(start+split)/2,xR=(split+end)/2;lines.push(horizontal?`<line x1="${xL}" y1="${yL}" x2="${xL}" y2="${y}" stroke="#7d8a90" stroke-width="1"/><line x1="${xR}" y1="${yR}" x2="${xR}" y2="${y}" stroke="#7d8a90" stroke-width="1"/><line x1="${xL}" y1="${y}" x2="${xR}" y2="${y}" stroke="#7d8a90" stroke-width="1"/>`:`<line x1="${yL}" y1="${xL}" x2="${y}" y2="${xL}" stroke="#7d8a90" stroke-width="1"/><line x1="${yR}" y1="${xR}" x2="${y}" y2="${xR}" stroke="#7d8a90" stroke-width="1"/><line x1="${y}" y1="${xL}" x2="${y}" y2="${xR}" stroke="#7d8a90" stroke-width="1"/>`);
  dendrogramSegments(node.left,start,split,base,scale,horizontal,lines);dendrogramSegments(node.right,split,end,base,scale,horizontal,lines);return lines;
}
function galleryHeatmap(W,H){
  const s=state.gallery.settings,a=state.gallery.analysis,vars=a.vars.slice(),cluster=s.heatmapCluster||'none';
  const rowOrder=(cluster==='rows'||cluster==='both')?clusterVarOrder(a.corr,vars):{order:vars,tree:null};
  const colOrder=(cluster==='cols'||cluster==='both')?clusterVarOrder(a.corr,vars):{order:vars,tree:null};
  const rows=rowOrder.order,cols=colOrder.order,showDen=!!s.heatmapShowDendrogram,den=showDen?56:0,pad=118;
  const n=Math.max(rows.length,cols.length),size=Math.min((W-pad-90-den)/Math.max(cols.length,1),(H-pad-90-den)/Math.max(rows.length,1)),x0=pad+den,y0=84+den;let body='';
  if(showDen&&colOrder.tree){body+=`<g class="chart-object">${dendrogramSegments(colOrder.tree,x0,x0+cols.length*size,y0-8,46,true).join('')}</g>`}
  if(showDen&&rowOrder.tree){body+=`<g class="chart-object">${dendrogramSegments(rowOrder.tree,y0,y0+rows.length*size,x0-8,46,false).join('')}</g>`}
  cols.forEach((v,j)=>{body+=`<text x="${x0+(j+.5)*size}" y="${y0-12}" text-anchor="start" font-size="${s.heatmapXLabelSize}" font-weight="${s.xTickWeight}" fill="${s.xTickColor}" transform="rotate(-45 ${x0+(j+.5)*size} ${y0-12})">${esc(v)}</text>`});
  rows.forEach((v,i)=>{body+=`<text x="${x0-12}" y="${y0+(i+.55)*size}" text-anchor="end" font-size="${s.heatmapYLabelSize}" font-weight="${s.yTickWeight}" fill="${s.yTickColor}">${esc(v)}</text>`;cols.forEach((w,j)=>{const r=a.corr[v][w],x=x0+j*size,y=y0+i*size,gap=s.heatmapCellGap||0,isDiag=v===w,cellColor=heatColor(r,isDiag);body+=`<rect x="${x+gap/2}" y="${y+gap/2}" width="${Math.max(0,size-gap)}" height="${Math.max(0,size-gap)}" fill="${cellColor}" stroke="${s.heatmapGridStroke}" stroke-width="${s.heatmapGridStrokeWidth}"/>`;if(s.heatmapShowValues){const rgb=hexRgb(cellColor),lum=(.299*rgb[0]+.587*rgb[1]+.114*rgb[2]);body+=`<text x="${x+size/2}" y="${y+size/2+s.heatmapValueSize*.34}" text-anchor="middle" font-size="${s.heatmapValueSize}" fill="${lum<145?'white':'#222'}">${formatNumber(r,2)}</text>`}})});
  return `<g data-gobject="heatmap-scale" class="chart-object">${body}</g>${heatmapColorBar(W,H)}`
}

function galleryRadar(W,H){
  const s=state.gallery.settings,rows=(state.gallery.rows||[]).filter(r=>r&&r.Group&&r.Indicator&&Number.isFinite(r.Value)),groups=[...new Set(rows.map(r=>r.Group))],inds=[...new Set(rows.map(r=>r.Indicator))],cx=W*.5,cy=H*.52,R=Math.min(W,H)*.34,n=Math.max(inds.length,3);
  const perInd=Object.fromEntries(inds.map(ind=>{const vals=rows.filter(r=>r.Indicator===ind).map(r=>r.Value).filter(Number.isFinite);return[ind,{min:Math.min(...vals),max:Math.max(...vals)}]}));
  const dataMin=Math.min(...inds.map(ind=>perInd[ind].min)),dataMax=Math.max(...inds.map(ind=>perInd[ind].max),dataMin+1),levelCount=Math.max(2,Number(s.radarLevels)||4);
  const minManual=String(s.radarMin??'').trim()!==''&&String(s.radarMin).toLowerCase()!=='auto'&&Number.isFinite(Number(s.radarMin)),maxManual=String(s.radarMax??'').trim()!==''&&String(s.radarMax).toLowerCase()!=='auto'&&Number.isFinite(Number(s.radarMax));
  let rawMin=minManual?Number(s.radarMin):dataMin,rawMax=maxManual?Number(s.radarMax):dataMax;
  if(s.normalize){rawMin=0;rawMax=1}else if(!minManual&&!maxManual){const step=niceStep((dataMax-dataMin)/levelCount||1);rawMin=Math.floor(dataMin/step)*step;rawMax=rawMin+step*levelCount;if(rawMax<dataMax-1e-10){rawMax+=step;rawMin=rawMax-step*levelCount}}else if(!minManual){const step=niceStep((rawMax-dataMin)/levelCount||1);rawMin=rawMax-step*levelCount;if(rawMin>dataMin)rawMin-=step}else if(!maxManual){const step=niceStep((dataMax-rawMin)/levelCount||1);rawMax=rawMin+step*levelCount;if(rawMax<dataMax)rawMax+=step}if(!(rawMax>rawMin))rawMax=rawMin+1;
  const tickStep=(rawMax-rawMin)/(levelCount||1),labelOffset=Number(s.radarLabelOffset)||30,tickOffset=Number(s.radarTickLabelOffset)||10,tickSize=Number(s.radarTickLabelSize)||10,theme=RADAR_THEMES[s.radarTheme]||RADAR_THEMES.journal;
  let out='<g data-gobject="radar-grid" class="chart-object">';
  const polygonPoints=radius=>inds.map((_,i)=>{const a=-Math.PI/2+i*2*Math.PI/n;return`${cx+radius*Math.cos(a)},${cy+radius*Math.sin(a)}`}).join(' ');
  // Radar background gradient is always clipped by the outer radar polygon.
  // Users can keep the existing center-to-edge gradient or switch to a directional gradient.
  if(s.radarSmartHighlight!==false){
    const mode=s.radarGradientMode||'radial';
    if(mode==='radial'){
      const gradientSteps=24;
      for(let k=gradientSteps;k>=1;k--){
        const t=k/gradientSteps;
        const fill=blendHex(theme.inner,theme.outer,Math.pow(t,.90));
        out+=`<polygon points="${polygonPoints(R*t)}" fill="${fill}" fill-opacity="1" stroke="none"/>`;
      }
    }else{
      const vectors={
        'left-right':['0%','50%','100%','50%'],
        'right-left':['100%','50%','0%','50%'],
        'top-bottom':['50%','0%','50%','100%'],
        'bottom-top':['50%','100%','50%','0%'],
        'diag-down':['0%','0%','100%','100%'],
        'diag-up':['0%','100%','100%','0%']
      };
      const [x1,y1,x2,y2]=vectors[mode]||vectors['left-right'];
      const gid=`radarDirectionalGradient_${String(mode).replace(/[^a-z-]/g,'')}`;
      const mid=blendHex(theme.inner,theme.outer,.48);
      out+=`<defs><linearGradient id="${gid}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0%" stop-color="${theme.outer}"/><stop offset="48%" stop-color="${mid}"/><stop offset="100%" stop-color="${theme.inner}"/></linearGradient></defs>`;
      out+=`<polygon points="${polygonPoints(R)}" fill="url(#${gid})" fill-opacity="1" stroke="none"/>`;
    }
  }
  // Draw polygon grids over the background so every ring stays crisp.
  for(let k=1;k<=levelCount;k++){
    const pts=polygonPoints(R*k/levelCount);
    out+=`<polygon points="${pts}" fill="none" stroke="${s.radarGridColor}" stroke-width="${s.radarGridWidth}"/>`;
    if(s.radarShowTickLabels){
      const rv=rawMin+tickStep*k;let tx=cx+tickOffset,ty=cy-R*k/levelCount+4,anchor='start';
      if(s.radarTickLabelPosition==='left'){tx=cx-R*k/levelCount-tickOffset;ty=cy+4;anchor='end'}
      else if(s.radarTickLabelPosition==='right'){tx=cx+R*k/levelCount+tickOffset;ty=cy+4;anchor='start'}
      out+=`<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-size="${tickSize}" fill="${s.yTickColor}">${formatNumber(rv,s.radarTickDecimals)}</text>`;
    }
  }
  if(s.radarShowTickLabels){let tx=cx+tickOffset,ty=cy+4,anchor='start';if(s.radarTickLabelPosition==='left'){tx=cx-tickOffset;anchor='end'}else if(s.radarTickLabelPosition==='right'){tx=cx+tickOffset;anchor='start'}out+=`<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-size="${tickSize}" fill="${s.yTickColor}">${formatNumber(rawMin,s.radarTickDecimals)}</text>`;}
  // Spokes use a separate, slightly stronger width for paper-style readability.
  inds.forEach((ind,i)=>{const a=-Math.PI/2+i*2*Math.PI/n,x=cx+R*Math.cos(a),y=cy+R*Math.sin(a),lx=cx+(R+labelOffset)*Math.cos(a),ly=cy+(R+labelOffset)*Math.sin(a);const anchor=Math.cos(a)>0.28?'start':Math.cos(a)<-0.28?'end':'middle';out+=`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${s.radarSpokeColor}" stroke-width="${s.radarSpokeWidth||s.radarGridWidth}"/><text x="${lx}" y="${ly+4}" text-anchor="${anchor}" font-size="${s.radarLabelSize}" font-weight="${s.xTickWeight}">${esc(ind)}</text>`});out+='</g>';
  groups.forEach((g,gi)=>{const st=getGallerySeriesStyle(gi),pts=inds.map((ind,i)=>{const row=rows.find(r=>r.Group===g&&r.Indicator===ind),v=row?row.Value:rawMin;let z;if(s.normalize){const mn=perInd[ind].min,mx=perInd[ind].max;z=(v-mn)/(mx-mn||1)}else z=(v-rawMin)/(rawMax-rawMin||1);z=clamp(z,0,1);const a=-Math.PI/2+i*2*Math.PI/n;return[cx+R*z*Math.cos(a),cy+R*z*Math.sin(a)]});let body=`<polygon points="${pts.map(q=>q.join(',')).join(' ')}" fill="none" stroke="${st.color}" stroke-width="${st.lineWidth}"/>`;if(s.radarShowMarkers)pts.forEach(q=>body+=markerShapeSvg(st.markerShape,q[0],q[1],s.radarPointSize||st.pointSize,`fill="${st.markerFill==='series'?st.color:'white'}" stroke="${st.color}" stroke-width="1.2"`));out+=`<g data-gobject="series" data-gseries="${gi}" class="chart-object">${body}</g>`});out+=galleryLegend(groups);return out;
}

function exportGallerySvg(){const svg=$('#gallerySvg');if(!svg){toast('请先生成图形');return}download(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'}),`FoodLab_${safeFile(galleryDef().name)}.svg`)}
function exportGalleryPng(){const svg=$('#gallerySvg');if(!svg){toast('请先生成图形');return}const s=state.gallery.settings,scale=Math.max(1,Number(s.dpi||300)/96),xml=new XMLSerializer().serializeToString(svg),url=URL.createObjectURL(new Blob([xml],{type:'image/svg+xml'})),img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=Math.round(s.width*scale);c.height=Math.round(s.height*scale);const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);c.toBlob(b=>download(b,`FoodLab_${safeFile(galleryDef().name)}_${s.dpi}dpi.png`),'image/png');URL.revokeObjectURL(url)};img.src=url}


// ===== v0.7.6 论文拼图工作台：平台图表 + 本地图片 =====
function bindCompose(){
  $('#addToFigure')?.addEventListener('click',()=>addCurrentChartToFigure(false));
  $('#openCompose')?.addEventListener('click',()=>showView('compose'));
  $('#composeBackStudio')?.addEventListener('click',()=>showView('chart'));
  $('#composeAddText')?.addEventListener('click',()=>addComposeAnnotation('text'));
  $('#composeAddArrow')?.addEventListener('click',()=>addComposeAnnotation('arrow'));
  $('#composeAddCurrent')?.addEventListener('click',()=>addCurrentChartToFigure(true));
  $('#composeImportImages')?.addEventListener('click',()=>$('#composeImageInput')?.click());
  $('#composeImageInput')?.addEventListener('change',async e=>{if(e.target.files?.length)await importComposeImages([...e.target.files]);e.target.value=''});
  $('#composeClear')?.addEventListener('click',()=>{if(!state.figureBoard.items.length)return;state.figureBoard.items=[];renderComposeWorkspace();toast('拼图已清空')});
  $('#composeExportSvg')?.addEventListener('click',exportComposeSvg);
  $('#composeExportPng')?.addEventListener('click',exportComposePng);
}
function currentChartSvgElement(){return $('#paperSvg')||$('#gallerySvg')}
function cleanChartSvgClone(svg){
  const clone=cleanAnnotationEditorArtifacts(svg.cloneNode(true));clone.removeAttribute('id');clone.querySelectorAll('.object-selected').forEach(el=>el.classList.remove('object-selected'));clone.querySelectorAll('[data-gobject],[data-object],[data-gdrag]').forEach(el=>{el.removeAttribute('data-gobject');el.removeAttribute('data-object');el.removeAttribute('data-gdrag');el.classList.remove('chart-object','draggable')});return clone;
}
function ensureComposeGridCapacity(){
  const b=state.figureBoard;b.columns=clamp(Number(b.columns)||2,1,6);b.rows=b.rows||2;
}
function addFigureItem(item){
  const b=state.figureBoard;item.label=item.label||indexLetter(b.items.length).toUpperCase();item.id=item.id||`panel_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;b.items.push(item);b.selected=b.items.length-1;ensureComposeGridCapacity();
}
function addCurrentChartToFigure(openAfter=false){
  const svg=currentChartSvgElement();if(!svg){toast('当前没有可加入的图');return}
  const clone=cleanChartSvgClone(svg),vb=svg.viewBox?.baseVal,w=vb?.width||Number(svg.getAttribute('width'))||980,h=vb?.height||Number(svg.getAttribute('height'))||660;
  addFigureItem({title:workflowChartLabel(state.workflow.chartType),type:state.workflow.chartType,kind:'svg',width:w,height:h,svg:new XMLSerializer().serializeToString(clone)});
  toast(`已加入拼图：${state.figureBoard.items.at(-1).label} · ${workflowChartLabel(state.workflow.chartType)}`);if(openAfter)showView('compose');else renderComposeWorkspace();
}
function readAsText(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(new Error(`无法读取 ${file.name}`));r.readAsText(file)})}
function readAsDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(new Error(`无法读取 ${file.name}`));r.readAsDataURL(file)})}
function imageDimensions(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth||img.width||980,height:img.naturalHeight||img.height||660});img.onerror=()=>reject(new Error('图片尺寸读取失败'));img.src=src})}
function parseImportedSvg(text,name){
  const doc=new DOMParser().parseFromString(text,'image/svg+xml'),root=doc.documentElement;if(!root||root.nodeName.toLowerCase()!=='svg'||doc.querySelector('parsererror'))throw new Error(`${name} 不是有效 SVG`);
  root.querySelectorAll('script,foreignObject').forEach(x=>x.remove());
  const vb=(root.getAttribute('viewBox')||'').trim().split(/[ ,]+/).map(Number),width=vb.length===4&&Number.isFinite(vb[2])?vb[2]:parseFloat(root.getAttribute('width'))||980,height=vb.length===4&&Number.isFinite(vb[3])?vb[3]:parseFloat(root.getAttribute('height'))||660;
  if(!root.getAttribute('viewBox'))root.setAttribute('viewBox',`0 0 ${width} ${height}`);root.removeAttribute('id');
  return {kind:'svg',title:name.replace(/\.svg$/i,''),type:'imported-svg',width,height,svg:new XMLSerializer().serializeToString(root)};
}
async function importComposeImages(files){
  let added=0;
  for(const file of files){
    try{
      if(file.type==='image/svg+xml'||/\.svg$/i.test(file.name)){addFigureItem(parseImportedSvg(await readAsText(file),file.name))}
      else if(/^image\//.test(file.type)||/\.(png|jpe?g|webp)$/i.test(file.name)){const src=await readAsDataUrl(file),dim=await imageDimensions(src);addFigureItem({kind:'image',title:file.name.replace(/\.[^.]+$/,''),type:'imported-image',width:dim.width,height:dim.height,src})}
      else continue;added++;
    }catch(err){toast(err.message||`无法导入 ${file.name}`)}
  }
  renderComposeWorkspace();if(added)toast(`已导入 ${added} 张本地图片`);
}
function addComposeAnnotation(type){
  const b=state.figureBoard,id=makeAnnotationId();let ann={id,type,color:'#111111',width:2,dash:'',fontFamily:b.labelFont||'Arial',fontSize:28,fontWeight:500};
  if(type==='text')Object.assign(ann,{text:'说明文字',x:b.width*.52,y:b.height*.12,background:'#ffffff',backgroundOpacity:.9,padding:8,borderColor:'#b8c5c0',borderWidth:1,cornerRadius:4});
  else Object.assign(ann,{x1:b.width*.35,y1:b.height*.18,x2:b.width*.50,y2:b.height*.32,arrowEnd:true,text:''});
  b.annotations.push(ann);b.selectedAnnotation=id;renderComposeWorkspace();toast(type==='text'?'已加入拼图文字框':'已加入拼图箭头：拖动“起”“终”圆点调整');
}
function selectedComposeAnnotation(){return state.figureBoard.annotations.find(a=>a.id===state.figureBoard.selectedAnnotation)}
function composeAnnotationSvg(ann,interactive=true){
  if(ann.type==='text'){
    const w=Math.max(40,String(ann.text||'').length*ann.fontSize*.62+(ann.padding||0)*2),h=ann.fontSize*1.35+(ann.padding||0)*2;
    return `<g data-compose-annotation="${ann.id}" class="compose-annotation" transform="translate(${ann.x} ${ann.y})"><rect x="${-w/2}" y="${-h+ann.fontSize*.35}" width="${w}" height="${h}" rx="${ann.cornerRadius??4}" fill="${ann.background}" fill-opacity="${ann.backgroundOpacity}" stroke="${ann.borderColor||'none'}" stroke-width="${ann.borderWidth||0}"/><text text-anchor="middle" font-family="${escAttr(ann.fontFamily)},sans-serif" font-size="${ann.fontSize}" font-weight="${ann.fontWeight}" fill="${ann.color}">${esc(ann.text)}</text></g>`
  }
  const mx=(ann.x1+ann.x2)/2,my=(ann.y1+ann.y2)/2,handles=interactive?`${arrowEndpointHandleMarkup({id:ann.id,x:ann.x1,y:ann.y1,endpoint:'start',compose:true})}${arrowEndpointHandleMarkup({id:ann.id,x:ann.x2,y:ann.y2,endpoint:'end',compose:true})}`:'';
  return `<g data-compose-annotation="${ann.id}" class="compose-annotation"><line class="annotation-hit-line" data-compose-arrow-hit x1="${ann.x1}" y1="${ann.y1}" x2="${ann.x2}" y2="${ann.y2}"/><line data-compose-arrow-line x1="${ann.x1}" y1="${ann.y1}" x2="${ann.x2}" y2="${ann.y2}" stroke="${ann.color}" stroke-width="${ann.width}" ${ann.dash?`stroke-dasharray="${ann.dash}"`:''} ${ann.arrowEnd!==false?'marker-end="url(#composeArrowHead)"':''}/>${ann.text?`<text data-compose-arrow-label x="${mx}" y="${my-8}" text-anchor="middle" font-family="${escAttr(ann.fontFamily)},sans-serif" font-size="${ann.fontSize}" fill="${ann.color}">${esc(ann.text)}</text>`:''}${handles}</g>`
}
function updateComposeArrowDom(group,ann){
  group.querySelectorAll('[data-compose-arrow-line],[data-compose-arrow-hit]').forEach(line=>{line.setAttribute('x1',ann.x1);line.setAttribute('y1',ann.y1);line.setAttribute('x2',ann.x2);line.setAttribute('y2',ann.y2)});
  const a=group.querySelector('[data-compose-arrow-handle="start"]'),b=group.querySelector('[data-compose-arrow-handle="end"]');if(a)a.setAttribute('transform',`translate(${ann.x1} ${ann.y1})`);if(b)b.setAttribute('transform',`translate(${ann.x2} ${ann.y2})`);
  const t=group.querySelector('[data-compose-arrow-label]');if(t){t.setAttribute('x',(ann.x1+ann.x2)/2);t.setAttribute('y',(ann.y1+ann.y2)/2-8)}
}
function bindComposeAnnotationInteractions(){
  const svg=$('#composeSvg');if(!svg)return;
  svg.querySelectorAll('[data-compose-arrow-handle]').forEach(handle=>handle.addEventListener('pointerdown',e=>{
    e.preventDefault();e.stopPropagation();const id=handle.dataset.composeAnnotationId,ann=state.figureBoard.annotations.find(a=>a.id===id);if(!ann)return;state.figureBoard.selectedAnnotation=id;
    const endpoint=handle.dataset.composeArrowHandle,group=handle.closest('[data-compose-annotation]');handle.setPointerCapture(e.pointerId);handle.classList.add('is-dragging');
    const move=ev=>{const p=svgPoint(svg,ev);if(endpoint==='start'){ann.x1=p.x;ann.y1=p.y}else{ann.x2=p.x;ann.y2=p.y}updateComposeArrowDom(group,ann)};
    const endDrag=()=>{handle.classList.remove('is-dragging');handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',endDrag);handle.removeEventListener('pointercancel',endDrag);renderComposeWorkspace()};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',endDrag);handle.addEventListener('pointercancel',endDrag);
  }));
  $$('[data-compose-annotation]').forEach(el=>{
    el.addEventListener('click',e=>{e.stopPropagation();state.figureBoard.selectedAnnotation=el.dataset.composeAnnotation;renderComposeSettings();$$('[data-compose-annotation]').forEach(x=>x.classList.toggle('compose-annotation-selected',x===el))});
    el.addEventListener('pointerdown',e=>{if(e.target.closest('[data-compose-arrow-handle]'))return;e.preventDefault();e.stopPropagation();const ann=state.figureBoard.annotations.find(a=>a.id===el.dataset.composeAnnotation);if(!ann)return;state.figureBoard.selectedAnnotation=ann.id;const start=svgPoint(svg,e),snap=structuredClone(ann);el.setPointerCapture(e.pointerId);const move=ev=>{const p=svgPoint(svg,ev),dx=p.x-start.x,dy=p.y-start.y;if(ann.type==='text'){ann.x=snap.x+dx;ann.y=snap.y+dy;el.setAttribute('transform',`translate(${ann.x} ${ann.y})`)}else{ann.x1=snap.x1+dx;ann.y1=snap.y1+dy;ann.x2=snap.x2+dx;ann.y2=snap.y2+dy;el.setAttribute('transform',`translate(${dx} ${dy})`)}};const up=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);renderComposeWorkspace()};el.addEventListener('pointermove',move);el.addEventListener('pointerup',up)});
  });
  svg.addEventListener('click',function composePanelSelect(e){const hit=e.target.closest&&e.target.closest('[data-compose-panel]');if(hit){state.figureBoard.selected=Number(hit.dataset.composePanel);renderComposeItemList();renderComposeSettings();renderComposePreviewOnly()}});
}
function renderComposeWorkspace(){
  if(!$('#composeStage'))return;ensureComposeGridCapacity();renderComposeItemList();renderComposeSettings();const svg=composeSvgMarkup();$('#composeStage').innerHTML=svg||'<div class="gallery-empty"><b>还没有拼图面板</b><span>可加入当前 Chart Studio 图，也可直接导入 PNG、JPG、WebP 或 SVG。</span></div>';bindComposeAnnotationInteractions();const b=state.figureBoard;$('#composeCount').textContent=`${b.items.length} 张`;$('#composeCanvasMeta').textContent=`${b.columns} 列 × ${b.computedRows||b.rows||2} 行 · ${b.width} × ${b.computedHeight||b.height} px · ${b.dpi} dpi`;
}
function composeThumbSrc(item){return item.kind==='image'?item.src:svgDataUri(item.svg||'')}
function renderComposeItemList(){
  const box=$('#composeItemList'),items=state.figureBoard.items;if(!items.length){box.innerHTML='<div class="empty-state">尚未加入图表或图片</div>';return}
  box.innerHTML=items.map((item,i)=>`<div class="compose-item ${i===state.figureBoard.selected?'active':''}" data-compose-select="${i}"><div class="compose-thumb"><img alt="${escAttr(item.title)}" src="${composeThumbSrc(item)}"></div><div class="compose-item-meta"><label>面板标签<input data-compose-label="${i}" value="${escAttr(item.label||indexLetter(i).toUpperCase())}" maxlength="8"></label><label>跨列<select data-compose-colspan="${i}">${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${(Number(item.colspan)||1)===n?'selected':''}>${n}</option>`).join('')}</select></label><b>${esc(item.title)}</b><small>${item.kind==='image'?'本地图片':'SVG 图表'} · ${item.width} × ${item.height}</small></div><div class="compose-item-actions"><button data-compose-up="${i}" ${i===0?'disabled':''}>↑</button><button data-compose-down="${i}" ${i===items.length-1?'disabled':''}>↓</button><button data-compose-remove="${i}" class="danger">×</button></div></div>`).join('');
  $$('[data-compose-select]').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('button,input,select,label'))return;state.figureBoard.selected=Number(el.dataset.composeSelect);renderComposeItemList()}));
  $$('[data-compose-label]').forEach(el=>el.addEventListener('input',()=>{items[Number(el.dataset.composeLabel)].label=el.value;renderComposePreviewOnly()}));
  $$('[data-compose-colspan]').forEach(el=>el.addEventListener('change',()=>{const it=items[Number(el.dataset.composeColspan)];if(!it)return;it.colspan=Math.max(1,Math.min(Number(el.value)||1,state.figureBoard.columns||2));ensureComposeGridCapacity();renderComposeWorkspace()}));
  $$('[data-compose-up]').forEach(el=>el.addEventListener('click',()=>moveComposeItem(Number(el.dataset.composeUp),-1)));
  $$('[data-compose-down]').forEach(el=>el.addEventListener('click',()=>moveComposeItem(Number(el.dataset.composeDown),1)));
  $$('[data-compose-remove]').forEach(el=>el.addEventListener('click',()=>{items.splice(Number(el.dataset.composeRemove),1);state.figureBoard.selected=clamp(state.figureBoard.selected,0,Math.max(0,items.length-1));renderComposeWorkspace()}));
}
function moveComposeItem(i,delta){const items=state.figureBoard.items,j=i+delta;if(j<0||j>=items.length)return;[items[i],items[j]]=[items[j],items[i]];state.figureBoard.selected=j;renderComposeWorkspace()}
function renderComposePreviewOnly(){const stage=$('#composeStage');if(stage){stage.innerHTML=composeSvgMarkup()||'';bindComposeAnnotationInteractions()}const b=state.figureBoard;const meta=$('#composeCanvasMeta');if(meta)meta.textContent=`${b.columns} 列 × ${b.computedRows||b.rows||2} 行 · ${b.width} × ${b.computedHeight||b.height} px · ${b.dpi} dpi`}
function composeGroup(title,inner,open){return `<details class="compose-group" ${open?'open':''}><summary>${title}</summary>${inner}</details>`}
function renderComposeSettings(){
  const b=state.figureBoard;b.labelFont=b.labelFont||'Arial';b.rows=b.rows||Math.max(1,Math.ceil(b.items.length/(b.columns||2)));
  const fonts=[['Arial','Arial'],['Times New Roman','Times New Roman'],['Calibri','Calibri'],['Helvetica','Helvetica'],['Georgia','Georgia'],['Microsoft YaHei','微软雅黑'],['SimSun','宋体'],['SimHei','黑体']];
  if(!$('#composeGroupStyle')){const st=document.createElement('style');st.id='composeGroupStyle';st.textContent='.compose-group{border:1px solid #e6ebed;border-radius:9px;margin-bottom:9px;overflow:hidden;background:#fff}.compose-group summary{cursor:pointer;font-weight:600;font-size:13px;padding:9px 11px;background:#f7f9f8;border-bottom:1px solid #edf1f0;list-style:none;display:flex;justify-content:space-between;align-items:center;margin:0}.compose-group summary::-webkit-details-marker{display:none}.compose-group summary::after{content:"▾";color:#8a969c;transition:transform .15s}.compose-group:not([open]) summary::after{transform:rotate(-90deg)}.compose-group>div{padding:10px 11px}.compose-group .field{margin-bottom:10px}.compose-group .small-note{color:#8a969c;font-size:11px;line-height:1.5;margin-top:6px}';document.head.appendChild(st)}
  const sel=b.items[b.selected];const selHtml=sel?`<div class="field"><label><span>宽度</span><output>${Number(sel.colspan)||1}</output></label><select id="composePanelColspan">${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${(Number(sel.colspan)||1)===n?'selected':''}>${n} 格</option>`).join('')}</select></div><div class="field"><label><span>高度</span><output>${Number(sel.rowspan)||1}</output></label><select id="composePanelRowspan">${[1,2,3,4,5].map(n=>`<option value="${n}" ${(Number(sel.rowspan)||1)===n?'selected':''}>${n} 格</option>`).join('')}</select></div><div class="small-note">在画布上点击任意图即可选中；改完自动重排对称。</div>`:'<div class="small-note">在画布上点击任意图即可选中后编辑尺寸。</div>';
  const html=composeGroup('画布与布局',`${composeSelect('columns','列数',[[1,'1 列'],[2,'2 列'],[3,'3 列'],[4,'4 列'],[5,'5 列'],[6,'6 列']])}${composeNumber('width','总宽度',800,5000,10)}${composeRange('gap','面板间距',0,200,1)}${composeNumber('padding','外边距',0,160,1)}${composeCheck('trimWhitespace','裁剪面板白边（自动去掉图周围空白）')}${composeNumber('height','总高度（不足时自动扩展）',600,5000,10)}${composeSelect('dpi','PNG 清晰度',[[96,'96 dpi'],[150,'150 dpi'],[300,'300 dpi'],[600,'600 dpi']])}${composeColor('background','背景颜色')}`,true)
  +composeGroup('选中面板',selHtml,true)
  +composeGroup('面板标签',`${composeCheck('labelEnabled','显示 A、B、C、D 标签')}${composeSelect('labelFont','字体',fonts)}${composeRange('labelSize','字号',12,72,1)}${composeSelect('labelWeight','字重',[[400,'常规'],[500,'中等'],[600,'半粗'],[700,'粗体']])}${composeColor('labelColor','颜色')}${composeSelect('labelPosition','位置',[['top-left','左上角'],['top-right','右上角'],['outside-top-left','面板外左上']])}${composeNumber('labelInsetX','水平内缩',-40,80,1)}${composeNumber('labelInsetY','垂直内缩',-40,80,1)}`,false)
  +composeGroup('面板边框',`${composeCheck('panelBorder','显示面板边框')}${composeRange('panelBorderWidth','边框粗细',.5,6,.1)}${composeColor('panelBorderColor','边框颜色')}`,false)
  +composeGroup('拼图文字与箭头',composeAnnotationSettingsHtml(fonts),false);
  $('#composeSettings').innerHTML=html;$$('[data-compose-setting]').forEach(el=>{const fn=()=>{const k=el.dataset.composeSetting;let v=el.type==='checkbox'?el.checked:el.value;if(['number','range'].includes(el.type)||['columns','rows','dpi'].includes(k))v=Number(v);state.figureBoard[k]=v;if(k==='columns'||k==='rows')ensureComposeGridCapacity();renderComposePreviewOnly();const out=el.closest('.field')?.querySelector('output');if(out)out.textContent=state.figureBoard[k]};el.addEventListener('input',fn);el.addEventListener('change',fn)});$('#composePanelColspan')?.addEventListener('change',e=>{const it=state.figureBoard.items[state.figureBoard.selected];if(!it)return;it.colspan=Math.max(1,Math.min(Number(e.target.value)||1,state.figureBoard.columns||2));renderComposePreviewOnly();const out=e.target.closest('.field')?.querySelector('output');if(out)out.textContent=it.colspan});$('#composePanelRowspan')?.addEventListener('change',e=>{const it=state.figureBoard.items[state.figureBoard.selected];if(!it)return;it.rowspan=Math.max(1,Math.min(Number(e.target.value)||1,5));renderComposePreviewOnly();const out=e.target.closest('.field')?.querySelector('output');if(out)out.textContent=it.rowspan});bindComposeAnnotationInputs();
}
function composeAnnotationSettingsHtml(fonts){
  const b=state.figureBoard,ann=selectedComposeAnnotation(),list=b.annotations.map((a,i)=>`<button type="button" class="compose-ann-chip ${a.id===b.selectedAnnotation?'active':''}" data-compose-ann-select="${a.id}">${annotationTypeLabel(a.type)} ${i+1}</button>`).join('');
  let fields='<div class="empty-state">使用顶部“＋文字框”或“＋箭头”添加拼图标注。</div>',tip='文字框和箭头可直接在组合图中拖动。';
  if(ann){
    if(ann.type==='text')fields=composeAnnText('text','文字内容')+composeAnnNumber('x','水平位置',0,5000,1)+composeAnnNumber('y','垂直位置',0,5000,1)+composeAnnSelect('fontFamily','字体',fonts)+composeAnnRange('fontSize','字号',10,96,1)+composeAnnSelect('fontWeight','字重',[[300,'细体'],[400,'常规'],[500,'中等'],[600,'半粗'],[700,'粗体']])+composeAnnColor('color','文字颜色')+composeAnnColor('background','文字框底色')+composeAnnRange('backgroundOpacity','底色透明度',0,1,.05)+composeAnnRange('padding','内边距',0,40,1)+composeAnnColor('borderColor','边框颜色')+composeAnnRange('borderWidth','边框粗细',0,8,.1)+composeAnnRange('cornerRadius','圆角',0,24,1);
    else{fields=composeAnnText('text','箭头文字')+composeAnnSelect('fontFamily','字体',fonts)+composeAnnRange('fontSize','文字字号',10,72,1)+composeAnnColor('color','颜色')+composeAnnRange('width','线宽',.5,8,.1)+composeAnnSelect('dash','线型',[['','实线'],['8 5','虚线'],['2 4','点线']])+composeAnnCheck('arrowEnd','显示箭头');tip='拖动箭头本体可整体移动；拖动两端圆形手柄可任意改变方向和长度。';}
    fields+=`<button id="composeDeleteAnnotation" class="ghost danger wide" type="button">删除此标注</button>`;
  }
  return `<div class="object-property-section"><div class="compose-ann-list">${list||'<span class="small-note">暂无标注</span>'}</div>${fields}<div class="annotation-drag-tip">${tip}</div></div>`;
}
function composeAnnWrap(k,l,input){const a=selectedComposeAnnotation(),v=a?.[k]??'';return `<div class="field"><label><span>${l}</span><output>${esc(v)}</output></label>${input}</div>`}
function composeAnnText(k,l){const a=selectedComposeAnnotation();return composeAnnWrap(k,l,`<input data-compose-ann-setting="${k}" type="text" value="${escAttr(a?.[k]??'')}">`)}
function composeAnnNumber(k,l,min,max,step){const a=selectedComposeAnnotation();return composeAnnWrap(k,l,`<input data-compose-ann-setting="${k}" type="number" min="${min}" max="${max}" step="${step}" value="${a?.[k]??''}">`)}
function composeAnnRange(k,l,min,max,step){const a=selectedComposeAnnotation();return composeAnnWrap(k,l,`<input data-compose-ann-setting="${k}" type="range" min="${min}" max="${max}" step="${step}" value="${a?.[k]??0}">`)}
function composeAnnColor(k,l){const a=selectedComposeAnnotation();return composeAnnWrap(k,l,`<input data-compose-ann-setting="${k}" type="color" value="${a?.[k]||'#111111'}">`)}
function composeAnnSelect(k,l,opts){const a=selectedComposeAnnotation(),v=a?.[k]??'';return composeAnnWrap(k,l,`<select data-compose-ann-setting="${k}">${opts.map(([x,n])=>`<option value="${x}" ${String(v)===String(x)?'selected':''}>${n}</option>`).join('')}</select>`)}
function composeAnnCheck(k,l){const a=selectedComposeAnnotation();return `<label class="check-row"><input data-compose-ann-setting="${k}" type="checkbox" ${a?.[k]?'checked':''}>${l}</label>`}
function bindComposeAnnotationInputs(){
  $$('[data-compose-ann-select]').forEach(btn=>btn.addEventListener('click',()=>{state.figureBoard.selectedAnnotation=btn.dataset.composeAnnSelect;renderComposeSettings();renderComposePreviewOnly()}));
  $$('[data-compose-ann-setting]').forEach(el=>{const fn=()=>{const a=selectedComposeAnnotation();if(!a)return;let v=el.type==='checkbox'?el.checked:el.value;if(['number','range'].includes(el.type))v=Number(v);a[el.dataset.composeAnnSetting]=v;renderComposePreviewOnly()};el.addEventListener('input',fn);el.addEventListener('change',fn)});
  $('#composeDeleteAnnotation')?.addEventListener('click',()=>{const b=state.figureBoard;b.annotations=b.annotations.filter(a=>a.id!==b.selectedAnnotation);b.selectedAnnotation=b.annotations.at(-1)?.id||null;renderComposeWorkspace()});
}

function composeWrap(label,key,input){return `<div class="field"><label><span>${label}</span><output>${esc(state.figureBoard[key])}</output></label>${input}</div>`}
function composeNumber(k,l,min,max,step){return composeWrap(l,k,`<input data-compose-setting="${k}" type="number" min="${min}" max="${max}" step="${step}" value="${state.figureBoard[k]}">`)}
function composeRange(k,l,min,max,step){return composeWrap(l,k,`<input data-compose-setting="${k}" type="range" min="${min}" max="${max}" step="${step}" value="${state.figureBoard[k]}">`)}
function composeSelect(k,l,opts){return composeWrap(l,k,`<select data-compose-setting="${k}">${opts.map(([v,n])=>`<option value="${v}" ${String(state.figureBoard[k])===String(v)?'selected':''}>${n}</option>`).join('')}</select>`)}
function composeColor(k,l){return composeWrap(l,k,`<input data-compose-setting="${k}" type="color" value="${state.figureBoard[k]}">`)}
function composeCheck(k,l){return `<label class="check-row"><input data-compose-setting="${k}" type="checkbox" ${state.figureBoard[k]?'checked':''}>${l}</label>`}
function svgDataUri(svg){return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
function prefixSvgIds(text,prefix){let out=String(text);const ids=[];out=out.replace(/\bid="([^"]+)"/g,(m,id)=>{ids.push(id);return `id="${prefix}${id}"`});ids.forEach(id=>{const escId=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');out=out.replace(new RegExp(`url\\(#${escId}\\)`,'g'),`url(#${prefix}${id})`).replace(new RegExp(`(["'])#${escId}(["'])`,'g'),`$1#${prefix}${id}$2`)});return out}
function svgInner(text){const m=String(text).match(/<svg\b[^>]*>([\s\S]*)<\/svg>/i);return m?m[1]:text}
function svgRootPresentation(text){try{const doc=new DOMParser().parseFromString(String(text),'image/svg+xml'),root=doc.documentElement;return{style:root.getAttribute('style')||'',fontFamily:root.getAttribute('font-family')||'',fontWeight:root.getAttribute('font-weight')||''}}catch{return{style:'',fontFamily:'',fontWeight:''}}}
function trimSvgWhitespace(svg,pad=8){
  try{
    const vbm=String(svg).match(/<svg[^>]*viewBox="([^"]+)"/);if(!vbm)return svg;
    const p=vbm[1].trim().split(/[\s,]+/).map(Number);if(p.length<4||p.some(x=>!Number.isFinite(x)))return svg;
    const vw=p[2],vh=p[3];if(!vw||!vh)return svg;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,found=false;
    const re=/(?:<|\s)((?:rect|circle|line|text|path|image|ellipse|polygon|polyline))([^>]*?)(?:\/>|>)/gi;let m;
    while((m=re.exec(String(svg)))){
      const tag=m[1],a=m[2];
      if(tag==='rect'){if(/data-object="background"/.test(a))continue;const rw=Number((a.match(/width="([\d.\-]+)"/)||[])[1]||0),rh=Number((a.match(/height="([\d.\-]+)"/)||[])[1]||0);if(rw>0&&rh>0&&Math.abs(rw-vw)<.5&&Math.abs(rh-vh)<.5)continue}
      const xs=[...(a.match(/(?:^|\s)(?:x|cx|x1|x2)="([\d.\-]+)"/g)||[])].map(s=>Number(s.replace(/^.*="|"$/g,''))).filter(Number.isFinite);
      const ys=[...(a.match(/(?:^|\s)(?:y|cy|y1|y2)="([\d.\-]+)"/g)||[])].map(s=>Number(s.replace(/^.*="|"$/g,''))).filter(Number.isFinite);
      const ws=[...(a.match(/(?:^|\s)width="([\d.\-]+)"/g)||[])].map(s=>Number(s.replace(/^.*="|"$/g,''))).filter(Number.isFinite);
      const hs=[...(a.match(/(?:^|\s)height="([\d.\-]+)"/g)||[])].map(s=>Number(s.replace(/^.*="|"$/g,''))).filter(Number.isFinite);
      const rs=[...(a.match(/(?:^|\s)r="([\d.\-]+)"/g)||[])].map(s=>Number(s.replace(/^.*="|"$/g,''))).filter(Number.isFinite);
      const d=(a.match(/d="([^"]+)"/)||[])[1]||'';
      const dn=[...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(mm=>Number(mm[0])).filter(Number.isFinite);
      if(xs.length&&ws.length){const rx=xs[0]??0,rw2=ws[0]??0;minX=Math.min(minX,rx);maxX=Math.max(maxX,rx+rw2);minY=Math.min(minY,...ys);maxY=Math.max(maxY,...ys)}
      if(ys.length&&hs.length){const ry=ys[0]??0,rh2=hs[0]??0;minY=Math.min(minY,ry);maxY=Math.max(maxY,ry+rh2);minX=Math.min(minX,...xs);maxX=Math.max(maxX,...xs)}
      if(xs.length&&!ws.length){minX=Math.min(minX,...xs);maxX=Math.max(maxX,...xs)}
      if(ys.length&&!hs.length){minY=Math.min(minY,...ys);maxY=Math.max(maxY,...ys)}
      if(rs.length&&xs.length&&ys.length){minX=Math.min(minX,...xs.map((x,i)=>x-(rs[i]||0)));maxX=Math.max(maxX,...xs.map((x,i)=>x+(rs[i]||0)));minY=Math.min(minY,...ys.map((y,i)=>y-(rs[i]||0)));maxY=Math.max(maxY,...ys.map((y,i)=>y+(rs[i]||0)))}
      if(dn.length>=4){const dxs=dn.filter((_,i)=>i%2===0),dys=dn.filter((_,i)=>i%2===1);minX=Math.min(minX,...dxs);maxX=Math.max(maxX,...dxs);minY=Math.min(minY,...dys);maxY=Math.max(maxY,...dys)}
      if(xs.length||ys.length||ws.length||hs.length||rs.length||dn.length)found=true;
    }
    if(!found||!Number.isFinite(minX))return svg;
    const cx=Math.max(0,Math.floor(minX-pad)),cy=Math.max(0,Math.floor(minY-pad)),cw=Math.min(vw,Math.ceil(maxX-minX+pad*2)),ch=Math.min(vh,Math.ceil(maxY-minY+pad*2));
    if(cw<vw*.2||ch<vh*.2||cw>vw*.98||ch>vh*.98)return svg;
    return String(svg).replace(/viewBox="[^"]*"/,`viewBox="${cx} ${cy} ${cw} ${ch}"`);
  }catch(e){return svg}
}
function composeSvgMarkup(interactive=true){
  const b=state.figureBoard,items=b.items;if(!items.length&&!b.annotations.length)return'';ensureComposeGridCapacity();const W=clamp(Number(b.width)||1600,800,5000),H=clamp(Number(b.height)||1200,600,5000),cols=clamp(Number(b.columns)||2,1,6),gap=Math.max(0,Number(b.gap)||0),pad=Math.max(0,Number(b.padding)||0),cellW=(W-pad*2-gap*(cols-1))/cols;
  // 贪心网格：按顺序放置，支持跨列/跨行
  const grid={},pos=[];
  items.forEach((item,i)=>{
    const sc=Math.max(1,Math.min(Number(item.colspan)||1,cols)),sr=Math.max(1,Math.min(Number(item.rowspan)||1,5));let placed=false;
    for(let r=0;!placed&&r<40;r++){for(let c=0;c+sc<=cols;c++){
      let free=true;
      for(let rr=r;rr<r+sr;rr++){const row=grid[rr]||(grid[rr]={});for(let cc=c;cc<c+sc;cc++){if(row[cc]){free=false;break}}if(!free)break}
      if(free){for(let rr=r;rr<r+sr;rr++){const row=grid[rr]||(grid[rr]={});for(let cc=c;cc<c+sc;cc++)row[cc]=1}pos.push({i,r,c,sc,sr});placed=true;break}
    }}
    if(!placed){let r=0;while(grid[r])r++;const row=grid[r]||(grid[r]={});for(let cc=0;cc<sc;cc++)row[cc]=1;pos.push({i,r,c:0,sc,sr:1})}
  });
  const rowCount=pos.reduce((m,p)=>Math.max(m,p.r+p.sr),0);
  // 行高自适应：每个面板按自身宽高比分摊到所占行
  const rowH=new Array(rowCount).fill(0);
  pos.forEach(p=>{const item=items[p.i],w=cellW*p.sc+gap*(p.sc-1);
    const natH=item.kind==='image'?(item.height&&item.width?w*Number(item.height)/Number(item.width):w*.6):(item.height&&item.width?w*Number(item.height)/Number(item.width):w*.6);
    const per=Math.max(60,natH/p.sr);
    for(let r=p.r;r<p.r+p.sr;r++)rowH[r]=Math.max(rowH[r]||0,per)});
  const contentH=rowH.reduce((s,h)=>s+h,0)+gap*(rowCount-1);
  const Hf=Math.max(H,contentH+pad*2);
  const yStart=pad+(Hf-contentH-pad*2)/2;
  const yOf=new Array(rowCount).fill(0);{let acc=yStart;for(let r=0;r<rowCount;r++){yOf[r]=acc;acc+=rowH[r]+gap}}
  const xOf=c=>pad+c*(cellW+gap);
  b.computedHeight=Hf;b.computedRows=rowCount;
  let body=`<rect width="${W}" height="${Hf}" fill="${b.background}"/>`;
  const selectedI=b.selected;
  pos.forEach(p=>{
    const item=items[p.i],x=xOf(p.c),y=yOf[p.r],w=cellW*p.sc+gap*(p.sc-1);
    let ph=rowH[p.r]+gap*(p.sr-1);for(let r=p.r+1;r<p.r+p.sr;r++)ph+=rowH[r];
    if(item.kind==='image'){body+=`<image x="${x}" y="${y}" width="${w}" height="${ph}" href="${escAttr(item.src)}" preserveAspectRatio="xMidYMid meet"${interactive?` data-compose-panel="${p.i}" style="cursor:pointer"`:''}/>`}
    else{const srcSvg=b.trimWhitespace!==false?trimSvgWhitespace(item.svg,8):item.svg,prefix=`p${p.i}_`,prefixed=prefixSvgIds(srcSvg,prefix),inner=svgInner(prefixed),pres=svgRootPresentation(srcSvg),style=pres.style?` style="${escAttr(pres.style)}"`:'',ff=pres.fontFamily?` font-family="${escAttr(pres.fontFamily)}"`:'',fw=pres.fontWeight?` font-weight="${escAttr(pres.fontWeight)}"`:'';body+=`<svg x="${x}" y="${y}" width="${w}" height="${ph}" viewBox="0 0 ${item.width} ${item.height}" preserveAspectRatio="xMidYMid meet"${style}${ff}${fw}${interactive?` data-compose-panel="${p.i}" style="cursor:pointer"`:''}>${inner}</svg>`}
    if(b.panelBorder||p.i===selectedI){const col=p.i===selectedI?'#2f6fed':'#c9d0d4',bw=p.i===selectedI?2.5:(Number(b.panelBorderWidth)||1);body+=`<rect x="${x}" y="${y}" width="${w}" height="${ph}" fill="none" stroke="${col}" stroke-width="${bw}"/>`}
    if(b.labelEnabled){let lx=x+b.labelInsetX,ly=y+b.labelSize+b.labelInsetY,anchor='start';if(b.labelPosition==='top-right'){lx=x+w-b.labelInsetX;anchor='end'}else if(b.labelPosition==='outside-top-left'){lx=x-b.labelInsetX;ly=y-b.labelInsetY}body+=`<text x="${lx}" y="${ly}" text-anchor="${anchor}" font-family="${escAttr(b.labelFont||'Arial')},sans-serif" font-size="${b.labelSize}" font-weight="${b.labelWeight}" fill="${b.labelColor}">${esc(item.label||indexLetter(p.i).toUpperCase())}</text>`}
    if(interactive)body+=`<rect x="${x}" y="${y}" width="${w}" height="${ph}" fill="rgba(0,0,0,0)" pointer-events="all" data-compose-panel="${p.i}" style="cursor:pointer"/>`;
  });
  body+=(b.annotations||[]).map(a=>composeAnnotationSvg(a,interactive)).join('');
  return `<svg id="composeSvg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${Hf}" style="background:${b.background}"><defs><marker id="composeArrowHead" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,8 L9,4 z" fill="context-stroke"/></marker></defs>${body}</svg>`;
}
function exportComposeSvg(){const markup=composeSvgMarkup(false);if(!markup){toast('请先加入至少一张图或图片');return}download(new Blob([markup],{type:'image/svg+xml;charset=utf-8'}),`${safeFile(state.design.experimentName)}_论文拼图.svg`)}
function exportComposePng(){const markup=composeSvgMarkup(false);if(!markup){toast('请先加入至少一张图或图片');return}const b=state.figureBoard,scale=Math.max(1,Number(b.dpi||300)/96),url=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml'})),img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=Math.round(b.width*scale);c.height=Math.round((b.computedHeight||b.height)*scale);const ctx=c.getContext('2d');ctx.fillStyle=b.background;ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);c.toBlob(blob=>download(blob,`${safeFile(state.design.experimentName)}_论文拼图_${b.dpi}dpi.png`),'image/png');URL.revokeObjectURL(url)};img.onerror=()=>{URL.revokeObjectURL(url);toast('拼图导出失败，请检查导入图片格式')};img.src=url}


// ===== 页面导览（左下角"?"）=====
const TOUR_STEPS={
  plan:[
    {target:'.goal-tabs,[data-goal-tab]',title:'① 选研究目的',text:'先点一个你要解决的问题（如组间比较、时间趋势），系统会据此推荐合适的图和数据模板。'},
    {target:'#chartSearch,.chart-grid,.goal-grid,[data-route-chart]',title:'② 选图类型',text:'在卡片里挑一个图，点一下就定下来；搜索框可以快速筛。'},
    {target:'[data-open="data"]',title:'③ 下一步',text:'选好图后，点这个绿色按钮进入「数据模板与导入」。'}
  ],
  data:[
    {target:'#downloadCurrentXlsx,#downloadCurrentCsv',title:'① 下载模板',text:'先下载和当前图配套的 Excel 模板，按照模板规则填写即可。'},
    {target:'#fileInput,[data-drop],.drop-zone,#dataFile',title:'② 导入数据',text:'把填好的 Excel 拖进来，或点这里选择文件。同名自动算一组，A-1/A-2 是平行，同名列重复=重复测定。'},
    {target:'#nextStepBtn',title:'③ 下一步',text:'导入成功后点这里，进入「初步分析」。'}
  ],
  statistics:[
    {target:'.stat-table,#descriptTable,table',title:'① 描述统计',text:'这里自动算出每组的均值、标准差、样本量，不用自己在 Excel 里算。'},
    {target:'.warning-banner,.data-warning',title:'② 数据提醒',text:'有异常数据会在这里黄色提醒，先处理再作图。'},
    {target:'#goChart,#nextStepBtn',title:'③ 进入作图',text:'确认数据没问题，点这里进 Chart Studio 开始调图。'}
  ],
  chart:[
    {target:'#view-chart .object-tree,#objectTree,[data-layer-id]',title:'① 左侧对象树',text:'想改图哪部分，就点这里：图题、坐标轴、图例、背景……点中哪个，右边就出哪个的设置。'},
    {target:'#paperSvg,.chart-canvas,#chartCanvas',title:'② 中间画布',text:'图画在这里。图题、坐标轴、图例可以直接用鼠标拖动位置。'},
    {target:'#propertyEditor',title:'③ 右侧属性面板',text:'选中对象后，在这里调颜色、字号、粗细、显著性字母、误差棒等。'},
    {target:'#view-chart .property-section:has(#paletteFile),#view-chart',title:'④ 配色与参数',text:'左侧树里有「配色参数」「图片参数」，可以存一套配色和图设置，下次直接套用。'},
    {target:'#exportSvgBtn,#exportPngBtn,.export-buttons,[data-export]',title:'⑤ 导出',text:'调好后点这里导出。SVG 是矢量图，PNG 选 300 dpi 直接贴论文。'}
  ],
  compose:[
    {target:'#addToCompose,.add-compose,[data-add-compose]',title:'① 加入拼图',text:'把你之前做好的图一张张加进来。'},
    {target:'#composeCanvas,.compose-board,#composeSvg',title:'② 拼图画布',text:'多图自动排列，A/B/C/D 面板标签自动加。'},
    {target:'#composeGap,[data-compose-gap]',title:'③ 调间距',text:'在这里调图与图之间的空白大小，紧凑导出会自动裁白边。'},
    {target:'#exportComposeSvg,#exportComposePng',title:'④ 导出整图',text:'满意后导出整版拼图，直接是论文图版。'}
  ]
};
function tourCss(){if($('#tourCss'))return;const c=document.createElement('style');c.id='tourCss';c.textContent='#tourFab{position:fixed;right:18px;bottom:18px;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#6aa6ff,#5b8def);color:#fff;border:none;font-size:18px;font-weight:700;cursor:pointer;line-height:1;padding:0;box-shadow:0 4px 14px rgba(91,141,239,.45);z-index:9998}#tourFab:hover{transform:scale(1.1)}#settingSearchWrap{position:relative;margin-left:14px;display:inline-block;vertical-align:middle}#settingSearch{padding:5px 10px;border:1px solid #c9d2d8;border-radius:14px;font-size:12px;width:150px;outline:none}#settingSearch:focus{border-color:#5b8def}#settingSearchDrop{position:absolute;top:100%;left:0;margin-top:4px;background:#fff;border:1px solid #e0e6ea;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.15);max-height:260px;overflow-y:auto;min-width:220px;z-index:50;display:none}#settingSearchDrop button{display:block;width:100%;text-align:left;padding:7px 12px;border:none;background:none;cursor:pointer;font-size:12px;color:#2a3340}#settingSearchDrop button:hover{background:#eef4ff}#settingSearchDrop button small{color:#8a969c;margin-left:6px}.tour-mask{position:fixed;inset:0;background:rgba(20,28,38,.55);z-index:9999;pointer-events:none}.tour-hl{outline:3px solid #ffd166;outline-offset:3px;border-radius:8px;position:relative;z-index:10000!important;transition:all .2s}.tour-bubble{position:fixed;z-index:10001;max-width:300px;max-height:80vh;overflow-y:auto;background:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 10px 34px rgba(0,0,0,.28);font-size:13px;line-height:1.65;color:#2a3340}.tour-bubble h4{margin:0 0 6px;font-size:14px;color:#3a6fd8}.tour-bubble .tour-nav{display:flex;gap:8px;margin-top:10px;justify-content:flex-end}.tour-bubble button{padding:5px 12px;border-radius:6px;border:1px solid #c9d2d8;background:#f4f7f9;cursor:pointer;font-size:12px}.tour-bubble .tour-next{background:#5b8def;color:#fff;border-color:#5b8def}.tour-bubble .tour-skip{color:#8a969c}';document.head.appendChild(c)}
function ensureTourFab(){tourCss();if(!$('#tourFab')){const b=document.createElement('button');b.id='tourFab';b.textContent='?';b.title='查看本页使用说明';b.onclick=startTour;document.body.appendChild(b)}ensureSettingSearch()}
const SETTING_INDEX=[
 {id:'title',label:'图题',kw:'图题 标题 title 大字'},
 {id:'subtitle',label:'副标题',kw:'副标题 副标 subtitle'},
 {id:'typography',label:'字体与字号',kw:'字体 字号 字重 英文 中文 font typography'},
 {id:'canvas',label:'画布与导出',kw:'画布 尺寸 宽度 高度 dpi 清晰度 比例 导出 紧凑 svg png'},
 {id:'axis-x',label:'X轴与横标题',kw:'X轴 横坐标 标题 刻度 数字 倾斜 axis-x x轴'},
 {id:'axis-y',label:'Y轴与纵标题',kw:'Y轴 纵坐标 标题 刻度 数字 axis-y y轴'},
 {id:'legend',label:'图例内容',kw:'图例 legend 位置 列数'},
 {id:'legend-frame',label:'图例边框',kw:'图例边框 边框 阴影'},
 {id:'frame',label:'图片边框',kw:'边框 框线 frame'},
 {id:'background',label:'背景与网格',kw:'背景 底色 网格 横网格 纵网格 background'},
 {id:'palette',label:'配色参数',kw:'配色 颜色 色板 hex 保存配色 palette'},
 {id:'style',label:'图片参数',kw:'图参数 保存参数 导入参数 style'},
 {id:'methodnote',label:'方法说明',kw:'方法说明 材料与方法 论文文案 method'},
 {id:'error',label:'误差棒',kw:'误差棒 误差 sd sem ci 标准差 标准误 error'},
 {id:'letters',label:'显著性字母',kw:'显著性 字母 多重比较 duncan tukey letters 差异'},
 {id:'series',label:'系列颜色与样式',kw:'系列 颜色 线宽 标记 点 形状 折线'}
];
function ensureSettingSearch(){const titleEl=$('#studioContextTitle');if(!titleEl||$('#settingSearchWrap'))return;
  const wrap=document.createElement('span');wrap.id='settingSearchWrap';
  wrap.innerHTML='<input id="settingSearch" type="text" placeholder="搜索设置…" autocomplete="off"><div id="settingSearchDrop"></div>';
  titleEl.parentElement.appendChild(wrap);
  const input=$('#settingSearch'),drop=$('#settingSearchDrop');
  input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();if(!q){drop.style.display='none';return}
    const hits=SETTING_INDEX.filter(x=>x.label.toLowerCase().includes(q)||x.kw.toLowerCase().includes(q));
    drop.innerHTML=hits.length?hits.map(h=>'<button type="button" data-setting-id="'+h.id+'">'+h.label+'</button>').join(''):'<button type="button" disabled>无匹配</button>';
    drop.style.display='block'});
  drop.addEventListener('click',e=>{const b=e.target.closest('button[data-setting-id]');if(!b)return;state.chart.selected=b.dataset.settingId;renderLayers();renderProperties();drop.style.display='none';input.value=''});
  document.addEventListener('click',e=>{if(!wrap.contains(e.target))drop.style.display='none'});
}
function tourFind(sel){if(!sel)return null;for(const s of sel.split(',').map(x=>x.trim())){const el=$(s);if(el&&el.offsetParent!==null)return el}return null}
function startTour(){
  const steps=TOUR_STEPS[state.view]||[];
  if(!steps.length){toast('本页暂无使用说明');return}
  let i=0;
  const old=$('.tour-mask');if(old)old.remove();const oldB=$('.tour-bubble');if(oldB)oldB.remove();$$('.tour-hl').forEach(e=>e.classList.remove('tour-hl'));
  const mask=document.createElement('div');mask.className='tour-mask';document.body.appendChild(mask);
  const bubble=document.createElement('div');bubble.className='tour-bubble';document.body.appendChild(bubble);
  function close(){mask.remove();bubble.remove();$$('.tour-hl').forEach(e=>e.classList.remove('tour-hl'))}
  function show(){
    $$('.tour-hl').forEach(e=>e.classList.remove('tour-hl'));
    const st=steps[i];const el=tourFind(st.target);
    bubble.innerHTML='<h4>'+esc(st.title)+'</h4><div>'+esc(st.text)+'</div><div class="tour-nav"><button class="tour-skip" type="button">跳过</button>'+(i>0?'<button type="button" class="tour-prev">上一步</button>':'')+'<button type="button" class="tour-next">'+(i===steps.length-1?'完成':'下一步')+'</button></div>';
    if(el){el.classList.add('tour-hl');const r=el.getBoundingClientRect();const bw=Math.min(300,window.innerWidth-28);const estH=Math.min(260,Math.max(140,window.innerHeight*0.4));let bx=r.left+r.width/2-bw/2;bx=Math.max(14,Math.min(window.innerWidth-bw-14,bx));let by=r.bottom+12;if(by+estH>window.innerHeight-12){by=r.top-estH-12}if(by<12)by=12;bubble.style.left=bx+'px';bubble.style.top=by+'px';bubble.style.right='auto';bubble.style.bottom='auto';bubble.style.transform='none'}
    else{const bw=Math.min(300,window.innerWidth-28);bubble.style.left=(window.innerWidth-bw)/2+'px';bubble.style.top='80px';bubble.style.right='auto';bubble.style.bottom='auto';bubble.style.transform='none'}
    bubble.querySelector('.tour-skip').onclick=close;
    const nx=bubble.querySelector('.tour-next');nx.onclick=()=>{if(i===steps.length-1)close();else{i++;show()}};
    const pv=bubble.querySelector('.tour-prev');if(pv)pv.onclick=()=>{if(i>0){i--;show()}};
  }
  show();
}

init();
