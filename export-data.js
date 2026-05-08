// Temporary script - run with: node export-data.js
// Exports modules, lessons, softwares, plans, plan_softwares, resources to JSON
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function exportData() {
  const data = {};
  data.modules = (await pool.query('SELECT title,description,icon,cover_image,order_position,is_bonus FROM modules ORDER BY order_position')).rows;
  data.lessons = (await pool.query('SELECT m.title as module_title, l.title,l.description,l.content_type,l.content_url,l.thumbnail,l.duration,l.order_position FROM lessons l JOIN modules m ON m.id=l.module_id ORDER BY l.module_id,l.order_position')).rows;
  data.resources = (await pool.query('SELECT title,description,file_url,resource_type FROM resources')).rows;
  data.softwares = (await pool.query('SELECT name,description,download_url,tutorial_url,icon,order_position,links FROM softwares ORDER BY order_position')).rows;
  data.plans = (await pool.query(`SELECT p.name,p.description,p.duration_months,p.order_position,p.has_discord,p.has_bot,p.bot_message_limit,
    s.name as bot_sw_name, p.allowed_modules,
    array_agg(DISTINCT sw.name) FILTER (WHERE sw.name IS NOT NULL) as software_names,
    array_agg(DISTINCT m.title) FILTER (WHERE m.title IS NOT NULL) as module_titles
    FROM plans p
    LEFT JOIN softwares s ON s.id=p.bot_credential_software_id
    LEFT JOIN plan_softwares ps ON ps.plan_id=p.id
    LEFT JOIN softwares sw ON sw.id=ps.software_id
    LEFT JOIN modules m ON m.id = ANY(
      CASE WHEN jsonb_typeof(p.allowed_modules)='array' THEN
        (SELECT array_agg(x::int) FROM jsonb_array_elements_text(p.allowed_modules) x)
      ELSE ARRAY[]::int[] END
    )
    GROUP BY p.id, s.name ORDER BY p.order_position`)).rows;

  fs.writeFileSync('/tmp/platform-export.json', JSON.stringify(data, null, 2));
  console.log('Exported:', Object.keys(data).map(k => k + ':' + data[k].length).join(', '));
  console.log('File: /tmp/platform-export.json');
  await pool.end();
}
exportData().catch(console.error);
