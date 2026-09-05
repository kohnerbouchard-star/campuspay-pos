from pathlib import Path
p=Path('scripts/integration-test.mjs')
s=p.read_text().replace("async function request(cookies,path,body,expected=200) {", "async function request(cookies,path,body,expected=200) {\n if (expected===200 && body!==undefined && ['/api/pos/intents','/api/accounting/intents','/api/inventory/products','/api/inventory/receipts','/api/coupons'].includes(path)) expected=201")
p.write_text(s)
for file in ['scripts/integration-test.mjs','scripts/bootstrap-demo.mjs']:
 p=Path(file);s=p.read_text().replace("'card:04A81F92C73180'","'04A81F92C73180'").replace("'coupon:WELCOME10'","'WELCOME10'");p.write_text(s)
# Fresh demo fixtures must reconcile their header cost to all five inventory lots.
p=Path('database/schema/010_demo_bootstrap.sql');p.write_text(p.read_text().replace('85500, 0, 0, 0, 85500','122000, 0, 0, 0, 122000'))
