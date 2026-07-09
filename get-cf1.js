const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:neutara123@localhost:5433/neutara_db' });
pool.query(`
  SELECT i.key, i.cf_key, i.current_department, i.summary, i.priority, i.type, i."createdAt", i."updatedAt",
         i.description, i.labels,
         s.name AS status_name, s.color AS status_color,
         CONCAT(a."firstName", ' ', a."lastName") AS assignee_name, a.email AS assignee_email,
         CONCAT(r."firstName", ' ', r."lastName") AS reporter_name
  FROM issues i
  LEFT JOIN statuses s ON i."statusId" = s.id
  LEFT JOIN users a ON i."assigneeId" = a.id
  LEFT JOIN users r ON i."reporterId" = r.id
  WHERE i.cf_key = 'CF-1' LIMIT 1
`)
  .then(r => { console.log(JSON.stringify(r.rows[0], null, 2)); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
