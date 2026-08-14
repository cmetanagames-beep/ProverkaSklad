let products=[];
let shipmentName='';
let storageKey='';
const state={open:0,query:'',complete:false,rows:[]};
const app=document.querySelector('#app');
let scannerStream=null,scannerFrame=0,scannerControls=null,scanAllocation=null;

const esc=(s='')=>String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const formatDate=value=>{if(!value)return'';const[y,m]=value.split('-');return`${m}.${y}`};
const columnIndex=ref=>{let n=0;for(const c of ref.match(/[A-Z]+/i)?.[0]||'')n=n*26+c.toUpperCase().charCodeAt(0)-64;return n-1};
const cleanPath=value=>{const parts=[];for(const part of value.replace(/^\//,'').split('/'))part==='..'?parts.pop():part!=='.'&&parts.push(part);return parts.join('/')};

function persist(){if(storageKey)localStorage.setItem(storageKey,JSON.stringify({rows:state.rows}))}
function toast(text){const el=document.querySelector('#toast');el.textContent=text;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2400)}
const acceptedForRow=row=>row.alloc.reduce((sum,a)=>sum+Number(a.qty||0),0);
const differenceKind=diff=>diff<0?'shortage':diff>0?'surplus':'exact';
const signed=value=>value>0?`+${value.toLocaleString('ru-RU')}`:value.toLocaleString('ru-RU');

async function unzip(buffer){
 const bytes=new Uint8Array(buffer),view=new DataView(buffer);let eocd=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){eocd=i;break}
 if(eocd<0)throw new Error('INVALID_XLSX');
 const count=view.getUint16(eocd+10,true),decoder=new TextDecoder(),files=new Map();let offset=view.getUint32(eocd+16,true);
 for(let i=0;i<count;i++){
  if(view.getUint32(offset,true)!==0x02014b50)throw new Error('INVALID_ZIP');
  const method=view.getUint16(offset+10,true),size=view.getUint32(offset+20,true),nameLen=view.getUint16(offset+28,true),extraLen=view.getUint16(offset+30,true),commentLen=view.getUint16(offset+32,true),local=view.getUint32(offset+42,true),name=decoder.decode(bytes.slice(offset+46,offset+46+nameLen));
  const localName=view.getUint16(local+26,true),localExtra=view.getUint16(local+28,true),start=local+30+localName+localExtra,data=bytes.slice(start,start+size);
  files.set(cleanPath(name),async()=>method===0?data:new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
  offset+=46+nameLen+extraLen+commentLen;
 }
 return{async text(name){const loader=files.get(cleanPath(name));if(!loader)throw new Error(`MISSING:${name}`);return decoder.decode(await loader())}};
}

async function parseXlsx(file){
 const zip=await unzip(await file.arrayBuffer()),parser=new DOMParser();
 const xml=async path=>parser.parseFromString(await zip.text(path),'application/xml');
 const workbook=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels');
 const relMap=new Map([...rels.querySelectorAll('Relationship')].map(x=>[x.getAttribute('Id'),x.getAttribute('Target')]));
 const firstSheet=workbook.querySelector('sheet');if(!firstSheet)throw new Error('NO_SHEET');
 const relId=firstSheet.getAttribute('r:id')||firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
 let target=relMap.get(relId);if(!target)throw new Error('NO_SHEET_REL');target=cleanPath(target.startsWith('/')?target:`xl/${target}`);
 let shared=[];try{const doc=await xml('xl/sharedStrings.xml');shared=[...doc.querySelectorAll('si')].map(si=>[...si.querySelectorAll('t')].map(t=>t.textContent||'').join(''))}catch{}
 const sheet=await xml(target),rows=[...sheet.querySelectorAll('sheetData > row')].map(row=>{const values=[];for(const cell of row.querySelectorAll('c')){const index=columnIndex(cell.getAttribute('r')||''),type=cell.getAttribute('t'),raw=cell.querySelector('v')?.textContent??cell.querySelector('is t')?.textContent??'';values[index]=type==='s'?shared[Number(raw)]??'':raw}return values});
 const headerIndex=rows.findIndex(row=>row.some(v=>String(v).trim()==='Артикул')&&row.some(v=>String(v).trim()==='Номенклатура'));
 if(headerIndex<0)throw new Error('HEADERS_NOT_FOUND');
 const headers=rows[headerIndex].map(v=>String(v||'').trim().toLowerCase()),dataRows=rows.slice(headerIndex+1);
 const find=name=>headers.findIndex(h=>h===name),findBest=name=>{const candidates=headers.map((h,i)=>h===name?i:-1).filter(i=>i>=0);return candidates.sort((a,b)=>dataRows.filter(r=>r[a]!==''&&r[a]!=null).length-dataRows.filter(r=>r[b]!==''&&r[b]!=null).length).pop()??-1};
 const article=find('артикул'),title=find('номенклатура'),series=find('серия'),quantity=findBest('количество'),pack=findBest('упаковка');
 if(article<0||title<0||quantity<0)throw new Error('COLUMNS_NOT_FOUND');
 const result=dataRows.filter(row=>String(row[article]||row[title]||'').trim()&&Number(row[quantity])>0).map(row=>({article:String(row[article]||'').trim(),name:String(row[title]||'').trim(),series:String(row[series]||'').trim(),plan:Number(row[quantity]),pack:String(row[pack]||'шт').trim()||'шт'}));
 if(!result.length)throw new Error('NO_PRODUCTS');return result;
}

async function loadFile(file){
 if(!file)return;const label=document.querySelector('#uploadState');label.textContent='Читаем файл…';
 try{
  products=await parseXlsx(file);shipmentName=file.name.replace(/\.xlsx?$/i,'');storageKey=`akfix_receiving_v2_${file.name}_${file.size}_${file.lastModified}`;
  const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');state.rows=products.map((p,i)=>saved.rows?.[i]||{done:false,alloc:[{qty:'',date:'',cell:'',comment:''}]});state.open=0;state.query='';state.complete=false;render();toast(`Загружено позиций: ${products.length}`);
 }catch(error){console.error(error);label.textContent='Не удалось прочитать файл. Проверьте формат Excel.'}
}

function renderUpload(){
 app.innerHTML=`<div class="shell upload-shell"><header class="top"><span></span><h1>Приёмка</h1><span></span></header><section class="upload"><div class="upload-icon">⇧</div><h2>Загрузите файл для приёмки</h2><p>Выберите полученный Excel-файл. Данные обрабатываются только на этом устройстве.</p><label class="upload-button">Выбрать Excel<input id="fileInput" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label><small id="uploadState">Поддерживается формат .xlsx</small></section></div>`;
 document.querySelector('#fileInput').onchange=e=>loadFile(e.target.files[0]);
}

function allocation(a,j,total){return`<section class="allocation"><h3>Размещение ${total>1?j+1:''}${total>1?`<button class="remove" data-remove="${j}">Удалить</button>`:''}</h3><div class="grid"><label class="field">Фактически принято<input type="number" min="0" inputmode="numeric" data-key="qty" data-a="${j}" value="${esc(a.qty)}"></label><label class="field">Срок годности (месяц и год)<input type="month" data-key="date" data-a="${j}" value="${esc(a.date)}"></label><label class="field">Ячейка хранения<span class="cell-control"><input data-key="cell" data-a="${j}" placeholder="Например, A-01-03" value="${esc(a.cell)}"><button type="button" class="scan-cell" data-scan="${j}" aria-label="Сканировать ячейку">⌗</button></span></label><label class="field full">Комментарий<input data-key="comment" data-a="${j}" placeholder="Необязательно" value="${esc(a.comment)}"></label></div></section>`}

function exportExcel(){
 if(!window.XLSX)return toast('Модуль Excel не загрузился — обновите страницу');
 const rows=[['Номенклатура','Артикул','Серия','Количество','Упаковка','Ячейка']];
 state.rows.forEach((row,i)=>row.alloc.forEach(a=>rows.push([products[i].name,products[i].article,formatDate(a.date),Number(a.qty),'шт',a.cell])));
 const sheet=XLSX.utils.aoa_to_sheet(rows),workbook=XLSX.utils.book_new();
 sheet['!cols']=[{wch:58},{wch:18},{wch:14},{wch:14},{wch:12},{wch:20}];
 XLSX.utils.book_append_sheet(workbook,sheet,'Товары');
 XLSX.writeFileXLSX(workbook,`${shipmentName} - приёмка.xlsx`,{compression:true});
 toast('Файл Excel .xlsx сформирован');
}

function render(){
 if(!products.length)return renderUpload();
 if(state.complete){app.innerHTML=`<div class="shell"><div class="complete"><div class="check">✓</div><h2>Приёмка завершена</h2><p>${esc(shipmentName)} · принято ${state.rows.reduce((s,r)=>s+r.alloc.reduce((x,a)=>x+Number(a.qty||0),0),0).toLocaleString('ru-RU')} шт.<br>Файл содержит только данные для загрузки таблицы «Товары».</p><button class="btn primary export" id="export">Скачать Excel</button><button class="btn outline" id="return">Вернуться к позициям</button><button class="change-file" id="changeFile">Загрузить другой файл</button></div></div>`;document.querySelector('#export').onclick=exportExcel;document.querySelector('#return').onclick=()=>{state.complete=false;render()};document.querySelector('#changeFile').onclick=resetFile;return}
 const done=state.rows.filter(r=>r.done).length,totalPlan=products.reduce((sum,p)=>sum+p.plan,0),totalAccepted=state.rows.reduce((sum,row)=>sum+(row.done?acceptedForRow(row):0),0),totalDiff=totalAccepted-totalPlan,totalKind=differenceKind(totalDiff),quantityPercent=totalPlan?Math.round(totalAccepted/totalPlan*100):0,filtered=products.map((p,i)=>({...p,i})).filter(p=>(p.article+' '+p.name).toLowerCase().includes(state.query.toLowerCase()));
 app.innerHTML=`<div class="shell"><header class="top"><button class="back" id="changeFile">‹</button><h1>Приёмка</h1><span></span></header><section class="summary"><h2>${esc(shipmentName)}</h2><p>${done} из ${products.length} позиций сохранено</p><div class="quantity-stats"><div class="quantity-stat"><span>По плану</span><b>${totalPlan.toLocaleString('ru-RU')}</b></div><div class="quantity-stat"><span>Принято</span><b>${totalAccepted.toLocaleString('ru-RU')}</b></div><div class="quantity-stat ${totalKind}"><span>Разница</span><b>${signed(totalDiff)}</b></div></div><div class="progress"><div class="track"><div class="bar" style="width:${Math.min(quantityPercent,100)}%"></div></div><b>${quantityPercent}%</b></div></section><input class="search" placeholder="Поиск по артикулу или названию" value="${esc(state.query)}"><div class="labels"><span>Артикул / товар</span><span>План</span><span>Статус</span></div><section>${filtered.map(p=>{const r=state.rows[p.i],open=state.open===p.i,accepted=acceptedForRow(r),diff=accepted-p.plan,kind=differenceKind(diff),status=r.done?(diff===0?'Точно':signed(diff)):'Ожидает';return`<article class="item ${open?'open':''} ${r.done?`done ${kind}`:''}"><div class="item-head" data-open="${p.i}"><span class="num">${p.i+1}</span><span class="product"><b>${esc(p.article)}</b><small>${esc(p.name)}<br>${esc(p.pack)}</small>${r.done?`<small class="accepted-line ${kind}">Принято ${accepted.toLocaleString('ru-RU')} из ${p.plan.toLocaleString('ru-RU')}</small>`:''}</span><span class="qty">${p.plan.toLocaleString('ru-RU')}</span><span class="status">${status} ${open?'⌃':'⌄'}</span></div>${open?`<div class="form">${r.alloc.map((a,j)=>allocation(a,j,r.alloc.length)).join('')}<div class="actions"><button class="btn outline" id="split">Разделить размещение</button><button class="btn primary" id="save">Сохранить позицию</button></div></div>`:''}</article>`}).join('')||'<div class="empty">Ничего не найдено</div>'}</section><footer class="finish"><button class="btn primary" id="finish" ${done<products.length?'disabled':''}>Завершить приёмку</button></footer></div>`;wire();
}

function resetFile(){stopScanner();products=[];shipmentName='';storageKey='';state.rows=[];state.complete=false;render()}
function wire(){
 document.querySelector('#changeFile').onclick=resetFile;document.querySelector('.search').oninput=e=>{state.query=e.target.value;render()};document.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>{state.open=state.open===+x.dataset.open?null:+x.dataset.open;render()});document.querySelectorAll('[data-key]').forEach(x=>x.oninput=()=>{state.rows[state.open].alloc[+x.dataset.a][x.dataset.key]=x.value});document.querySelectorAll('[data-scan]').forEach(x=>x.onclick=()=>startScanner(+x.dataset.scan));document.querySelectorAll('[data-remove]').forEach(x=>x.onclick=()=>{state.rows[state.open].alloc.splice(+x.dataset.remove,1);render()});
 const split=document.querySelector('#split');if(split)split.onclick=()=>{state.rows[state.open].alloc.push({qty:'',date:'',cell:'',comment:''});render()};
 const save=document.querySelector('#save');if(save)save.onclick=()=>{const row=state.rows[state.open];if(row.alloc.some(a=>a.qty===''||!Number.isFinite(Number(a.qty))||Number(a.qty)<0))return toast('Укажите принятое количество — можно 0');if(row.alloc.some(a=>Number(a.qty)>0&&(!a.date||!a.cell)))return toast('Для принятого товара заполните срок и ячейку');const diff=acceptedForRow(row)-products[state.open].plan;row.done=true;persist();state.open=Math.min(state.open+1,products.length-1);toast(diff===0?'Принято по плану':diff<0?`Недостача: ${Math.abs(diff)}`:`Излишек: ${diff}`);render()};
 const finish=document.querySelector('#finish');if(finish)finish.onclick=()=>{state.complete=true;render()};
}

function stopScanner(){cancelAnimationFrame(scannerFrame);scannerFrame=0;scannerControls?.stop?.();scannerControls=null;scannerStream?.getTracks().forEach(track=>track.stop());scannerStream=null;document.querySelector('#scannerVideo').srcObject=null;document.querySelector('#scanner').hidden=true}
function acceptScannedCell(value){const cell=String(value||'').trim();if(!cell)return;state.rows[state.open].alloc[scanAllocation].cell=cell;persist();stopScanner();render();toast(`Ячейка: ${cell}`)}
async function startScanner(allocationIndex){
 scanAllocation=allocationIndex;const overlay=document.querySelector('#scanner'),video=document.querySelector('#scannerVideo'),hint=document.querySelector('#scannerHint');overlay.hidden=false;hint.textContent='Запрашиваем доступ к камере…';
 try{
  if('BarcodeDetector'in window){const formats=await BarcodeDetector.getSupportedFormats(),wanted=['qr_code','code_128','code_39','ean_13','ean_8','data_matrix'].filter(x=>formats.includes(x)),detector=new BarcodeDetector(wanted.length?{formats:wanted}:undefined);scannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});video.srcObject=scannerStream;await video.play();hint.textContent='Наведите камеру на QR-код или штрихкод ячейки';const detect=async()=>{if(!scannerStream)return;try{const codes=await detector.detect(video);if(codes[0]?.rawValue)return acceptScannedCell(codes[0].rawValue)}catch{}scannerFrame=requestAnimationFrame(detect)};return detect()}
  if(window.ZXingBrowser){hint.textContent='Наведите камеру на QR-код или штрихкод ячейки';const reader=new ZXingBrowser.BrowserMultiFormatReader();scannerControls=await reader.decodeFromConstraints({video:{facingMode:{ideal:'environment'}},audio:false},video,result=>{if(result?.getText())acceptScannedCell(result.getText())});return}
  stopScanner();toast('Не удалось загрузить сканер — введите ячейку вручную');
 }catch(error){stopScanner();toast(error.name==='NotAllowedError'?'Разрешите доступ к камере':'Не удалось открыть камеру')}
}

document.querySelector('#closeScanner').onclick=stopScanner;document.querySelector('#scanner').onclick=e=>{if(e.target.id==='scanner')stopScanner()};addEventListener('pagehide',stopScanner);render();
