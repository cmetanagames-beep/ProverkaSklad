Exit code: 0
Wall time: 0.9 seconds
Output:
(function(){
  const DB='akfix-offline', STORE='uploads';
  let syncing=null;
  function open(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
  async function transaction(mode,run){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);let result;try{result=run(store)}catch(e){reject(e)}tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error)})}
  function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  async function enqueue(form,user){const fields={},files=[];for(const [key,value] of form.entries()){if(value instanceof Blob)files.push({key,blob:value,name:value.name||'photo.jpg',type:value.type||'image/jpeg'});else fields[key]=value}const item={id:`${user.login}:${fields.orderId}`,userLogin:user.login,userName:user.name,warehouse:user.warehouse,createdAt:new Date().toISOString(),fields,files};await transaction('readwrite',store=>store.put(item));await schedule();dispatchEvent(new CustomEvent('offlinequeuechange'));return item}
  async function list(userLogin){const rows=await transaction('readonly',store=>request(store.getAll()));const resolved=await rows;return userLogin?resolved.filter(x=>x.userLogin===userLogin):resolved}
  async function remove(id){await transaction('readwrite',store=>store.delete(id));dispatchEvent(new CustomEvent('offlinequeuechange'))}
  async function runSync(userLogin){if(!navigator.onLine)return{sent:0};let sent=0;for(const item of await list(userLogin)){const form=new FormData();Object.entries(item.fields).forEach(([k,v])=>form.set(k,v));item.files.forEach(file=>form.append(file.key,file.blob,file.name));let response;try{response=await fetch('/api/checks/complete',{method:'POST',body:form})}catch{return{sent,offline:true}}if(response.status===401)return{sent,authRequired:true};if(!response.ok)return{sent,error:true};await remove(item.id);sent++}return{sent}}
  function sync(userLogin){if(syncing)return syncing;syncing=runSync(userLogin).finally(()=>{syncing=null});return syncing}
  async function schedule(){if('serviceWorker'in navigator){const registration=await navigator.serviceWorker.ready;try{await registration.sync?.register('akfix-upload')}catch{}}}
  window.OfflineQueue={enqueue,list,remove,sync};
})();

