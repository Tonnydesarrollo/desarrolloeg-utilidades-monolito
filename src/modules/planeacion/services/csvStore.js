import fs from 'fs';
import path from 'path';

function getDataDir() {
  return process.env.PLANEACION_DATA_DIR || path.resolve(process.cwd(), 'src', 'modules', 'planeacion', 'data');
}

const CSV_PATH = () => path.join(getDataDir(), 'branches.csv');
const HEADERS = ['id','label','empresa_id','empresa_nombre','municipio_id','municipio_nombre','estado_id','estado_nombre','lat','lng','address','updated_at'];

function ensureDataDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeCsv(value) {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function writeBranches(rows) {
  ensureDataDir();
  const lines = rows.map((row) => HEADERS.map((key) => escapeCsv(String(row[key] ?? ''))).join(','));
  fs.writeFileSync(CSV_PATH(), [HEADERS.join(','), ...lines].join('\n'), 'utf8');
}

export function readBranches() {
  const filePath = CSV_PATH();
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  const lines = content.split('\n');
  const header = lines.shift();
  if (!header) return [];
  const columns = header.split(',');
  return lines.filter((line) => line.trim() !== '').map(parseCsvLine).map((values) => {
    const row = { id:'', label:'', empresa_id:'', empresa_nombre:'', municipio_id:'', municipio_nombre:'', estado_id:'', estado_nombre:'', lat:'', lng:'', address:'', updated_at:'' };
    columns.forEach((col, idx) => { row[col] = values[idx] ?? ''; });
    return row;
  });
}

export function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export function readCsvFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  const lines = content.split('\n');
  const header = lines.shift();
  if (!header) return [];
  const columns = parseCsvLine(header);
  return lines.filter((line) => line.trim() !== '').map(parseCsvLine).map((values) => {
    const row = {};
    columns.forEach((col, idx) => { row[col] = values[idx] ?? ''; });
    return row;
  });
}

export function writeCsvFile(filePath, columns, rows) {
  const lines = [columns.join(','), ...rows.map((row) => columns.map((col) => escapeCsv(String(row[col] ?? ''))).join(','))];
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}
