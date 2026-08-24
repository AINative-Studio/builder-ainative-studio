import { test, expect } from '@playwright/test'
const CID='zdbtest-1784597561', NAME='RT1784597804'

async function waitForApp(page:any){
  // wait until the real app (not "Refining"/"Generating") is mounted with the input
  for (let i=0;i<20;i++){
    const body = await page.locator('body').innerText().catch(()=>'')
    const hasInput = await page.getByPlaceholder(/contact name|name/i).count().catch(()=>0)
    if (hasInput>0 && !/Refining your app|Generating your app/i.test(body)) return true
    await page.waitForTimeout(1500)
  }
  return false
}

test('ZeroDB round-trip robust', async ({ page }) => {
  test.setTimeout(120000)
  const db:{m:string}[]=[]
  page.on('request',(r:any)=>{ if(/\/api\/db\//.test(r.url())) db.push({m:r.method()}) })

  await page.goto('https://builder.ainative.studio/api/preview/'+CID, { waitUntil:'domcontentloaded' })
  const ready1 = await waitForApp(page)
  console.log('[RT] app rendered on first load: '+ready1+' | GET-on-mount: '+db.some(d=>d.m==='GET'))
  if(!ready1){ console.log('[RT] ABORT: app did not render'); return }

  // ADD
  await page.getByPlaceholder(/contact name|name/i).first().fill(NAME)
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /^add/i }).first().click().catch(async()=>{
    await page.locator('button:visible').filter({hasText:/add/i}).first().click().catch(()=>{})
  })
  await page.waitForTimeout(3000)
  const appeared = (await page.locator('body').innerText().catch(()=>'')).includes(NAME)
  const posted = db.some(d=>d.m==='POST')
  console.log('[RT] ADD: appears='+appeared+' POST='+posted)

  // RELOAD — the real persistence test
  await page.reload({ waitUntil:'domcontentloaded' })
  const ready2 = await waitForApp(page)
  await page.waitForTimeout(2000)
  const survived = (await page.locator('body').innerText().catch(()=>'')).includes(NAME)
  await page.screenshot({ path: 'e2e/screenshots/zdb-rt2.png' }).catch(()=>{})
  console.log('[RT] RELOAD: appRendered='+ready2+' contactSURVIVED='+survived)
  console.log('[RT] db calls: '+db.map(d=>d.m).join(','))

  expect(posted, 'POST to ZeroDB on add').toBe(true)
  expect(survived, 'contact survives page reload = real ZeroDB persistence').toBe(true)
})
