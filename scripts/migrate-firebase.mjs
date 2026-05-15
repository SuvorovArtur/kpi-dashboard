/**
 * Миграция данных из Firebase (ya-vector-mytishi) → Supabase (kpi-dashboard)
 *
 * Читает Firestore документы dashboard/data и dashboard/plans,
 * конвертирует в строки для attendance_records и attendance_plans,
 * записывает в Supabase.
 *
 * Только МБУ «МТХ» (orgIndex = 0, DEFAULT_PLAN = 50).
 *
 * Запуск: node scripts/migrate-firebase.mjs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { createClient } from '@supabase/supabase-js';

// Firebase config (from ya-vector-mytishi)
const firebaseConfig = {
  apiKey: "AIzaSyCtZ2oTtMahLJ8G6O8Xg7zgEGLC0NwSnCI",
  authDomain: "ya-vector-mytishi.firebaseapp.com",
  projectId: "ya-vector-mytishi",
  storageBucket: "ya-vector-mytishi.firebasestorage.app",
  messagingSenderId: "538524700022",
  appId: "1:538524700022:web:7ecd0abe25b1a0f50efe57"
};

// Supabase config
const SUPABASE_URL = 'https://dwrpellubzpjblmffmqv.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3cnBlbGx1YnpwamJsbWZmbXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxODAwMDMsImV4cCI6MjA5MDc1NjAwM30.hL450C8_2by4Gwinjdg_xUa3W-igc-ospOGJYmMFq84';

const ORG = 'МБУ «МТХ»';
const DEFAULT_PLAN = 50;

async function main() {
  console.log('🔄 Начинаю миграцию Firebase → Supabase...\n');

  // 1. Read from Firebase
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const [dataSnap, plansSnap] = await Promise.all([
    getDoc(doc(db, 'dashboard', 'data')),
    getDoc(doc(db, 'dashboard', 'plans')),
  ]);

  const data = dataSnap.exists() ? dataSnap.data() : {};
  const plans = plansSnap.exists() ? plansSnap.data() : {};

  console.log('✅ Firebase прочитан');
  console.log(`   Организации в data: ${Object.keys(data).join(', ')}`);
  console.log(`   Организации в plans: ${Object.keys(plans).join(', ')}\n`);

  // 2. Extract МТХ data
  const mthData = data[ORG] || {};
  const mthPlans = plans[ORG] || {};

  // Convert plans
  const planRows = [];
  for (const [yearStr, months] of Object.entries(mthPlans)) {
    for (const [monthStr, value] of Object.entries(months)) {
      planRows.push({
        year: Number(yearStr),
        month: Number(monthStr),
        plan_value: Number(value),
      });
    }
  }

  // Convert records
  const recordRows = [];
  for (const [yearStr, months] of Object.entries(mthData)) {
    const year = Number(yearStr);
    for (const [monthStr, days] of Object.entries(months)) {
      const month = Number(monthStr);
      const plan = mthPlans?.[yearStr]?.[monthStr] ?? DEFAULT_PLAN;
      for (const [dayStr, rec] of Object.entries(days)) {
        const day = Number(dayStr);
        if (rec && typeof rec === 'object' && 'fact' in rec) {
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          recordRows.push({
            date: dateStr,
            fact: Number(rec.fact),
            plan: Number(plan),
          });
        }
      }
    }
  }

  console.log(`📊 Найдено:`);
  console.log(`   Планы: ${planRows.length} записей`);
  console.log(`   Записи: ${recordRows.length} записей\n`);

  if (recordRows.length === 0 && planRows.length === 0) {
    console.log('⚠️  Нет данных для миграции');
    process.exit(0);
  }

  // Show sample
  if (recordRows.length > 0) {
    const sorted = [...recordRows].sort((a, b) => a.date.localeCompare(b.date));
    console.log(`   Первая запись: ${sorted[0].date} — факт ${sorted[0].fact} из ${sorted[0].plan}`);
    console.log(`   Последняя:    ${sorted[sorted.length - 1].date} — факт ${sorted[sorted.length - 1].fact} из ${sorted[sorted.length - 1].plan}\n`);
  }

  // 3. Write to Supabase
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  if (planRows.length > 0) {
    const { error } = await supabase.from('attendance_plans').upsert(planRows, { onConflict: 'year,month' });
    if (error) {
      console.error('❌ Ошибка записи планов:', error.message);
    } else {
      console.log(`✅ Планы: ${planRows.length} записей → attendance_plans`);
    }
  }

  if (recordRows.length > 0) {
    // Batch by 500
    for (let i = 0; i < recordRows.length; i += 500) {
      const batch = recordRows.slice(i, i + 500);
      const { error } = await supabase.from('attendance_records').upsert(batch, { onConflict: 'date' });
      if (error) {
        console.error(`❌ Ошибка записи (batch ${i}):`, error.message);
      } else {
        console.log(`✅ Записи: batch ${i + 1}-${i + batch.length} → attendance_records`);
      }
    }
  }

  console.log('\n🎉 Миграция завершена!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Ошибка:', err);
  process.exit(1);
});
