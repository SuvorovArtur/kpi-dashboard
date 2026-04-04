import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabase = createClient(
  'https://dwrpellubzpjblmffmqv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3cnBlbGx1YnpwamJsbWZmbXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxODAwMDMsImV4cCI6MjA5MDc1NjAwM30.hL450C8_2by4Gwinjdg_xUa3W-igc-ospOGJYmMFq84'
);

const basePath = process.cwd() + '/src/data';

// Load KPI values
const kpiValues = JSON.parse(readFileSync(`${basePath}/kpi-values.json`, 'utf-8'));
const rows = kpiValues.map(d => ({
  date: d.date,
  kpi_id: d.kpiId,
  value: d.value,
  territory: d.territory || null,
  note: d.note || null,
}));

// Insert in batches of 500
for (let i = 0; i < rows.length; i += 500) {
  const batch = rows.slice(i, i + 500);
  const { error } = await supabase.from('kpi_values').insert(batch);
  if (error) {
    console.error(`KPI values batch ${i} error:`, error.message);
  } else {
    console.log(`KPI values: inserted ${i + batch.length}/${rows.length}`);
  }
}

// Load appeals
const appeals = JSON.parse(readFileSync(`${basePath}/appeals.json`, 'utf-8'));
const appealRows = appeals.map(a => ({
  id: a.id,
  date: a.date,
  category: a.category,
  territory: a.territory || null,
  status: a.status,
  response_hours: a.responseHours ?? null,
  has_photo_before: a.hasPhotoBefore ?? false,
  has_photo_after: a.hasPhotoAfter ?? false,
  source: a.source || null,
}));

for (let i = 0; i < appealRows.length; i += 500) {
  const batch = appealRows.slice(i, i + 500);
  const { error } = await supabase.from('appeals').insert(batch);
  if (error) {
    console.error(`Appeals batch ${i} error:`, error.message);
  } else {
    console.log(`Appeals: inserted ${i + batch.length}/${appealRows.length}`);
  }
}

// Load staff
const staff = JSON.parse(readFileSync(`${basePath}/staff.json`, 'utf-8'));
const staffRows = staff.map(s => ({
  date: s.date,
  total_staff: s.totalStaff,
  aup: s.aup,
  workers: s.workers,
  vacancies: s.vacancies,
  vacancies_over_30d: s.vacanciesOver30d,
  turnover_percent: s.turnoverPercent,
  avg_worker_salary: s.avgWorkerSalary,
}));

const { error: staffErr } = await supabase.from('staff_metrics').insert(staffRows);
if (staffErr) console.error('Staff error:', staffErr.message);
else console.log(`Staff: inserted ${staffRows.length}`);

// Load roadmap
const roadmap = JSON.parse(readFileSync(`${basePath}/roadmap.json`, 'utf-8'));
const roadmapRows = roadmap.map(r => ({
  id: r.id,
  track: r.track,
  title: r.title,
  start_date: r.startDate,
  end_date: r.endDate,
  status: r.status,
  linked_kpis: r.linkedKpis || [],
}));

const { error: roadmapErr } = await supabase.from('roadmap').insert(roadmapRows);
if (roadmapErr) console.error('Roadmap error:', roadmapErr.message);
else console.log(`Roadmap: inserted ${roadmapRows.length}`);

console.log('Done!');
