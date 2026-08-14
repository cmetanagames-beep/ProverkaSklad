const products=[
 {article:'CA032',name:'Akfix C900 Химический Анкер, 300 мл.',plan:1788,pack:'упак (12 шт)'},
 {article:'AS3242',name:'Akfix D3 Клей ПВА Д3, 500 гр. Белый',plan:9600,pack:'упак (12 шт)'},
 {article:'SA046',name:'Akfix 100E Универсальный силикон, 280 мл. Серый',plan:7632,pack:'упак (24 шт)'},
 {article:'SA044',name:'Akfix 100E Универсальный силикон, 280 мл. Коричневый',plan:7632,pack:'упак (24 шт)'},
 {article:'AA701',name:'Akfix AC607 Огнестойкий акриловый герметик, 310 мл. Белый',plan:7356,pack:'упак (12 шт)'},
 {article:'SA031',name:'Akfix 100S Санитарный силикон, 280 мл. Прозрачный',plan:11520,pack:'упак (24 шт)'},
 {article:'SA031',name:'Akfix 100S Санитарный силикон, 280 мл. Прозрачный',plan:11520,pack:'упак (24 шт)'}
];
const saved=JSON.parse(localStorage.getItem('akfix_receiving_fura90')||'{}');
const state={open:0,query:'',complete:false,rows:products.map((p,i)=>saved.rows?.[i]||{done:false,alloc:[{qty:p.plan,date:'',batch:'',cell:'',comment:''}]})};
const app=document.querySelector('#app');
let scannerStream=null,scannerFrame=0,scanAllocation=null;
function persist(){localStorage.setItem('akfix_receiving_fura90',JSON.stringify({rows:state.rows}))}
function esc(s=''){return String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
function excelEsc(s=''){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function formatDate(value){if(!value)return'';const [y,m,d]=value.split('-');return `${d}.${m}.${y}`}
function exportExcel(){
 const rows=[];
 state.rows.forEach((row,i)=>row.alloc.forEach(a=>rows.push([products[i].name,products[i].article,`${a.batch} (${formatDate(a.date)})`,Number(a.qty),'шт'])));
 const cell=(value,type='String')=>`<Cell><Data ss:Type="${type}">${excelEsc(value)}</Data></Cell>`;
 const body=[['Номенклатура','Артикул','Серия (срок годности)','Количество','Упаковка'],...rows].map((r,ri)=>`<Row>${r.map((v,ci)=>cell(v,ri>0&&ci===3?'Number':'String')).join('')}</Row>`).join('');
 const xml=`<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Товары"><Table><Column ss:Width="330"/><Column ss:Width="90"/><Column ss:Width="170"/><Column ss:Width="90"/><Column ss:Width="90"/>${body}</Table></Worksheet></Workbook>`;
 const blob=new Blob([xml],{type:'application/vnd.ms-excel;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='Фура 90 - приёмка.xls';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Excel-файл сформирован');
}
function stopScanner(){cancelAnimationFrame(scannerFrame);scannerFrame=0;scannerStream?.getTracks().forEach(track=>track.stop());scannerStream=null;document.querySelector('#scannerVideo').srcObject=null;document.querySelector('#scanner').hidden=true}
async function startScanner(allocationIndex){
 if(!('BarcodeDetector'in window))return toast('Сканер не поддерживается этим браузером — введите ячейку вручную');
 scanAllocation=allocationIndex;
 const overlay=document.querySelector('#scanner'),video=document.querySelector('#scannerVideo'),hint=document.querySelector('#scannerHint');
 overlay.hidden=false;hint.textContent='Запрашиваем доступ к камере…';
 try{
  const formats=await BarcodeDetector.getSupportedFormats();
  const wanted=['qr_code','code_128','code_39','ean_13','ean_8','data_matrix'].filter(x=>formats.includes(x));
  const detector=new BarcodeDetector(wanted.length?{formats:wanted}:undefined);
  scannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
  video.srcObject=scannerStream;await video.play();hint.textContent='Наведите камеру на QR-код или штрихкод ячейки';
  const detect=async()=>{if(!scannerStream)return;try{const codes=await detector.detect(video);if(codes[0]?.rawValue){state.rows[state.open].alloc[scanAllocation].cell=codes[0].rawValue.trim();persist();stopScanner();render();toast(`Ячейка: ${codes[0].rawValue.trim()}`);return}}catch{}scannerFrame=requestAnimationFrame(detect)};detect();
 }catch(error){stopScanner();toast(error.name==='NotAllowedError'?'Разрешите доступ к камере':'Не удалось открыть камеру')}
}
function allocation(a,j,total){return `<section class="allocation"><h3>Размещение ${total>1?j+1:''}${total>1?`<button class="remove" data-remove="${j}">Удалить</button>`:''}</h3><div class="grid"><label class="field">Фактически принято<input inputmode="numeric" data-key="qty" data-a="${j}" value="${esc(a.qty)}"></label><label class="field">Срок годности<input type="date" data-key="date" data-a="${j}" value="${esc(a.date)}"></label><label class="field">Серия / партия<input data-key="batch" data-a="${j}" placeholder="Например, 2408A" value="${esc(a.batch)}"></label><label class="field">Ячейка хранения<span class="cell-control"><input data-key="cell" data-a="${j}" placeholder="Например, A-01-03" value="${esc(a.cell)}"><button type="button" class="scan-cell" data-scan="${j}" aria-label="Сканировать ячейку">⌗</button></span></label><label class="field full">Комментарий<input data-key="comment" data-a="${j}" placeholder="Необязательно" value="${esc(a.comment)}"></label></div></section>`}
function render(){if(state.complete){app.innerHTML=`<div class="shell"><div class="complete"><div class="check">✓</div><h2>Приёмка завершена</h2><p>Фура 90 · принято ${state.rows.reduce((s,r)=>s+r.alloc.reduce((x,a)=>x+Number(a.qty||0),0),0).toLocaleString('ru-RU')} шт.<br>Файл содержит только данные для загрузки таблицы «Товары».</p><button class="btn primary export" id="export">Скачать Excel</button><button class="btn outline" id="return">Вернуться к позициям</button></div></div>`;document.querySelector('#export').onclick=exportExcel;document.querySelector('#return').onclick=()=>{state.complete=false;render()};return}
 const done=state.rows.filter(r=>r.done).length, filtered=products.map((p,i)=>({...p,i})).filter(p=>(p.article+' '+p.name).toLowerCase().includes(state.query.toLowerCase()));
 app.innerHTML=`<div class="shell"><header class="top"><button class="back">‹</button><h1>Приёмка</h1><span></span></header><section class="summary"><h2>Фура 90</h2><p>${done} из 7 позиций · данные из Excel</p><div class="progress"><div class="track"><div class="bar" style="width:${done/7*100}%"></div></div><b>${Math.round(done/7*100)}%</b></div></section><input class="search" placeholder="Поиск по артикулу или названию" value="${esc(state.query)}"><div class="labels"><span>Артикул / товар</span><span>План</span><span>Статус</span></div><section>${filtered.map(p=>{const r=state.rows[p.i],open=state.open===p.i;return `<article class="item ${open?'open':''} ${r.done?'done':''}"><div class="item-head" data-open="${p.i}"><span class="num">${p.i+1}</span><span class="product"><b>${p.article}</b><small>${p.name}<br>${p.pack}</small></span><span class="qty">${p.plan.toLocaleString('ru-RU')}</span><span class="status">${r.done?'Готово':'Ожидает'} ${open?'⌃':'⌄'}</span></div>${open?`<div class="form">${r.alloc.map((a,j)=>allocation(a,j,r.alloc.length)).join('')}<div class="actions"><button class="btn outline" id="split">Разделить размещение</button><button class="btn primary" id="save">Сохранить позицию</button></div></div>`:''}</article>`}).join('')||'<div class="empty">Ничего не найдено</div>'}</section><footer class="finish"><button class="btn primary" id="finish" ${done<7?'disabled':''}>Завершить приёмку</button></footer></div>`;
 wire();}
function wire(){document.querySelector('.search').oninput=e=>{state.query=e.target.value;render()};document.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>{state.open=state.open===+x.dataset.open?null:+x.dataset.open;render()});document.querySelectorAll('[data-key]').forEach(x=>x.oninput=()=>{state.rows[state.open].alloc[+x.dataset.a][x.dataset.key]=x.value});document.querySelectorAll('[data-scan]').forEach(x=>x.onclick=()=>startScanner(+x.dataset.scan));document.querySelectorAll('[data-remove]').forEach(x=>x.onclick=()=>{state.rows[state.open].alloc.splice(+x.dataset.remove,1);render()});const split=document.querySelector('#split');if(split)split.onclick=()=>{state.rows[state.open].alloc.push({qty:'',date:'',batch:'',cell:'',comment:''});render()};const save=document.querySelector('#save');if(save)save.onclick=()=>{const row=state.rows[state.open],sum=row.alloc.reduce((s,a)=>s+Number(a.qty||0),0);if(row.alloc.some(a=>!a.qty||!a.date||!a.batch||!a.cell))return toast('Заполните количество, срок, партию и ячейку');if(sum!==products[state.open].plan)return toast(`Распределено ${sum}, по плану ${products[state.open].plan}`);row.done=true;persist();state.open=Math.min(state.open+1,6);toast('Позиция сохранена');render()};const finish=document.querySelector('#finish');if(finish)finish.onclick=()=>{state.complete=true;render()}}
function toast(t){const el=document.querySelector('#toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2200)}document.querySelector('#closeScanner').onclick=stopScanner;document.querySelector('#scanner').onclick=e=>{if(e.target.id==='scanner')stopScanner()};addEventListener('pagehide',stopScanner);render();
