// 批量抓多个商品详情正文（临时排查用）
const puppeteer=require('puppeteer-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const IDS=process.argv.slice(2);
(async()=>{
  const b=await puppeteer.connect({browserURL:'http://127.0.0.1:18803'});
  const ps=await b.pages();
  const p=ps.find(x=>x.url().includes('goofish'))||ps[0];
  for(const id of IDS){
    await p.goto('https://www.goofish.com/item?id='+id,{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(4200);
    await p.evaluate(()=>{document.querySelectorAll('[class*="close"]').forEach(b=>{try{b.click()}catch(e){}})}).catch(()=>{});
    await p.keyboard.press('Escape').catch(()=>{});
    await sleep(500);
    const t=await p.evaluate(()=>document.body.innerText.slice(0,1400));
    console.log('\n########## '+id+' ##########');
    console.log(t);
  }
  b.disconnect();
})();
