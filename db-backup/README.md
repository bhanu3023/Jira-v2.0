# neutara_db Backup

## Files
- neutara_db_*.dump  — Custom-format binary dump (faster restore, pg_restore required)
- neutara_db_*.sql   — Plain SQL dump (portable, psql required)

## Restore Instructions

### Option A — Binary dump (recommended, faster)
`
pg_restore -h localhost -p 5432 -U postgres -d neutara_db --clean --if-exists neutara_db_YYYYMMDD_HHMM.dump
`

### Option B — Plain SQL
`
psql -h localhost -p 5432 -U postgres -d neutara_db -f neutara_db_YYYYMMDD_HHMM.sql
`

## Connection
- Host     : localhost
- Port     : 5432
- Database : neutara_db
- User     : postgres
- Password : neutara123

## Stats (as of backup)
- Users    : 260
- Spaces   : 12
- Issues   : ~93,890
- Comments : ~60,177
- Test steps stored in issues.testSteps (59,947 issues)
