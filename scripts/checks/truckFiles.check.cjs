// Run: node scripts/checks/truckFiles.check.cjs <path to typescript package>
// Trucks: always editable (with a photo), documents and insurance (PDFs), and private owner-only notes.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(read('src/lib/truckDocs.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const d = m.exports;
let bad = 0;
const check = (n, ok, detail) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (detail || ''))); };

check('1 PDFs and common photo types are accepted; other files are not',
  d.isAllowedDocument('application/pdf', 'x.pdf') && d.isAllowedDocument('image/heic', 'card.HEIC') && d.isAllowedDocument('application/octet-stream', 'policy.pdf') && !d.isAllowedDocument('application/zip', 'a.zip') && !d.isAllowedDocument(undefined, 'virus.exe'));
const today = new Date(2026, 9, 19);
check('2 expiry: expired, expiring within 30 days, fine, or no date',
  d.expiryStatus('2026-10-01', today).state === 'expired' && /Expired Oct 1, 2026/.test(d.expiryStatus('2026-10-01', today).label)
  && d.expiryStatus('2026-10-30', today).state === 'soon' && d.expiryStatus('2026-10-30', today).label === 'Expires in 11 days'
  && d.expiryStatus('2026-10-19', today).label === 'Expires today' && d.expiryStatus('2027-06-01', today).state === 'ok' && d.expiryStatus('', today).state === 'none');
check('3 titles and sizes read well', d.suggestedTitle('insurance', 'State_Farm_Policy.pdf') === 'State Farm Policy' && d.suggestedTitle('registration') === 'Registration' && d.formatSize(1536) === '2 KB' && d.formatSize(2.5 * 1024 * 1024) === '2.5 MB');
check('4 a note needs text and a sensible length', d.noteProblem('  ') !== '' && d.noteProblem('Needs tires') === '' && d.noteProblem('x'.repeat(2001)) !== '');

const sql = read('supabase/updates/056_truck_documents_notes.sql');
check('5 the database keeps documents and notes OWNER-ONLY (not admins, workers or customers) and tested',
  /is_company_owner\(company_id\)/.test(sql) && /member_role\(cid\) = 'owner'/.test(sql) && fs.existsSync(path.join(__dirname, '../../supabase/tests/056_truck_documents_notes.pglite.mjs')));
check('6 PDFs can be uploaded (client and the media function)', /application\/pdf/.test(read('src/lib/media.ts')) && /'application\/pdf': 'pdf'/.test(read('supabase/functions/media/index.ts')));

const form = read('src/components/trucks/TruckForm.tsx');
check('7 one form adds AND edits a truck: all fields incl. VIN, color and every status (also Out of Service), photo take/choose/remove',
  /export function TruckForm\(\{ truckId \}/.test(form) && /label="VIN"/.test(form) && /label="Color"/.test(form) && /key: 'out_of_service'/.test(form) && /Take Photo/.test(form) && /Remove Photo/.test(form) && /updateTruck\(truckId,/.test(form));
check('8 the photo picker has no system crop screen (it crashed on iOS 27)', !/allowsEditing: true/.test(form + read('src/lib/pickImage.ts')) && /pickImage\(source, \{ afterSheetMs: 650 \}\)/.test(form));
check('9 documents can be added while adding a truck (uploaded once it is saved), owner only', /staged/.test(form) && /addTruckDocument\(id, d\)/.test(form) && /!editing && isOwner/.test(form));
const detail = read('app/(owner)/(tabs)/more/trucks/[id].tsx');
check('10 the truck page has ONE edit control (the pencil at the top right, no second Edit Truck button), and routes exist',
  !/title="Edit Truck"/.test(detail) && /accessibilityLabel="Edit this truck"/.test(detail) && fs.existsSync(path.join(__dirname, '../../app/(owner)/(tabs)/more/trucks/edit.tsx')) && /TruckForm/.test(read('app/(owner)/(tabs)/more/trucks/new.tsx')));
check('11 documents and private notes show only for the owner', /\{isOwner && <TruckPrivateSection truckId=\{truck\.id\} \/>\}/.test(detail) && /db\.role === 'owner'/.test(read('src/data/truckFiles.ts')));
const priv = read('src/components/trucks/TruckPrivateSection.tsx');
check('12 insurance opens on tap, shows expiry warnings and can be deleted with a confirmation; there are no private notes any more',
  /Linking\.openURL\(d\.fileUrl\)/.test(priv) && /expiryStatus\(d\.expiresOn\)/.test(priv) && /Delete this insurance\?/.test(priv) && !/Private Notes/.test(priv) && !/TruckNote|useTruckNotes/.test(priv));
check('13 the card is called Insurance and lists only insurance papers; Maintenance is a separate card',
  /title="Insurance"/.test(priv) && /d\.kind === 'insurance'/.test(priv) && /title="Maintenance"/.test(priv) && !/Documents & Insurance/.test(priv + form));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
