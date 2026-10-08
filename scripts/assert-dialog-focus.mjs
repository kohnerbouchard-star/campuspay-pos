import assert from 'node:assert/strict'
import { expect } from '@playwright/test'

// Exercise the actual StudentDetail/Dialog components rendered by the fixture.
// This adds edge assertions; the original suite's focus loops stay unchanged.
export async function assertDialogFocus(page) {
 const trace=[]
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000})
  const row=page.getByRole('row').filter({hasText:'UI-001'}).getByRole('button')
  await row.focus();await page.keyboard.press(width===390?'Space':'Enter')
  const dialog=page.getByRole('dialog',{name:'Student account · Synthetic Student 001 · UI-001',exact:true})
  await expect(dialog).toBeVisible();assert.ok(await dialog.evaluate(n=>n.matches(':modal')))
  const close=dialog.getByRole('button',{name:'Close dialog',exact:true}),more=dialog.locator('summary').filter({hasText:'More student actions'})
  await close.focus();await page.keyboard.press('Shift+Tab');await expect(more).toBeFocused()
  await page.keyboard.press('Tab');await expect(close).toBeFocused()
  await more.focus();await page.keyboard.press('Enter')
  const status=dialog.getByRole('button',{name:'Manage Status',exact:true});await expect(status).toBeVisible()
  await close.focus();await page.keyboard.press('Shift+Tab');await expect(status).toBeFocused()
  await page.keyboard.press('Tab');await expect(close).toBeFocused()
  await more.focus();await page.keyboard.press('Enter');await expect(status).toBeHidden();await close.focus()
  for(const key of ['Tab','Shift+Tab'])for(let index=0;index<8;index++){
   await page.keyboard.press(key)
   const state=await dialog.evaluate(n=>({inside:n.contains(document.activeElement),modal:n.matches(':modal'),tag:document.activeElement.tagName,name:document.activeElement.getAttribute('aria-label')??document.activeElement.textContent?.slice(0,80)}))
   trace.push({width,key,index,...state});assert.ok(state.inside,JSON.stringify(trace.at(-1)))
  }
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(row).toBeFocused()
 }
 return trace
}
